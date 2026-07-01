import type { WorkoutSession } from '~/utils/session'

export type PhaseKind = 'prepare' | 'work' | 'rest'

export interface TimerPhase {
  kind: PhaseKind
  seconds: number
  label: string
  sublabel?: string
  blockTitle: string
  category?: string
  round?: number
  totalRounds?: number
}

const PREPARE_SECONDS = 10

function buildPhases(session: WorkoutSession): TimerPhase[] {
  const phases: TimerPhase[] = []

  for (const block of session.blocks) {
    block.exercises.forEach((ex) => {
      phases.push({
        kind: 'prepare',
        seconds: PREPARE_SECONDS,
        label: ex.name,
        sublabel: ex.combo ? `${ex.combo} — ${comboToText(ex.combo)}` : block.title,
        blockTitle: block.title,
        category: ex.category,
      })

      for (let r = 1; r <= ex.intervals.rounds; r++) {
        phases.push({
          kind: 'work',
          seconds: ex.intervals.work,
          label: ex.name,
          sublabel: ex.combo ? `${ex.combo} — ${comboToText(ex.combo)}` : undefined,
          blockTitle: block.title,
          category: ex.category,
          round: r,
          totalRounds: ex.intervals.rounds,
        })

        if (r < ex.intervals.rounds && ex.intervals.rest > 0) {
          phases.push({
            kind: 'rest',
            seconds: ex.intervals.rest,
            label: 'Repos',
            sublabel: `${ex.name} — round ${r + 1}/${ex.intervals.rounds}`,
            blockTitle: block.title,
          })
        }
      }

      if (ex.restAfterSec > 0) {
        phases.push({
          kind: 'rest',
          seconds: ex.restAfterSec,
          label: 'Repos',
          sublabel: 'Exercice suivant',
          blockTitle: block.title,
        })
      }
    })
  }

  // Pas de repos traînant en fin de séance.
  while (phases.length && phases[phases.length - 1]!.kind === 'rest') phases.pop()
  return phases
}

export function useWorkoutTimer(session: WorkoutSession) {
  const sound = createSoundPlayer()
  const phases = buildPhases(session)

  const index = ref(0)
  const remaining = ref(phases[0]?.seconds ?? 0)
  const running = ref(false)
  const finished = ref(phases.length === 0)

  const cumulativeBefore = phases.reduce<number[]>((acc, p, i) => {
    acc[i] = (acc[i - 1] ?? 0) + (i > 0 ? phases[i - 1]!.seconds : 0)
    return acc
  }, [])
  const totalSeconds = phases.reduce((acc, p) => acc + p.seconds, 0)

  const current = computed<TimerPhase | null>(() => phases[index.value] ?? null)
  const next = computed<TimerPhase | null>(() => phases[index.value + 1] ?? null)
  const phaseProgress = computed(() => {
    const c = current.value
    if (!c || c.seconds === 0) return 0
    return Math.min(1, Math.max(0, 1 - remaining.value / c.seconds))
  })
  const elapsedSeconds = computed(() => {
    const c = current.value
    if (finished.value) return totalSeconds
    if (!c) return 0
    return (cumulativeBefore[index.value] ?? 0) + (c.seconds - remaining.value)
  })
  const overallProgress = computed(() =>
    totalSeconds ? Math.min(1, elapsedSeconds.value / totalSeconds) : 0,
  )

  let endsAt = 0
  let lastBeepSecond = -1
  let interval: ReturnType<typeof setInterval> | null = null
  let wakeLock: WakeLockSentinel | null = null

  async function requestWakeLock() {
    try {
      if ('wakeLock' in navigator) {
        wakeLock = await navigator.wakeLock.request('screen')
      }
    } catch {
      /* non supporté / refusé */
    }
  }
  function releaseWakeLock() {
    try {
      void wakeLock?.release()
    } catch {
      /* ignore */
    }
    wakeLock = null
  }

  function enterPhase(i: number) {
    index.value = i
    const phase = phases[i]
    if (!phase) return
    remaining.value = phase.seconds
    lastBeepSecond = -1
    if (phase.kind === 'work') sound.start()
    else sound.rest()
  }

  function advance() {
    if (index.value + 1 >= phases.length) {
      finish()
      return
    }
    enterPhase(index.value + 1)
    endsAt = performance.now() + remaining.value * 1000
  }

  function finish() {
    finished.value = true
    running.value = false
    remaining.value = 0
    stopLoop()
    releaseWakeLock()
    sound.end()
  }

  function tick() {
    if (!running.value) return
    const now = performance.now()
    remaining.value = Math.max(0, (endsAt - now) / 1000)

    const secLeft = Math.ceil(remaining.value)
    if (secLeft > 0 && secLeft <= 3 && secLeft !== lastBeepSecond) {
      lastBeepSecond = secLeft
      sound.countdown()
    }

    if (remaining.value <= 0.02) advance()
  }

  function startLoop() {
    stopLoop()
    interval = setInterval(tick, 100)
  }
  function stopLoop() {
    if (interval) clearInterval(interval)
    interval = null
  }

  function start() {
    sound.unlock()
    if (finished.value) reset()
    running.value = true
    endsAt = performance.now() + remaining.value * 1000
    lastBeepSecond = -1
    void requestWakeLock()
    startLoop()
  }
  function pause() {
    if (!running.value) return
    remaining.value = Math.max(0, (endsAt - performance.now()) / 1000)
    running.value = false
    stopLoop()
    releaseWakeLock()
  }
  function resume() {
    if (running.value || finished.value) return
    running.value = true
    endsAt = performance.now() + remaining.value * 1000
    void requestWakeLock()
    startLoop()
  }
  function toggle() {
    if (running.value) pause()
    else start()
  }
  function skip() {
    if (index.value + 1 >= phases.length) {
      finish()
      return
    }
    enterPhase(index.value + 1)
    if (running.value) endsAt = performance.now() + remaining.value * 1000
  }
  function prev() {
    if (index.value === 0) {
      remaining.value = phases[0]?.seconds ?? 0
    } else {
      enterPhase(index.value - 1)
    }
    if (running.value) endsAt = performance.now() + remaining.value * 1000
  }
  function reset() {
    finished.value = phases.length === 0
    enterPhase(0)
    remaining.value = phases[0]?.seconds ?? 0
    running.value = false
  }
  function stop() {
    running.value = false
    stopLoop()
    releaseWakeLock()
  }

  onScopeDispose(() => {
    stopLoop()
    releaseWakeLock()
  })

  return {
    phases,
    index,
    remaining,
    running,
    finished,
    current,
    next,
    totalSeconds,
    elapsedSeconds,
    phaseProgress,
    overallProgress,
    start,
    pause,
    resume,
    toggle,
    skip,
    prev,
    stop,
    reset,
  }
}
