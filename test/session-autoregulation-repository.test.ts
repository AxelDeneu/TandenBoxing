import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { sessionAdaptations, sessionCheckIns } from '../server/database/schema'
import {
  findSessionCheckIn,
  listSessionAdaptations,
  listSessionAdaptationsBefore,
  recordSessionAdaptation,
  upsertSessionCheckIn,
} from '../server/repositories/session-autoregulation.repository'

let sqlite: Database.Database

beforeEach(() => {
  sqlite = new Database(':memory:')
  sqlite.exec(`
    CREATE TABLE session_check_ins (
      id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
      session_id INTEGER NOT NULL UNIQUE,
      available_time_min INTEGER,
      energy INTEGER DEFAULT 3 NOT NULL,
      soreness_level INTEGER DEFAULT 0 NOT NULL,
      soreness_locations TEXT DEFAULT '[]' NOT NULL,
      pain_locations TEXT DEFAULT '[]' NOT NULL,
      intention TEXT DEFAULT 'maintain' NOT NULL,
      created_at INTEGER DEFAULT (unixepoch()) NOT NULL,
      updated_at INTEGER DEFAULT (unixepoch()) NOT NULL
    );
    CREATE TABLE session_adaptations (
      id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
      session_id INTEGER NOT NULL,
      session_date TEXT NOT NULL,
      cause TEXT NOT NULL,
      cursor TEXT,
      constraints TEXT NOT NULL,
      changes TEXT NOT NULL,
      before_duration_sec INTEGER NOT NULL,
      after_duration_sec INTEGER NOT NULL,
      before_intensity INTEGER NOT NULL,
      after_intensity INTEGER NOT NULL,
      rule_version TEXT NOT NULL,
      safety_notice_shown INTEGER DEFAULT false NOT NULL,
      created_at INTEGER DEFAULT (unixepoch()) NOT NULL
    );
  `)
  const db = drizzle(sqlite, { schema: { sessionAdaptations, sessionCheckIns } })
  vi.stubGlobal('useDatabase', () => db)
  vi.stubGlobal('sessionAdaptations', sessionAdaptations)
  vi.stubGlobal('sessionCheckIns', sessionCheckIns)
})

afterEach(() => {
  vi.unstubAllGlobals()
  sqlite.close()
})

describe('session-autoregulation.repository', () => {
  it('conserve un seul check-in structuré par séance', () => {
    upsertSessionCheckIn({
      sessionId: 7,
      availableTimeMin: 30,
      energy: 2,
      sorenessLevel: 1,
      sorenessLocations: ['shoulder'],
      painLocations: [],
      intention: 'technique',
    })
    upsertSessionCheckIn({
      sessionId: 7,
      availableTimeMin: 20,
      energy: 3,
      sorenessLevel: 0,
      sorenessLocations: [],
      painLocations: ['wrist_hand'],
      intention: 'maintain',
    })

    expect(findSessionCheckIn(7)).toMatchObject({
      availableTimeMin: 20,
      energy: 3,
      painLocations: ['wrist_hand'],
    })
  })

  it('journalise cause, changements, résultat et version de règle', () => {
    const adaptation = recordSessionAdaptation({
      sessionId: 7,
      sessionDate: '2026-09-22',
      cause: 'pain',
      cursor: { blockIndex: 1, exerciseIndex: 0 },
      constraints: {
        targetSeconds: 1_800,
        intensity: 1,
        workScale: 0.7,
        restScale: 1.5,
        roundDelta: -1,
        maxComboLength: 1,
        prohibitedMovementFamilies: ['directs'],
        allowedMovementFamilies: ['squats'],
        safetyPrecedence: true,
      },
      changes: [
        {
          kind: 'substitution',
          path: 'blocks.1.exercises.1',
          before: 'directs',
          after: 'respiration',
        },
      ],
      beforeDurationSec: 1_800,
      afterDurationSec: 1_500,
      beforeIntensity: 3,
      afterIntensity: 1,
      ruleVersion: 'session-autoregulation/v1',
      safetyNoticeShown: true,
    })

    expect(adaptation).toMatchObject({
      cause: 'pain',
      beforeDurationSec: 1_800,
      afterDurationSec: 1_500,
      ruleVersion: 'session-autoregulation/v1',
      safetyNoticeShown: true,
    })
    expect(listSessionAdaptations(7)[0]!.changes).toHaveLength(1)
    expect(listSessionAdaptationsBefore('2026-09-23')).toHaveLength(1)
    expect(listSessionAdaptationsBefore('2026-09-22')).toHaveLength(0)
  })
})
