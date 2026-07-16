import { buildTimerPhases, type TimerPhase } from '~~/shared/timer'
import type { Exercise, WorkoutSession } from '~/utils/session'

export function useWorkoutTimer(session: WorkoutSession) {
  const sound = createSoundPlayer()
  const phases = buildTimerPhases(session)

  const index = ref(0)
  const remaining = ref(phases[0]?.seconds ?? 0)
  const running = ref(false)
  const finished = ref(phases.length === 0)

  const cumulativeBefore = phases.reduce<number[]>((acc, _p, i) => {
    acc[i] = (acc[i - 1] ?? 0) + (i > 0 ? phases[i - 1]!.seconds : 0)
    return acc
  }, [])
  const totalSeconds = phases.reduce((acc, p) => acc + p.seconds, 0)

  const current = computed<TimerPhase | null>(() => phases[index.value] ?? null)
  const next = computed<TimerPhase | null>(() => phases[index.value + 1] ?? null)

  /** Retrouve l'exercice source d'une phase (pour afficher son guide). */
  function exerciseOf(phase: TimerPhase | null): Exercise | null {
    if (!phase) return null
    return session.blocks[phase.blockIndex]?.exercises[phase.exerciseIndex] ?? null
  }
  const currentExercise = computed<Exercise | null>(() => exerciseOf(current.value))
  const nextExercise = computed<Exercise | null>(() => exerciseOf(next.value))
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
    currentExercise,
    nextExercise,
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
