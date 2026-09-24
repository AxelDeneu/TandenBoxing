import { createHash, randomUUID } from 'node:crypto'
import { estimateCostUsd } from '../../shared/ai-pricing'
import {
  GENERATION_CONTEXT_VERSION,
  generationRetryDelayMs,
  isActiveGenerationStatus,
  type GenerationJobRequest,
  type GenerationJobSource,
  type GenerationRunMetrics,
} from '../../shared/generation-jobs'
import { GENERATOR_VERSIONS } from '../../shared/generator-version'
import { addDays, isoWeekday, todayIso } from '../../shared/dates'
import type { GenerationJob, Session } from '../database/schema'
import { isDateDismissed } from '../repositories/dismissed-date.repository'
import {
  claimNextGenerationJob,
  completeGenerationJob,
  createGenerationJob,
  failGenerationJob,
  findLatestGenerationJob,
  findNextGenerationDispatchAt,
  hasActiveGenerationJob,
  invalidateGenerationJob,
  recoverExpiredGenerationJobs,
  requeueFailedGenerationJob,
  scheduleGenerationJobRetry,
  toPublicGenerationJob,
  type GenerationCompletion,
  type GenerationFailure,
} from '../repositories/generation-job.repository'
import {
  deleteSessionByDate,
  findSessionByDate,
  listPreparedSessions,
} from '../repositories/session.repository'
import { getSettings } from '../repositories/settings.repository'
import {
  buildGenerationContext,
  generateDeterministicFallbackForDate,
  generateSessionForDateDetailed,
  GenerationExecutionError,
  type GeneratedSessionResult,
} from './generation.service'

const WORKER_ID = `generation-worker:${process.pid}:${randomUUID()}`
const PREFETCH_SIZE = 2

let workerRunning = false
let wakeTimer: ReturnType<typeof setTimeout> | null = null

function stableValue(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString()
  if (Array.isArray(value)) return value.map(stableValue)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, stableValue(item)]),
  )
}

export function stableGenerationHash(value: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify(stableValue(value)))
    .digest('hex')
}

export interface GenerationIdentity {
  contextHash: string
  idempotencyKey: string
  request: GenerationJobRequest
}

/**
 * L'empreinte inclut explicitement `prescription.exercisePreferences` via le contexte : toute
 * préférence de #12, version de politique, modification du profil ou du plan change la clé.
 */
export function buildGenerationIdentity(
  date: string,
  request: GenerationJobRequest,
): GenerationIdentity {
  const existing = findSessionByDate(date)
  const normalizedRequest: GenerationJobRequest = {
    regenerate: Boolean(existing && request.regenerate),
    adjustment: request.adjustment?.trim() || null,
  }
  const { context } = buildGenerationContext(date)
  const contextHash = stableGenerationHash({
    version: GENERATION_CONTEXT_VERSION,
    generatorVersions: GENERATOR_VERSIONS,
    context,
    request: normalizedRequest,
    existingRevision:
      normalizedRequest.regenerate || normalizedRequest.adjustment
        ? {
            id: existing?.id ?? null,
            status: existing?.status ?? null,
            updatedAt: existing?.updatedAt ?? null,
            generatedAt: existing?.generatedAt ?? null,
          }
        : null,
  })
  return {
    contextHash,
    idempotencyKey: `session:${date}:${contextHash}`,
    request: normalizedRequest,
  }
}

export interface RequestGenerationOptions {
  regenerate?: boolean
  adjustment?: string | null
  source?: GenerationJobSource
  retryFailed?: boolean
}

export function requestGenerationJob(
  date: string,
  options: RequestGenerationOptions = {},
): GenerationJob | null {
  const existing = findSessionByDate(date)
  const adjustment = options.adjustment?.trim() || null
  if (existing?.status === 'in_progress' && (options.regenerate || adjustment)) {
    throw new GenerationExecutionError(
      'permanent',
      'SESSION_ALREADY_STARTED',
      'Une séance démarrée ne peut être régénérée.',
      'Utilise les actions du timer pour adapter uniquement la suite.',
    )
  }
  if (existing && !options.regenerate && !adjustment) return null

  const now = new Date()
  const identity = buildGenerationIdentity(date, {
    regenerate: Boolean(options.regenerate),
    adjustment,
  })
  let job = createGenerationJob({
    sessionDate: date,
    idempotencyKey: identity.idempotencyKey,
    contextHash: identity.contextHash,
    request: identity.request,
    source: options.source ?? 'user',
    status: 'queued',
    nextAttemptAt: now,
    queuedAt: now,
  })
  if (job.status === 'failed' && options.retryFailed) {
    job = requeueFailedGenerationJob(job.id, now)
  }
  if (isActiveGenerationStatus(job.status)) kickGenerationWorker()
  return job
}

export function retryGenerationJob(jobId: number): GenerationJob {
  const job = requeueFailedGenerationJob(jobId)
  kickGenerationWorker()
  return job
}

function generationFailure(error: unknown): GenerationFailure {
  if (error instanceof GenerationExecutionError) {
    return {
      kind: error.kind,
      code: error.code,
      message: error.message,
      actionableMessage: error.actionableMessage,
    }
  }
  return {
    kind: 'temporary',
    code: 'UNEXPECTED_GENERATION_ERROR',
    message: 'Une erreur technique inattendue a interrompu la génération.',
    actionableMessage: 'Une nouvelle tentative sera lancée automatiquement.',
  }
}

function completion(result: GeneratedSessionResult, durationMs: number): GenerationCompletion {
  const model = result.session.aiModel
  const estimatedCostUsd = result.metrics.modelCalls ? estimateCostUsd(model, result.metrics) : 0
  return { ...result.metrics, durationMs, estimatedCostUsd }
}

export interface GenerationWorkerDependencies {
  now: () => Date
  contextIsCurrent: (job: GenerationJob) => boolean
  execute: (job: GenerationJob) => Promise<GeneratedSessionResult>
  fallback: (job: GenerationJob) => Promise<GeneratedSessionResult>
  canFallback: (job: GenerationJob) => boolean
  onInvalidated: (job: GenerationJob) => void
  onSucceeded: (job: GenerationJob, result: GeneratedSessionResult) => void
}

function productionWorkerDependencies(): GenerationWorkerDependencies {
  return {
    now: () => new Date(),
    contextIsCurrent: (job) =>
      buildGenerationIdentity(job.sessionDate, job.request).contextHash === job.contextHash,
    execute: (job) =>
      generateSessionForDateDetailed(job.sessionDate, {
        ...job.request,
        contextHash: job.contextHash,
        source: job.source,
      }),
    fallback: async (job) =>
      generateDeterministicFallbackForDate(job.sessionDate, { contextHash: job.contextHash }),
    canFallback: (job) => !job.request.adjustment && !findSessionByDate(job.sessionDate),
    onInvalidated: (job) => {
      requestGenerationJob(job.sessionDate, {
        ...job.request,
        source: job.source,
      })
    },
    onSucceeded: (job) => {
      if (job.source !== 'prefetch' && !job.request.adjustment) {
        enqueuePrefetchBatch(job.sessionDate)
      }
    },
  }
}

/**
 * Traite un job déjà claimé. Les dépendances injectables rendent retries/backoff/fallback
 * testables avec une horloge fixe, sans `sleep` réel ni fournisseur externe.
 */
export async function processClaimedGenerationJob(
  job: GenerationJob,
  dependencies: GenerationWorkerDependencies = productionWorkerDependencies(),
): Promise<'succeeded' | 'retry_scheduled' | 'failed' | 'invalidated'> {
  const startedAt = dependencies.now()

  const persisted = findSessionByDate(job.sessionDate)
  if (persisted?.generationContextHash === job.contextHash) {
    const metrics: GenerationRunMetrics = {
      modelCalls: 0,
      inputTokens: 0,
      outputTokens: 0,
      cacheCreationTokens: 0,
      cacheReadTokens: 0,
      providerLatencyMs: 0,
      reuseKind: persisted.reusedFromSessionId ? 'session' : 'none',
      reusedBlockCount: 0,
      fallbackUsed: persisted.fallbackUsed,
      policyCorrectionCount: 0,
      policyCompliant: true,
    }
    completeGenerationJob(job, {
      ...metrics,
      durationMs: 0,
      estimatedCostUsd: 0,
    })
    return 'succeeded'
  }

  if (!dependencies.contextIsCurrent(job)) {
    invalidateGenerationJob(job.id, 'Le profil, les préférences ou la politique ont changé.')
    dependencies.onInvalidated(job)
    return 'invalidated'
  }

  // Un crash compte comme un essai potentiel. Au-delà de la borne, la reprise va directement
  // au fallback au lieu de rappeler indéfiniment le fournisseur à chaque redémarrage.
  if (job.attemptCount > job.maxAttempts) {
    if (dependencies.canFallback(job)) {
      try {
        const result = await dependencies.fallback(job)
        completeGenerationJob(job, completion(result, 0), {
          kind: 'temporary',
          code: 'WORKER_INTERRUPTED',
          message: 'Le dernier essai a été interrompu avant la reprise.',
          actionableMessage: 'Le fallback local a pris le relais.',
        })
        dependencies.onSucceeded(job, result)
        return 'succeeded'
      } catch (error) {
        failGenerationJob(job, generationFailure(error), 0)
        return 'failed'
      }
    }
    failGenerationJob(
      job,
      {
        kind: 'temporary',
        code: 'RETRY_BUDGET_EXHAUSTED_AFTER_RESTART',
        message: 'Le budget de tentatives était épuisé avant la reprise.',
        actionableMessage: 'Relance explicitement la génération.',
      },
      0,
    )
    return 'failed'
  }

  try {
    const result = await dependencies.execute(job)
    const durationMs = Math.max(0, dependencies.now().getTime() - startedAt.getTime())
    completeGenerationJob(job, completion(result, durationMs))
    dependencies.onSucceeded(job, result)
    return 'succeeded'
  } catch (error) {
    const failure = generationFailure(error)
    const now = dependencies.now()
    const durationMs = Math.max(0, now.getTime() - startedAt.getTime())
    const retryable = failure.kind === 'temporary' && job.attemptCount < job.maxAttempts
    if (retryable) {
      const backoffMs = generationRetryDelayMs(job.attemptCount)
      scheduleGenerationJobRetry(
        job,
        failure,
        new Date(now.getTime() + backoffMs),
        backoffMs,
        durationMs,
      )
      return 'retry_scheduled'
    }

    if (dependencies.canFallback(job)) {
      try {
        const result = await dependencies.fallback(job)
        const totalDurationMs = Math.max(0, dependencies.now().getTime() - startedAt.getTime())
        completeGenerationJob(job, completion(result, totalDurationMs), failure)
        dependencies.onSucceeded(job, result)
        return 'succeeded'
      } catch (fallbackError) {
        const fallbackFailure = generationFailure(fallbackError)
        failGenerationJob(job, fallbackFailure, durationMs)
        return 'failed'
      }
    }

    const actionableFailure: GenerationFailure = {
      ...failure,
      actionableMessage:
        failure.kind === 'temporary'
          ? 'Les tentatives automatiques sont épuisées. Relance explicitement la génération.'
          : failure.actionableMessage,
    }
    failGenerationJob(job, actionableFailure, durationMs)
    return 'failed'
  }
}

export async function processNextGenerationJob(
  dependencies: GenerationWorkerDependencies = productionWorkerDependencies(),
): Promise<boolean> {
  const now = dependencies.now()
  recoverExpiredGenerationJobs(now)
  const job = claimNextGenerationJob(WORKER_ID, now)
  if (!job) return false
  await processClaimedGenerationJob(job, dependencies)
  return true
}

function scheduleWorkerWake(): void {
  if (wakeTimer) clearTimeout(wakeTimer)
  const next = findNextGenerationDispatchAt()
  if (!next) return
  const delay = Math.max(0, Math.min(2_147_483_647, next.getTime() - Date.now()))
  wakeTimer = setTimeout(() => {
    wakeTimer = null
    kickGenerationWorker()
  }, delay)
}

export function kickGenerationWorker(): void {
  if (workerRunning) return
  workerRunning = true
  queueMicrotask(async () => {
    try {
      while (await processNextGenerationJob()) {
        // Draine les jobs immédiatement disponibles ; les retries futurs ont leur propre réveil.
      }
    } catch (error) {
      console.error('[generation-job] Worker interrompu :', error)
    } finally {
      workerRunning = false
      scheduleWorkerWake()
    }
  })
}

export function resumeGenerationJobs(): void {
  recoverExpiredGenerationJobs(new Date())
  invalidatePreparedSessions()
  kickGenerationWorker()
}

export function enqueuePrefetchBatch(afterDate: string): GenerationJob[] {
  const settings = getSettings()
  if (!settings.onboardingCompleted) return []
  const jobs: GenerationJob[] = []
  let date = afterDate
  for (let offset = 0; offset < 30 && jobs.length < PREFETCH_SIZE; offset += 1) {
    date = addDays(date, 1)
    if (!settings.trainingDays.includes(isoWeekday(date))) continue
    if (findSessionByDate(date) || isDateDismissed(date)) continue
    const job = requestGenerationJob(date, { source: 'prefetch' })
    if (job) jobs.push(job)
  }
  return jobs
}

export interface PreparedSessionInvalidationDependencies {
  sessions: readonly Session[]
  currentContextHash: (session: Session) => string
  remove: (session: Session) => void
  markJobInvalidated: (session: Session) => void
  shouldRegenerate: (session: Session) => boolean
  regenerate: (session: Session) => void
}

/** Noyau injectable : compare les empreintes puis invalide avant toute nouvelle génération. */
export function invalidatePreparedSessionBatch(
  dependencies: PreparedSessionInvalidationDependencies,
): string[] {
  const invalidated: string[] = []
  for (const session of dependencies.sessions) {
    if (session.generationContextHash === dependencies.currentContextHash(session)) continue
    dependencies.remove(session)
    dependencies.markJobInvalidated(session)
    invalidated.push(session.date)
    if (dependencies.shouldRegenerate(session)) dependencies.regenerate(session)
  }
  return invalidated
}

/** Supprime puis remplace uniquement les séances anticipées dont l'empreinte n'est plus valide. */
export function invalidatePreparedSessions(): string[] {
  const settings = getSettings()
  const today = todayIso(settings.timezone)
  return invalidatePreparedSessionBatch({
    sessions: listPreparedSessions(today),
    currentContextHash: (session) =>
      buildGenerationIdentity(session.date, {
        regenerate: false,
        adjustment: null,
      }).contextHash,
    remove: (session) => deleteSessionByDate(session.date),
    markJobInvalidated: (session) => {
      const latest = findLatestGenerationJob(session.date)
      if (latest?.status === 'succeeded') {
        invalidateGenerationJob(
          latest.id,
          'Séance anticipée invalidée par un changement de contexte.',
        )
      }
    },
    shouldRegenerate: (session) =>
      settings.trainingDays.includes(isoWeekday(session.date)) && !isDateDismissed(session.date),
    regenerate: (session) => {
      requestGenerationJob(session.date, { source: 'prefetch' })
    },
  })
}

export function isGenerating(date: string): boolean {
  return hasActiveGenerationJob(date)
}

export function generationJobForDate(date: string) {
  return toPublicGenerationJob(findLatestGenerationJob(date))
}

export function triggerGeneration(
  date: string,
  options: { regenerate?: boolean; adjustment?: string } = {},
): GenerationJob | null {
  return requestGenerationJob(date, { ...options, source: 'user', retryFailed: true })
}

export function ensureTodaySession() {
  const settings = getSettings()
  const today = todayIso(settings.timezone)
  if (!settings.trainingDays.includes(isoWeekday(today))) return null
  const existing = findSessionByDate(today)
  if (existing) return existing
  if (isDateDismissed(today)) return null
  requestGenerationJob(today, { source: 'automatic' })
  return null
}
