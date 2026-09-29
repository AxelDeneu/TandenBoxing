import Database from 'better-sqlite3'
import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  generationJobAttempts,
  generationJobs,
  sessions,
  settings,
  type GenerationJob,
  type Session,
} from '../server/database/schema'
import {
  claimNextGenerationJob,
  completeGenerationJob,
  createGenerationJob,
  failGenerationJob,
  findGenerationJob,
  findNextGenerationWakeAt,
  hasGenerationJobLease,
  recoverExpiredGenerationJobs,
  scheduleGenerationJobRetry,
  toPublicGenerationJob,
  updateGenerationJobStage,
} from '../server/repositories/generation-job.repository'
import {
  deleteSessionByDate,
  listPreparedSessions,
} from '../server/repositories/session.repository'
import {
  invalidatePreparedSessionBatch,
  ensureTodaySessionWithDependencies,
  processClaimedGenerationJob,
  requestGenerationJob,
  scheduleGenerationWorkerWake,
  stableGenerationHash,
  GENERATION_ATTEMPT_DEADLINE_MS,
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
      'next_attempt_at INTEGER NOT NULL, lease_owner TEXT, lease_token TEXT, lease_expires_at INTEGER,',
      'attempt_started_at INTEGER, current_stage TEXT, stage_started_at INTEGER,',
      'last_error_kind TEXT, last_error_code TEXT, last_error_message TEXT, actionable_message TEXT,',
      'model_calls INTEGER DEFAULT 0 NOT NULL, input_tokens INTEGER DEFAULT 0 NOT NULL,',
      'output_tokens INTEGER DEFAULT 0 NOT NULL, cache_creation_tokens INTEGER DEFAULT 0 NOT NULL,',
      'cache_read_tokens INTEGER DEFAULT 0 NOT NULL, estimated_cost_usd REAL, duration_ms INTEGER,',
      "provider_latency_ms INTEGER DEFAULT 0 NOT NULL, reuse_kind TEXT DEFAULT 'none' NOT NULL,",
      'reused_block_count INTEGER DEFAULT 0 NOT NULL, fallback_used INTEGER DEFAULT false NOT NULL,',
      'policy_correction_count INTEGER, policy_compliant INTEGER,',
      'queued_at INTEGER DEFAULT (unixepoch()) NOT NULL, started_at INTEGER, completed_at INTEGER,',
      'failed_at INTEGER, created_at INTEGER DEFAULT (unixepoch()) NOT NULL,',
      'updated_at INTEGER DEFAULT (unixepoch()) NOT NULL);',
      'CREATE UNIQUE INDEX generation_jobs_idempotency_key_unique ON generation_jobs (idempotency_key);',
      'CREATE TABLE generation_job_attempts (',
      'id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL, job_id INTEGER NOT NULL,',
      'lease_token TEXT,',
      "attempt_number INTEGER NOT NULL, status TEXT DEFAULT 'running' NOT NULL,",
      'error_kind TEXT, error_code TEXT, error_message TEXT, backoff_ms INTEGER,',
      'model_calls INTEGER DEFAULT 0 NOT NULL, duration_ms INTEGER,',
      'started_at INTEGER DEFAULT (unixepoch()) NOT NULL, completed_at INTEGER);',
      'CREATE UNIQUE INDEX generation_job_attempts_job_attempt_unique',
      'ON generation_job_attempts (job_id, attempt_number);',
      'CREATE TABLE settings (',
      'id INTEGER PRIMARY KEY DEFAULT 1 NOT NULL,',
      "training_days TEXT DEFAULT '[1,3,5]' NOT NULL, generation_time TEXT DEFAULT '07:00' NOT NULL,",
      "target_duration_min INTEGER DEFAULT 45 NOT NULL, timezone TEXT DEFAULT 'Europe/Paris' NOT NULL,",
      "ai_model TEXT DEFAULT 'claude-opus-4-8' NOT NULL, weight_tracking_enabled INTEGER DEFAULT true NOT NULL,",
      'auth_enabled INTEGER DEFAULT false NOT NULL, onboarding_completed INTEGER DEFAULT false NOT NULL,',
      'created_at INTEGER DEFAULT (unixepoch()) NOT NULL, updated_at INTEGER DEFAULT (unixepoch()) NOT NULL);',
      'CREATE TABLE sessions (',
      'id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL, date TEXT NOT NULL UNIQUE,',
      "status TEXT DEFAULT 'generated' NOT NULL, title TEXT NOT NULL, category TEXT,",
      "focus TEXT NOT NULL, summary TEXT NOT NULL, coach_note TEXT DEFAULT '' NOT NULL,",
      'target_duration_min INTEGER NOT NULL, estimated_duration_min INTEGER NOT NULL,',
      "structure TEXT NOT NULL, ai_model TEXT NOT NULL, generation_source TEXT DEFAULT 'model' NOT NULL,",
      'generation_context_hash TEXT, fallback_used INTEGER DEFAULT false NOT NULL,',
      'reused_from_session_id INTEGER, generation_context TEXT, generated_at INTEGER,',
      'started_at INTEGER, completed_at INTEGER, actual_duration_sec INTEGER,',
      'skipped_block_count INTEGER,',
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
  db = drizzle(sqlite, { schema: { generationJobs, generationJobAttempts, sessions, settings } })
  vi.stubGlobal('useDatabase', () => db)
  vi.stubGlobal('sessions', sessions)
  vi.stubGlobal('settings', settings)
  vi.stubGlobal('ensureSingletons', () => undefined)
  db.insert(settings).values({ id: 1 }).run()
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  sqlite.close()
})

describe('generation jobs — intégration SQLite', () => {
  it('ne crée aucune file pouvant appeler le fournisseur avant onboarding', () => {
    expect(requestGenerationJob('2026-10-01', { source: 'automatic' })).toBeNull()
    expect(requestGenerationJob('2026-10-01', { source: 'user' })).toBeNull()
    expect(db.select().from(generationJobs).all()).toHaveLength(0)
  })

  it('fait du commit complet de l’onboarding la frontière du premier job automatique', async () => {
    const settings = {
      onboardingCompleted: false,
      timezone: 'Europe/Paris',
      trainingDays: [4],
    }
    const profile = {
      goal: 'cardio-perte-de-gras',
      equipment: [] as string[],
      fitnessLevel: null as string | null,
    }
    const dependencies = {
      today: () => '2026-10-01',
      weekday: () => 4,
      findSession: () => undefined,
      isDismissed: () => false,
      request: (date: string) => {
        const contextHash = stableGenerationHash({ profile })
        createGenerationJob({
          sessionDate: date,
          idempotencyKey: `session:${date}:${contextHash}`,
          contextHash,
          request: { regenerate: false, adjustment: null },
          source: 'automatic',
          nextAttemptAt: new Date('2026-10-01T06:00:00Z'),
        })
      },
    }

    ensureTodaySessionWithDependencies(settings, dependencies)
    expect(db.select().from(generationJobs).all()).toHaveLength(0)

    // Représente le commit atomique : les choix sont complets avant que le booléen devienne visible.
    profile.goal = 'technique'
    profile.equipment = ['sac-de-frappe']
    profile.fitnessLevel = 'actif'
    settings.onboardingCompleted = true

    await Promise.all(
      Array.from({ length: 8 }, async () =>
        ensureTodaySessionWithDependencies(settings, dependencies),
      ),
    )
    const jobs = db.select().from(generationJobs).all()
    expect(jobs).toHaveLength(1)
    expect(jobs[0]).toMatchObject({
      source: 'automatic',
      contextHash: stableGenerationHash({ profile }),
    })
  })

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

  it('sort automatiquement de running quand execute ne se résout jamais', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-01T06:00:00Z'))
    enqueue()
    const claimed = claimNextGenerationJob('watchdog-worker', new Date())!
    const dependencies: GenerationWorkerDependencies = {
      now: () => new Date(),
      contextIsCurrent: () => true,
      execute: vi.fn(() => new Promise<GeneratedSessionResult>(() => undefined)),
      fallback: vi.fn(),
      canFallback: () => false,
      onInvalidated: vi.fn(),
      onSucceeded: vi.fn(),
    }

    const processing = processClaimedGenerationJob(claimed, dependencies)
    await vi.advanceTimersByTimeAsync(GENERATION_ATTEMPT_DEADLINE_MS)

    await expect(processing).resolves.toBe('retry_scheduled')
    expect(findGenerationJob(claimed.id)).toMatchObject({
      status: 'retry_scheduled',
      lastErrorCode: 'GENERATION_ATTEMPT_DEADLINE_EXCEEDED',
    })
    expect(db.select().from(generationJobAttempts).get()).toMatchObject({
      status: 'retry_scheduled',
      errorCode: 'GENERATION_ATTEMPT_DEADLINE_EXCEEDED',
      durationMs: GENERATION_ATTEMPT_DEADLINE_MS,
    })
  })

  it('renouvelle le lease pendant génération et correction proches de la deadline', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-01T06:00:00Z'))
    const log = vi.spyOn(console, 'info').mockImplementation(() => undefined)
    enqueue()
    const claimed = claimNextGenerationJob('long-worker', new Date())!
    const wait = (durationMs: number) =>
      new Promise<void>((resolve) => setTimeout(resolve, durationMs))
    const dependencies: GenerationWorkerDependencies = {
      now: () => new Date(),
      contextIsCurrent: () => true,
      execute: vi.fn(async (_job, control) => {
        control.onStage?.({ stage: 'generation', status: 'started', model: 'test/model' })
        await wait(119_000)
        control.onStage?.({
          stage: 'generation',
          status: 'succeeded',
          model: 'test/model',
          durationMs: 119_000,
        })
        control.onStage?.({ stage: 'validation', status: 'started', model: 'test/model' })
        await wait(50_000)
        control.onStage?.({
          stage: 'validation',
          status: 'failed',
          model: 'test/model',
          durationMs: 50_000,
          errorCode: 'MODEL_OUTPUT_INVALID',
        })
        control.onStage?.({ stage: 'correction', status: 'started', model: 'test/model' })
        await wait(119_000)
        control.onStage?.({
          stage: 'correction',
          status: 'succeeded',
          model: 'test/model',
          durationMs: 119_000,
        })
        return successfulResult()
      }),
      fallback: vi.fn(),
      canFallback: () => false,
      onInvalidated: vi.fn(),
      onSucceeded: vi.fn(),
    }

    const processing = processClaimedGenerationJob(claimed, dependencies)
    await vi.advanceTimersByTimeAsync(200_000)
    expect(recoverExpiredGenerationJobs(new Date())).toBe(0)
    expect(claimNextGenerationJob('second-worker', new Date())).toBeNull()

    await vi.advanceTimersByTimeAsync(88_000)
    await expect(processing).resolves.toBe('succeeded')
    expect(findGenerationJob(claimed.id)).toMatchObject({
      status: 'succeeded',
      attemptCount: 1,
    })
    const events = log.mock.calls.map(([line]) => String(line))
    expect(events.some((line) => line.includes('"event":"stage_started"'))).toBe(true)
    expect(events.some((line) => line.includes('"stage":"generation"'))).toBe(true)
    expect(events.some((line) => line.includes('"stage":"correction"'))).toBe(true)
    expect(events.some((line) => line.includes('"event":"succeeded"'))).toBe(true)
    log.mockRestore()
  })

  it('programme au redémarrage la récupération future d’un lease encore valide', async () => {
    vi.useFakeTimers()
    const startedAt = new Date('2026-10-01T06:00:00Z')
    vi.setSystemTime(startedAt)
    enqueue()
    const claimed = claimNextGenerationJob('worker-before-restart', startedAt, 1_000)!
    expect(findNextGenerationWakeAt()?.getTime()).toBe(startedAt.getTime() + 1_000)

    const wake = vi.fn(() => recoverExpiredGenerationJobs(new Date()))
    scheduleGenerationWorkerWake({
      now: Date.now,
      wake,
      setTimer: setTimeout,
      clearTimer: clearTimeout,
    })

    await vi.advanceTimersByTimeAsync(999)
    expect(wake).not.toHaveBeenCalled()
    expect(findGenerationJob(claimed.id)?.status).toBe('running')

    await vi.advanceTimersByTimeAsync(1)
    expect(wake).toHaveBeenCalledOnce()
    expect(findGenerationJob(claimed.id)?.status).toBe('queued')
  })

  it('rejette la réponse tardive du premier worker après récupération par un second', async () => {
    vi.useFakeTimers()
    const startedAt = new Date('2026-10-01T06:00:00Z')
    vi.setSystemTime(startedAt)
    enqueue()
    const firstClaim = claimNextGenerationJob('worker-a', startedAt)!
    let finishFirst!: () => void
    const firstDependencies: GenerationWorkerDependencies = {
      now: () => new Date(),
      contextIsCurrent: () => true,
      execute: vi.fn(
        (_job, control) =>
          new Promise<GeneratedSessionResult>((resolve, reject) => {
            finishFirst = () => {
              try {
                control.assertActive?.()
                resolve(successfulResult())
              } catch (error) {
                reject(error)
              }
            }
          }),
      ),
      fallback: vi.fn(),
      canFallback: () => false,
      onInvalidated: vi.fn(),
      onSucceeded: vi.fn(),
    }
    const firstProcessing = processClaimedGenerationJob(firstClaim, firstDependencies)
    await Promise.resolve()

    vi.setSystemTime(new Date(startedAt.getTime() + 45_001))
    expect(recoverExpiredGenerationJobs(new Date())).toBe(1)
    const secondClaim = claimNextGenerationJob('worker-b', new Date())!
    const secondDependencies: GenerationWorkerDependencies = {
      ...firstDependencies,
      execute: vi.fn().mockResolvedValue(successfulResult()),
      onSucceeded: vi.fn(),
    }
    await expect(processClaimedGenerationJob(secondClaim, secondDependencies)).resolves.toBe(
      'succeeded',
    )

    finishFirst()
    await expect(firstProcessing).resolves.toBe('lease_lost')
    expect(findGenerationJob(firstClaim.id)).toMatchObject({
      status: 'succeeded',
      attemptCount: 2,
    })
    expect(
      db
        .select()
        .from(generationJobAttempts)
        .orderBy(generationJobAttempts.attemptNumber)
        .all()
        .map((attempt) => attempt.status),
    ).toEqual(['interrupted', 'succeeded'])
    expect(firstDependencies.onSucceeded).not.toHaveBeenCalled()
    expect(secondDependencies.onSucceeded).toHaveBeenCalledOnce()
  })

  it('interdit à un worker récupéré d’invalider puis replanifier le job', async () => {
    const startedAt = new Date('2026-10-01T06:00:00Z')
    enqueue()
    const staleClaim = claimNextGenerationJob('worker-a', startedAt, 1_000)!
    expect(recoverExpiredGenerationJobs(new Date(startedAt.getTime() + 1_001))).toBe(1)
    const currentClaim = claimNextGenerationJob('worker-b', new Date(startedAt.getTime() + 1_001))!
    const onInvalidated = vi.fn()

    await expect(
      processClaimedGenerationJob(staleClaim, {
        now: () => new Date(startedAt.getTime() + 1_001),
        contextIsCurrent: () => false,
        execute: vi.fn(),
        fallback: vi.fn(),
        canFallback: () => false,
        onInvalidated,
        onSucceeded: vi.fn(),
      }),
    ).resolves.toBe('lease_lost')

    expect(onInvalidated).not.toHaveBeenCalled()
    expect(findGenerationJob(currentClaim.id)).toMatchObject({
      status: 'running',
      attemptCount: 2,
      leaseOwner: 'worker-b',
    })
  })

  it('clôture toutes les transitions par propriétaire, token et numéro d’essai', () => {
    const now = new Date('2026-10-01T06:00:00Z')
    enqueue()
    const claimed = claimNextGenerationJob('right-worker', now)!
    const wrongOwner = { ...claimed, leaseOwner: 'wrong-worker' }
    const wrongAttempt = { ...claimed, attemptCount: claimed.attemptCount + 1 }
    const failure = {
      kind: 'temporary' as const,
      code: 'TEST_FAILURE',
      message: 'Erreur bornée.',
      actionableMessage: 'Réessaie.',
    }
    const metrics = emptyGenerationRunMetrics()

    expect(hasGenerationJobLease(claimed, now)).toBe(true)
    expect(updateGenerationJobStage(wrongOwner, 'generation', now)).toBe(false)
    expect(
      scheduleGenerationJobRetry(
        wrongAttempt,
        failure,
        new Date(now.getTime() + 1_000),
        1_000,
        10,
        now,
      ),
    ).toBe(false)
    expect(
      completeGenerationJob(
        wrongOwner,
        { ...metrics, durationMs: 10, estimatedCostUsd: 0 },
        undefined,
        now,
      ),
    ).toBe(false)
    expect(failGenerationJob(wrongAttempt, failure, 10, now)).toBe(false)
    expect(findGenerationJob(claimed.id)?.status).toBe('running')
    expect(db.select().from(generationJobAttempts).get()?.status).toBe('running')
  })

  it('expose séparément l’étape courante et le résultat de l’essai précédent', async () => {
    const firstStartedAt = new Date('2026-10-01T06:00:00Z')
    enqueue()
    const first = claimNextGenerationJob('worker-a', firstStartedAt)!
    const failure = {
      kind: 'temporary' as const,
      code: 'PROVIDER_UNAVAILABLE',
      message: 'Fournisseur indisponible.',
      actionableMessage: 'Réessaie.',
    }
    expect(
      scheduleGenerationJobRetry(
        first,
        failure,
        new Date(firstStartedAt.getTime() + 1_000),
        1_000,
        500,
        new Date(firstStartedAt.getTime() + 500),
      ),
    ).toBe(true)
    const secondStartedAt = new Date(firstStartedAt.getTime() + 1_000)
    const second = claimNextGenerationJob('worker-b', secondStartedAt)!
    expect(updateGenerationJobStage(second, 'correction', secondStartedAt)).toBe(true)

    expect(toPublicGenerationJob(findGenerationJob(second.id))).toMatchObject({
      status: 'running',
      currentAttempt: {
        number: 2,
        startedAt: secondStartedAt.getTime(),
        stage: 'correction',
      },
      lastAttempt: {
        number: 1,
        status: 'retry_scheduled',
        errorCode: 'PROVIDER_UNAVAILABLE',
      },
    })
  })

  it('invalide en base une séance anticipée lorsque son contexte change', () => {
    const prepared = {
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
    } as const
    db.insert(sessions)
      .values([
        prepared,
        { ...prepared, date: '2026-10-04', status: 'in_progress', startedAt: new Date() },
        { ...prepared, date: '2026-10-05', status: 'completed', completedAt: new Date() },
        { ...prepared, date: '2026-10-06', generationSource: 'model' },
        { ...prepared, date: '2026-10-07', startedAt: new Date() },
      ])
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
    expect(
      db
        .select({ date: sessions.date, status: sessions.status })
        .from(sessions)
        .all()
        .sort((left, right) => left.date.localeCompare(right.date)),
    ).toEqual([
      { date: '2026-10-04', status: 'in_progress' },
      { date: '2026-10-05', status: 'completed' },
      { date: '2026-10-06', status: 'generated' },
      { date: '2026-10-07', status: 'generated' },
    ])
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

  it.each([
    ['objectif', { goal: 'technique', equipment: [] }],
    ['matériel', { goal: 'cardio-perte-de-gras', equipment: ['sac-de-frappe'] }],
  ])('fait évoluer l’empreinte quand le %s change', (_label, personalization) => {
    const before = stableGenerationHash({
      prescription: {
        personalization: { goal: 'cardio-perte-de-gras', equipment: [] },
      },
    })
    const after = stableGenerationHash({ prescription: { personalization } })
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
