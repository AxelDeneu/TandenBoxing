import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { ensureTodaySessionWithDependencies } from '../server/services/generation-job.service'

type NitroPlugin = () => void

let plugin: NitroPlugin
let onboardingCompleted = false
const request = vi.fn()
const scheduleGeneration = vi.fn()
const ensureTodaySession = vi.fn(() =>
  ensureTodaySessionWithDependencies(
    {
      onboardingCompleted,
      timezone: 'Europe/Paris',
      trainingDays: [4],
    },
    {
      today: () => '2026-10-01',
      weekday: () => 4,
      findSession: () => undefined,
      isDismissed: () => false,
      request,
    },
  ),
)

beforeAll(async () => {
  vi.stubGlobal('defineNitroPlugin', (handler: NitroPlugin) => handler)
  vi.stubGlobal('useRuntimeConfig', () => ({ disableCron: '' }))
  vi.stubGlobal('scheduleGeneration', scheduleGeneration)
  vi.stubGlobal('ensureTodaySession', ensureTodaySession)
  plugin = (await import('../server/plugins/1.cron')).default as NitroPlugin
})

beforeEach(() => {
  onboardingCompleted = false
  vi.clearAllMocks()
})

describe('cron au démarrage — frontière onboarding', () => {
  it('ne demande aucune génération sur un profil vierge', () => {
    plugin()

    expect(scheduleGeneration).toHaveBeenCalledOnce()
    expect(ensureTodaySession).toHaveBeenCalledOnce()
    expect(request).not.toHaveBeenCalled()
  })

  it('autorise le rattrapage seulement après la fin atomique de l’onboarding', () => {
    onboardingCompleted = true

    plugin()

    expect(request).toHaveBeenCalledOnce()
    expect(request).toHaveBeenCalledWith('2026-10-01')
  })
})
