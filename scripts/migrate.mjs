// Runner de migrations autonome (Node pur, sans tsx) — utilisable en production.
// Applique les migrations SQL générées par drizzle-kit dans ./drizzle.
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

const dbPath = resolve(process.cwd(), process.env.NUXT_DATABASE_PATH || './data/tanden.db')
mkdirSync(dirname(dbPath), { recursive: true })

const sqlite = new Database(dbPath)
sqlite.pragma('journal_mode = WAL')

migrate(drizzle(sqlite), { migrationsFolder: resolve(process.cwd(), 'drizzle') })
console.log('✔ Migrations appliquées →', dbPath)

sqlite.close()
