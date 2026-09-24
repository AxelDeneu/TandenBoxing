import type { GeneratorVersions } from './generator-version'

export const EVALUATION_TELEMETRY_VERSION = 'generation-outcomes-telemetry/v1'

export const TELEMETRY_METRIC_IDS = [
  'policyComplianceRate',
  'automaticCorrectionsPerGeneration',
  'plannedDurationSecondsMean',
  'actualDurationSecondsMean',
  'durationAbsoluteErrorSecondsMean',
  'completionRate',
  'skippedBlocksPerCompletedSession',
  'plannedDifficultyMean',
  'feltDifficultyMean',
  'enjoymentMean',
  'replacementsPerSession',
  'adaptationsPerSession',
  'providerLatencyMillisecondsMean',
  'estimatedCostUsdMean',
  'estimatedCostUsdTotal',
] as const

export type TelemetryMetricId = (typeof TELEMETRY_METRIC_IDS)[number]

export interface TelemetryMetricDefinition {
  id: TelemetryMetricId
  definition: string
  unit: 'ratio' | 'count/session' | 'seconds' | 'score 1-5' | 'milliseconds' | 'USD'
  aggregation: 'mean' | 'rate' | 'sum'
  windowBasis: 'session_date'
  owner:
    'maintainer:generation-quality' | 'maintainer:coaching-experience' | 'maintainer:ai-operations'
}

export const TELEMETRY_METRIC_DEFINITIONS: readonly TelemetryMetricDefinition[] = [
  {
    id: 'policyComplianceRate',
    definition:
      'Part des générations terminales dont la sortie persistée respecte toutes les règles bloquantes.',
    unit: 'ratio',
    aggregation: 'rate',
    windowBasis: 'session_date',
    owner: 'maintainer:generation-quality',
  },
  {
    id: 'automaticCorrectionsPerGeneration',
    definition:
      "Nombre moyen d'appels modèle supplémentaires déclenchés par la correction automatique de politique.",
    unit: 'count/session',
    aggregation: 'mean',
    windowBasis: 'session_date',
    owner: 'maintainer:generation-quality',
  },
  {
    id: 'plannedDurationSecondsMean',
    definition: 'Durée cible moyenne des séances générées dans la fenêtre.',
    unit: 'seconds',
    aggregation: 'mean',
    windowBasis: 'session_date',
    owner: 'maintainer:coaching-experience',
  },
  {
    id: 'actualDurationSecondsMean',
    definition: 'Durée exécutée moyenne lorsque le timer ou le feedback fournit une mesure.',
    unit: 'seconds',
    aggregation: 'mean',
    windowBasis: 'session_date',
    owner: 'maintainer:coaching-experience',
  },
  {
    id: 'durationAbsoluteErrorSecondsMean',
    definition: 'Écart absolu moyen entre durée cible et durée exécutée, sur les séances mesurées.',
    unit: 'seconds',
    aggregation: 'mean',
    windowBasis: 'session_date',
    owner: 'maintainer:generation-quality',
  },
  {
    id: 'completionRate',
    definition: 'Part des séances de la fenêtre marquées terminées.',
    unit: 'ratio',
    aggregation: 'rate',
    windowBasis: 'session_date',
    owner: 'maintainer:coaching-experience',
  },
  {
    id: 'skippedBlocksPerCompletedSession',
    definition:
      "Nombre moyen de blocs distincts dont au moins une phase d'effort a été ignorée dans le timer, par séance terminée.",
    unit: 'count/session',
    aggregation: 'mean',
    windowBasis: 'session_date',
    owner: 'maintainer:coaching-experience',
  },
  {
    id: 'plannedDifficultyMean',
    definition: 'Intensité moyenne prescrite avant génération, sur une échelle de 1 à 5.',
    unit: 'score 1-5',
    aggregation: 'mean',
    windowBasis: 'session_date',
    owner: 'maintainer:generation-quality',
  },
  {
    id: 'feltDifficultyMean',
    definition: 'Difficulté globale moyenne déclarée après séance, sur une échelle de 1 à 5.',
    unit: 'score 1-5',
    aggregation: 'mean',
    windowBasis: 'session_date',
    owner: 'maintainer:coaching-experience',
  },
  {
    id: 'enjoymentMean',
    definition: 'Plaisir ou motivation moyen déclaré après séance, sur une échelle de 1 à 5.',
    unit: 'score 1-5',
    aggregation: 'mean',
    windowBasis: 'session_date',
    owner: 'maintainer:coaching-experience',
  },
  {
    id: 'replacementsPerSession',
    definition: "Nombre moyen d'actions structurées de remplacement d'exercice par séance.",
    unit: 'count/session',
    aggregation: 'mean',
    windowBasis: 'session_date',
    owner: 'maintainer:coaching-experience',
  },
  {
    id: 'adaptationsPerSession',
    definition: "Nombre moyen d'adaptations structurées avant ou pendant l'effort par séance.",
    unit: 'count/session',
    aggregation: 'mean',
    windowBasis: 'session_date',
    owner: 'maintainer:coaching-experience',
  },
  {
    id: 'providerLatencyMillisecondsMean',
    definition: 'Latence fournisseur cumulée moyenne des jobs de génération terminés.',
    unit: 'milliseconds',
    aggregation: 'mean',
    windowBasis: 'session_date',
    owner: 'maintainer:ai-operations',
  },
  {
    id: 'estimatedCostUsdMean',
    definition: 'Coût fournisseur estimé moyen par job de génération terminal.',
    unit: 'USD',
    aggregation: 'mean',
    windowBasis: 'session_date',
    owner: 'maintainer:ai-operations',
  },
  {
    id: 'estimatedCostUsdTotal',
    definition: 'Somme des coûts fournisseur estimés dans la fenêtre.',
    unit: 'USD',
    aggregation: 'sum',
    windowBasis: 'session_date',
    owner: 'maintainer:ai-operations',
  },
]

export interface ProductionTelemetryRecord {
  model: string
  versions: GeneratorVersions
  policyCompliant: boolean | null
  automaticCorrectionCount: number | null
  plannedDurationSeconds: number
  actualDurationSeconds: number | null
  completed: boolean
  skippedBlockCount: number | null
  plannedDifficulty: number | null
  feltDifficulty: number | null
  enjoyment: number | null
  replacementCount: number
  adaptationCount: number
  providerLatencyMilliseconds: number | null
  estimatedCostUsd: number | null
}

export interface TelemetryMetricValue {
  value: number | null
  observations: number
}

export interface ProductionTelemetryGroup {
  generator: { model: string; versions: GeneratorVersions }
  sessionCount: number
  metrics: Record<TelemetryMetricId, TelemetryMetricValue>
}

export interface ProductionTelemetryReport {
  reportVersion: typeof EVALUATION_TELEMETRY_VERSION
  window: { from: string; to: string; basis: 'session_date' }
  privacy: { minimumGroupSize: number; suppressedSessionCount: number }
  definitions: readonly TelemetryMetricDefinition[]
  groups: ProductionTelemetryGroup[]
}

function rounded(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000
}

function mean(values: readonly (number | null)[]): TelemetryMetricValue {
  const present = values.filter((value): value is number => value != null)
  return {
    value: present.length
      ? rounded(present.reduce((sum, value) => sum + value, 0) / present.length)
      : null,
    observations: present.length,
  }
}

function sum(values: readonly (number | null)[]): TelemetryMetricValue {
  const present = values.filter((value): value is number => value != null)
  return {
    value: present.length ? rounded(present.reduce((total, value) => total + value, 0)) : null,
    observations: present.length,
  }
}

function groupKey(record: ProductionTelemetryRecord): string {
  const { versions } = record
  return [
    record.model,
    versions.planner,
    versions.prompt,
    versions.policy,
    versions.prescription,
    versions.outputContract,
    versions.preferences,
    versions.autoregulation,
  ].join('|')
}

function metrics(
  records: readonly ProductionTelemetryRecord[],
): ProductionTelemetryGroup['metrics'] {
  const completed = records.filter((record) => record.completed)
  return {
    policyComplianceRate: mean(
      records.map((record) =>
        record.policyCompliant == null ? null : record.policyCompliant ? 1 : 0,
      ),
    ),
    automaticCorrectionsPerGeneration: mean(
      records.map((record) => record.automaticCorrectionCount),
    ),
    plannedDurationSecondsMean: mean(records.map((record) => record.plannedDurationSeconds)),
    actualDurationSecondsMean: mean(records.map((record) => record.actualDurationSeconds)),
    durationAbsoluteErrorSecondsMean: mean(
      records.map((record) =>
        record.actualDurationSeconds == null
          ? null
          : Math.abs(record.actualDurationSeconds - record.plannedDurationSeconds),
      ),
    ),
    completionRate: mean(records.map((record) => (record.completed ? 1 : 0))),
    skippedBlocksPerCompletedSession: mean(completed.map((record) => record.skippedBlockCount)),
    plannedDifficultyMean: mean(records.map((record) => record.plannedDifficulty)),
    feltDifficultyMean: mean(records.map((record) => record.feltDifficulty)),
    enjoymentMean: mean(records.map((record) => record.enjoyment)),
    replacementsPerSession: mean(records.map((record) => record.replacementCount)),
    adaptationsPerSession: mean(records.map((record) => record.adaptationCount)),
    providerLatencyMillisecondsMean: mean(
      records.map((record) => record.providerLatencyMilliseconds),
    ),
    estimatedCostUsdMean: mean(records.map((record) => record.estimatedCostUsd)),
    estimatedCostUsdTotal: sum(records.map((record) => record.estimatedCostUsd)),
  }
}

/** Agrégation pure : aucune chaîne libre, aucun identifiant de séance ni aucune donnée personnelle ne sort. */
export function aggregateProductionTelemetry(
  records: readonly ProductionTelemetryRecord[],
  window: { from: string; to: string },
  minimumGroupSize = 3,
): ProductionTelemetryReport {
  if (!Number.isInteger(minimumGroupSize) || minimumGroupSize < 1) {
    throw new RangeError('minimumGroupSize doit être un entier positif.')
  }
  const byGenerator = new Map<string, ProductionTelemetryRecord[]>()
  for (const record of records) {
    const key = groupKey(record)
    const group = byGenerator.get(key) ?? []
    group.push(record)
    byGenerator.set(key, group)
  }
  let suppressedSessionCount = 0
  const groups: ProductionTelemetryGroup[] = []
  for (const group of byGenerator.values()) {
    if (group.length < minimumGroupSize) {
      suppressedSessionCount += group.length
      continue
    }
    const first = group[0]!
    groups.push({
      generator: { model: first.model, versions: first.versions },
      sessionCount: group.length,
      metrics: metrics(group),
    })
  }
  groups.sort((left, right) =>
    `${left.generator.model}|${left.generator.versions.prompt}`.localeCompare(
      `${right.generator.model}|${right.generator.versions.prompt}`,
    ),
  )
  return {
    reportVersion: EVALUATION_TELEMETRY_VERSION,
    window: { ...window, basis: 'session_date' },
    privacy: { minimumGroupSize, suppressedSessionCount },
    definitions: TELEMETRY_METRIC_DEFINITIONS,
    groups,
  }
}
