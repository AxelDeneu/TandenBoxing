import { describe, expect, it } from 'vitest'
import { candidateRun as referenceCandidate } from '../evaluation/fixtures/reference-candidate'
import { createPolicyAdapter, createUnavailablePolicyAdapter } from '../evaluation/policy-adapter'
import { formatReadableReport, formatReportJson } from '../evaluation/report'
import { compareReports, evaluateCandidate } from '../evaluation/runner'
import type { CandidateRun, EvaluationCorpus } from '../evaluation/types'

const firstCaseId = 'beginner-no-history-30'
const firstCase = {
  id: firstCaseId,
  title: 'Cas minimal',
  description: 'Cas minimal pour vérifier la stabilité du rapport JSON généré.',
  tags: ['beginner'] as const,
  context: {
    date: '2027-01-04',
    targetDurationMin: 30,
    profile: {
      level: 'debutant' as const,
      fitnessLevel: 'actif' as const,
      equipment: ['sac'],
      constraints: [],
    },
    history: [],
    skippedSessions: [],
  },
  expected: { category: 'apprentissage' as const, focus: 'fondations' as const },
}

const corpus: EvaluationCorpus = {
  id: 'test-corpus/v1',
  description: 'Corpus de test',
  cases: [firstCase],
}

function candidate(): CandidateRun {
  return {
    ...referenceCandidate,
    id: 'test-candidate/v1',
    corpusId: corpus.id,
    outputs: { [firstCaseId]: structuredClone(referenceCandidate.outputs[firstCaseId]!) },
  }
}

const acceptingPolicy = createPolicyAdapter({
  id: 'test-policy',
  version: 'test-policy/v1',
  validate: () => [],
  isBlocking: () => true,
})

describe('runner d’évaluation', () => {
  it('produit un format JSON stable sans horodatage', async () => {
    const first = await evaluateCandidate(corpus, candidate(), acceptingPolicy)
    const second = await evaluateCandidate(corpus, candidate(), acceptingPolicy)
    const json = formatReportJson(first)

    expect(json).toBe(formatReportJson(second))
    expect(json).not.toContain('generatedAt')
    expect(Object.keys(JSON.parse(json))).toEqual([
      'reportVersion',
      'corpus',
      'candidate',
      'policyAdapter',
      'cases',
      'global',
      'thresholds',
      'passed',
    ])
    expect(formatReadableReport(first)).toContain('Résultat: PASS')
  })

  it('échoue lorsqu’une violation obligatoire franchit le seuil', async () => {
    const rejectingPolicy = createPolicyAdapter({
      id: 'rejecting-policy',
      version: 'test-policy/v1',
      validate: () => [{ code: 'TEST_VIOLATION', message: 'Violation connue' }],
      isBlocking: () => true,
    })
    const report = await evaluateCandidate(corpus, candidate(), rejectingPolicy)

    expect(report.passed).toBe(false)
    expect(report.global.policy.blockingViolationCount).toBe(1)
    expect(report.thresholds[0]).toMatchObject({
      id: 'mandatory-policy-compliance',
      passed: false,
    })
  })

  it('échoue lors d’un dépassement de durée', async () => {
    const overlong = candidate()
    const firstExercise = overlong.outputs[firstCaseId]!.blocks[0]!.exercises[0]!
    firstExercise.restAfterSec += 1
    const report = await evaluateCandidate(corpus, overlong, acceptingPolicy)

    expect(report.passed).toBe(false)
    expect(report.global.duration.overrunCases).toBe(1)
    expect(report.thresholds[1]).toMatchObject({ id: 'duration-overrun', passed: false })
  })

  it('considère un oracle indisponible comme un échec bloquant', async () => {
    const report = await evaluateCandidate(
      corpus,
      candidate(),
      createUnavailablePolicyAdapter('Dépendance #1 absente'),
    )

    expect(report.passed).toBe(false)
    expect(report.global.policy.mandatoryComplianceRate).toBeNull()
    expect(report.thresholds[0]!.actual).toContain('oracle indisponible')
  })

  it('compare deux rapports uniquement sur le même corpus', async () => {
    const before = await evaluateCandidate(corpus, candidate(), acceptingPolicy)
    const after = await evaluateCandidate(corpus, candidate(), acceptingPolicy)
    expect(compareReports(before, after).deltas).toEqual({
      mandatoryComplianceRate: 0,
      meanAbsoluteDurationErrorSeconds: 0,
      categoryFidelityRate: 0,
      focusFidelityRate: 0,
      mainExerciseOverlap: null,
      warmupCooldownExerciseOverlap: null,
      blockDiversityRatio: 0,
      progressionCoherenceRate: null,
    })
  })
})
