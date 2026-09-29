import { randomUUID } from 'node:crypto'
import { and, asc, desc, eq, gt, gte, inArray, isNotNull, isNull, lte, sql } from 'drizzle-orm'
import type {
  GenerationErrorKind,
  GenerationJobStatus,
  GenerationRunMetrics,
  GenerationStage,
  PublicGenerationJob,
} from '../../shared/generation-jobs'
import {
  generationJobAttempts,
  generationJobs,
  type GenerationJob,
  type GenerationJobAttempt,
  type NewGenerationJob,
} from '../database/schema'

const ACTIVE_STATUSES: GenerationJobStatus[] = ['queued', 'running', 'retry_scheduled']

export interface GenerationFailure {
  kind: GenerationErrorKind
  code: string
  message: string
  actionableMessage: string
}

export interface GenerationCompletion extends GenerationRunMetrics {
  durationMs: number
  estimatedCostUsd: number | null
}

export interface CreatedGenerationJob {
  job: GenerationJob
  created: boolean
}

export interface GenerationLeaseRecovery {
  jobId: number
  date: string
  source: GenerationJob['source']
  attempt: number
  maxAttempts: number
  stage: GenerationStage | null
}

function nullableEquals<T>(column: Parameters<typeof isNull>[0], value: T | null) {
  return value == null ? isNull(column) : eq(column, value)
}

function claimFence(job: GenerationJob, now: Date, requireUnexpired = true) {
  return and(
    eq(generationJobs.id, job.id),
    eq(generationJobs.status, 'running'),
    eq(generationJobs.attemptCount, job.attemptCount),
    nullableEquals(generationJobs.leaseOwner, job.leaseOwner),
    nullableEquals(generationJobs.leaseToken, job.leaseToken),
    ...(requireUnexpired ? [gt(generationJobs.leaseExpiresAt, now)] : []),
  )
}

function attemptFence(job: GenerationJob) {
  return and(
    eq(generationJobAttempts.jobId, job.id),
    eq(generationJobAttempts.attemptNumber, job.attemptCount),
    eq(generationJobAttempts.status, 'running'),
    nullableEquals(generationJobAttempts.leaseToken, job.leaseToken),
  )
}

function assertAttemptTransition(changes: number): void {
  if (changes !== 1) throw new Error('GENERATION_ATTEMPT_FENCE_MISMATCH')
}

export function createGenerationJobWithResult(values: NewGenerationJob): CreatedGenerationJob {
  const db = useDatabase()
  const inserted = db.insert(generationJobs).values(values).onConflictDoNothing().run()
  return {
    job: db
      .select()
      .from(generationJobs)
      .where(eq(generationJobs.idempotencyKey, values.idempotencyKey))
      .get()!,
    created: inserted.changes > 0,
  }
}

export function createGenerationJob(values: NewGenerationJob): GenerationJob {
  return createGenerationJobWithResult(values).job
}

export function findGenerationJob(id: number): GenerationJob | undefined {
  return useDatabase().select().from(generationJobs).where(eq(generationJobs.id, id)).get()
}

export function findGenerationJobByKey(idempotencyKey: string): GenerationJob | undefined {
  return useDatabase()
    .select()
    .from(generationJobs)
    .where(eq(generationJobs.idempotencyKey, idempotencyKey))
    .get()
}

export function findLatestGenerationJob(date: string): GenerationJob | undefined {
  return useDatabase()
    .select()
    .from(generationJobs)
    .where(eq(generationJobs.sessionDate, date))
    .orderBy(desc(generationJobs.createdAt), desc(generationJobs.id))
    .limit(1)
    .get()
}

export function listLatestGenerationJobsBetween(from: string, to: string): GenerationJob[] {
  const rows = useDatabase()
    .select()
    .from(generationJobs)
    .where(and(gte(generationJobs.sessionDate, from), lte(generationJobs.sessionDate, to)))
    .orderBy(desc(generationJobs.createdAt), desc(generationJobs.id))
    .all()
  const byDate = new Map<string, GenerationJob>()
  for (const row of rows) {
    if (!byDate.has(row.sessionDate)) byDate.set(row.sessionDate, row)
  }
  return [...byDate.values()]
}

export function listGenerationJobs(limit = 1_000): GenerationJob[] {
  return useDatabase()
    .select()
    .from(generationJobs)
    .orderBy(desc(generationJobs.createdAt), desc(generationJobs.id))
    .limit(limit)
    .all()
}

export function findNextGenerationDispatchAt(): Date | null {
  return (
    useDatabase()
      .select({ nextAttemptAt: generationJobs.nextAttemptAt })
      .from(generationJobs)
      .where(inArray(generationJobs.status, ['queued', 'retry_scheduled']))
      .orderBy(asc(generationJobs.nextAttemptAt), asc(generationJobs.id))
      .limit(1)
      .get()?.nextAttemptAt ?? null
  )
}

export function findNextGenerationLeaseExpiryAt(): Date | null {
  return (
    useDatabase()
      .select({ leaseExpiresAt: generationJobs.leaseExpiresAt })
      .from(generationJobs)
      .where(and(eq(generationJobs.status, 'running'), isNotNull(generationJobs.leaseExpiresAt)))
      .orderBy(asc(generationJobs.leaseExpiresAt), asc(generationJobs.id))
      .limit(1)
      .get()?.leaseExpiresAt ?? null
  )
}

/** Prochain dispatch ou contrôle de lease, y compris après un redémarrage avant expiration. */
export function findNextGenerationWakeAt(): Date | null {
  const candidates = [findNextGenerationDispatchAt(), findNextGenerationLeaseExpiryAt()].filter(
    (value): value is Date => value instanceof Date,
  )
  return candidates.length
    ? new Date(Math.min(...candidates.map((candidate) => candidate.getTime())))
    : null
}

/** Prend atomiquement le prochain job dû et lui attribue un jeton de fencing unique. */
export function claimNextGenerationJob(
  workerId: string,
  now: Date,
  leaseMs = 45_000,
): GenerationJob | null {
  return useDatabase().transaction((tx) => {
    const candidate = tx
      .select()
      .from(generationJobs)
      .where(
        and(
          inArray(generationJobs.status, ['queued', 'retry_scheduled']),
          lte(generationJobs.nextAttemptAt, now),
        ),
      )
      .orderBy(asc(generationJobs.nextAttemptAt), asc(generationJobs.id))
      .limit(1)
      .get()
    if (!candidate) return null

    const leaseToken = randomUUID()
    const updated = tx
      .update(generationJobs)
      .set({
        status: 'running',
        attemptCount: sql`${generationJobs.attemptCount} + 1`,
        startedAt: candidate.startedAt ?? now,
        attemptStartedAt: now,
        currentStage: null,
        stageStartedAt: null,
        leaseOwner: workerId,
        leaseToken,
        leaseExpiresAt: new Date(now.getTime() + leaseMs),
        updatedAt: now,
      })
      .where(
        and(
          eq(generationJobs.id, candidate.id),
          inArray(generationJobs.status, ['queued', 'retry_scheduled']),
          lte(generationJobs.nextAttemptAt, now),
        ),
      )
      .run()
    if (!updated.changes) return null

    const claimed = tx
      .select()
      .from(generationJobs)
      .where(eq(generationJobs.id, candidate.id))
      .get()!
    tx.insert(generationJobAttempts)
      .values({
        jobId: claimed.id,
        attemptNumber: claimed.attemptCount,
        leaseToken,
        status: 'running',
        startedAt: now,
      })
      .run()
    return claimed
  })
}

export function hasGenerationJobLease(job: GenerationJob, now: Date): boolean {
  return Boolean(
    useDatabase()
      .select({ id: generationJobs.id })
      .from(generationJobs)
      .where(claimFence(job, now))
      .limit(1)
      .get(),
  )
}

/** Heartbeat atomique : un worker ne peut jamais ressusciter un lease déjà expiré ou récupéré. */
export function renewGenerationJobLease(job: GenerationJob, now: Date, leaseMs = 45_000): boolean {
  return Boolean(
    useDatabase()
      .update(generationJobs)
      .set({ leaseExpiresAt: new Date(now.getTime() + leaseMs), updatedAt: now })
      .where(claimFence(job, now))
      .run().changes,
  )
}

/** Publie une étape bornée et renouvelle le lease dans la même écriture clôturée. */
export function updateGenerationJobStage(
  job: GenerationJob,
  stage: GenerationStage,
  now: Date,
  leaseMs = 45_000,
): boolean {
  return Boolean(
    useDatabase()
      .update(generationJobs)
      .set({
        currentStage: stage,
        stageStartedAt: now,
        leaseExpiresAt: new Date(now.getTime() + leaseMs),
        updatedAt: now,
      })
      .where(claimFence(job, now))
      .run().changes,
  )
}

/** Rend récupérables les leases expirés et clôt exactement l'essai qui les détenait. */
export function recoverExpiredGenerationJobLeases(now: Date): GenerationLeaseRecovery[] {
  return useDatabase().transaction((tx) => {
    const expired = tx
      .select()
      .from(generationJobs)
      .where(and(eq(generationJobs.status, 'running'), lte(generationJobs.leaseExpiresAt, now)))
      .all()
    const recovered: GenerationLeaseRecovery[] = []

    for (const job of expired) {
      const update = tx
        .update(generationJobs)
        .set({
          status: 'queued',
          nextAttemptAt: now,
          leaseOwner: null,
          leaseToken: null,
          leaseExpiresAt: null,
          attemptStartedAt: null,
          currentStage: null,
          stageStartedAt: null,
          lastErrorKind: 'temporary',
          lastErrorCode: 'WORKER_INTERRUPTED',
          lastErrorMessage: 'Le processus de génération a été interrompu puis repris.',
          actionableMessage: null,
          updatedAt: now,
        })
        .where(and(claimFence(job, now, false), lte(generationJobs.leaseExpiresAt, now)))
        .run()
      if (!update.changes) continue

      assertAttemptTransition(
        tx
          .update(generationJobAttempts)
          .set({
            status: 'interrupted',
            errorKind: 'temporary',
            errorCode: 'WORKER_INTERRUPTED',
            errorMessage: 'Processus interrompu avant la fin de l’essai.',
            durationMs: job.attemptStartedAt
              ? Math.max(0, now.getTime() - job.attemptStartedAt.getTime())
              : null,
            completedAt: now,
          })
          .where(attemptFence(job))
          .run().changes,
      )
      recovered.push({
        jobId: job.id,
        date: job.sessionDate,
        source: job.source,
        attempt: job.attemptCount,
        maxAttempts: job.maxAttempts,
        stage: job.currentStage,
      })
    }
    return recovered
  })
}

/** Compatibilité pour les appels historiques qui n'ont besoin que du compteur. */
export function recoverExpiredGenerationJobs(now: Date): number {
  return recoverExpiredGenerationJobLeases(now).length
}

export function scheduleGenerationJobRetry(
  job: GenerationJob,
  failure: GenerationFailure,
  nextAttemptAt: Date,
  backoffMs: number,
  durationMs: number,
  now = new Date(),
): boolean {
  return useDatabase().transaction((tx) => {
    const update = tx
      .update(generationJobs)
      .set({
        status: 'retry_scheduled',
        nextAttemptAt,
        leaseOwner: null,
        leaseToken: null,
        leaseExpiresAt: null,
        attemptStartedAt: null,
        currentStage: null,
        stageStartedAt: null,
        lastErrorKind: failure.kind,
        lastErrorCode: failure.code,
        lastErrorMessage: failure.message,
        actionableMessage: failure.actionableMessage,
        updatedAt: now,
      })
      .where(claimFence(job, now))
      .run()
    if (!update.changes) return false
    assertAttemptTransition(
      tx
        .update(generationJobAttempts)
        .set({
          status: 'retry_scheduled',
          errorKind: failure.kind,
          errorCode: failure.code,
          errorMessage: failure.message,
          backoffMs,
          durationMs,
          completedAt: now,
        })
        .where(attemptFence(job))
        .run().changes,
    )
    return true
  })
}

export function completeGenerationJob(
  job: GenerationJob,
  result: GenerationCompletion,
  recoveredFailure?: GenerationFailure,
  now = new Date(),
): boolean {
  return useDatabase().transaction((tx) => {
    const update = tx
      .update(generationJobs)
      .set({
        status: 'succeeded',
        leaseOwner: null,
        leaseToken: null,
        leaseExpiresAt: null,
        attemptStartedAt: null,
        currentStage: null,
        stageStartedAt: null,
        completedAt: now,
        failedAt: null,
        lastErrorKind: null,
        lastErrorCode: null,
        lastErrorMessage: null,
        actionableMessage: null,
        modelCalls: result.modelCalls,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        cacheCreationTokens: result.cacheCreationTokens,
        cacheReadTokens: result.cacheReadTokens,
        estimatedCostUsd: result.estimatedCostUsd,
        durationMs: result.durationMs,
        providerLatencyMs: result.providerLatencyMs,
        reuseKind: result.reuseKind,
        reusedBlockCount: result.reusedBlockCount,
        fallbackUsed: result.fallbackUsed,
        policyCorrectionCount: result.policyCorrectionCount,
        policyCompliant: result.policyCompliant,
        updatedAt: now,
      })
      .where(claimFence(job, now))
      .run()
    if (!update.changes) return false
    assertAttemptTransition(
      tx
        .update(generationJobAttempts)
        .set({
          status: recoveredFailure ? 'fallback_succeeded' : 'succeeded',
          errorKind: recoveredFailure?.kind ?? null,
          errorCode: recoveredFailure?.code ?? null,
          errorMessage: recoveredFailure?.message ?? null,
          modelCalls: result.modelCalls,
          durationMs: result.durationMs,
          completedAt: now,
        })
        .where(attemptFence(job))
        .run().changes,
    )
    return true
  })
}

export function failGenerationJob(
  job: GenerationJob,
  failure: GenerationFailure,
  durationMs: number,
  now = new Date(),
): boolean {
  return useDatabase().transaction((tx) => {
    const update = tx
      .update(generationJobs)
      .set({
        status: 'failed',
        leaseOwner: null,
        leaseToken: null,
        leaseExpiresAt: null,
        attemptStartedAt: null,
        currentStage: null,
        stageStartedAt: null,
        failedAt: now,
        lastErrorKind: failure.kind,
        lastErrorCode: failure.code,
        lastErrorMessage: failure.message,
        actionableMessage: failure.actionableMessage,
        durationMs,
        updatedAt: now,
      })
      .where(claimFence(job, now))
      .run()
    if (!update.changes) return false
    assertAttemptTransition(
      tx
        .update(generationJobAttempts)
        .set({
          status: 'failed',
          errorKind: failure.kind,
          errorCode: failure.code,
          errorMessage: failure.message,
          durationMs,
          completedAt: now,
        })
        .where(attemptFence(job))
        .run().changes,
    )
    return true
  })
}

export function invalidateClaimedGenerationJob(
  job: GenerationJob,
  message: string,
  now = new Date(),
): boolean {
  return useDatabase().transaction((tx) => {
    const update = tx
      .update(generationJobs)
      .set({
        status: 'invalidated',
        leaseOwner: null,
        leaseToken: null,
        leaseExpiresAt: null,
        attemptStartedAt: null,
        currentStage: null,
        stageStartedAt: null,
        completedAt: now,
        lastErrorKind: 'permanent',
        lastErrorCode: 'CONTEXT_INVALIDATED',
        lastErrorMessage: message,
        actionableMessage: null,
        updatedAt: now,
      })
      .where(claimFence(job, now))
      .run()
    if (!update.changes) return false
    assertAttemptTransition(
      tx
        .update(generationJobAttempts)
        .set({
          status: 'invalidated',
          errorKind: 'permanent',
          errorCode: 'CONTEXT_INVALIDATED',
          errorMessage: message,
          completedAt: now,
        })
        .where(attemptFence(job))
        .run().changes,
    )
    return true
  })
}

/** Invalidation administrative : elle révoque volontairement tout lease courant. */
export function invalidateGenerationJob(jobId: number, message: string): void {
  const now = new Date()
  useDatabase().transaction((tx) => {
    const job = tx.select().from(generationJobs).where(eq(generationJobs.id, jobId)).get()
    if (!job) return
    tx.update(generationJobs)
      .set({
        status: 'invalidated',
        leaseOwner: null,
        leaseToken: null,
        leaseExpiresAt: null,
        attemptStartedAt: null,
        currentStage: null,
        stageStartedAt: null,
        completedAt: now,
        lastErrorKind: 'permanent',
        lastErrorCode: 'CONTEXT_INVALIDATED',
        lastErrorMessage: message,
        actionableMessage: null,
        updatedAt: now,
      })
      .where(eq(generationJobs.id, jobId))
      .run()
    if (job.status === 'running') {
      tx.update(generationJobAttempts)
        .set({
          status: 'invalidated',
          errorKind: 'permanent',
          errorCode: 'CONTEXT_INVALIDATED',
          errorMessage: message,
          completedAt: now,
        })
        .where(attemptFence(job))
        .run()
    }
  })
}

/** Une relance garde l'historique et ouvre un nouveau budget de trois essais. */
export function requeueFailedGenerationJob(jobId: number, now = new Date()): GenerationJob {
  const db = useDatabase()
  const current = findGenerationJob(jobId)
  if (!current || current.status !== 'failed') {
    throw new Error('Seul un job en échec peut être relancé.')
  }
  db.update(generationJobs)
    .set({
      status: 'queued',
      maxAttempts: current.attemptCount + 3,
      nextAttemptAt: now,
      leaseOwner: null,
      leaseToken: null,
      leaseExpiresAt: null,
      attemptStartedAt: null,
      currentStage: null,
      stageStartedAt: null,
      failedAt: null,
      lastErrorKind: null,
      lastErrorCode: null,
      lastErrorMessage: null,
      actionableMessage: null,
      queuedAt: now,
      updatedAt: now,
    })
    .where(and(eq(generationJobs.id, jobId), eq(generationJobs.status, 'failed')))
    .run()
  return findGenerationJob(jobId)!
}

export function hasActiveGenerationJob(date: string): boolean {
  return Boolean(
    useDatabase()
      .select({ id: generationJobs.id })
      .from(generationJobs)
      .where(
        and(eq(generationJobs.sessionDate, date), inArray(generationJobs.status, ACTIVE_STATUSES)),
      )
      .limit(1)
      .get(),
  )
}

export function findLastCompletedGenerationAttempt(
  jobId: number,
): GenerationJobAttempt | undefined {
  return useDatabase()
    .select()
    .from(generationJobAttempts)
    .where(
      and(eq(generationJobAttempts.jobId, jobId), isNotNull(generationJobAttempts.completedAt)),
    )
    .orderBy(desc(generationJobAttempts.attemptNumber))
    .limit(1)
    .get()
}

export function toPublicGenerationJob(job: GenerationJob | undefined): PublicGenerationJob | null {
  if (!job) return null
  const lastAttempt = findLastCompletedGenerationAttempt(job.id)
  return {
    id: job.id,
    date: job.sessionDate,
    status: job.status,
    source: job.source,
    attemptCount: job.attemptCount,
    maxAttempts: job.maxAttempts,
    nextAttemptAt: job.nextAttemptAt?.getTime() ?? null,
    // Champs historiques conservés pour les anciens clients ; lastAttempt lève l'ambiguïté.
    errorKind: job.lastErrorKind,
    errorCode: job.lastErrorCode,
    errorMessage: job.lastErrorMessage,
    actionableMessage: job.actionableMessage,
    reuseKind: job.reuseKind,
    reusedBlockCount: job.reusedBlockCount,
    fallbackUsed: job.fallbackUsed,
    createdAt: job.createdAt.getTime(),
    startedAt: job.startedAt?.getTime() ?? null,
    completedAt: job.completedAt?.getTime() ?? null,
    currentAttempt:
      job.status === 'running' && job.attemptStartedAt
        ? {
            number: job.attemptCount,
            startedAt: job.attemptStartedAt.getTime(),
            stage: job.currentStage,
            stageStartedAt: job.stageStartedAt?.getTime() ?? null,
          }
        : null,
    lastAttempt:
      lastAttempt?.completedAt != null
        ? {
            number: lastAttempt.attemptNumber,
            status: lastAttempt.status,
            errorKind: lastAttempt.errorKind,
            errorCode: lastAttempt.errorCode,
            errorMessage: lastAttempt.errorMessage,
            completedAt: lastAttempt.completedAt.getTime(),
          }
        : null,
  }
}
