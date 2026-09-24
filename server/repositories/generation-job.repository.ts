import { and, asc, desc, eq, gte, inArray, lte, sql } from 'drizzle-orm'
import type {
  GenerationErrorKind,
  GenerationJobStatus,
  GenerationRunMetrics,
  PublicGenerationJob,
} from '../../shared/generation-jobs'
import {
  generationJobAttempts,
  generationJobs,
  type GenerationJob,
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

export function createGenerationJob(values: NewGenerationJob): GenerationJob {
  const db = useDatabase()
  db.insert(generationJobs).values(values).onConflictDoNothing().run()
  return db
    .select()
    .from(generationJobs)
    .where(eq(generationJobs.idempotencyKey, values.idempotencyKey))
    .get()!
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

/** Prend atomiquement le prochain job dû et incrémente son numéro d'essai. */
export function claimNextGenerationJob(
  workerId: string,
  now: Date,
  leaseMs = 5 * 60_000,
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

    const updated = tx
      .update(generationJobs)
      .set({
        status: 'running',
        attemptCount: sql`${generationJobs.attemptCount} + 1`,
        startedAt: candidate.startedAt ?? now,
        leaseOwner: workerId,
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
        status: 'running',
        startedAt: now,
      })
      .run()
    return claimed
  })
}

/** Rend récupérables les jobs dont le processus a disparu après expiration de son lease. */
export function recoverExpiredGenerationJobs(now: Date): number {
  return useDatabase().transaction((tx) => {
    const expired = tx
      .select()
      .from(generationJobs)
      .where(and(eq(generationJobs.status, 'running'), lte(generationJobs.leaseExpiresAt, now)))
      .all()
    for (const job of expired) {
      tx.update(generationJobs)
        .set({
          status: 'queued',
          nextAttemptAt: now,
          leaseOwner: null,
          leaseExpiresAt: null,
          lastErrorKind: 'temporary',
          lastErrorCode: 'WORKER_INTERRUPTED',
          lastErrorMessage: 'Le processus de génération a été interrompu puis repris.',
          actionableMessage: null,
          updatedAt: now,
        })
        .where(eq(generationJobs.id, job.id))
        .run()
      tx.update(generationJobAttempts)
        .set({
          status: 'interrupted',
          errorKind: 'temporary',
          errorCode: 'WORKER_INTERRUPTED',
          errorMessage: 'Processus interrompu avant la fin de l’essai.',
          durationMs: job.startedAt ? Math.max(0, now.getTime() - job.startedAt.getTime()) : null,
          completedAt: now,
        })
        .where(
          and(
            eq(generationJobAttempts.jobId, job.id),
            eq(generationJobAttempts.attemptNumber, job.attemptCount),
          ),
        )
        .run()
    }
    return expired.length
  })
}

export function scheduleGenerationJobRetry(
  job: GenerationJob,
  failure: GenerationFailure,
  nextAttemptAt: Date,
  backoffMs: number,
  durationMs: number,
): void {
  const now = new Date()
  useDatabase().transaction((tx) => {
    tx.update(generationJobs)
      .set({
        status: 'retry_scheduled',
        nextAttemptAt,
        leaseOwner: null,
        leaseExpiresAt: null,
        lastErrorKind: failure.kind,
        lastErrorCode: failure.code,
        lastErrorMessage: failure.message,
        actionableMessage: failure.actionableMessage,
        updatedAt: now,
      })
      .where(eq(generationJobs.id, job.id))
      .run()
    tx.update(generationJobAttempts)
      .set({
        status: 'retry_scheduled',
        errorKind: failure.kind,
        errorCode: failure.code,
        errorMessage: failure.message,
        backoffMs,
        durationMs,
        completedAt: now,
      })
      .where(
        and(
          eq(generationJobAttempts.jobId, job.id),
          eq(generationJobAttempts.attemptNumber, job.attemptCount),
        ),
      )
      .run()
  })
}

export function completeGenerationJob(
  job: GenerationJob,
  result: GenerationCompletion,
  recoveredFailure?: GenerationFailure,
): void {
  const now = new Date()
  useDatabase().transaction((tx) => {
    tx.update(generationJobs)
      .set({
        status: 'succeeded',
        leaseOwner: null,
        leaseExpiresAt: null,
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
      .where(eq(generationJobs.id, job.id))
      .run()
    tx.update(generationJobAttempts)
      .set({
        status: recoveredFailure ? 'fallback_succeeded' : 'succeeded',
        errorKind: recoveredFailure?.kind ?? null,
        errorCode: recoveredFailure?.code ?? null,
        errorMessage: recoveredFailure?.message ?? null,
        modelCalls: result.modelCalls,
        durationMs: result.durationMs,
        completedAt: now,
      })
      .where(
        and(
          eq(generationJobAttempts.jobId, job.id),
          eq(generationJobAttempts.attemptNumber, job.attemptCount),
        ),
      )
      .run()
  })
}

export function failGenerationJob(
  job: GenerationJob,
  failure: GenerationFailure,
  durationMs: number,
): void {
  const now = new Date()
  useDatabase().transaction((tx) => {
    tx.update(generationJobs)
      .set({
        status: 'failed',
        leaseOwner: null,
        leaseExpiresAt: null,
        failedAt: now,
        lastErrorKind: failure.kind,
        lastErrorCode: failure.code,
        lastErrorMessage: failure.message,
        actionableMessage: failure.actionableMessage,
        durationMs,
        updatedAt: now,
      })
      .where(eq(generationJobs.id, job.id))
      .run()
    tx.update(generationJobAttempts)
      .set({
        status: 'failed',
        errorKind: failure.kind,
        errorCode: failure.code,
        errorMessage: failure.message,
        durationMs,
        completedAt: now,
      })
      .where(
        and(
          eq(generationJobAttempts.jobId, job.id),
          eq(generationJobAttempts.attemptNumber, job.attemptCount),
        ),
      )
      .run()
  })
}

export function invalidateGenerationJob(jobId: number, message: string): void {
  const now = new Date()
  useDatabase().transaction((tx) => {
    const job = tx.select().from(generationJobs).where(eq(generationJobs.id, jobId)).get()
    if (!job) return
    tx.update(generationJobs)
      .set({
        status: 'invalidated',
        leaseOwner: null,
        leaseExpiresAt: null,
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
        .where(
          and(
            eq(generationJobAttempts.jobId, job.id),
            eq(generationJobAttempts.attemptNumber, job.attemptCount),
          ),
        )
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
      failedAt: null,
      lastErrorKind: null,
      lastErrorCode: null,
      lastErrorMessage: null,
      actionableMessage: null,
      queuedAt: now,
      updatedAt: now,
    })
    .where(eq(generationJobs.id, jobId))
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

export function toPublicGenerationJob(job: GenerationJob | undefined): PublicGenerationJob | null {
  if (!job) return null
  return {
    id: job.id,
    date: job.sessionDate,
    status: job.status,
    source: job.source,
    attemptCount: job.attemptCount,
    maxAttempts: job.maxAttempts,
    nextAttemptAt: job.nextAttemptAt?.getTime() ?? null,
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
  }
}
