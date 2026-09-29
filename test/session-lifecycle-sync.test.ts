import { describe, expect, it, vi } from 'vitest'
import {
  createSessionExecutionLifecycle,
  flushPendingSessionLifecycle,
  hasPendingSessionLifecycle,
  queueSessionFinish,
} from '../app/utils/session-lifecycle-sync'

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>()

  get length(): number {
    return this.values.size
  }

  clear(): void {
    this.values.clear()
  }

  getItem(key: string): string | null {
    return this.values.get(key) ?? null
  }

  key(index: number): string | null {
    return [...this.values.keys()][index] ?? null
  }

  removeItem(key: string): void {
    this.values.delete(key)
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value)
  }
}

const DATE = '2026-09-28'

describe('parcours client du cycle de séance', () => {
  it('ouvrir puis quitter sans Lecture ne crée aucun événement', () => {
    const storage = new MemoryStorage()
    createSessionExecutionLifecycle(DATE, { storage })

    expect(hasPendingSessionLifecycle(DATE, storage)).toBe(false)
  })

  it('le premier Lecture seulement met le démarrage en file', async () => {
    const storage = new MemoryStorage()
    const lifecycle = createSessionExecutionLifecycle(DATE, { storage })
    const request = vi.fn().mockResolvedValue({ ok: true })

    expect(lifecycle.start()).toBe(true)
    expect(lifecycle.start()).toBe(false)
    await flushPendingSessionLifecycle(DATE, request, storage)

    expect(request).toHaveBeenCalledOnce()
    expect(request).toHaveBeenCalledWith(`/api/sessions/${DATE}/start`, { method: 'POST' })
  })

  it('finir puis quitter synchronise la clôture sans dépendre du feedback', async () => {
    const storage = new MemoryStorage()
    const lifecycle = createSessionExecutionLifecycle(DATE, { storage })
    const request = vi.fn().mockResolvedValue({ ok: true })

    lifecycle.start()
    expect(lifecycle.finish({ actualDurationSec: 901.4, skippedBlockCount: 2 })).toBe(true)
    await flushPendingSessionLifecycle(DATE, request, storage)

    expect(request.mock.calls).toEqual([
      [`/api/sessions/${DATE}/start`, { method: 'POST' }],
      [
        `/api/sessions/${DATE}/finish`,
        { method: 'POST', body: { actualDurationSec: 901, skippedBlockCount: 2 } },
      ],
    ])
    expect(hasPendingSessionLifecycle(DATE, storage)).toBe(false)
  })

  it('Refaire reste local et ne remplace pas la clôture originale', async () => {
    const storage = new MemoryStorage()
    const lifecycle = createSessionExecutionLifecycle(DATE, { storage })
    const request = vi.fn().mockResolvedValue({ ok: true })

    lifecycle.start()
    lifecycle.finish({ actualDurationSec: 600, skippedBlockCount: 0 })
    lifecycle.restartAsReplay()
    expect(lifecycle.start()).toBe(false)
    expect(lifecycle.finish({ actualDurationSec: 1_200, skippedBlockCount: 4 })).toBe(false)

    await flushPendingSessionLifecycle(DATE, request, storage)
    expect(request).toHaveBeenLastCalledWith(`/api/sessions/${DATE}/finish`, {
      method: 'POST',
      body: { actualDurationSec: 600, skippedBlockCount: 0 },
    })
  })

  it('une clôture hors ligne est envoyée une seule fois lors de reconnexions concurrentes', async () => {
    const storage = new MemoryStorage()
    queueSessionFinish(DATE, { actualDurationSec: 750, skippedBlockCount: 1 }, storage)
    const request = vi.fn().mockResolvedValue({ ok: true })

    await Promise.all([
      flushPendingSessionLifecycle(DATE, request, storage),
      flushPendingSessionLifecycle(DATE, request, storage),
    ])

    expect(request.mock.calls.filter(([url]) => url.endsWith('/finish'))).toHaveLength(1)
    expect(hasPendingSessionLifecycle(DATE, storage)).toBe(false)
  })

  it('conserve la clôture locale tant que le serveur reste indisponible', async () => {
    const storage = new MemoryStorage()
    queueSessionFinish(DATE, { actualDurationSec: 750, skippedBlockCount: 1 }, storage)
    const request = vi
      .fn()
      .mockResolvedValueOnce({ ok: true })
      .mockRejectedValueOnce(new Error('offline'))

    await expect(flushPendingSessionLifecycle(DATE, request, storage)).rejects.toThrow('offline')
    expect(hasPendingSessionLifecycle(DATE, storage)).toBe(true)
  })
})
