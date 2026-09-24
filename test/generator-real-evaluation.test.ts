import { describe, expect, it } from 'vitest'
import { SYNTHETIC_CORPUS } from '../evaluation/fixtures/corpus'
import { candidateRun as referenceCandidate } from '../evaluation/fixtures/reference-candidate'
import { createPolicyAdapter } from '../evaluation/policy-adapter'
import { formatRealReportJson, formatRealReportMarkdown } from '../evaluation/real/report'
import { RealEvaluationBudgetError, runRealEvaluation } from '../evaluation/real/runner'
import type { RealEvaluationBudget, RealGenerationProvider } from '../evaluation/real/types'
import { GENERATOR_VERSIONS } from '../shared/generator-version'
import { workoutSessionSchema } from '../shared/session-schema'

const selectedCase = SYNTHETIC_CORPUS.cases[0]!
const output = referenceCandidate.outputs[selectedCase.id]!
const budget: RealEvaluationBudget = {
  maxCases: 1,
  maxCalls: 4,
  maxTotalTokens: 1_000_000,
  maxCostUsd: 100,
  maxDurationMs: 60_000,
  maxOutputTokensPerCall: 4_000,
}
const acceptingPolicy = createPolicyAdapter({
  id: 'real-evaluation-test-policy',
  version: GENERATOR_VERSIONS.policy,
  validate: () => [],
  isBlocking: () => true,
})

function fakeProvider(counter: { calls: number }): RealGenerationProvider {
  return {
    id: 'fake-provider',
    capabilities: { seed: false, temperature: true },
    async generate(request) {
      counter.calls += 1
      return {
        model: request.model,
        output: structuredClone(output),
        latencyMs: 10 + counter.calls,
        usage: {
          inputTokens: 100,
          outputTokens: 50,
          cacheCreationTokens: 0,
          cacheReadTokens: 0,
        },
      }
    },
  }
}

function input(provider: RealGenerationProvider, overrides: Partial<RealEvaluationBudget> = {}) {
  let clock = 1_800_000_000_000
  return {
    corpus: SYNTHETIC_CORPUS,
    cases: [selectedCase],
    provider,
    policyAdapter: acceptingPolicy,
    candidate: {
      id: 'candidate/test',
      model: 'claude-haiku-4-5',
      versions: GENERATOR_VERSIONS,
    },
    baseline: {
      id: 'baseline/test',
      model: 'claude-haiku-4-5',
      versions: GENERATOR_VERSIONS,
    },
    budget: { ...budget, ...overrides },
    repetitions: 2,
    seed: 42,
    temperature: 0.2,
    provenance: { codeRevision: 'abc123', codeDirty: false },
    now: () => (clock += 5),
  }
}

describe('évaluation réelle du générateur', () => {
  it('compare baseline et candidat, archive la reproductibilité et calcule la variance', async () => {
    const counter = { calls: 0 }
    const report = await runRealEvaluation(input(fakeProvider(counter)))

    expect(counter.calls).toBe(4)
    expect(report.usage.calls).toBe(4)
    expect(report.provenance).toMatchObject({
      codeRevision: 'abc123',
      corpusId: SYNTHETIC_CORPUS.id,
      promptVersion: GENERATOR_VERSIONS.prompt,
      policyVersion: GENERATOR_VERSIONS.policy,
      prescriptionVersion: GENERATOR_VERSIONS.prescription,
    })
    expect(report.reproducibility).toEqual({
      seed: 42,
      seedApplied: false,
      temperature: 0.2,
      temperatureApplied: true,
      repetitions: 2,
    })
    expect(report.candidate.scenarios[0]!.metrics.latencyMs).toMatchObject({
      count: 2,
      variance: 0.5,
    })
    expect(report.comparison.scenarios[0]!.metrics.policyCompliance.deltaMean).toBe(0)
    expect(report.candidate.samples[0]!.output).toEqual(workoutSessionSchema.parse(output))
    expect(JSON.parse(formatRealReportJson(report)).reportVersion).toBe(
      'generator-real-evaluation-report/v1',
    )
    expect(formatRealReportMarkdown(report)).toContain('## Comparaison globale')
    expect(formatRealReportMarkdown(report)).toContain('var.')
  })

  it('refuse un plan qui dépasserait le budget avant le premier appel fournisseur', async () => {
    const counter = { calls: 0 }
    await expect(runRealEvaluation(input(fakeProvider(counter), { maxCalls: 3 }))).rejects.toThrow(
      RealEvaluationBudgetError,
    )
    expect(counter.calls).toBe(0)
  })

  it('refuse un scénario séquentiel sans ses prédécesseurs', async () => {
    const counter = { calls: 0 }
    const sequenceCase = SYNTHETIC_CORPUS.cases.find((item) => item.id === 'foundation-week-2')!
    await expect(
      runRealEvaluation({
        ...input(fakeProvider(counter)),
        cases: [sequenceCase],
      }),
    ).rejects.toThrow('prédécesseurs')
    expect(counter.calls).toBe(0)
  })
})
