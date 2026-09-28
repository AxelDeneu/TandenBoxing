import Database from 'better-sqlite3'
import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PROFILE_PERSONALIZATION_VERSION } from '../shared/profile-personalization'
import { profile } from '../server/database/schema'
import { getProfile, updateProfile } from '../server/repositories/profile.repository'

let sqlite: Database.Database
let db: ReturnType<typeof drizzle>

beforeEach(() => {
  sqlite = new Database(':memory:')
  sqlite.exec(`
    CREATE TABLE profile (
      id INTEGER PRIMARY KEY DEFAULT 1 NOT NULL,
      discipline TEXT DEFAULT 'boxe-anglaise' NOT NULL,
      level TEXT DEFAULT 'debutant' NOT NULL,
      goal TEXT DEFAULT 'cardio-perte-de-gras' NOT NULL,
      fitness_level TEXT,
      experience TEXT,
      age INTEGER,
      height_cm INTEGER,
      equipment TEXT DEFAULT '[]' NOT NULL,
      personalization_version TEXT,
      constraints TEXT,
      notes TEXT,
      created_at INTEGER DEFAULT (unixepoch()) NOT NULL,
      updated_at INTEGER DEFAULT (unixepoch()) NOT NULL
    );
  `)
  db = drizzle(sqlite, { schema: { profile } })
  vi.stubGlobal('useDatabase', () => db)
  vi.stubGlobal('profile', profile)
  vi.stubGlobal('ensureSingletons', () => undefined)
})

afterEach(() => {
  vi.unstubAllGlobals()
  sqlite.close()
})

describe('profil personnalisé — round-trip repository/API', () => {
  it('lit un profil historique avec la compatibilité sac puis persiste le contrat explicite', () => {
    sqlite
      .prepare('INSERT INTO profile (id, goal, equipment) VALUES (1, ?, ?)')
      .run('cardio-perte-de-gras', JSON.stringify(['gants', 'bandes']))

    expect(getProfile()).toMatchObject({
      goal: 'cardio-perte-de-gras',
      equipment: ['sac-de-frappe'],
      personalizationVersion: PROFILE_PERSONALIZATION_VERSION,
    })

    expect(updateProfile({ goal: 'technique', equipment: [] })).toMatchObject({
      goal: 'technique',
      equipment: [],
      personalizationVersion: PROFILE_PERSONALIZATION_VERSION,
    })
    expect(db.select().from(profile).where(eq(profile.id, 1)).get()).toMatchObject({
      goal: 'technique',
      equipment: [],
      personalizationVersion: PROFILE_PERSONALIZATION_VERSION,
    })
  })
})
