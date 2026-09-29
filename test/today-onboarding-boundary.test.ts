import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

type TodayHandler = () => Record<string, unknown>

let handler: TodayHandler
let onboardingCompleted = false
const requestGenerationJob = vi.fn()

beforeAll(async () => {
  vi.stubGlobal('defineEventHandler', (candidate: TodayHandler) => candidate)
  vi.stubGlobal('getSettings', () => ({
    onboardingCompleted,
    timezone: 'Europe/Paris',
    trainingDays: [4],
  }))
  vi.stubGlobal('todayIso', () => '2026-10-01')
  vi.stubGlobal('isoWeekday', () => 4)
  vi.stubGlobal('useRuntimeConfig', () => ({ openrouterApiKey: 'test-key' }))
  vi.stubGlobal('findSessionByDate', () => undefined)
  vi.stubGlobal('isDateDismissed', () => false)
  vi.stubGlobal('requestGenerationJob', requestGenerationJob)
  vi.stubGlobal('generationJobForDate', () => null)
  vi.stubGlobal('isGenerating', () => false)

  handler = (await import('../server/api/sessions/today.get')).default as TodayHandler
})

beforeEach(() => {
  onboardingCompleted = false
  requestGenerationJob.mockClear()
})

afterAll(() => {
  vi.unstubAllGlobals()
})

describe('GET /api/sessions/today — frontière onboarding', () => {
  it('ne crée aucun job automatique sur une base vierge avant onboarding', () => {
    expect(handler()).toMatchObject({ onboardingCompleted: false, session: null })
    expect(requestGenerationJob).not.toHaveBeenCalled()
  })

  it('devient éligible immédiatement après le commit de fin d’onboarding', () => {
    onboardingCompleted = true
    expect(handler()).toMatchObject({ onboardingCompleted: true, session: null })
    expect(requestGenerationJob).toHaveBeenCalledOnce()
    expect(requestGenerationJob).toHaveBeenCalledWith('2026-10-01', {
      source: 'automatic',
    })
  })
})
