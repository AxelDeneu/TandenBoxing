import { Buffer } from 'node:buffer'
import { estimateCostUsd } from '../../shared/ai-pricing'
import { GENERATOR_VERSIONS } from '../../shared/generator-version'
import { workoutSessionSchema, type WorkoutSession } from '../../shared/session-schema'
import { SYSTEM_PROMPT } from '../../server/services/generation.service'
import {
  calculateBlockDiversity,
  calculateDurationMetric,
  calculateExerciseOverlap,
  calculateFidelityMetric,
  calculateProgressionMetric,
} from '../metrics'
import type { EvaluationCase, EvaluationCorpus, PolicyAdapter } from '../types'
import { buildSyntheticPrescription, buildSyntheticProviderPrompt, sha256 } from './prescription'
import { REAL_NON_REGRESSION_RULES, REAL_EVALUATION_THRESHOLDS_VERSION } from './thresholds'
import {
  REAL_METRIC_IDS,
  type RealCandidateConfig,
  type RealCandidateResult,
  type RealComparison,
  type RealDistribution,
  type RealEvaluationAlert,
  type RealEvaluationBudget,
  type RealEvaluationReport,
  type RealEvaluationUsage,
  type RealGenerationProvider,
  type RealMetricId,
  type RealMetricValues,
  type RealProviderUsage,
  type RealSample,
  type RealScenarioSummary,
} from './types'

export class RealEvaluationBudgetError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RealEvaluationBudgetError'
  }
}

interface ProvenanceInput {
  codeRevision: string
  codeDirty: boolean
}

interface RealEvaluationInput {
  corpus: EvaluationCorpus
  cases?: readonly EvaluationCase[]
  provider: RealGenerationProvider
  policyAdapter: PolicyAdapter
  candidate: RealCandidateConfig
  baseline: RealCandidateConfig | RealEvaluationReport
  budget: RealEvaluationBudget
  repetitions: number
  seed: number
  temperature: number
  provenance: ProvenanceInput
  now?: () => number
}

interface MutableUsage extends RealEvaluationUsage {
  startedAt: number
}

function round(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000
}

function distribution(values: readonly (number | null)[]): RealDistribution {
  const present = values.filter((value): value is number => value != null)
  if (!present.length) {
    return { count: 0, mean: null, variance: null, minimum: null, maximum: null }
  }
  const mean = present.reduce((sum, value) => sum + value, 0) / present.length
  const variance =
    present.length > 1
      ? present.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (present.length - 1)
      : null
  return {
    count: present.length,
    mean: round(mean),
    variance: variance == null ? null : round(variance),
    minimum: Math.min(...present),
    maximum: Math.max(...present),
  }
}

function summarizeScenarios(
  cases: readonly EvaluationCase[],
  samples: readonly RealSample[],
): RealScenarioSummary[] {
  return cases.map((evaluationCase) => {
    const matching = samples.filter((sample) => sample.caseId === evaluationCase.id)
    return {
      caseId: evaluationCase.id,
      title: evaluationCase.title,
      repetitions: matching.length,
      metrics: Object.fromEntries(
        REAL_METRIC_IDS.map((metric) => [
          metric,
          distribution(matching.map((sample) => sample.metrics[metric])),
        ]),
      ) as Record<RealMetricId, RealDistribution>,
    }
  })
}

function summarizeGlobal(samples: readonly RealSample[]): Record<RealMetricId, RealDistribution> {
  return Object.fromEntries(
    REAL_METRIC_IDS.map((metric) => [
      metric,
      distribution(samples.map((sample) => sample.metrics[metric])),
    ]),
  ) as Record<RealMetricId, RealDistribution>
}

function emptyUsage(cases: number, startedAt: number): MutableUsage {
  return {
    cases,
    calls: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheCreationTokens: 0,
    cacheReadTokens: 0,
    totalTokens: 0,
    costUsd: 0,
    durationMs: 0,
    startedAt,
  }
}

function publicUsage(usage: MutableUsage, now: number): RealEvaluationUsage {
  return {
    cases: usage.cases,
    calls: usage.calls,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    cacheCreationTokens: usage.cacheCreationTokens,
    cacheReadTokens: usage.cacheReadTokens,
    totalTokens: usage.totalTokens,
    costUsd: round(usage.costUsd),
    durationMs: Math.max(0, now - usage.startedAt),
  }
}

function responseCost(model: string, usage: RealProviderUsage): number {
  const cost = estimateCostUsd(model, usage)
  if (cost == null) {
    throw new RealEvaluationBudgetError(
      `Tarif inconnu pour ${model}; impossible de garantir le budget de coût.`,
    )
  }
  return cost
}

function totalTokens(usage: RealProviderUsage): number {
  return usage.inputTokens + usage.outputTokens + usage.cacheCreationTokens + usage.cacheReadTokens
}

function plannedCost(model: string, inputTokens: number, outputTokens: number): number {
  const cost = estimateCostUsd(model, {
    inputTokens,
    outputTokens,
    cacheCreationTokens: 0,
    cacheReadTokens: 0,
  })
  if (cost == null) {
    throw new RealEvaluationBudgetError(
      `Tarif inconnu pour ${model}; impossible de vérifier le coût maximal avant appel.`,
    )
  }
  return cost
}

function assertPreflight(
  input: RealEvaluationInput,
  cases: readonly EvaluationCase[],
  baselineNeedsCalls: boolean,
): void {
  const { budget, repetitions } = input
  if (cases.length > budget.maxCases) {
    throw new RealEvaluationBudgetError(
      `Le corpus sélectionné exige ${cases.length} cas, au-delà du budget ${budget.maxCases}.`,
    )
  }
  const candidateCount = baselineNeedsCalls ? 2 : 1
  const calls = cases.length * repetitions * candidateCount
  if (calls > budget.maxCalls) {
    throw new RealEvaluationBudgetError(
      `Le plan exige ${calls} appels, au-delà du budget ${budget.maxCalls}.`,
    )
  }

  let maximumTokens = 0
  let maximumCost = 0
  const configs = baselineNeedsCalls
    ? [input.baseline as RealCandidateConfig, input.candidate]
    : [input.candidate]
  for (const config of configs) {
    for (const evaluationCase of cases) {
      const { prompt } = buildSyntheticProviderPrompt(evaluationCase)
      // Un octet par token est volontairement conservateur pour refuser avant tout dépassement.
      const inputTokens = Buffer.byteLength(SYSTEM_PROMPT) + Buffer.byteLength(prompt)
      maximumTokens += (inputTokens + budget.maxOutputTokensPerCall) * repetitions
      maximumCost +=
        plannedCost(config.model, inputTokens, budget.maxOutputTokensPerCall) * repetitions
    }
  }
  if (maximumTokens > budget.maxTotalTokens) {
    throw new RealEvaluationBudgetError(
      `Le plafond conservateur est ${maximumTokens} tokens, au-delà du budget ${budget.maxTotalTokens}.`,
    )
  }
  if (maximumCost > budget.maxCostUsd) {
    throw new RealEvaluationBudgetError(
      `Le plafond conservateur est $${maximumCost.toFixed(4)}, au-delà du budget $${budget.maxCostUsd.toFixed(4)}.`,
    )
  }
}

function previousSessions(
  cases: readonly EvaluationCase[],
  parsed: ReadonlyMap<string, WorkoutSession>,
  current: EvaluationCase,
): { immediate: { caseId: string; session: WorkoutSession } | null; all: WorkoutSession[] } {
  if (!current.sequence) return { immediate: null, all: [] }
  const previous = cases
    .filter(
      (candidate) =>
        candidate.sequence?.id === current.sequence!.id &&
        candidate.sequence.position < current.sequence!.position &&
        parsed.has(candidate.id),
    )
    .sort((left, right) => left.sequence!.position - right.sequence!.position)
  const immediate = previous.at(-1)
  return {
    immediate: immediate ? { caseId: immediate.id, session: parsed.get(immediate.id)! } : null,
    all: previous.map((candidate) => parsed.get(candidate.id)!),
  }
}

function invalidMetrics(response: {
  latencyMs: number
  usage: RealProviderUsage
  costUsd: number
}): RealMetricValues {
  return {
    structuralValidity: 0,
    policyCompliance: 0,
    blockingViolations: 1,
    durationAbsoluteErrorSeconds: null,
    durationOverrunSeconds: null,
    categoryFidelity: null,
    focusFidelity: null,
    mainExerciseOverlap: null,
    warmupCooldownExerciseOverlap: null,
    blockDiversityRatio: null,
    progressionCoherence: null,
    latencyMs: response.latencyMs,
    totalTokens: totalTokens(response.usage),
    costUsd: response.costUsd,
  }
}

async function runCandidate(
  input: RealEvaluationInput,
  config: RealCandidateConfig,
  cases: readonly EvaluationCase[],
  usage: MutableUsage,
): Promise<RealCandidateResult> {
  const startedAt = input.now!()
  const samples: RealSample[] = []
  for (let repetition = 0; repetition < input.repetitions; repetition += 1) {
    const generated = new Map<
      string,
      {
        response: Awaited<ReturnType<RealGenerationProvider['generate']>>
        costUsd: number
        seed: number
      }
    >()
    const parsed = new Map<string, WorkoutSession>()

    for (const [caseIndex, evaluationCase] of cases.entries()) {
      const now = input.now!()
      const remainingMs = input.budget.maxDurationMs - (now - usage.startedAt)
      if (remainingMs <= 0) {
        throw new RealEvaluationBudgetError(
          `Le budget de durée ${input.budget.maxDurationMs} ms serait dépassé avant le prochain appel.`,
        )
      }
      if (usage.calls + 1 > input.budget.maxCalls) {
        throw new RealEvaluationBudgetError(
          'Le budget d’appels serait dépassé avant le prochain cas.',
        )
      }
      const { prompt } = buildSyntheticProviderPrompt(evaluationCase)
      const derivedSeed = input.seed + repetition * cases.length + caseIndex
      const response = await input.provider.generate({
        model: config.model,
        systemPrompt: SYSTEM_PROMPT,
        userPrompt: prompt,
        temperature: input.provider.capabilities.temperature ? input.temperature : 0,
        seed: input.provider.capabilities.seed ? derivedSeed : 0,
        maxOutputTokens: input.budget.maxOutputTokensPerCall,
        timeoutMs: remainingMs,
      })
      const costUsd = responseCost(response.model, response.usage)
      usage.calls += 1
      usage.inputTokens += response.usage.inputTokens
      usage.outputTokens += response.usage.outputTokens
      usage.cacheCreationTokens += response.usage.cacheCreationTokens
      usage.cacheReadTokens += response.usage.cacheReadTokens
      usage.totalTokens += totalTokens(response.usage)
      usage.costUsd += costUsd
      if (usage.totalTokens > input.budget.maxTotalTokens) {
        throw new RealEvaluationBudgetError('Le fournisseur a dépassé le budget total de tokens.')
      }
      if (usage.costUsd > input.budget.maxCostUsd) {
        throw new RealEvaluationBudgetError('Le fournisseur a dépassé le budget de coût.')
      }
      generated.set(evaluationCase.id, { response, costUsd, seed: derivedSeed })
      const output = workoutSessionSchema.safeParse(response.output)
      if (output.success) parsed.set(evaluationCase.id, output.data)
    }

    for (const evaluationCase of cases) {
      const generatedCase = generated.get(evaluationCase.id)!
      const { response, costUsd, seed: derivedSeed } = generatedCase
      const session = parsed.get(evaluationCase.id)
      const common = {
        caseId: evaluationCase.id,
        repetition: repetition + 1,
        seedRequested: derivedSeed,
        seedApplied: input.provider.capabilities.seed,
        temperatureRequested: input.temperature,
        temperatureApplied: input.provider.capabilities.temperature ? input.temperature : null,
        modelRequested: config.model,
        modelResolved: response.model,
        usage: { ...response.usage, costUsd: round(costUsd) },
      }
      if (!session) {
        samples.push({
          ...common,
          status: 'invalid-output',
          errorCode: 'INVALID_WORKOUT_SESSION',
          output: response.output,
          metrics: invalidMetrics({ ...response, costUsd }),
        })
        continue
      }

      const sequence = previousSessions(cases, parsed, evaluationCase)
      const policy = await input.policyAdapter.evaluate({ evaluationCase, session })
      const duration = calculateDurationMetric(session, evaluationCase.context.targetDurationMin)
      const fidelity = calculateFidelityMetric(session, evaluationCase)
      const overlap = calculateExerciseOverlap(session, sequence.immediate)
      const diversity = calculateBlockDiversity(session)
      const progression = calculateProgressionMetric(evaluationCase, session, sequence.all)
      const blockingViolations =
        policy.status === 'evaluated'
          ? policy.violations.filter((violation) => violation.blocking).length
          : 1
      samples.push({
        ...common,
        status: 'evaluated',
        errorCode: null,
        output: session,
        metrics: {
          structuralValidity: 1,
          policyCompliance: blockingViolations === 0 ? 1 : 0,
          blockingViolations,
          durationAbsoluteErrorSeconds: duration.absoluteErrorSeconds,
          durationOverrunSeconds: duration.overrunSeconds,
          categoryFidelity: fidelity.category ? 1 : 0,
          focusFidelity: fidelity.focus ? 1 : 0,
          mainExerciseOverlap: overlap.main,
          warmupCooldownExerciseOverlap: overlap.warmupCooldown,
          blockDiversityRatio: diversity.distinctBlockTypeRatio,
          progressionCoherence: progression.applicable ? (progression.passed ? 1 : 0) : null,
          latencyMs: response.latencyMs,
          totalTokens: totalTokens(response.usage),
          costUsd: round(costUsd),
        },
      })
    }
  }

  const endedAt = input.now!()
  const candidateUsage = samples.reduce<RealEvaluationUsage>(
    (total, sample) => ({
      ...total,
      calls: total.calls + 1,
      inputTokens: total.inputTokens + sample.usage.inputTokens,
      outputTokens: total.outputTokens + sample.usage.outputTokens,
      cacheCreationTokens: total.cacheCreationTokens + sample.usage.cacheCreationTokens,
      cacheReadTokens: total.cacheReadTokens + sample.usage.cacheReadTokens,
      totalTokens: total.totalTokens + sample.metrics.totalTokens!,
      costUsd: round(total.costUsd + sample.usage.costUsd),
    }),
    {
      cases: cases.length,
      calls: 0,
      inputTokens: 0,
      outputTokens: 0,
      cacheCreationTokens: 0,
      cacheReadTokens: 0,
      totalTokens: 0,
      costUsd: 0,
      durationMs: endedAt - startedAt,
    },
  )
  return {
    candidate: config,
    samples,
    scenarios: summarizeScenarios(cases, samples),
    global: summarizeGlobal(samples),
    usage: candidateUsage,
  }
}

function comparisonMetric(
  baseline: RealDistribution,
  candidate: RealDistribution,
): { baseline: RealDistribution; candidate: RealDistribution; deltaMean: number | null } {
  return {
    baseline,
    candidate,
    deltaMean:
      baseline.mean == null || candidate.mean == null
        ? null
        : round(candidate.mean - baseline.mean),
  }
}

export function compareRealCandidates(
  baseline: RealCandidateResult,
  candidate: RealCandidateResult,
): RealComparison {
  const baselineScenarios = new Map(
    baseline.scenarios.map((scenario) => [scenario.caseId, scenario]),
  )
  return {
    baselineCandidateId: baseline.candidate.id,
    candidateCandidateId: candidate.candidate.id,
    scenarios: candidate.scenarios.map((scenario) => {
      const before = baselineScenarios.get(scenario.caseId)
      if (!before) throw new Error(`Scénario ${scenario.caseId} absent de la baseline.`)
      return {
        caseId: scenario.caseId,
        metrics: Object.fromEntries(
          REAL_METRIC_IDS.map((metric) => [
            metric,
            comparisonMetric(before.metrics[metric], scenario.metrics[metric]),
          ]),
        ) as RealComparison['scenarios'][number]['metrics'],
      }
    }),
    global: Object.fromEntries(
      REAL_METRIC_IDS.map((metric) => [
        metric,
        comparisonMetric(baseline.global[metric], candidate.global[metric]),
      ]),
    ) as RealComparison['global'],
  }
}

function alertsFor(comparison: RealComparison): RealEvaluationAlert[] {
  return REAL_NON_REGRESSION_RULES.map((rule) => {
    const delta = comparison.global[rule.metric].deltaMean
    const regressed =
      delta != null &&
      (rule.direction === 'higher-is-better'
        ? delta < -rule.allowedRegression
        : delta > rule.allowedRegression)
    return {
      ...rule,
      observedDelta: delta,
      status: delta == null ? 'unavailable' : regressed ? 'alert' : 'pass',
    }
  })
}

function subsetBaseline(
  report: RealEvaluationReport,
  cases: readonly EvaluationCase[],
): RealCandidateResult {
  const ids = new Set(cases.map((evaluationCase) => evaluationCase.id))
  const samples = report.candidate.samples.filter((sample) => ids.has(sample.caseId))
  for (const id of ids) {
    if (!samples.some((sample) => sample.caseId === id)) {
      throw new Error(`Scénario ${id} absent du rapport baseline.`)
    }
  }
  return {
    ...report.candidate,
    samples,
    scenarios: summarizeScenarios(cases, samples),
    global: summarizeGlobal(samples),
  }
}

export async function runRealEvaluation(input: RealEvaluationInput): Promise<RealEvaluationReport> {
  const now = input.now ?? Date.now
  const normalized = { ...input, now }
  const cases = input.cases ?? input.corpus.cases
  if (!cases.length) throw new Error('Au moins un cas doit être sélectionné.')
  if (new Set(cases.map((evaluationCase) => evaluationCase.id)).size !== cases.length) {
    throw new Error('La sélection contient des identifiants de cas dupliqués.')
  }
  const selectedIds = new Set(cases.map((evaluationCase) => evaluationCase.id))
  for (const evaluationCase of cases) {
    if (!evaluationCase.sequence) continue
    const missingPredecessors = input.corpus.cases
      .filter(
        (candidate) =>
          candidate.sequence?.id === evaluationCase.sequence!.id &&
          candidate.sequence.position < evaluationCase.sequence!.position &&
          !selectedIds.has(candidate.id),
      )
      .map((candidate) => candidate.id)
    if (missingPredecessors.length) {
      throw new Error(
        `Le cas ${evaluationCase.id} exige aussi ses prédécesseurs: ${missingPredecessors.join(', ')}.`,
      )
    }
  }
  const baselineReport = 'reportVersion' in input.baseline ? input.baseline : null
  if (baselineReport && baselineReport.provenance.corpusId !== input.corpus.id) {
    throw new Error('Le rapport baseline utilise un autre corpus.')
  }
  if (baselineReport && baselineReport.provenance.corpusSha256 !== sha256(input.corpus)) {
    throw new Error('Le rapport baseline utilise un contenu de corpus différent.')
  }
  assertPreflight(normalized, cases, !baselineReport)

  const usage = emptyUsage(cases.length, now())
  const baseline = baselineReport
    ? subsetBaseline(baselineReport, cases)
    : await runCandidate(normalized, input.baseline as RealCandidateConfig, cases, usage)
  const candidate = await runCandidate(normalized, input.candidate, cases, usage)
  usage.durationMs = now() - usage.startedAt
  if (usage.durationMs > input.budget.maxDurationMs) {
    throw new RealEvaluationBudgetError('Le budget de durée a été dépassé.')
  }

  const comparison = compareRealCandidates(baseline, candidate)
  const alerts = alertsFor(comparison)
  const prescriptions = cases.map((evaluationCase) => ({
    caseId: evaluationCase.id,
    prescription: buildSyntheticPrescription(evaluationCase),
  }))
  const provenance = {
    codeRevision: input.provenance.codeRevision,
    codeDirty: input.provenance.codeDirty,
    corpusId: input.corpus.id,
    corpusCaseIds: cases.map((evaluationCase) => evaluationCase.id),
    corpusSha256: sha256(input.corpus),
    promptVersion: GENERATOR_VERSIONS.prompt,
    promptSha256: sha256(SYSTEM_PROMPT),
    policyVersion: input.policyAdapter.version,
    prescriptionVersion: GENERATOR_VERSIONS.prescription,
    prescriptionSha256: sha256(prescriptions),
    thresholdsVersion: REAL_EVALUATION_THRESHOLDS_VERSION,
  }
  return {
    reportVersion: 'generator-real-evaluation-report/v1',
    generatedAt: new Date(now()).toISOString(),
    provider: { id: input.provider.id, capabilities: input.provider.capabilities },
    reproducibility: {
      seed: input.seed,
      seedApplied: input.provider.capabilities.seed,
      temperature: input.temperature,
      temperatureApplied: input.provider.capabilities.temperature,
      repetitions: input.repetitions,
    },
    provenance,
    baselineProvenance: baselineReport?.provenance ?? provenance,
    budget: input.budget,
    usage: publicUsage(usage, now()),
    candidate,
    baseline,
    comparison,
    alerts,
    status: alerts.some((alert) => alert.status === 'alert') ? 'alert' : 'pass',
  }
}
