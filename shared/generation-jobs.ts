export const GENERATION_CONTEXT_VERSION = 'generation-context/v1'

export const GENERATION_JOB_STATUSES = [
  'queued',
  'running',
  'retry_scheduled',
  'succeeded',
  'failed',
  'invalidated',
] as const

export type GenerationJobStatus = (typeof GENERATION_JOB_STATUSES)[number]
export type GenerationJobSource = 'automatic' | 'user' | 'prefetch'
export type GenerationErrorKind = 'temporary' | 'permanent'
export type GenerationReuseKind = 'none' | 'session' | 'blocks'

export interface GenerationJobRequest {
  regenerate: boolean
  adjustment: string | null
}

export interface GenerationRunMetrics {
  modelCalls: number
  inputTokens: number
  outputTokens: number
  cacheCreationTokens: number
  cacheReadTokens: number
  providerLatencyMs: number
  reuseKind: GenerationReuseKind
  reusedBlockCount: number
  fallbackUsed: boolean
  /** Nombre d'appels modèle supplémentaires déclenchés par une violation de politique. */
  policyCorrectionCount: number
  /** La sortie finalement persistée a franchi toutes les règles bloquantes. */
  policyCompliant: boolean
}

export interface PublicGenerationJob {
  id: number
  date: string
  status: GenerationJobStatus
  source: GenerationJobSource
  attemptCount: number
  maxAttempts: number
  nextAttemptAt: number | null
  errorKind: GenerationErrorKind | null
  errorCode: string | null
  errorMessage: string | null
  actionableMessage: string | null
  reuseKind: GenerationReuseKind
  reusedBlockCount: number
  fallbackUsed: boolean
  createdAt: number
  startedAt: number | null
  completedAt: number | null
}

export function isActiveGenerationStatus(status: GenerationJobStatus): boolean {
  return status === 'queued' || status === 'running' || status === 'retry_scheduled'
}

/** Backoff exponentiel borné, pur et injectable dans les tests sans aucune attente réelle. */
export function generationRetryDelayMs(
  attemptNumber: number,
  baseMs = 1_000,
  maximumMs = 30_000,
): number {
  const exponent = Math.max(0, Math.trunc(attemptNumber) - 1)
  return Math.min(maximumMs, baseMs * 2 ** exponent)
}

export function emptyGenerationRunMetrics(): GenerationRunMetrics {
  return {
    modelCalls: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheCreationTokens: 0,
    cacheReadTokens: 0,
    providerLatencyMs: 0,
    reuseKind: 'none',
    reusedBlockCount: 0,
    fallbackUsed: false,
    policyCorrectionCount: 0,
    policyCompliant: false,
  }
}
