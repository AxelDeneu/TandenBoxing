import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const scheduler = vi.hoisted(() => ({ failure: 'build' as 'build' | 'activate' }))

vi.mock('croner', () => ({
  Cron: class {
    constructor() {
      if (scheduler.failure === 'build') throw new Error('scheduler unavailable')
    }

    nextRun() {
      return new Date('2026-09-29T08:00:00Z')
    }

    pause() {}

    resume() {
      if (scheduler.failure === 'activate') throw new Error('scheduler cannot start')
    }

    stop() {}
  },
}))

type ApiHandler = (event: { body: unknown }) => Promise<unknown>

let settingsHandler: ApiHandler
let onboardingHandler: ApiHandler

const state = {
  settings: { generationTime: '07:00', timezone: 'Europe/Paris' },
  profile: { fitnessLevel: 'sedentaire' },
}
const updateSettings = vi.fn((patch: Record<string, unknown>) => {
  Object.assign(state.settings, patch)
  return { ...state.settings }
})
const updateProfile = vi.fn((patch: Record<string, unknown>) => {
  Object.assign(state.profile, patch)
  return { ...state.profile }
})
const invalidatePreparedSessions = vi.fn()
const ensureTodaySession = vi.fn()

beforeAll(async () => {
  vi.stubGlobal('defineEventHandler', (handler: ApiHandler) => handler)
  vi.stubGlobal('readBody', (event: { body: unknown }) => event.body)
  vi.stubGlobal(
    'createError',
    ({ statusCode, statusMessage }: { statusCode: number; statusMessage: string }) =>
      Object.assign(new Error(statusMessage), { statusCode, statusMessage }),
  )
  vi.stubGlobal('getSettings', () => ({ ...state.settings }))
  vi.stubGlobal('useRuntimeConfig', () => ({ disableCron: '' }))
  vi.stubGlobal('useDatabase', () => ({
    transaction: (run: () => unknown) => {
      const settingsBefore = { ...state.settings }
      const profileBefore = { ...state.profile }
      try {
        return run()
      } catch (error) {
        state.settings = settingsBefore
        state.profile = profileBefore
        throw error
      }
    },
  }))
  vi.stubGlobal('updateSettings', updateSettings)
  vi.stubGlobal('updateProfile', updateProfile)
  vi.stubGlobal('invalidatePreparedSessions', invalidatePreparedSessions)
  vi.stubGlobal('ensureTodaySession', ensureTodaySession)

  settingsHandler = (await import('../server/api/settings.put')).default as ApiHandler
  onboardingHandler = (await import('../server/api/onboarding.post')).default as ApiHandler
})

beforeEach(() => {
  vi.clearAllMocks()
  scheduler.failure = 'build'
  state.settings = { generationTime: '07:00', timezone: 'Europe/Paris' }
  state.profile = { fitnessLevel: 'sedentaire' }
})

describe('échec de construction du scheduler', () => {
  it('ne modifie ni les réglages ni les séances préparées', async () => {
    await expect(
      settingsHandler({ body: { generationTime: '08:00', timezone: 'UTC' } }),
    ).rejects.toMatchObject({ statusCode: 400 })

    expect(updateSettings).not.toHaveBeenCalled()
    expect(invalidatePreparedSessions).not.toHaveBeenCalled()
  })

  it('ne modifie ni le profil, ni les réglages, ni les séances pendant l’onboarding', async () => {
    await expect(
      onboardingHandler({
        body: {
          goal: 'cardio-perte-de-gras',
          equipment: [],
          fitnessLevel: 'actif',
          experience: null,
          age: 30,
          constraints: null,
          trainingDays: [1, 3, 5],
          generationTime: '08:00',
          timezone: 'UTC',
          targetDurationMin: 45,
        },
      }),
    ).rejects.toMatchObject({ statusCode: 400 })

    expect(updateProfile).not.toHaveBeenCalled()
    expect(updateSettings).not.toHaveBeenCalled()
    expect(invalidatePreparedSessions).not.toHaveBeenCalled()
  })

  it('annule la mutation des réglages si le job préparé ne peut pas être activé', async () => {
    scheduler.failure = 'activate'

    await expect(
      settingsHandler({ body: { generationTime: '08:00', timezone: 'UTC' } }),
    ).rejects.toMatchObject({ statusCode: 400 })

    expect(updateSettings).toHaveBeenCalledOnce()
    expect(state.settings).toEqual({ generationTime: '07:00', timezone: 'Europe/Paris' })
    expect(invalidatePreparedSessions).not.toHaveBeenCalled()
  })

  it('annule profil et réglages si le job d’onboarding ne peut pas être activé', async () => {
    scheduler.failure = 'activate'

    await expect(
      onboardingHandler({
        body: {
          goal: 'forme-generale',
          equipment: ['elastiques'],
          fitnessLevel: 'sportif',
          experience: null,
          age: 30,
          constraints: null,
          trainingDays: [1, 3, 5],
          generationTime: '08:00',
          timezone: 'UTC',
          targetDurationMin: 45,
        },
      }),
    ).rejects.toMatchObject({ statusCode: 400 })

    expect(updateProfile).toHaveBeenCalledOnce()
    expect(updateSettings).toHaveBeenCalledOnce()
    expect(state.profile).toEqual({ fitnessLevel: 'sedentaire' })
    expect(state.settings).toEqual({ generationTime: '07:00', timezone: 'Europe/Paris' })
    expect(invalidatePreparedSessions).not.toHaveBeenCalled()
  })
})
