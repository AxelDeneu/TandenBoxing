import { createHash, randomUUID } from 'node:crypto'
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
import { canRewriteGeneratedSession } from '../../shared/session-lifecycle'
import type { GenerationJob, Session } from '../database/schema'
import { isDateDismissed } from '../repositories/dismissed-date.repository'
import {
  claimNextGenerationJob,
  completeGenerationJob,
  createGenerationJobWithResult,
  failGenerationJob,
  findGenerationJob,
  findLatestGenerationJob,
  findNextGenerationWakeAt,
  hasGenerationJobLease,
  hasActiveGenerationJob,
  invalidateClaimedGenerationJob,
  invalidateGenerationJob,
  recoverExpiredGenerationJobLeases,
  requeueFailedGenerationJob,
  renewGenerationJobLease,
  scheduleGenerationJobRetry,
  toPublicGenerationJob,
  updateGenerationJobStage,
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
  type GenerationExecutionControl,
  type GenerationExecutionStageEvent,
  type GeneratedSessionResult,
} from './generation.service'
import { logGenerationJobEvent } from '../utils/generation-job-logger'

const WORKER_ID = `generation-worker:${process.pid}:${randomUUID().slice(0, 8)}`
const PREFETCH_SIZE = 2

/** Budget global catalogue + génération + validation + éventuelle correction. */
export const GENERATION_ATTEMPT_DEADLINE_MS = 5 * 60_000
export const GENERATION_FALLBACK_DEADLINE_MS = 30_000
export const GENERATION_LEASE_MS = 45_000
export const GENERATION_LEASE_HEARTBEAT_MS = 15_000

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

export function automaticGenerationAllowed(
  settings: Pick<ReturnType<typeof getSettings>, 'onboardingCompleted'>,
): boolean {
  return settings.onboardingCompleted
}

export function requestGenerationJob(
  date: string,
  options: RequestGenerationOptions = {},
): GenerationJob | null {
  const source = options.source ?? 'user'
  // Aucune file — même explicite — ne peut atteindre le fournisseur avec un profil incomplet.
  if (!automaticGenerationAllowed(getSettings())) return null
  const existing = findSessionByDate(date)
  const adjustment = options.adjustment?.trim() || null
  if (
    existing &&
    !canRewriteGeneratedSession(existing.status) &&
    (options.regenerate || adjustment)
  ) {
    throw new GenerationExecutionError(
      'permanent',
      'SESSION_IMMUTABLE',
      'Une séance démarrée ou clôturée ne peut pas être régénérée.',
      'Conserve son historique et crée une autre séance si nécessaire.',
    )
  }
  if (existing && !options.regenerate && !adjustment) return null

  const now = new Date()
  const identity = buildGenerationIdentity(date, {
    regenerate: Boolean(options.regenerate),
    adjustment,
  })
  const created = createGenerationJobWithResult({
    sessionDate: date,
    idempotencyKey: identity.idempotencyKey,
    contextHash: identity.contextHash,
    request: identity.request,
    source,
    status: 'queued',
    nextAttemptAt: now,
    queuedAt: now,
  })
  let job = created.job
  logGenerationJobEvent({
    event: created.created ? 'enqueued' : 'deduplicated',
    jobId: job.id,
    date: job.sessionDate,
    source: job.source,
    attempt: job.attemptCount,
    maxAttempts: job.maxAttempts,
    status: job.status,
  })
  if (job.status === 'failed' && options.retryFailed) {
    job = requeueFailedGenerationJob(job.id, now)
  }
  if (isActiveGenerationStatus(job.status)) kickGenerationWorker()
  return job
}

export function retryGenerationJob(jobId: number): GenerationJob {
  const existingJob = findGenerationJob(jobId)
  const session = existingJob ? findSessionByDate(existingJob.sessionDate) : undefined
  if (!existingJob || (session && !canRewriteGeneratedSession(session.status))) {
    throw new GenerationExecutionError(
      'permanent',
      'SESSION_IMMUTABLE',
      'Une séance démarrée ou clôturée ne peut pas être régénérée.',
      'La séance existante est conservée sans modification.',
    )
  }
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
  const estimatedCostUsd = result.metrics.modelCalls ? result.metrics.costUsd : 0
  return { ...result.metrics, durationMs, estimatedCostUsd }
}

export interface GenerationWorkerDependencies {
  now: () => Date
  contextIsCurrent: (job: GenerationJob) => boolean
  execute: (
    job: GenerationJob,
    control: GenerationExecutionControl,
  ) => Promise<GeneratedSessionResult>
  fallback: (
    job: GenerationJob,
    control: GenerationExecutionControl,
  ) => Promise<GeneratedSessionResult>
  canFallback: (job: GenerationJob) => boolean
  onInvalidated: (job: GenerationJob) => void
  onSucceeded: (job: GenerationJob, result: GeneratedSessionResult) => void
}

function productionWorkerDependencies(): GenerationWorkerDependencies {
  return {
    now: () => new Date(),
    contextIsCurrent: (job) =>
      automaticGenerationAllowed(getSettings()) &&
      buildGenerationIdentity(job.sessionDate, job.request).contextHash === job.contextHash,
    execute: (job, control) =>
      generateSessionForDateDetailed(job.sessionDate, {
        ...job.request,
        contextHash: job.contextHash,
        source: job.source,
        control,
      }),
    fallback: async (job, control) =>
      generateDeterministicFallbackForDate(job.sessionDate, {
        contextHash: job.contextHash,
        control,
      }),
    canFallback: (job) => !job.request.adjustment && !findSessionByDate(job.sessionDate),
    onInvalidated: (job) => {
      const session = findSessionByDate(job.sessionDate)
      if (session && !canRewriteGeneratedSession(session.status)) return
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

class GenerationLeaseLostError extends Error {
  constructor() {
    super('Le lease de génération n’appartient plus à ce worker.')
    this.name = 'GenerationLeaseLostError'
  }
}

function attemptDeadlineError(): GenerationExecutionError {
  return new GenerationExecutionError(
    'temporary',
    'GENERATION_ATTEMPT_DEADLINE_EXCEEDED',
    'La tentative a dépassé son budget maximal.',
    'Une nouvelle tentative sera lancée automatiquement.',
  )
}

function stageLogEvent(status: GenerationExecutionStageEvent['status']) {
  if (status === 'started') return 'stage_started' as const
  if (status === 'succeeded') return 'stage_succeeded' as const
  return 'stage_failed' as const
}

function executionControl(
  job: GenerationJob,
  dependencies: GenerationWorkerDependencies,
  controller: AbortController,
): GenerationExecutionControl {
  const assertActive = () => {
    controller.signal.throwIfAborted()
    if (!hasGenerationJobLease(job, dependencies.now())) throw new GenerationLeaseLostError()
  }

  return {
    signal: controller.signal,
    assertActive,
    onStage: (event) => {
      const now = dependencies.now()
      if (
        event.status === 'started' &&
        !updateGenerationJobStage(job, event.stage, now, GENERATION_LEASE_MS)
      ) {
        throw new GenerationLeaseLostError()
      }
      if (event.status !== 'started') assertActive()
      logGenerationJobEvent({
        event: stageLogEvent(event.status),
        jobId: job.id,
        date: job.sessionDate,
        source: job.source,
        attempt: job.attemptCount,
        maxAttempts: job.maxAttempts,
        model: event.model,
        stage: event.stage,
        status: event.status,
        durationMs: event.durationMs,
        errorCode: event.errorCode,
        workerId: WORKER_ID,
      })
    },
  }
}

/** Watchdog applicatif et heartbeat de lease, tous deux indépendants du timeout du SDK. */
async function runClaimedOperation<T>(
  job: GenerationJob,
  dependencies: GenerationWorkerDependencies,
  timeoutMs: number,
  operation: (control: GenerationExecutionControl) => Promise<T>,
): Promise<T> {
  const controller = new AbortController()
  if (!renewGenerationJobLease(job, dependencies.now(), GENERATION_LEASE_MS)) {
    throw new GenerationLeaseLostError()
  }
  let rejectLeaseLost!: (error: GenerationLeaseLostError) => void
  const leaseLost = new Promise<never>((_resolve, reject) => {
    rejectLeaseLost = reject
  })
  let deadlineTimer: ReturnType<typeof setTimeout> | null = null
  const deadline = new Promise<never>((_resolve, reject) => {
    deadlineTimer = setTimeout(() => {
      const error = attemptDeadlineError()
      reject(error)
      controller.abort(error)
    }, timeoutMs)
  })

  const heartbeat = setInterval(() => {
    try {
      if (renewGenerationJobLease(job, dependencies.now(), GENERATION_LEASE_MS)) return
    } catch {
      // Une erreur de renouvellement est traitée comme une perte de lease, sans journaliser l'erreur brute.
    }
    const error = new GenerationLeaseLostError()
    rejectLeaseLost(error)
    controller.abort(error)
  }, GENERATION_LEASE_HEARTBEAT_MS)
  const control = executionControl(job, dependencies, controller)

  try {
    return await Promise.race([operation(control), deadline, leaseLost])
  } finally {
    clearInterval(heartbeat)
    if (deadlineTimer) clearTimeout(deadlineTimer)
  }
}

async function runFallback(
  job: GenerationJob,
  dependencies: GenerationWorkerDependencies,
): Promise<GeneratedSessionResult> {
  logGenerationJobEvent({
    event: 'fallback_started',
    jobId: job.id,
    date: job.sessionDate,
    source: job.source,
    attempt: job.attemptCount,
    maxAttempts: job.maxAttempts,
    stage: 'fallback',
    status: 'running',
    workerId: WORKER_ID,
  })
  return runClaimedOperation(job, dependencies, GENERATION_FALLBACK_DEADLINE_MS, (control) =>
    dependencies.fallback(job, control),
  )
}

/**
 * Traite un job déjà claimé. Les dépendances injectables rendent retries/backoff/fallback
 * testables avec une horloge fixe, sans `sleep` réel ni fournisseur externe.
 */
export async function processClaimedGenerationJob(
  job: GenerationJob,
  dependencies: GenerationWorkerDependencies = productionWorkerDependencies(),
): Promise<'succeeded' | 'retry_scheduled' | 'failed' | 'invalidated' | 'lease_lost'> {
  const startedAt = dependencies.now()

  logGenerationJobEvent({
    event: 'attempt_started',
    jobId: job.id,
    date: job.sessionDate,
    source: job.source,
    attempt: job.attemptCount,
    maxAttempts: job.maxAttempts,
    status: 'running',
    workerId: WORKER_ID,
  })

  const persisted = findSessionByDate(job.sessionDate)
  if (persisted?.generationContextHash === job.contextHash) {
    const metrics: GenerationRunMetrics = {
      modelCalls: 0,
      inputTokens: 0,
      outputTokens: 0,
      cacheCreationTokens: 0,
      cacheReadTokens: 0,
      costUsd: 0,
      providerLatencyMs: 0,
      reuseKind: persisted.reusedFromSessionId ? 'session' : 'none',
      reusedBlockCount: 0,
      fallbackUsed: persisted.fallbackUsed,
      policyCorrectionCount: 0,
      policyCompliant: true,
    }
    const completed = completeGenerationJob(
      job,
      {
        ...metrics,
        durationMs: 0,
        estimatedCostUsd: 0,
      },
      undefined,
      dependencies.now(),
    )
    if (!completed) return 'lease_lost'
    logGenerationJobEvent({
      event: 'succeeded',
      jobId: job.id,
      date: job.sessionDate,
      source: job.source,
      attempt: job.attemptCount,
      maxAttempts: job.maxAttempts,
      status: 'succeeded',
      durationMs: 0,
      reuseKind: metrics.reuseKind,
      fallbackUsed: metrics.fallbackUsed,
      workerId: WORKER_ID,
    })
    return 'succeeded'
  }

  if (!dependencies.contextIsCurrent(job)) {
    const invalidated = invalidateClaimedGenerationJob(
      job,
      'Le profil, les préférences ou la politique ont changé.',
      dependencies.now(),
    )
    if (!invalidated) return 'lease_lost'
    logGenerationJobEvent({
      event: 'invalidated',
      jobId: job.id,
      date: job.sessionDate,
      source: job.source,
      attempt: job.attemptCount,
      maxAttempts: job.maxAttempts,
      status: 'invalidated',
      errorCode: 'CONTEXT_INVALIDATED',
      workerId: WORKER_ID,
    })
    dependencies.onInvalidated(job)
    return 'invalidated'
  }

  // Un crash compte comme un essai potentiel. Au-delà de la borne, la reprise va directement
  // au fallback au lieu de rappeler indéfiniment le fournisseur à chaque redémarrage.
  if (job.attemptCount > job.maxAttempts) {
    if (dependencies.canFallback(job)) {
      try {
        const result = await runFallback(job, dependencies)
        const completed = completeGenerationJob(
          job,
          completion(result, 0),
          {
            kind: 'temporary',
            code: 'WORKER_INTERRUPTED',
            message: 'Le dernier essai a été interrompu avant la reprise.',
            actionableMessage: 'Le fallback local a pris le relais.',
          },
          dependencies.now(),
        )
        if (!completed) return 'lease_lost'
        logGenerationJobEvent({
          event: 'succeeded',
          jobId: job.id,
          date: job.sessionDate,
          source: job.source,
          attempt: job.attemptCount,
          maxAttempts: job.maxAttempts,
          status: 'succeeded',
          durationMs: 0,
          reuseKind: result.metrics.reuseKind,
          fallbackUsed: true,
          workerId: WORKER_ID,
        })
        dependencies.onSucceeded(job, result)
        return 'succeeded'
      } catch (error) {
        if (error instanceof GenerationLeaseLostError) return 'lease_lost'
        const failure = generationFailure(error)
        if (!failGenerationJob(job, failure, 0, dependencies.now())) return 'lease_lost'
        logGenerationJobEvent({
          event: 'failed',
          jobId: job.id,
          date: job.sessionDate,
          source: job.source,
          attempt: job.attemptCount,
          maxAttempts: job.maxAttempts,
          status: 'failed',
          durationMs: 0,
          errorCode: failure.code,
          workerId: WORKER_ID,
        })
        return 'failed'
      }
    }
    const failure = {
      kind: 'temporary' as const,
      code: 'RETRY_BUDGET_EXHAUSTED_AFTER_RESTART',
      message: 'Le budget de tentatives était épuisé avant la reprise.',
      actionableMessage: 'Relance explicitement la génération.',
    }
    if (!failGenerationJob(job, failure, 0, dependencies.now())) return 'lease_lost'
    logGenerationJobEvent({
      event: 'failed',
      jobId: job.id,
      date: job.sessionDate,
      source: job.source,
      attempt: job.attemptCount,
      maxAttempts: job.maxAttempts,
      status: 'failed',
      durationMs: 0,
      errorCode: failure.code,
      workerId: WORKER_ID,
    })
    return 'failed'
  }

  try {
    const result = await runClaimedOperation(
      job,
      dependencies,
      GENERATION_ATTEMPT_DEADLINE_MS,
      (control) => dependencies.execute(job, control),
    )
    const durationMs = Math.max(0, dependencies.now().getTime() - startedAt.getTime())
    if (
      !completeGenerationJob(job, completion(result, durationMs), undefined, dependencies.now())
    ) {
      return 'lease_lost'
    }
    logGenerationJobEvent({
      event: 'succeeded',
      jobId: job.id,
      date: job.sessionDate,
      source: job.source,
      attempt: job.attemptCount,
      maxAttempts: job.maxAttempts,
      status: 'succeeded',
      durationMs,
      reuseKind: result.metrics.reuseKind,
      fallbackUsed: result.metrics.fallbackUsed,
      workerId: WORKER_ID,
    })
    dependencies.onSucceeded(job, result)
    return 'succeeded'
  } catch (error) {
    if (error instanceof GenerationLeaseLostError) {
      logGenerationJobEvent({
        event: 'lease_lost',
        jobId: job.id,
        date: job.sessionDate,
        source: job.source,
        attempt: job.attemptCount,
        maxAttempts: job.maxAttempts,
        status: 'ignored',
        workerId: WORKER_ID,
      })
      return 'lease_lost'
    }
    const failure = generationFailure(error)
    const now = dependencies.now()
    const durationMs = Math.max(0, now.getTime() - startedAt.getTime())
    const retryable = failure.kind === 'temporary' && job.attemptCount < job.maxAttempts
    if (retryable) {
      const backoffMs = generationRetryDelayMs(job.attemptCount)
      const scheduled = scheduleGenerationJobRetry(
        job,
        failure,
        new Date(now.getTime() + backoffMs),
        backoffMs,
        durationMs,
        now,
      )
      if (!scheduled) return 'lease_lost'
      logGenerationJobEvent({
        event: 'retry_scheduled',
        jobId: job.id,
        date: job.sessionDate,
        source: job.source,
        attempt: job.attemptCount,
        maxAttempts: job.maxAttempts,
        status: 'retry_scheduled',
        durationMs,
        errorCode: failure.code,
        retryDelayMs: backoffMs,
        workerId: WORKER_ID,
      })
      return 'retry_scheduled'
    }

    if (dependencies.canFallback(job)) {
      try {
        const result = await runFallback(job, dependencies)
        const totalDurationMs = Math.max(0, dependencies.now().getTime() - startedAt.getTime())
        if (
          !completeGenerationJob(
            job,
            completion(result, totalDurationMs),
            failure,
            dependencies.now(),
          )
        ) {
          return 'lease_lost'
        }
        logGenerationJobEvent({
          event: 'succeeded',
          jobId: job.id,
          date: job.sessionDate,
          source: job.source,
          attempt: job.attemptCount,
          maxAttempts: job.maxAttempts,
          status: 'succeeded',
          durationMs: totalDurationMs,
          errorCode: failure.code,
          reuseKind: result.metrics.reuseKind,
          fallbackUsed: true,
          workerId: WORKER_ID,
        })
        dependencies.onSucceeded(job, result)
        return 'succeeded'
      } catch (fallbackError) {
        if (fallbackError instanceof GenerationLeaseLostError) return 'lease_lost'
        const fallbackFailure = generationFailure(fallbackError)
        if (!failGenerationJob(job, fallbackFailure, durationMs, dependencies.now())) {
          return 'lease_lost'
        }
        logGenerationJobEvent({
          event: 'failed',
          jobId: job.id,
          date: job.sessionDate,
          source: job.source,
          attempt: job.attemptCount,
          maxAttempts: job.maxAttempts,
          status: 'failed',
          durationMs,
          errorCode: fallbackFailure.code,
          workerId: WORKER_ID,
        })
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
    if (!failGenerationJob(job, actionableFailure, durationMs, dependencies.now())) {
      return 'lease_lost'
    }
    logGenerationJobEvent({
      event: 'failed',
      jobId: job.id,
      date: job.sessionDate,
      source: job.source,
      attempt: job.attemptCount,
      maxAttempts: job.maxAttempts,
      status: 'failed',
      durationMs,
      errorCode: actionableFailure.code,
      workerId: WORKER_ID,
    })
    return 'failed'
  }
}

export async function processNextGenerationJob(
  dependencies: GenerationWorkerDependencies = productionWorkerDependencies(),
): Promise<boolean> {
  const now = dependencies.now()
  for (const recovered of recoverExpiredGenerationJobLeases(now)) {
    logGenerationJobEvent({
      event: 'lease_recovered',
      jobId: recovered.jobId,
      date: recovered.date,
      source: recovered.source,
      attempt: recovered.attempt,
      maxAttempts: recovered.maxAttempts,
      stage: recovered.stage,
      status: 'queued',
      errorCode: 'WORKER_INTERRUPTED',
      workerId: WORKER_ID,
    })
  }
  const job = claimNextGenerationJob(WORKER_ID, now, GENERATION_LEASE_MS)
  if (!job) return false
  logGenerationJobEvent({
    event: 'claimed',
    jobId: job.id,
    date: job.sessionDate,
    source: job.source,
    attempt: job.attemptCount,
    maxAttempts: job.maxAttempts,
    status: 'running',
    workerId: WORKER_ID,
  })
  await processClaimedGenerationJob(job, dependencies)
  return true
}

export interface GenerationWorkerWakeDependencies {
  now: () => number
  wake: () => void
  setTimer: typeof setTimeout
  clearTimer: typeof clearTimeout
}

/** Programme aussi bien un retry futur que la prochaine expiration de lease. */
export function scheduleGenerationWorkerWake(
  dependencies: GenerationWorkerWakeDependencies = {
    now: Date.now,
    wake: kickGenerationWorker,
    setTimer: setTimeout,
    clearTimer: clearTimeout,
  },
): void {
  if (wakeTimer) dependencies.clearTimer(wakeTimer)
  wakeTimer = null
  const next = findNextGenerationWakeAt()
  if (!next) return
  const delay = Math.max(0, Math.min(2_147_483_647, next.getTime() - dependencies.now()))
  wakeTimer = dependencies.setTimer(() => {
    wakeTimer = null
    dependencies.wake()
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
    } catch {
      console.error(
        '[generation-job] ' +
          JSON.stringify({
            event: 'worker_crashed',
            timestamp: new Date().toISOString(),
            errorCode: 'UNEXPECTED_WORKER_ERROR',
            workerId: WORKER_ID,
          }),
      )
    } finally {
      workerRunning = false
      scheduleGenerationWorkerWake()
    }
  })
}

export function resumeGenerationJobs(): void {
  const now = new Date()
  for (const recovered of recoverExpiredGenerationJobLeases(now)) {
    logGenerationJobEvent({
      event: 'lease_recovered',
      jobId: recovered.jobId,
      date: recovered.date,
      source: recovered.source,
      attempt: recovered.attempt,
      maxAttempts: recovered.maxAttempts,
      stage: recovered.stage,
      status: 'queued',
      errorCode: 'WORKER_INTERRUPTED',
      workerId: WORKER_ID,
    })
  }
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
        logGenerationJobEvent({
          event: 'invalidated',
          jobId: latest.id,
          date: latest.sessionDate,
          source: latest.source,
          attempt: latest.attemptCount,
          maxAttempts: latest.maxAttempts,
          status: 'invalidated',
          errorCode: 'CONTEXT_INVALIDATED',
          workerId: WORKER_ID,
        })
      }
    },
    shouldRegenerate: (session) =>
      settings.onboardingCompleted &&
      settings.trainingDays.includes(isoWeekday(session.date)) &&
      !isDateDismissed(session.date),
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

export interface EnsureTodaySessionDependencies {
  today: (timezone: string) => string
  weekday: (date: string) => number
  findSession: (date: string) => Session | undefined
  isDismissed: (date: string) => boolean
  request: (date: string) => void
}

export function ensureTodaySessionWithDependencies(
  settings: Pick<
    ReturnType<typeof getSettings>,
    'onboardingCompleted' | 'timezone' | 'trainingDays'
  >,
  dependencies: EnsureTodaySessionDependencies,
): Session | null {
  if (!automaticGenerationAllowed(settings)) return null
  const today = dependencies.today(settings.timezone)
  if (!settings.trainingDays.includes(dependencies.weekday(today))) return null
  const existing = dependencies.findSession(today)
  if (existing) return existing
  if (dependencies.isDismissed(today)) return null
  dependencies.request(today)
  return null
}

export function triggerGeneration(
  date: string,
  options: { regenerate?: boolean; adjustment?: string } = {},
): GenerationJob | null {
  return requestGenerationJob(date, { ...options, source: 'user', retryFailed: true })
}

export function ensureTodaySession() {
  const settings = getSettings()
  return ensureTodaySessionWithDependencies(settings, {
    today: todayIso,
    weekday: isoWeekday,
    findSession: findSessionByDate,
    isDismissed: isDateDismissed,
    request: (date) => {
      requestGenerationJob(date, { source: 'automatic' })
    },
  })
}
