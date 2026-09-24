import Database from 'better-sqlite3'
import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  generationJobAttempts,
  generationJobs,
  sessions,
  type GenerationJob,
  type Session,
} from '../server/database/schema'
import {
  claimNextGenerationJob,
  createGenerationJob,
  findGenerationJob,
  recoverExpiredGenerationJobs,
} from '../server/repositories/generation-job.repository'
import {
  deleteSessionByDate,
  listPreparedSessions,
} from '../server/repositories/session.repository'
import {
  invalidatePreparedSessionBatch,
  processClaimedGenerationJob,
  stableGenerationHash,
  type GenerationWorkerDependencies,
} from '../server/services/generation-job.service'
import {
  GenerationExecutionError,
  type GeneratedSessionResult,
  type GenerationContext,
} from '../server/services/generation.service'
import { buildDeterministicFallbackSession } from '../server/services/session-library.service'
import { emptyGenerationRunMetrics } from '../shared/generation-jobs'
import { estimateSessionSeconds } from '../shared/session-schema'

let sqlite: Database.Database
let db: ReturnType<typeof drizzle>

function createTables(): void {
  sqlite.exec(
    [
      'CREATE TABLE generation_jobs (',
      'id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,',
      'session_date TEXT NOT NULL, idempotency_key TEXT NOT NULL, context_hash TEXT NOT NULL,',
      "request TEXT NOT NULL, source TEXT NOT NULL, status TEXT DEFAULT 'queued' NOT NULL,",
      'attempt_count INTEGER DEFAULT 0 NOT NULL, max_attempts INTEGER DEFAULT 3 NOT NULL,',
      'next_attempt_at INTEGER NOT NULL, lease_owner TEXT, lease_expires_at INTEGER,',
      'last_error_kind TEXT, last_error_code TEXT, last_error_message TEXT, actionable_message TEXT,',
      'model_calls INTEGER DEFAULT 0 NOT NULL, input_tokens INTEGER DEFAULT 0 NOT NULL,',
      'output_tokens INTEGER DEFAULT 0 NOT NULL, cache_creation_tokens INTEGER DEFAULT 0 NOT NULL,',
      'cache_read_tokens INTEGER DEFAULT 0 NOT NULL, estimated_cost_usd REAL, duration_ms INTEGER,',
      "provider_latency_ms INTEGER DEFAULT 0 NOT NULL, reuse_kind TEXT DEFAULT 'none' NOT NULL,",
      'reused_block_count INTEGER DEFAULT 0 NOT NULL, fallback_used INTEGER DEFAULT false NOT NULL,',
      'queued_at INTEGER DEFAULT (unixepoch()) NOT NULL, started_at INTEGER, completed_at INTEGER,',
      'failed_at INTEGER, created_at INTEGER DEFAULT (unixepoch()) NOT NULL,',
      'updated_at INTEGER DEFAULT (unixepoch()) NOT NULL);',
      'CREATE UNIQUE INDEX generation_jobs_idempotency_key_unique ON generation_jobs (idempotency_key);',
      'CREATE TABLE generation_job_attempts (',
      'id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL, job_id INTEGER NOT NULL,',
      "attempt_number INTEGER NOT NULL, status TEXT DEFAULT 'running' NOT NULL,",
      'error_kind TEXT, error_code TEXT, error_message TEXT, backoff_ms INTEGER,',
      'model_calls INTEGER DEFAULT 0 NOT NULL, duration_ms INTEGER,',
      'started_at INTEGER DEFAULT (unixepoch()) NOT NULL, completed_at INTEGER);',
      'CREATE UNIQUE INDEX generation_job_attempts_job_attempt_unique',
      'ON generation_job_attempts (job_id, attempt_number);',
      'CREATE TABLE sessions (',
      'id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL, date TEXT NOT NULL UNIQUE,',
      "status TEXT DEFAULT 'generated' NOT NULL, title TEXT NOT NULL, category TEXT,",
      "focus TEXT NOT NULL, summary TEXT NOT NULL, coach_note TEXT DEFAULT '' NOT NULL,",
      'target_duration_min INTEGER NOT NULL, estimated_duration_min INTEGER NOT NULL,',
      "structure TEXT NOT NULL, ai_model TEXT NOT NULL, generation_source TEXT DEFAULT 'model' NOT NULL,",
      'generation_context_hash TEXT, fallback_used INTEGER DEFAULT false NOT NULL,',
      'reused_from_session_id INTEGER, generation_context TEXT, generated_at INTEGER,',
      'started_at INTEGER, completed_at INTEGER, actual_duration_sec INTEGER,',
      'created_at INTEGER DEFAULT (unixepoch()) NOT NULL, updated_at INTEGER DEFAULT (unixepoch()) NOT NULL);',
    ].join(' '),
  )
}

function enqueue(overrides: Partial<typeof generationJobs.$inferInsert> = {}): GenerationJob {
  return createGenerationJob({
    sessionDate: '2026-10-01',
    idempotencyKey: 'session:2026-10-01:context-a',
    contextHash: 'context-a',
    request: { regenerate: false, adjustment: null },
    source: 'user',
    nextAttemptAt: new Date('2026-10-01T06:00:00Z'),
    ...overrides,
  })
}

function successfulResult(fallbackUsed = false): GeneratedSessionResult {
  const metrics = emptyGenerationRunMetrics()
  metrics.fallbackUsed = fallbackUsed
  return {
    session: { aiModel: fallbackUsed ? 'deterministic-local/v1' : 'claude-opus-4-8' } as Session,
    metrics,
  }
}

beforeEach(() => {
  sqlite = new Database(':memory:')
  createTables()
  db = drizzle(sqlite, { schema: { generationJobs, generationJobAttempts, sessions } })
  vi.stubGlobal('useDatabase', () => db)
  vi.stubGlobal('sessions', sessions)
})

afterEach(() => {
  vi.unstubAllGlobals()
  sqlite.close()
})

describe('generation jobs — intégration SQLite', () => {
  it('déduplique les demandes concurrentes et ne laisse réclamer le job qu’une fois', async () => {
    const jobs = await Promise.all(Array.from({ length: 8 }, async () => enqueue()))

    expect(new Set(jobs.map((job) => job.id))).toEqual(new Set([1]))
    expect(db.select().from(generationJobs).all()).toHaveLength(1)

    const now = new Date('2026-10-01T06:00:00Z')
    const claims = await Promise.all(
      Array.from({ length: 4 }, async (_, index) => claimNextGenerationJob('worker-' + index, now)),
    )
    expect(claims.filter(Boolean)).toHaveLength(1)
    expect(findGenerationJob(1)).toMatchObject({ status: 'running', attemptCount: 1 })
  })

  it('récupère après redémarrage un lease expiré et conserve la progression des essais', () => {
    enqueue()
    const firstStart = new Date('2026-10-01T06:00:00Z')
    const first = claimNextGenerationJob('worker-before-restart', firstStart, 1_000)
    expect(first?.attemptCount).toBe(1)

    expect(recoverExpiredGenerationJobs(new Date('2026-10-01T06:00:02Z'))).toBe(1)
    expect(findGenerationJob(1)?.status).toBe('queued')

    const resumed = claimNextGenerationJob('worker-after-restart', new Date('2026-10-01T06:00:02Z'))
    expect(resumed).toMatchObject({ id: 1, status: 'running', attemptCount: 2 })
    expect(
      db
        .select()
        .from(generationJobAttempts)
        .where(eq(generationJobAttempts.jobId, 1))
        .all()
        .map((attempt) => attempt.status),
    ).toEqual(['interrupted', 'running'])
  })

  it('applique des retries bornés avec backoff puis sert le fallback au dernier essai', async () => {
    enqueue()
    let now = new Date('2026-10-01T06:00:00Z')
    const execute = vi
      .fn()
      .mockRejectedValue(
        new GenerationExecutionError(
          'temporary',
          'PROVIDER_UNAVAILABLE',
          'Fournisseur indisponible.',
          'Réessaie.',
        ),
      )
    const fallback = vi.fn().mockResolvedValue(successfulResult(true))
    const dependencies: GenerationWorkerDependencies = {
      now: () => now,
      contextIsCurrent: () => true,
      execute,
      fallback,
      canFallback: () => true,
      onInvalidated: vi.fn(),
      onSucceeded: vi.fn(),
    }

    const first = claimNextGenerationJob('worker', now)!
    expect(await processClaimedGenerationJob(first, dependencies)).toBe('retry_scheduled')
    expect(findGenerationJob(1)?.nextAttemptAt.getTime()).toBe(now.getTime() + 1_000)

    now = new Date(now.getTime() + 1_000)
    const second = claimNextGenerationJob('worker', now)!
    expect(await processClaimedGenerationJob(second, dependencies)).toBe('retry_scheduled')
    expect(findGenerationJob(1)?.nextAttemptAt.getTime()).toBe(now.getTime() + 2_000)

    now = new Date(now.getTime() + 2_000)
    const third = claimNextGenerationJob('worker', now)!
    expect(await processClaimedGenerationJob(third, dependencies)).toBe('succeeded')

    expect(execute).toHaveBeenCalledTimes(3)
    expect(fallback).toHaveBeenCalledTimes(1)
    expect(findGenerationJob(1)).toMatchObject({
      status: 'succeeded',
      attemptCount: 3,
      fallbackUsed: true,
    })
    const attempts = db.select().from(generationJobAttempts).all()
    expect(attempts.map((attempt) => attempt.backoffMs)).toEqual([1_000, 2_000, null])
    expect(attempts[2]).toMatchObject({
      status: 'fallback_succeeded',
      errorKind: 'temporary',
      errorCode: 'PROVIDER_UNAVAILABLE',
    })
  })

  it('invalide en base une séance anticipée lorsque son contexte change', () => {
    db.insert(sessions)
      .values({
        date: '2026-10-03',
        title: 'Préparée',
        category: 'cardio',
        focus: 'cardio',
        summary: 'Résumé',
        coachNote: 'Note',
        targetDurationMin: 45,
        estimatedDurationMin: 45,
        structure: {
          title: 'Préparée',
          curriculumVersion: 'beginner-boxing/v1',
          category: 'cardio',
          focus: 'cardio',
          summary: 'Résumé',
          coachNote: 'Note',
          estimatedDurationMin: 45,
          blocks: [],
        },
        aiModel: 'claude-opus-4-8',
        generationSource: 'prefetch',
        generationContextHash: 'preferences-before',
      })
      .run()

    const invalidated = invalidatePreparedSessionBatch({
      sessions: listPreparedSessions('2026-10-01'),
      currentContextHash: () => 'preferences-after',
      remove: (session) => deleteSessionByDate(session.date),
      markJobInvalidated: vi.fn(),
      shouldRegenerate: () => false,
      regenerate: vi.fn(),
    })

    expect(invalidated).toEqual(['2026-10-03'])
    expect(listPreparedSessions('2026-10-01')).toHaveLength(0)
  })
})

describe('bibliothèque, préférences et fallback', () => {
  it('fait évoluer l’empreinte quand une exclusion apprise change', () => {
    const before = stableGenerationHash({
      prescription: { exercisePreferences: { strictExclusions: [] } },
    })
    const after = stableGenerationHash({
      prescription: {
        exercisePreferences: {
          strictExclusions: [{ scope: 'movement', scopeKey: 'burpees' }],
        },
      },
    })
    expect(after).not.toBe(before)
  })

  it('construit toujours le même fallback conforme et à durée exacte', () => {
    const context = {
      dureeCibleMin: 45,
      prescription: {
        category: 'cardio',
        focus: 'cardio',
        targetSeconds: 2_700,
        blockBudgets: {
          echauffement: 324,
          technique: 405,
          cardio: 1_566,
          renforcement: 135,
          retour_au_calme: 270,
        },
        skillSelection: {
          newSkillId: null,
          consolidatedSkillIds: [],
        },
        exercisePreferences: {
          version: 'exercise-preferences/v1',
          asOfDate: '2026-10-01',
          signalCount: 0,
          strictExclusions: [],
          weightedPreferences: [],
        },
      },
    } as unknown as GenerationContext

    const first = buildDeterministicFallbackSession(context).session
    const second = buildDeterministicFallbackSession(context).session
    expect(second).toEqual(first)
    expect(first.category).toBe('cardio')
    expect(first.blocks[0]?.type).toBe('echauffement')
    expect(first.blocks.at(-1)?.type).toBe('retour_au_calme')
    expect(estimateSessionSeconds(first)).toBe(2_700)
  })
})
