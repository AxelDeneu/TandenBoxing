import Database from 'better-sqlite3'
import { eq } from 'drizzle-orm'
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import * as schema from '../database/schema'

// Re-export tables + types so they're auto-imported across the server.
export * from '../database/schema'

let _db: BetterSQLite3Database<typeof schema> | null = null

/**
 * Connexion SQLite unique (better-sqlite3 + Drizzle), créée à la demande.
 */
export function useDatabase(): BetterSQLite3Database<typeof schema> {
  if (_db) return _db
  const { databasePath } = useRuntimeConfig()
  const dbPath = resolve(process.cwd(), databasePath || './data/tanden.db')
  mkdirSync(dirname(dbPath), { recursive: true })
  const sqlite = new Database(dbPath)
  sqlite.pragma('journal_mode = WAL')
  sqlite.pragma('foreign_keys = ON')
  _db = drizzle(sqlite, { schema })
  return _db
}

/**
 * Garantit l'existence des lignes singleton (settings + profile, id = 1).
 */
export function ensureSingletons(db: BetterSQLite3Database<typeof schema> = useDatabase()) {
  const s = db.select().from(schema.settings).where(eq(schema.settings.id, 1)).get()
  if (!s) db.insert(schema.settings).values({ id: 1 }).run()

  const p = db.select().from(schema.profile).where(eq(schema.profile.id, 1)).get()
  if (!p) db.insert(schema.profile).values({ id: 1 }).run()
}
