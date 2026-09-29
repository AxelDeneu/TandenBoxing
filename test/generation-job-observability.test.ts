import { describe, expect, it } from 'vitest'
import {
  formatGenerationElapsed,
  generationPreviousAttemptDescription,
  generationProgressDescription,
  generationStageLabel,
} from '../app/utils/generation-job'
import { formatGenerationJobLog } from '../server/utils/generation-job-logger'
import type { PublicGenerationJob } from '../shared/generation-jobs'

function publicJob(overrides: Partial<PublicGenerationJob> = {}): PublicGenerationJob {
  return {
    id: 41,
    date: '2026-10-01',
    status: 'running',
    source: 'user',
    attemptCount: 2,
    maxAttempts: 3,
    nextAttemptAt: Date.parse('2026-10-01T06:00:00Z'),
    errorKind: 'temporary',
    errorCode: 'OPENROUTER_EMPTY_RESPONSE',
    errorMessage: 'Le modèle n’a renvoyé aucune sortie structurée.',
    actionableMessage: 'Une nouvelle tentative sera lancée automatiquement.',
    reuseKind: 'none',
    reusedBlockCount: 0,
    fallbackUsed: false,
    createdAt: Date.parse('2026-10-01T05:55:00Z'),
    startedAt: Date.parse('2026-10-01T06:00:00Z'),
    completedAt: null,
    currentAttempt: {
      number: 2,
      startedAt: Date.parse('2026-10-01T06:04:00Z'),
      stage: 'correction',
      stageStartedAt: Date.parse('2026-10-01T06:05:00Z'),
    },
    lastAttempt: {
      number: 1,
      status: 'retry_scheduled',
      errorKind: 'temporary',
      errorCode: 'OPENROUTER_EMPTY_RESPONSE',
      errorMessage: 'Le modèle n’a renvoyé aucune sortie structurée.',
      completedAt: Date.parse('2026-10-01T06:03:00Z'),
    },
    ...overrides,
  }
}

describe('observabilité sûre des jobs de génération', () => {
  it('sérialise uniquement les métadonnées allowlistées et expurge tout contenu sensible', () => {
    const secret = 'sk-or-v1-secret-sentinel'
    const prompt = 'PROMPT_SENTINEL profil blessure genou'
    const response = 'MODEL_RESPONSE_SENTINEL séance complète'
    const line = formatGenerationJobLog(
      {
        event: 'stage_failed',
        jobId: 41,
        date: '2026-10-01',
        source: 'user',
        attempt: 2,
        maxAttempts: 3,
        model: 'provider/model',
        stage: 'correction',
        status: 'failed',
        durationMs: 120_000,
        errorCode: 'OPENROUTER_INVALID_JSON',
        workerId: 'worker-safe',
        apiKey: secret,
        headers: { Authorization: secret },
        prompt,
        response,
        profile: { injury: 'genou' },
        session: { title: 'secret' },
      } as Parameters<typeof formatGenerationJobLog>[0],
      new Date('2026-10-01T06:06:00Z'),
    )

    expect(line).toMatch(/^\[generation-job\] \{"event":"stage_failed"/)
    expect(line).toContain('"jobId":41')
    expect(line).toContain('"stage":"correction"')
    for (const forbidden of [
      secret,
      prompt,
      response,
      'Authorization',
      'apiKey',
      'profile',
      'session',
    ]) {
      expect(line).not.toContain(forbidden)
    }
  })
})

describe('présentation de l’état courant et de l’essai précédent', () => {
  it('affiche étape, temps écoulé et erreur précédente sans les confondre', () => {
    const job = publicJob()
    const now = Date.parse('2026-10-01T06:06:05Z')

    expect(generationStageLabel(job.currentAttempt?.stage)).toBe('Correction structurée')
    expect(formatGenerationElapsed(job.currentAttempt!.startedAt, now)).toBe('2 min 5 s')
    expect(generationProgressDescription(job, now)).toBe(
      'Tentative 2/3 · Correction structurée · depuis 2 min 5 s',
    )
    expect(generationPreviousAttemptDescription(job)).toBe(
      'Essai précédent (1/3) : Le modèle n’a renvoyé aucune sortie structurée.',
    )
  })

  it('converge vers retry puis succès/fallback avec un état courant nul', () => {
    const running = publicJob()
    const retry = publicJob({
      status: 'retry_scheduled',
      currentAttempt: null,
    })
    const succeeded = publicJob({
      status: 'succeeded',
      currentAttempt: null,
      completedAt: Date.parse('2026-10-01T06:07:00Z'),
      fallbackUsed: true,
      lastAttempt: {
        number: 2,
        status: 'fallback_succeeded',
        errorKind: 'temporary',
        errorCode: 'GENERATION_ATTEMPT_DEADLINE_EXCEEDED',
        errorMessage: 'La tentative a dépassé son budget maximal.',
        completedAt: Date.parse('2026-10-01T06:07:00Z'),
      },
    })

    expect(running.currentAttempt?.stage).toBe('correction')
    expect(generationProgressDescription(retry)).toContain('nouvel essai programmé')
    expect(succeeded.currentAttempt).toBeNull()
    expect(succeeded.fallbackUsed).toBe(true)
    expect(succeeded.lastAttempt?.status).toBe('fallback_succeeded')
  })
})
