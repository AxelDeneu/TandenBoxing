import Database from 'better-sqlite3'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { DEFAULT_AI_MODEL, normalizeOpenRouterModelSlug } from '../shared/openrouter-models'

const legacyMappings = [
  ['claude-opus-4-8', 'anthropic/claude-opus-4.8'],
  ['claude-sonnet-5', 'anthropic/claude-sonnet-5'],
  ['claude-haiku-4-5-20251001', 'anthropic/claude-haiku-4.5'],
] as const

describe('migration des slugs OpenRouter', () => {
  it.each(legacyMappings)('normalise %s de façon idempotente', (legacy, expected) => {
    expect(normalizeOpenRouterModelSlug(legacy)).toBe(expected)
    expect(normalizeOpenRouterModelSlug(normalizeOpenRouterModelSlug(legacy))).toBe(expected)
  })

  it('migre les réglages, change le défaut et préserve les modèles des séances historiques', () => {
    const sqlite = new Database(':memory:')
    sqlite.exec(`
      CREATE TABLE settings (
        id integer PRIMARY KEY DEFAULT 1 NOT NULL,
        training_days text DEFAULT '[1,3,5]' NOT NULL,
        generation_time text DEFAULT '07:00' NOT NULL,
        target_duration_min integer DEFAULT 45 NOT NULL,
        timezone text DEFAULT 'Europe/Paris' NOT NULL,
        ai_model text DEFAULT 'claude-opus-4-8' NOT NULL,
        weight_tracking_enabled integer DEFAULT true NOT NULL,
        auth_enabled integer DEFAULT false NOT NULL,
        onboarding_completed integer DEFAULT false NOT NULL,
        created_at integer DEFAULT (unixepoch()) NOT NULL,
        updated_at integer DEFAULT (unixepoch()) NOT NULL
      );
      CREATE TABLE ai_usage (
        id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
        session_date text,
        kind text NOT NULL,
        model text NOT NULL,
        input_tokens integer DEFAULT 0 NOT NULL,
        output_tokens integer DEFAULT 0 NOT NULL,
        cache_creation_tokens integer DEFAULT 0 NOT NULL,
        cache_read_tokens integer DEFAULT 0 NOT NULL,
        created_at integer DEFAULT (unixepoch()) NOT NULL
      );
      CREATE TABLE sessions (id integer PRIMARY KEY, ai_model text NOT NULL);
    `)
    for (const [index, [legacy]] of legacyMappings.entries()) {
      sqlite.prepare('INSERT INTO settings (id, ai_model) VALUES (?, ?)').run(index + 1, legacy)
    }
    sqlite.prepare('INSERT INTO sessions (id, ai_model) VALUES (1, ?)').run('claude-opus-4-8')

    const migrationPath = fileURLToPath(
      new URL('../drizzle/0012_calm_vulture.sql', import.meta.url),
    )
    sqlite.exec(readFileSync(migrationPath, 'utf8').replaceAll('--> statement-breakpoint', ''))

    const settings = sqlite
      .prepare('SELECT ai_model AS model FROM settings ORDER BY id')
      .all() as Array<{ model: string }>
    expect(settings.map((row) => row.model)).toEqual(legacyMappings.map(([, model]) => model))
    expect(
      (
        sqlite.prepare("PRAGMA table_info('settings')").all() as Array<Record<string, unknown>>
      ).find((column) => column.name === 'ai_model')?.dflt_value,
    ).toBe(`'${DEFAULT_AI_MODEL}'`)
    expect(sqlite.prepare('SELECT ai_model AS model FROM sessions').get()).toEqual({
      model: 'claude-opus-4-8',
    })
    expect(
      (
        sqlite.prepare("PRAGMA table_info('ai_usage')").all() as Array<Record<string, unknown>>
      ).some((column) => column.name === 'cost_usd'),
    ).toBe(true)
    sqlite.close()
  })
})
