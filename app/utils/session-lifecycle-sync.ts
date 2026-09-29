export interface PendingSessionFinish {
  actualDurationSec: number
  skippedBlockCount: number
}

interface PendingSessionLifecycle {
  date: string
  phase: 'start' | 'finish'
  finish: PendingSessionFinish | null
  queuedAt: number
}

export type SessionLifecycleRequest = (
  url: string,
  options: { method: 'POST'; body?: PendingSessionFinish },
) => Promise<unknown>

const STORAGE_PREFIX = 'tanden:session-lifecycle:'
const inFlight = new Map<string, Promise<boolean>>()

function storageKey(date: string): string {
  return `${STORAGE_PREFIX}${date}`
}

function readPending(date: string, storage: Storage): PendingSessionLifecycle | null {
  const raw = storage.getItem(storageKey(date))
  if (!raw) return null
  try {
    const pending = JSON.parse(raw) as PendingSessionLifecycle
    if (
      pending.date !== date ||
      (pending.phase !== 'start' && pending.phase !== 'finish') ||
      (pending.phase === 'finish' && !pending.finish)
    ) {
      storage.removeItem(storageKey(date))
      return null
    }
    return pending
  } catch {
    storage.removeItem(storageKey(date))
    return null
  }
}

function writePending(pending: PendingSessionLifecycle, storage: Storage): void {
  storage.setItem(storageKey(pending.date), JSON.stringify(pending))
}

export function queueSessionStart(date: string, storage: Storage = localStorage): void {
  const existing = readPending(date, storage)
  if (existing?.phase === 'finish') return
  writePending({ date, phase: 'start', finish: null, queuedAt: Date.now() }, storage)
}

export function queueSessionFinish(
  date: string,
  finish: PendingSessionFinish,
  storage: Storage = localStorage,
): void {
  writePending(
    {
      date,
      phase: 'finish',
      finish: {
        actualDurationSec: Math.max(0, Math.round(finish.actualDurationSec)),
        skippedBlockCount: Math.max(0, Math.round(finish.skippedBlockCount)),
      },
      queuedAt: Date.now(),
    },
    storage,
  )
}

function pendingDates(storage: Storage): string[] {
  const dates: string[] = []
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index)
    if (key?.startsWith(STORAGE_PREFIX)) dates.push(key.slice(STORAGE_PREFIX.length))
  }
  return dates
}

async function flushDate(
  date: string,
  request: SessionLifecycleRequest,
  storage: Storage,
): Promise<boolean> {
  const pending = readPending(date, storage)
  if (!pending) return false
  const serialized = JSON.stringify(pending)

  // Une clôture restée hors ligne rejoue d'abord le démarrage. Les deux endpoints sont idempotents.
  await request(`/api/sessions/${date}/start`, { method: 'POST' })
  if (pending.phase === 'finish' && pending.finish) {
    await request(`/api/sessions/${date}/finish`, {
      method: 'POST',
      body: pending.finish,
    })
  }

  // Ne supprime jamais une clôture plus récente écrite pendant la requête de démarrage.
  if (storage.getItem(storageKey(date)) === serialized) storage.removeItem(storageKey(date))
  return true
}

export function flushPendingSessionLifecycle(
  date?: string,
  request: SessionLifecycleRequest = $fetch,
  storage: Storage = localStorage,
): Promise<boolean[]> {
  const dates = date ? [date] : pendingDates(storage)
  return Promise.all(
    dates.map(async (pendingDate) => {
      const current = inFlight.get(pendingDate)
      if (current) {
        await current
        return flushPendingSessionLifecycle(pendingDate, request, storage).then(
          ([flushed]) => flushed ?? false,
        )
      }

      const promise = flushDate(pendingDate, request, storage).finally(() => {
        inFlight.delete(pendingDate)
      })
      inFlight.set(pendingDate, promise)
      return promise
    }),
  )
}

export function hasPendingSessionLifecycle(date: string, storage: Storage = localStorage): boolean {
  return readPending(date, storage) !== null
}

/** Petit automate client testable : ouvrir/fermer ne produit rien, Refaire bascule en lecture locale. */
export function createSessionExecutionLifecycle(
  date: string,
  options: { replay?: boolean; started?: boolean; storage?: Storage } = {},
) {
  const storage = options.storage
  let started = options.started ?? false
  let replay = options.replay ?? false

  return {
    start(): boolean {
      if (replay || started) return false
      started = true
      queueSessionStart(date, storage ?? localStorage)
      return true
    },
    finish(payload: PendingSessionFinish): boolean {
      if (replay || !started) return false
      queueSessionFinish(date, payload, storage ?? localStorage)
      return true
    },
    restartAsReplay(): void {
      replay = true
    },
    get replay(): boolean {
      return replay
    },
    get started(): boolean {
      return started
    },
  }
}
