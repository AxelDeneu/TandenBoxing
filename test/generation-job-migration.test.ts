import Database from 'better-sqlite3'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

let sqlite: Database.Database

beforeEach(() => {
  sqlite = new Database(':memory:')
  sqlite.exec(`
    CREATE TABLE generation_jobs (
      id INTEGER PRIMARY KEY,
      status TEXT NOT NULL,
      attempt_count INTEGER NOT NULL,
      lease_owner TEXT,
      lease_expires_at INTEGER,
      started_at INTEGER,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE generation_job_attempts (
      id INTEGER PRIMARY KEY,
      job_id INTEGER NOT NULL,
      attempt_number INTEGER NOT NULL,
      status TEXT NOT NULL
    );
  `)
})

afterEach(() => sqlite.close())

describe('migration du fencing des jobs de génération', () => {
  it('backfill le token partagé des jobs running sans altérer les autres états', () => {
    sqlite
      .prepare(
        `INSERT INTO generation_jobs
          (id, status, attempt_count, lease_owner, lease_expires_at, started_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(1, 'running', 2, 'legacy-worker', 1_800_000_000, 1_700_000_000, 1_700_000_100)
    sqlite
      .prepare(
        `INSERT INTO generation_jobs
          (id, status, attempt_count, lease_owner, lease_expires_at, started_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(2, 'queued', 0, null, null, null, 1_700_000_200)
    sqlite
      .prepare(
        'INSERT INTO generation_job_attempts (id, job_id, attempt_number, status) VALUES (?, ?, ?, ?)',
      )
      .run(1, 1, 2, 'running')

    const migrationPath = fileURLToPath(
      new URL('../drizzle/0013_groovy_maginty.sql', import.meta.url),
    )
    sqlite.exec(readFileSync(migrationPath, 'utf8').replaceAll('--> statement-breakpoint', ''))

    const running = sqlite.prepare('SELECT * FROM generation_jobs WHERE id = 1').get() as Record<
      string,
      unknown
    >
    const queued = sqlite.prepare('SELECT * FROM generation_jobs WHERE id = 2').get() as Record<
      string,
      unknown
    >
    const attempt = sqlite
      .prepare('SELECT * FROM generation_job_attempts WHERE id = 1')
      .get() as Record<string, unknown>

    expect(running.lease_token).toMatch(/^[a-f0-9]{32}$/)
    expect(running.attempt_started_at).toBe(1_700_000_100)
    expect(attempt.lease_token).toBe(running.lease_token)
    expect(queued.lease_token).toBeNull()
    expect(queued.attempt_started_at).toBeNull()
  })
})
