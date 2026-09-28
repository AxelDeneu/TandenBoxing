import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { addDays, isoWeekday, todayIso } from '../shared/dates'
import { exerciseFeedback, sessionFeedback, sessions } from '../server/database/schema'
import {
  findSessionByDate,
  listCompletedSessions,
  transitionSessionByDate,
  updateSessionByDate,
  upsertSessionByDate,
} from '../server/repositories/session.repository'
import {
  findSessionFeedback,
  listExerciseFeedbackByIds,
  listSessionFeedbackByIds,
  replaceExerciseFeedback,
  upsertSessionFeedback,
} from '../server/repositories/feedback.repository'
import {
  finishSession,
  rescheduleSession,
  skipSession,
  startSession,
  submitFeedback,
  type FeedbackPayload,
} from '../server/services/session.service'
import { getSkillProgression } from '../server/services/skill-mastery.service'
import { getStats } from '../server/services/stats.service'

let sqlite: Database.Database
let db: ReturnType<typeof drizzle>
let transition: ReturnType<typeof vi.fn<typeof transitionSessionByDate>>
const clearRecommendationCache = vi.fn()
const invalidatePreparedSessions = vi.fn()

function createTables(): void {
  sqlite.exec(`
    CREATE TABLE sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
      date TEXT NOT NULL UNIQUE,
      status TEXT DEFAULT 'generated' NOT NULL,
      title TEXT NOT NULL,
      category TEXT,
      focus TEXT NOT NULL,
      summary TEXT NOT NULL,
      coach_note TEXT DEFAULT '' NOT NULL,
      target_duration_min INTEGER NOT NULL,
      estimated_duration_min INTEGER NOT NULL,
      structure TEXT NOT NULL,
      ai_model TEXT NOT NULL,
      generation_source TEXT DEFAULT 'model' NOT NULL,
      generation_context_hash TEXT,
      fallback_used INTEGER DEFAULT false NOT NULL,
      reused_from_session_id INTEGER,
      generation_context TEXT,
      generated_at INTEGER,
      started_at INTEGER,
      completed_at INTEGER,
      actual_duration_sec INTEGER,
      skipped_block_count INTEGER,
      created_at INTEGER DEFAULT (unixepoch()) NOT NULL,
      updated_at INTEGER DEFAULT (unixepoch()) NOT NULL
    );
    CREATE TABLE session_feedback (
      id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
      session_id INTEGER NOT NULL UNIQUE,
      completed INTEGER DEFAULT true NOT NULL,
      overall_difficulty INTEGER,
      energy_level INTEGER,
      soreness TEXT DEFAULT '[]' NOT NULL,
      enjoyment INTEGER,
      comment TEXT,
      actual_duration_sec INTEGER,
      skipped_block_count INTEGER,
      created_at INTEGER DEFAULT (unixepoch()) NOT NULL,
      FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
    );
    CREATE TABLE exercise_feedback (
      id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
      session_id INTEGER NOT NULL,
      block_index INTEGER NOT NULL,
      exercise_index INTEGER NOT NULL,
      exercise_name TEXT NOT NULL,
      difficulty INTEGER,
      comment TEXT,
      created_at INTEGER DEFAULT (unixepoch()) NOT NULL,
      FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
    );
  `)
}

function insertSession(status = 'generated'): void {
  db.insert(sessions)
    .values({
      date: '2026-09-28',
      status,
      title: 'Cycle fiable',
      category: 'apprentissage',
      focus: 'fondations',
      summary: 'Résumé',
      coachNote: 'Note',
      targetDurationMin: 20,
      estimatedDurationMin: 20,
      structure: {
        title: 'Cycle fiable',
        curriculumVersion: 'beginner-curriculum/v1',
        category: 'apprentissage',
        focus: 'fondations',
        summary: 'Résumé',
        coachNote: 'Note',
        estimatedDurationMin: 20,
        blocks: [
          {
            type: 'technique',
            title: 'Technique',
            description: 'Description',
            exercises: [
              {
                name: 'Garde',
                category: 'technique',
                explanation: 'Explication',
                tips: [],
                commonMistakes: [],
                skillIds: ['posture_garde'],
                combo: null,
                comboExplanation: null,
                intervals: { work: 30, rest: 0, rounds: 1 },
                restAfterSec: 0,
              },
            ],
          },
        ],
      },
      aiModel: 'test',
      generationSource: 'model',
      generatedAt: new Date('2026-09-28T08:00:00Z'),
    })
    .run()
}

function feedback(overrides: Partial<FeedbackPayload> = {}): FeedbackPayload {
  return {
    completed: true,
    overallDifficulty: 3,
    energyLevel: 4,
    soreness: [],
    enjoyment: 5,
    comment: 'Bien',
    actualDurationSec: 999,
    skippedBlockCount: 9,
    exercises: [],
    ...overrides,
  }
}

beforeEach(() => {
  sqlite = new Database(':memory:')
  sqlite.pragma('foreign_keys = ON')
  createTables()
  db = drizzle(sqlite, { schema: { sessions, sessionFeedback, exerciseFeedback } })
  transition = vi.fn(transitionSessionByDate)

  vi.stubGlobal('useDatabase', () => db)
  vi.stubGlobal('sessions', sessions)
  vi.stubGlobal('sessionFeedback', sessionFeedback)
  vi.stubGlobal('exerciseFeedback', exerciseFeedback)
  vi.stubGlobal('findSessionByDate', findSessionByDate)
  vi.stubGlobal('transitionSessionByDate', transition)
  vi.stubGlobal('updateSessionByDate', updateSessionByDate)
  vi.stubGlobal('upsertSessionFeedback', upsertSessionFeedback)
  vi.stubGlobal('replaceExerciseFeedback', replaceExerciseFeedback)
  vi.stubGlobal('recordSessionExercisePreference', vi.fn())
  vi.stubGlobal('clearRecommendationCache', clearRecommendationCache)
  vi.stubGlobal('invalidatePreparedSessions', invalidatePreparedSessions)
  vi.stubGlobal('getPlan', vi.fn().mockReturnValue(null))
  vi.stubGlobal('dismissDate', vi.fn())
  vi.stubGlobal('undismissDate', vi.fn())
  vi.stubGlobal('createError', ({ statusCode, statusMessage }: Record<string, unknown>) =>
    Object.assign(new Error(String(statusMessage)), { statusCode, statusMessage }),
  )

  vi.stubGlobal('listCompletedSessions', listCompletedSessions)
  vi.stubGlobal('listSessionFeedbackByIds', listSessionFeedbackByIds)
  vi.stubGlobal('listExerciseFeedbackByIds', listExerciseFeedbackByIds)
  vi.stubGlobal('getSettings', () => ({ trainingDays: [1, 3, 5], weightTrackingEnabled: false }))
  vi.stubGlobal('todayIso', todayIso)
  vi.stubGlobal('addDays', addDays)
  vi.stubGlobal('isoWeekday', isoWeekday)
  vi.stubGlobal('listWeights', () => [])

  vi.clearAllMocks()
})

afterEach(() => {
  vi.unstubAllGlobals()
  sqlite.close()
})

describe('cycle de séance — intégration SQLite', () => {
  it('déduplique les démarrages concurrents et conserve le premier instant', async () => {
    insertSession()

    const results = await Promise.all(
      Array.from({ length: 8 }, async () => startSession('2026-09-28')),
    )

    expect(transition).toHaveBeenCalledOnce()
    expect(results.every((row) => row.status === 'in_progress')).toBe(true)
    expect(findSessionByDate('2026-09-28')).toMatchObject({ status: 'in_progress' })
  })

  it('déduplique les clôtures concurrentes et la première métrique gagne', async () => {
    insertSession()
    startSession('2026-09-28')
    transition.mockClear()

    await Promise.all([
      Promise.resolve(
        finishSession('2026-09-28', { actualDurationSec: 600, skippedBlockCount: 1 }),
      ),
      Promise.resolve(
        finishSession('2026-09-28', { actualDurationSec: 900, skippedBlockCount: 4 }),
      ),
    ])

    expect(transition).toHaveBeenCalledOnce()
    expect(findSessionByDate('2026-09-28')).toMatchObject({
      status: 'completed',
      actualDurationSec: 600,
      skippedBlockCount: 1,
    })
  })

  it('ajoute puis modifie le feedback sans réécrire la clôture', () => {
    insertSession()
    startSession('2026-09-28')
    const completed = finishSession('2026-09-28', {
      actualDurationSec: 600,
      skippedBlockCount: 1,
    })
    const completedAt = completed.completedAt

    submitFeedback('2026-09-28', feedback())
    submitFeedback('2026-09-28', feedback({ comment: 'Modifié', actualDurationSec: 1_200 }))

    expect(findSessionByDate('2026-09-28')).toMatchObject({
      status: 'completed',
      completedAt,
      actualDurationSec: 600,
      skippedBlockCount: 1,
    })
    expect(findSessionFeedback(completed.id)).toMatchObject({
      comment: 'Modifié',
      actualDurationSec: 600,
      skippedBlockCount: 1,
    })
  })

  it('refuse feedback et clôture hors ordre sans mutation', () => {
    insertSession()

    expect(() =>
      finishSession('2026-09-28', { actualDurationSec: 10, skippedBlockCount: 0 }),
    ).toThrow()
    expect(() => submitFeedback('2026-09-28', feedback())).toThrow()
    expect(findSessionByDate('2026-09-28')).toMatchObject({
      status: 'generated',
      completedAt: null,
      actualDurationSec: null,
    })
  })

  it('rend la clôture skipped idempotente et conserve sa première raison', () => {
    insertSession()

    const skipped = skipSession('2026-09-28', 'Indisponible')
    const repeated = skipSession('2026-09-28', 'Ne doit pas remplacer')

    expect(skipped.status).toBe('skipped')
    expect(repeated).toMatchObject({ id: skipped.id, status: 'skipped' })
    expect(findSessionFeedback(skipped.id)).toMatchObject({
      completed: false,
      comment: 'Indisponible',
    })
  })

  it('autorise le report atomique d’une proposition encore générée', () => {
    insertSession()

    const result = rescheduleSession('2026-09-28', '2026-09-29')

    expect(result.session).toMatchObject({ date: '2026-09-29', status: 'generated' })
    expect(findSessionByDate('2026-09-28')).toBeUndefined()
    expect(findSessionByDate('2026-09-29')).toMatchObject({ title: 'Cycle fiable' })
  })

  it('protège une séance terminée contre un report et un nouveau start', () => {
    insertSession()
    startSession('2026-09-28')
    const completed = finishSession('2026-09-28', {
      actualDurationSec: 600,
      skippedBlockCount: 0,
    })
    transition.mockClear()

    expect(startSession('2026-09-28')).toMatchObject({ id: completed.id, status: 'completed' })
    expect(() => rescheduleSession('2026-09-28', '2026-09-29')).toThrow()
    expect(transition).not.toHaveBeenCalled()
    expect(findSessionByDate('2026-09-28')).toMatchObject({ id: completed.id, status: 'completed' })
  })

  it('un résultat de génération tardif ne réécrit ni historique ni feedback', () => {
    insertSession()
    startSession('2026-09-28')
    const completed = finishSession('2026-09-28', {
      actualDurationSec: 600,
      skippedBlockCount: 1,
    })
    submitFeedback('2026-09-28', feedback({ comment: 'À conserver' }))

    const result = upsertSessionByDate({
      date: '2026-09-28',
      status: 'generated',
      title: 'Nouvelle proposition interdite',
      category: 'cardio',
      focus: 'cardio',
      summary: 'Ne doit pas passer',
      coachNote: 'Ne doit pas passer',
      targetDurationMin: 30,
      estimatedDurationMin: 30,
      structure: completed.structure,
      aiModel: 'late-job',
      generationSource: 'model',
      generatedAt: new Date(),
    })

    expect(result).toMatchObject({
      id: completed.id,
      status: 'completed',
      title: 'Cycle fiable',
      actualDurationSec: 600,
    })
    expect(findSessionFeedback(completed.id)).toMatchObject({ comment: 'À conserver' })
    expect(getStats()).toMatchObject({ totalSessions: 1, totalMinutes: 10 })
  })

  it('crédite statistiques et progression avant tout feedback', () => {
    insertSession()
    startSession('2026-09-28')
    finishSession('2026-09-28', { actualDurationSec: 600, skippedBlockCount: 0 })

    expect(getStats()).toMatchObject({ totalSessions: 1, totalMinutes: 10 })
    expect(getSkillProgression('2026-09-28').mastery.posture_garde).toMatchObject({
      state: 'en_consolidation',
      exposures: 1,
      neutralExposures: 1,
    })
  })
})
