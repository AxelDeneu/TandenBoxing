import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { exercisePreferenceEvents } from '../server/database/schema'
import {
  deleteExercisePreferenceEvents,
  listExercisePreferenceEvents,
  recordExercisePreferenceEvent,
  replaceExercisePreferenceEvents,
  upsertExercisePreferenceEvent,
} from '../server/repositories/exercise-preference.repository'
import type { NewExercisePreferenceEventRow } from '../server/database/schema'

type EventValues = Omit<NewExercisePreferenceEventRow, 'id' | 'createdAt' | 'updatedAt'>

let sqlite: Database.Database

function values(overrides: Partial<EventValues> = {}): EventValues {
  return {
    exerciseKey: 'burpees:poids_du_corps',
    exerciseName: 'Burpees contrôlés',
    movementFamily: 'burpees',
    modality: 'poids_du_corps',
    action: 'disliked',
    reasonCode: 'boredom',
    signalKind: 'weighted',
    scope: 'exercise',
    scopeKey: 'burpees:poids_du_corps',
    occurredOn: '2026-09-22',
    source: 'feedback',
    sourceKey: 'feedback:1:0:0',
    context: {
      sessionDate: '2026-09-22',
      blockType: 'cardio',
      exerciseCategory: 'cardio',
      workoutFocus: 'cardio',
    },
    ...overrides,
  }
}

beforeEach(() => {
  sqlite = new Database(':memory:')
  sqlite.exec(`
    CREATE TABLE exercise_preference_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
      exercise_key TEXT NOT NULL,
      exercise_name TEXT NOT NULL,
      movement_family TEXT NOT NULL,
      modality TEXT NOT NULL,
      action TEXT NOT NULL,
      reason_code TEXT NOT NULL,
      signal_kind TEXT NOT NULL,
      scope TEXT NOT NULL,
      scope_key TEXT NOT NULL,
      occurred_on TEXT NOT NULL,
      source TEXT NOT NULL,
      source_key TEXT,
      context TEXT NOT NULL,
      created_at INTEGER DEFAULT (unixepoch()) NOT NULL,
      updated_at INTEGER DEFAULT (unixepoch()) NOT NULL
    );
    CREATE UNIQUE INDEX exercise_preference_events_source_key_unique
      ON exercise_preference_events (source_key);
  `)
  const db = drizzle(sqlite, { schema: { exercisePreferenceEvents } })
  vi.stubGlobal('useDatabase', () => db)
  vi.stubGlobal('exercisePreferenceEvents', exercisePreferenceEvents)
})

afterEach(() => {
  vi.unstubAllGlobals()
  sqlite.close()
})

describe('exercise-preference.repository', () => {
  it('persiste les événements et réenregistre un feedback de façon idempotente', () => {
    recordExercisePreferenceEvent(values({ sourceKey: null }))
    upsertExercisePreferenceEvent(values())
    upsertExercisePreferenceEvent(
      values({ action: 'liked', reasonCode: 'liked', exerciseName: 'Burpees appréciés' }),
    )

    const rows = listExercisePreferenceEvents('2026-09-22')
    expect(rows).toHaveLength(2)
    expect(rows.find((row) => row.sourceKey)?.action).toBe('liked')
    expect(rows.find((row) => row.sourceKey)?.context).toMatchObject({ blockType: 'cardio' })
  })

  it('remplace puis efface tous les signaux appris pour un exercice', () => {
    recordExercisePreferenceEvent(values({ sourceKey: null }))
    recordExercisePreferenceEvent(values({ sourceKey: null, occurredOn: '2026-09-21' }))

    replaceExercisePreferenceEvents(
      'burpees:poids_du_corps',
      values({
        action: 'disliked',
        reasonCode: 'pain',
        signalKind: 'strict_exclusion',
        scope: 'movement',
        scopeKey: 'burpees',
        source: 'settings',
        sourceKey: null,
      }),
    )

    expect(listExercisePreferenceEvents()).toHaveLength(1)
    expect(listExercisePreferenceEvents()[0]).toMatchObject({
      reasonCode: 'pain',
      signalKind: 'strict_exclusion',
    })
    expect(deleteExercisePreferenceEvents('burpees:poids_du_corps')).toBe(1)
    expect(listExercisePreferenceEvents()).toHaveLength(0)
  })
})
