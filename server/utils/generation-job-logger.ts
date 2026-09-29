import type {
  GenerationJobSource,
  GenerationReuseKind,
  GenerationStage,
} from '../../shared/generation-jobs'

export type GenerationJobLogEvent =
  | 'enqueued'
  | 'deduplicated'
  | 'claimed'
  | 'attempt_started'
  | 'stage_started'
  | 'stage_succeeded'
  | 'stage_failed'
  | 'retry_scheduled'
  | 'lease_recovered'
  | 'lease_lost'
  | 'fallback_started'
  | 'invalidated'
  | 'succeeded'
  | 'failed'

export interface GenerationJobLogMetadata {
  event: GenerationJobLogEvent
  jobId: number
  date: string
  source: GenerationJobSource
  attempt?: number
  maxAttempts?: number
  model?: string | null
  stage?: GenerationStage | null
  status?: string
  durationMs?: number
  errorCode?: string | null
  retryDelayMs?: number
  reuseKind?: GenerationReuseKind
  fallbackUsed?: boolean
  workerId?: string
}

function boundedString(value: string, maximum = 128): string {
  return [...value]
    .filter((character) => {
      const code = character.charCodeAt(0)
      return code >= 32 && code !== 127
    })
    .join('')
    .slice(0, maximum)
}

/**
 * Construit exclusivement une allowlist de métadonnées opérationnelles. Aucun objet d'erreur,
 * prompt, header, profil, réponse modèle, contexte ou contenu de séance ne peut être sérialisé.
 */
export function formatGenerationJobLog(
  metadata: GenerationJobLogMetadata,
  timestamp = new Date(),
): string {
  const payload: Record<string, string | number | boolean> = {
    event: metadata.event,
    timestamp: timestamp.toISOString(),
    jobId: metadata.jobId,
    date: boundedString(metadata.date, 10),
    source: metadata.source,
  }
  if (metadata.attempt != null) payload.attempt = metadata.attempt
  if (metadata.maxAttempts != null) payload.maxAttempts = metadata.maxAttempts
  if (metadata.model) payload.model = boundedString(metadata.model)
  if (metadata.stage) payload.stage = metadata.stage
  if (metadata.status) payload.status = boundedString(metadata.status, 48)
  if (metadata.durationMs != null) payload.durationMs = Math.max(0, metadata.durationMs)
  if (metadata.errorCode) payload.errorCode = boundedString(metadata.errorCode, 96)
  if (metadata.retryDelayMs != null) payload.retryDelayMs = Math.max(0, metadata.retryDelayMs)
  if (metadata.reuseKind) payload.reuseKind = metadata.reuseKind
  if (metadata.fallbackUsed != null) payload.fallbackUsed = metadata.fallbackUsed
  if (metadata.workerId) payload.workerId = boundedString(metadata.workerId, 96)
  return `[generation-job] ${JSON.stringify(payload)}`
}

export function logGenerationJobEvent(metadata: GenerationJobLogMetadata): void {
  console.info(formatGenerationJobLog(metadata))
}
