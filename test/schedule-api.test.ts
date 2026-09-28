import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

type ApiHandler = (event: { body: unknown }) => Promise<unknown>

let settingsHandler: ApiHandler
let onboardingHandler: ApiHandler

const updateSettings = vi.fn((patch: Record<string, unknown>) => ({ id: 1, ...patch }))
const updateProfile = vi.fn((patch: Record<string, unknown>) => ({ id: 1, ...patch }))
const invalidatePreparedSessions = vi.fn()

beforeAll(async () => {
  vi.stubGlobal('defineEventHandler', (handler: ApiHandler) => handler)
  vi.stubGlobal('readBody', (event: { body: unknown }) => event.body)
  vi.stubGlobal(
    'createError',
    ({ statusCode, statusMessage }: { statusCode: number; statusMessage: string }) =>
      Object.assign(new Error(statusMessage), {
        statusCode,
        statusMessage,
        data: { statusMessage },
      }),
  )
  vi.stubGlobal('getSettings', () => ({
    generationTime: '07:00',
    timezone: 'Europe/Paris',
  }))
  vi.stubGlobal('useRuntimeConfig', () => ({ disableCron: '1' }))
  vi.stubGlobal('useDatabase', () => ({ transaction: (run: () => unknown) => run() }))
  vi.stubGlobal('updateSettings', updateSettings)
  vi.stubGlobal('updateProfile', updateProfile)
  vi.stubGlobal('invalidatePreparedSessions', invalidatePreparedSessions)

  settingsHandler = (await import('../server/api/settings.put')).default as ApiHandler
  onboardingHandler = (await import('../server/api/onboarding.post')).default as ApiHandler
})

beforeEach(() => {
  vi.clearAllMocks()
})

describe('contrat API de planification', () => {
  it.each([
    [{ generationTime: '99:99' }, "L'heure de génération doit être comprise entre 00:00 et 23:59."],
    [{ generationTime: '24:00' }, "L'heure de génération doit être comprise entre 00:00 et 23:59."],
    [
      { timezone: 'Mars/Olympus' },
      'Le fuseau horaire doit être un identifiant valide, par exemple Europe/Paris ou UTC.',
    ],
  ] as const)('refuse %o avec un message exploitable', async (body, statusMessage) => {
    await expect(settingsHandler({ body })).rejects.toMatchObject({
      statusCode: 400,
      statusMessage,
    })
    expect(updateSettings).not.toHaveBeenCalled()
    expect(invalidatePreparedSessions).not.toHaveBeenCalled()
  })

  it.each([
    ['99:99', 'Europe/Paris'],
    ['24:00', 'Europe/Paris'],
    ['07:00', 'Mars/Olympus'],
  ])('refuse l’onboarding invalide %s / %s sans mutation', async (generationTime, timezone) => {
    await expect(
      onboardingHandler({
        body: {
          fitnessLevel: 'actif',
          experience: null,
          age: 30,
          constraints: null,
          trainingDays: [1, 3, 5],
          generationTime,
          timezone,
          targetDurationMin: 45,
        },
      }),
    ).rejects.toMatchObject({ statusCode: 400 })
    expect(updateProfile).not.toHaveBeenCalled()
    expect(updateSettings).not.toHaveBeenCalled()
    expect(invalidatePreparedSessions).not.toHaveBeenCalled()
  })

  it('accepte les bornes et UTC dans les réglages', async () => {
    await expect(
      settingsHandler({ body: { generationTime: '00:00', timezone: 'UTC' } }),
    ).resolves.toMatchObject({ generationTime: '00:00', timezone: 'UTC' })
    expect(updateSettings).toHaveBeenCalledOnce()
    expect(invalidatePreparedSessions).toHaveBeenCalledOnce()
  })

  it('accepte 23:59 et Europe/Paris dans l’onboarding', async () => {
    await expect(
      onboardingHandler({
        body: {
          fitnessLevel: 'sportif',
          experience: null,
          age: null,
          constraints: null,
          trainingDays: [5, 1, 5],
          generationTime: '23:59',
          timezone: 'Europe/Paris',
          targetDurationMin: 45,
        },
      }),
    ).resolves.toEqual({ ok: true })
    expect(updateProfile).toHaveBeenCalledOnce()
    expect(updateSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        trainingDays: [1, 5],
        generationTime: '23:59',
        timezone: 'Europe/Paris',
      }),
    )
    expect(invalidatePreparedSessions).toHaveBeenCalledOnce()
  })
})
