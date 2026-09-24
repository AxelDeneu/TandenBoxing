import { describe, expect, it } from 'vitest'
import {
  aggregateProductionTelemetry,
  TELEMETRY_METRIC_DEFINITIONS,
  type ProductionTelemetryRecord,
} from '../shared/evaluation-telemetry'
import { GENERATOR_VERSIONS } from '../shared/generator-version'

function record(overrides: Partial<ProductionTelemetryRecord> = {}): ProductionTelemetryRecord {
  return {
    model: 'claude-haiku-4-5',
    versions: GENERATOR_VERSIONS,
    policyCompliant: true,
    automaticCorrectionCount: 0,
    plannedDurationSeconds: 1_800,
    actualDurationSeconds: 1_700,
    completed: true,
    skippedBlockCount: 1,
    plannedDifficulty: 3,
    feltDifficulty: 4,
    enjoyment: 5,
    replacementCount: 1,
    adaptationCount: 2,
    providerLatencyMilliseconds: 900,
    estimatedCostUsd: 0.03,
    ...overrides,
  }
}

describe('télémétrie agrégée de qualité', () => {
  it('agrège tous les signaux demandés avec définition, unité, fenêtre et propriétaire', () => {
    const report = aggregateProductionTelemetry(
      [record(), record({ actualDurationSeconds: 1_900 }), record({ completed: false })],
      { from: '2027-01-01', to: '2027-01-31' },
    )

    expect(report.groups).toHaveLength(1)
    expect(report.groups[0]!.metrics).toMatchObject({
      policyComplianceRate: { value: 1, observations: 3 },
      automaticCorrectionsPerGeneration: { value: 0, observations: 3 },
      plannedDurationSecondsMean: { value: 1_800, observations: 3 },
      actualDurationSecondsMean: { observations: 3 },
      completionRate: { value: 0.666667, observations: 3 },
      skippedBlocksPerCompletedSession: { value: 1, observations: 2 },
      plannedDifficultyMean: { value: 3, observations: 3 },
      feltDifficultyMean: { value: 4, observations: 3 },
      enjoymentMean: { value: 5, observations: 3 },
      replacementsPerSession: { value: 1, observations: 3 },
      adaptationsPerSession: { value: 2, observations: 3 },
      providerLatencyMillisecondsMean: { value: 900, observations: 3 },
      estimatedCostUsdTotal: { value: 0.09, observations: 3 },
    })
    expect(TELEMETRY_METRIC_DEFINITIONS.every((item) => item.owner && item.unit)).toBe(true)
    expect(report.window).toEqual({
      from: '2027-01-01',
      to: '2027-01-31',
      basis: 'session_date',
    })
  })

  it('supprime les groupes trop petits et ne sérialise aucune donnée libre', () => {
    const report = aggregateProductionTelemetry(
      [record(), record()],
      { from: '2027-01-01', to: '2027-01-31' },
      3,
    )
    const serialized = JSON.stringify(report)

    expect(report.groups).toEqual([])
    expect(report.privacy.suppressedSessionCount).toBe(2)
    expect(serialized).not.toContain('comment')
    expect(serialized).not.toContain('note')
    expect(serialized).not.toContain('exerciseName')
  })
})
