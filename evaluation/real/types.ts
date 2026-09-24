import type { WorkoutSession } from '../../shared/session-schema'
import type { GeneratorVersions } from '../../shared/generator-version'

export const REAL_METRIC_IDS = [
  'structuralValidity',
  'policyCompliance',
  'blockingViolations',
  'durationAbsoluteErrorSeconds',
  'durationOverrunSeconds',
  'categoryFidelity',
  'focusFidelity',
  'mainExerciseOverlap',
  'warmupCooldownExerciseOverlap',
  'blockDiversityRatio',
  'progressionCoherence',
  'latencyMs',
  'totalTokens',
  'costUsd',
] as const

export type RealMetricId = (typeof REAL_METRIC_IDS)[number]
export type RealMetricValues = Record<RealMetricId, number | null>

export interface RealEvaluationBudget {
  maxCases: number
  maxCalls: number
  maxTotalTokens: number
  maxCostUsd: number
  maxDurationMs: number
  maxOutputTokensPerCall: number
}

export interface RealEvaluationUsage {
  cases: number
  calls: number
  inputTokens: number
  outputTokens: number
  cacheCreationTokens: number
  cacheReadTokens: number
  totalTokens: number
  costUsd: number
  durationMs: number
}

export interface RealProviderUsage {
  inputTokens: number
  outputTokens: number
  cacheCreationTokens: number
  cacheReadTokens: number
}

export interface RealProviderRequest {
  model: string
  systemPrompt: string
  userPrompt: string
  temperature: number
  seed: number
  maxOutputTokens: number
  timeoutMs: number
}

export interface RealProviderResponse {
  model: string
  output: unknown
  usage: RealProviderUsage
  latencyMs: number
}

export interface RealGenerationProvider {
  id: string
  capabilities: {
    seed: boolean
    temperature: boolean
  }
  generate(request: RealProviderRequest): Promise<RealProviderResponse>
}

export interface RealCandidateConfig {
  id: string
  model: string
  versions: GeneratorVersions
}

export interface RealDistribution {
  count: number
  mean: number | null
  variance: number | null
  minimum: number | null
  maximum: number | null
}

export interface RealSample {
  caseId: string
  repetition: number
  seedRequested: number
  seedApplied: boolean
  temperatureRequested: number
  temperatureApplied: number | null
  modelRequested: string
  modelResolved: string
  status: 'evaluated' | 'invalid-output'
  errorCode: 'INVALID_WORKOUT_SESSION' | null
  output: WorkoutSession | unknown
  metrics: RealMetricValues
  usage: RealProviderUsage & { costUsd: number }
}

export interface RealScenarioSummary {
  caseId: string
  title: string
  repetitions: number
  metrics: Record<RealMetricId, RealDistribution>
}

export interface RealCandidateResult {
  candidate: RealCandidateConfig
  samples: RealSample[]
  scenarios: RealScenarioSummary[]
  global: Record<RealMetricId, RealDistribution>
  usage: RealEvaluationUsage
}

export interface RealComparisonMetric {
  baseline: RealDistribution
  candidate: RealDistribution
  deltaMean: number | null
}

export interface RealComparison {
  baselineCandidateId: string
  candidateCandidateId: string
  scenarios: Array<{
    caseId: string
    metrics: Record<RealMetricId, RealComparisonMetric>
  }>
  global: Record<RealMetricId, RealComparisonMetric>
}

export interface RealEvaluationAlert {
  id: string
  metric: RealMetricId
  direction: 'higher-is-better' | 'lower-is-better'
  allowedRegression: number
  observedDelta: number | null
  status: 'pass' | 'alert' | 'unavailable'
}

export interface RealEvaluationReport {
  reportVersion: 'generator-real-evaluation-report/v1'
  generatedAt: string
  provider: {
    id: string
    capabilities: RealGenerationProvider['capabilities']
  }
  reproducibility: {
    seed: number
    seedApplied: boolean
    temperature: number
    temperatureApplied: boolean
    repetitions: number
  }
  provenance: {
    codeRevision: string
    codeDirty: boolean
    corpusId: string
    corpusCaseIds: string[]
    corpusSha256: string
    promptVersion: string
    promptSha256: string
    policyVersion: string
    prescriptionVersion: string
    prescriptionSha256: string
    thresholdsVersion: string
  }
  baselineProvenance: RealEvaluationReport['provenance']
  budget: RealEvaluationBudget
  usage: RealEvaluationUsage
  candidate: RealCandidateResult
  baseline: RealCandidateResult
  comparison: RealComparison
  alerts: RealEvaluationAlert[]
  status: 'pass' | 'alert'
}
