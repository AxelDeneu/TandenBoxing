import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { SYNTHETIC_CORPUS } from '../evaluation/fixtures/corpus'
import { candidateRun } from '../evaluation/fixtures/reference-candidate'
import { workoutSessionSchema } from '../shared/session-schema'

describe('corpus synthétique du générateur', () => {
  it('contient au moins 20 cas documentés et identifiables', () => {
    expect(SYNTHETIC_CORPUS.cases.length).toBeGreaterThanOrEqual(20)
    expect(new Set(SYNTHETIC_CORPUS.cases.map((item) => item.id)).size).toBe(
      SYNTHETIC_CORPUS.cases.length,
    )
    for (const item of SYNTHETIC_CORPUS.cases) {
      expect(item.title.length).toBeGreaterThan(0)
      expect(item.description.length).toBeGreaterThan(20)
    }
  })

  it('couvre tous les axes demandés par issue #5', () => {
    const tags = new Set(SYNTHETIC_CORPUS.cases.flatMap((item) => item.tags))
    expect(tags).toEqual(
      new Set([
        'beginner',
        'fatigue',
        'skipped-session',
        'physical-constraint',
        'neglected-focus',
        'explicit-request',
        'progression',
      ]),
    )
    expect(
      SYNTHETIC_CORPUS.cases.filter((item) => item.sequence?.id === 'foundation-four-weeks'),
    ).toHaveLength(4)
    expect(
      SYNTHETIC_CORPUS.cases.filter((item) => item.sequence?.id === 'load-then-recovery'),
    ).toHaveLength(4)
  })

  it('fournit une sortie structurellement valide pour chaque cas', () => {
    expect(Object.keys(candidateRun.outputs)).toHaveLength(SYNTHETIC_CORPUS.cases.length)
    for (const item of SYNTHETIC_CORPUS.cases) {
      expect(workoutSessionSchema.safeParse(candidateRun.outputs[item.id]).success).toBe(true)
    }
  })

  it('ne dépend ni de la base locale, ni de secrets, ni du client Anthropic', async () => {
    const fixtureFiles = ['corpus.ts', 'reference-candidate.ts'].map((name) =>
      fileURLToPath(new URL(`../evaluation/fixtures/${name}`, import.meta.url)),
    )
    const sources = (await Promise.all(fixtureFiles.map((path) => readFile(path, 'utf8')))).join(
      '\n',
    )

    expect(sources).not.toContain('data/tanden.db')
    expect(sources).not.toContain('process.env')
    expect(sources).not.toContain('ANTHROPIC_API_KEY')
    expect(sources).not.toContain('server/utils/anthropic')
  })
})
