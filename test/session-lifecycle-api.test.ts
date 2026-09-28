import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

type Event = { date?: string; id?: string; body?: unknown }
type Handler = (event: Event) => Promise<unknown> | unknown

let generateHandler: Handler
let adjustHandler: Handler
let rescheduleHandler: Handler
let finishHandler: Handler

const findSessionByDate = vi.fn()
const requestGenerationJob = vi.fn()
const triggerGeneration = vi.fn()
const undismissDate = vi.fn()
const rescheduleSession = vi.fn()
const finishSession = vi.fn()

beforeAll(async () => {
  vi.stubGlobal('defineEventHandler', (handler: Handler) => handler)
  vi.stubGlobal('getRouterParam', (event: Event, name: string) =>
    name === 'date' ? event.date : event.id,
  )
  vi.stubGlobal('readBody', async (event: Event) => event.body)
  vi.stubGlobal(
    'createError',
    ({ statusCode, statusMessage }: { statusCode: number; statusMessage: string }) =>
      Object.assign(new Error(statusMessage), { statusCode, statusMessage }),
  )
  vi.stubGlobal('findSessionByDate', findSessionByDate)
  vi.stubGlobal('requestGenerationJob', requestGenerationJob)
  vi.stubGlobal('triggerGeneration', triggerGeneration)
  vi.stubGlobal('undismissDate', undismissDate)
  vi.stubGlobal('rescheduleSession', rescheduleSession)
  vi.stubGlobal('finishSession', finishSession)
  vi.stubGlobal('getSettings', () => ({ timezone: 'Europe/Paris' }))
  vi.stubGlobal('todayIso', () => '2026-09-28')
  vi.stubGlobal('isGenerating', () => false)
  vi.stubGlobal('findLatestGenerationJob', () => undefined)
  vi.stubGlobal('toPublicGenerationJob', (job: unknown) => job)
  vi.stubGlobal('useRuntimeConfig', () => ({ anthropicApiKey: '' }))

  generateHandler = (await import('../server/api/sessions/generate.post')).default as Handler
  adjustHandler = (await import('../server/api/sessions/[date]/adjust.post')).default as Handler
  rescheduleHandler = (await import('../server/api/sessions/[date]/reschedule.post'))
    .default as Handler
  finishHandler = (await import('../server/api/sessions/[date]/finish.post')).default as Handler
})

beforeEach(() => {
  vi.clearAllMocks()
  findSessionByDate.mockReturnValue({ id: 1, date: '2026-09-28', status: 'completed' })
})

describe('protections API des états terminaux', () => {
  it('répond 409 avant toute régénération', async () => {
    await expect(
      generateHandler({ body: { date: '2026-09-28', regenerate: true } }),
    ).rejects.toMatchObject({ statusCode: 409 })
    expect(undismissDate).not.toHaveBeenCalled()
    expect(requestGenerationJob).not.toHaveBeenCalled()
  })

  it("répond 409 à l'ajustement, même sans clé fournisseur", async () => {
    await expect(
      adjustHandler({ date: '2026-09-28', body: { instruction: 'plus court' } }),
    ).rejects.toMatchObject({ statusCode: 409 })
    expect(triggerGeneration).not.toHaveBeenCalled()
  })

  it('propage le 409 du report sans lancer de mutation secondaire', async () => {
    rescheduleSession.mockImplementation(() => {
      throw Object.assign(new Error('terminal'), { statusCode: 409 })
    })

    await expect(
      rescheduleHandler({ date: '2026-09-28', body: { newDate: '2026-09-29' } }),
    ).rejects.toMatchObject({ statusCode: 409 })
    expect(rescheduleSession).toHaveBeenCalledOnce()
  })

  it('valide puis transmet les métriques de clôture au service idempotent', async () => {
    finishSession.mockReturnValue({ status: 'completed' })

    await expect(
      finishHandler({
        date: '2026-09-28',
        body: { actualDurationSec: 600, skippedBlockCount: 2 },
      }),
    ).resolves.toEqual({ status: 'completed' })
    expect(finishSession).toHaveBeenCalledWith('2026-09-28', {
      actualDurationSec: 600,
      skippedBlockCount: 2,
    })
  })
})
