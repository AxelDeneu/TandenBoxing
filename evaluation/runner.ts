import { workoutSessionSchema, type WorkoutSession } from '../shared/session-schema'
import {
  calculateBlockDiversity,
  calculateDurationMetric,
  calculateExerciseOverlap,
  calculateFidelityMetric,
  calculateProgressionMetric,
} from './metrics'
import type {
  CandidateRun,
  CaseEvaluation,
  EvaluationCorpus,
  EvaluationReport,
  GlobalMetrics,
  PolicyAdapter,
  ReportComparison,
} from './types'

function round(value: number): number {
  return Math.round(value * 10_000) / 10_000
}

function average(values: readonly number[]): number | null {
  if (values.length === 0) return null
  return round(values.reduce((sum, value) => sum + value, 0) / values.length)
}

function assertInputs(corpus: EvaluationCorpus, candidate: CandidateRun): void {
  if (candidate.corpusId !== corpus.id) {
    throw new Error(
      `Le candidat ${candidate.id} cible ${candidate.corpusId}, mais le runner utilise ${corpus.id}.`,
    )
  }

  const caseIds = corpus.cases.map((evaluationCase) => evaluationCase.id)
  if (new Set(caseIds).size !== caseIds.length) {
    throw new Error(`Le corpus ${corpus.id} contient des identifiants de cas dupliqués.`)
  }

  const missing = caseIds.filter((caseId) => candidate.outputs[caseId] == null)
  if (missing.length > 0) {
    throw new Error(`Sorties manquantes pour ${candidate.id}: ${missing.join(', ')}`)
  }
}

function calculateGlobalMetrics(cases: readonly CaseEvaluation[]): GlobalMetrics {
  const evaluatedPolicyCases = cases.filter((item) => item.policy.status === 'evaluated')
  const blockingViolationCount = evaluatedPolicyCases.reduce(
    (count, item) =>
      count + item.policy.violations.filter((violation) => violation.blocking).length,
    0,
  )
  const compliantCases = evaluatedPolicyCases.filter((item) =>
    item.policy.violations.every((violation) => !violation.blocking),
  ).length
  const mainOverlaps = cases
    .map((item) => item.exerciseOverlap.main)
    .filter((value): value is number => value != null)
  const warmupCooldownOverlaps = cases
    .map((item) => item.exerciseOverlap.warmupCooldown)
    .filter((value): value is number => value != null)
  const progressionCases = cases.filter((item) => item.progression.applicable)
  const coherentCases = progressionCases.filter((item) => item.progression.passed).length

  return {
    cases: cases.length,
    policy: {
      evaluatedCases: evaluatedPolicyCases.length,
      unavailableCases: cases.length - evaluatedPolicyCases.length,
      compliantCases,
      mandatoryComplianceRate:
        evaluatedPolicyCases.length > 0
          ? round(compliantCases / evaluatedPolicyCases.length)
          : null,
      blockingViolationCount,
    },
    duration: {
      meanAbsoluteErrorSeconds:
        average(cases.map((item) => item.duration.absoluteErrorSeconds)) ?? 0,
      maxAbsoluteErrorSeconds: Math.max(
        0,
        ...cases.map((item) => item.duration.absoluteErrorSeconds),
      ),
      overrunCases: cases.filter((item) => item.duration.overrunSeconds > 0).length,
      totalOverrunSeconds: cases.reduce((total, item) => total + item.duration.overrunSeconds, 0),
    },
    fidelity: {
      categoryRate: average(cases.map((item) => (item.fidelity.category ? 1 : 0))) ?? 0,
      focusRate: average(cases.map((item) => (item.fidelity.focus ? 1 : 0))) ?? 0,
    },
    exerciseOverlap: {
      comparedCases: mainOverlaps.length,
      meanMain: average(mainOverlaps),
      meanWarmupCooldown: average(warmupCooldownOverlaps),
    },
    blockDiversity: {
      meanDistinctBlockTypeRatio:
        average(cases.map((item) => item.blockDiversity.distinctBlockTypeRatio)) ?? 0,
      distinctPatterns: new Set(cases.map((item) => item.blockDiversity.pattern)).size,
    },
    progression: {
      evaluatedCases: progressionCases.length,
      coherentCases,
      coherenceRate:
        progressionCases.length > 0 ? round(coherentCases / progressionCases.length) : null,
    },
  }
}

function sequenceCases(
  corpus: EvaluationCorpus,
  parsedOutputs: Readonly<Record<string, WorkoutSession>>,
  currentCaseId: string,
): { previous: { caseId: string; session: WorkoutSession } | null; allPrevious: WorkoutSession[] } {
  const current = corpus.cases.find((item) => item.id === currentCaseId)
  if (!current?.sequence) return { previous: null, allPrevious: [] }

  const previousCases = corpus.cases
    .filter(
      (item) =>
        item.sequence?.id === current.sequence!.id &&
        item.sequence.position < current.sequence!.position,
    )
    .sort((left, right) => left.sequence!.position - right.sequence!.position)

  const immediate = previousCases.at(-1)
  return {
    previous: immediate ? { caseId: immediate.id, session: parsedOutputs[immediate.id]! } : null,
    allPrevious: previousCases.map((item) => parsedOutputs[item.id]!),
  }
}

export async function evaluateCandidate(
  corpus: EvaluationCorpus,
  candidate: CandidateRun,
  policyAdapter: PolicyAdapter,
): Promise<EvaluationReport> {
  assertInputs(corpus, candidate)

  const parsedOutputs = Object.fromEntries(
    corpus.cases.map((evaluationCase) => [
      evaluationCase.id,
      workoutSessionSchema.parse(candidate.outputs[evaluationCase.id]),
    ]),
  ) as Record<string, WorkoutSession>

  const cases: CaseEvaluation[] = []
  for (const evaluationCase of corpus.cases) {
    const session = parsedOutputs[evaluationCase.id]!
    const sequence = sequenceCases(corpus, parsedOutputs, evaluationCase.id)
    cases.push({
      caseId: evaluationCase.id,
      title: evaluationCase.title,
      tags: evaluationCase.tags,
      policy: await policyAdapter.evaluate({ evaluationCase, session }),
      duration: calculateDurationMetric(session, evaluationCase.context.targetDurationMin),
      fidelity: calculateFidelityMetric(session, evaluationCase),
      exerciseOverlap: calculateExerciseOverlap(session, sequence.previous),
      blockDiversity: calculateBlockDiversity(session),
      progression: calculateProgressionMetric(evaluationCase, session, sequence.allPrevious),
    })
  }

  const global = calculateGlobalMetrics(cases)
  const policyThresholdPassed =
    global.policy.evaluatedCases === global.cases && global.policy.mandatoryComplianceRate === 1
  const durationThresholdPassed = global.duration.overrunCases === 0
  const thresholds = [
    {
      id: 'mandatory-policy-compliance' as const,
      target: '100 % des cas évalués, sans violation bloquante',
      actual:
        global.policy.mandatoryComplianceRate == null
          ? `oracle indisponible (${global.policy.unavailableCases}/${global.cases} cas)`
          : `${round(global.policy.mandatoryComplianceRate * 100)} % (${global.policy.evaluatedCases}/${global.cases} cas évalués)`,
      passed: policyThresholdPassed,
    },
    {
      id: 'duration-overrun' as const,
      target: '0 dépassement',
      actual: `${global.duration.overrunCases} dépassement(s), ${global.duration.totalOverrunSeconds} s au total`,
      passed: durationThresholdPassed,
    },
  ]

  return {
    reportVersion: 'generator-evaluation-report/v1',
    corpus: { id: corpus.id, caseCount: corpus.cases.length },
    candidate: {
      id: candidate.id,
      description: candidate.description,
      versions: candidate.versions,
    },
    policyAdapter: { id: policyAdapter.id, version: policyAdapter.version },
    cases,
    global,
    thresholds,
    passed: thresholds.every((threshold) => threshold.passed),
  }
}

function delta(left: number | null, right: number | null): number | null {
  if (left == null || right == null) return null
  return round(right - left)
}

export function compareReports(
  baseline: EvaluationReport,
  candidate: EvaluationReport,
): ReportComparison {
  if (baseline.corpus.id !== candidate.corpus.id) {
    throw new Error('Une comparaison avant/après exige exactement le même corpus.')
  }
  return {
    baselineCandidateId: baseline.candidate.id,
    deltas: {
      mandatoryComplianceRate: delta(
        baseline.global.policy.mandatoryComplianceRate,
        candidate.global.policy.mandatoryComplianceRate,
      ),
      meanAbsoluteDurationErrorSeconds: round(
        candidate.global.duration.meanAbsoluteErrorSeconds -
          baseline.global.duration.meanAbsoluteErrorSeconds,
      ),
      categoryFidelityRate: round(
        candidate.global.fidelity.categoryRate - baseline.global.fidelity.categoryRate,
      ),
      focusFidelityRate: round(
        candidate.global.fidelity.focusRate - baseline.global.fidelity.focusRate,
      ),
      mainExerciseOverlap: delta(
        baseline.global.exerciseOverlap.meanMain,
        candidate.global.exerciseOverlap.meanMain,
      ),
      warmupCooldownExerciseOverlap: delta(
        baseline.global.exerciseOverlap.meanWarmupCooldown,
        candidate.global.exerciseOverlap.meanWarmupCooldown,
      ),
      blockDiversityRatio: round(
        candidate.global.blockDiversity.meanDistinctBlockTypeRatio -
          baseline.global.blockDiversity.meanDistinctBlockTypeRatio,
      ),
      progressionCoherenceRate: delta(
        baseline.global.progression.coherenceRate,
        candidate.global.progression.coherenceRate,
      ),
    },
  }
}
