import { buildTimerPhases, type TimerPhase } from '~~/shared/timer'
import type { Exercise, WorkoutSession } from '~/utils/session'

/**
 * Passé ce délai, une séance interrompue n'est plus proposée à la reprise :
 * mieux vaut repartir de zéro que ressusciter l'entraînement de la veille.
 */
const RESUME_MAX_AGE_MS = 6 * 60 * 60 * 1000

/** Instantané du timer conservé en localStorage pour survivre à un rechargement. */
interface TimerSnapshot {
  index: number
  remaining: number
  activeSeconds: number
  /** Nombre de phases à la sauvegarde : une régénération de la séance invalide l'instantané. */
  phasesCount: number
  savedAt: number
}

export function useWorkoutTimer(session: WorkoutSession, date?: string) {
  const sound = createSoundPlayer()
  // Les props Vue sont des proxies, que structuredClone refuse. Le contrat séance est 100 % JSON.
  const cloneSession = (value: WorkoutSession): WorkoutSession =>
    JSON.parse(JSON.stringify(value)) as WorkoutSession
  let activeSession = cloneSession(session)
  const phases = reactive<TimerPhase[]>(buildTimerPhases(activeSession))
  const storageKey = import.meta.client && date ? `tanden:timer:${date}` : null

  const index = ref(0)
  const remaining = ref(phases[0]?.seconds ?? 0)
  const running = ref(false)
  const finished = ref(phases.length === 0)
  /** Temps réellement passé à s'entraîner, pauses exclues. Préremplit le feedback. */
  const activeSeconds = ref(0)
  /** Séance interrompue retrouvée au montage ; repasse à `null` dès que l'utilisateur a tranché. */
  const savedSnapshot = ref<TimerSnapshot | null>(null)

  const cumulativeBefore = computed(() =>
    phases.reduce<number[]>((acc, _p, i) => {
      acc[i] = (acc[i - 1] ?? 0) + (i > 0 ? phases[i - 1]!.seconds : 0)
      return acc
    }, []),
  )
  const totalSeconds = computed(() => phases.reduce((acc, p) => acc + p.seconds, 0))

  const current = computed<TimerPhase | null>(() => phases[index.value] ?? null)
  const next = computed<TimerPhase | null>(() => phases[index.value + 1] ?? null)

  /** Retrouve l'exercice source d'une phase (pour afficher son guide). */
  function exerciseOf(phase: TimerPhase | null): Exercise | null {
    if (!phase) return null
    return activeSession.blocks[phase.blockIndex]?.exercises[phase.exerciseIndex] ?? null
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
    if (finished.value) return totalSeconds.value
    if (!c) return 0
    return (cumulativeBefore.value[index.value] ?? 0) + (c.seconds - remaining.value)
  })
  const overallProgress = computed(() =>
    totalSeconds.value ? Math.min(1, elapsedSeconds.value / totalSeconds.value) : 0,
  )

  let endsAt = 0
  let lastTickAt = 0
  let lastPersistAt = 0
  let lastBeepSecond = -1
  let interval: ReturnType<typeof setInterval> | null = null
  let wakeLock: WakeLockSentinel | null = null

  function readSnapshot(): TimerSnapshot | null {
    if (!storageKey) return null
    try {
      const raw = localStorage.getItem(storageKey)
      if (!raw) return null
      const snap = JSON.parse(raw) as TimerSnapshot
      const unusable =
        Date.now() - snap.savedAt > RESUME_MAX_AGE_MS ||
        snap.phasesCount !== phases.length ||
        snap.index < 0 ||
        snap.index >= phases.length
      if (unusable) {
        clearSnapshot()
        return null
      }
      return snap
    } catch {
      return null
    }
  }

  function writeSnapshot() {
    // Rien à sauver tant que la séance n'a pas démarré, ni une fois terminée.
    if (!storageKey || finished.value || activeSeconds.value <= 0) return
    try {
      localStorage.setItem(
        storageKey,
        JSON.stringify({
          index: index.value,
          remaining: remaining.value,
          activeSeconds: activeSeconds.value,
          phasesCount: phases.length,
          savedAt: Date.now(),
        } satisfies TimerSnapshot),
      )
    } catch {
      /* quota dépassé / navigation privée */
    }
  }

  function clearSnapshot() {
    if (!storageKey) return
    try {
      localStorage.removeItem(storageKey)
    } catch {
      /* ignore */
    }
  }

  /** Reprend la séance là où elle s'était arrêtée, en pause : l'utilisateur relance lui-même. */
  function restoreSnapshot() {
    const snap = savedSnapshot.value
    if (!snap) return
    index.value = snap.index
    remaining.value = snap.remaining
    activeSeconds.value = snap.activeSeconds
    finished.value = false
    lastBeepSecond = -1
    savedSnapshot.value = null
  }

  /** Ignore la séance interrompue et repart de zéro. */
  function discardSnapshot() {
    savedSnapshot.value = null
    clearSnapshot()
  }

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
    clearSnapshot()
    sound.end()
  }

  function tick() {
    if (!running.value) return
    const now = performance.now()
    activeSeconds.value += (now - lastTickAt) / 1000
    lastTickAt = now
    remaining.value = Math.max(0, (endsAt - now) / 1000)

    const secLeft = Math.ceil(remaining.value)
    if (secLeft > 0 && secLeft <= 3 && secLeft !== lastBeepSecond) {
      lastBeepSecond = secLeft
      sound.countdown()
    }

    if (now - lastPersistAt >= 1000) {
      lastPersistAt = now
      writeSnapshot()
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
    const now = performance.now()
    running.value = true
    endsAt = now + remaining.value * 1000
    lastTickAt = now
    lastPersistAt = now
    lastBeepSecond = -1
    void requestWakeLock()
    startLoop()
  }
  function pause() {
    if (!running.value) return
    const now = performance.now()
    activeSeconds.value += (now - lastTickAt) / 1000
    remaining.value = Math.max(0, (endsAt - now) / 1000)
    running.value = false
    stopLoop()
    releaseWakeLock()
    writeSnapshot()
  }
  function resume() {
    if (running.value || finished.value) return
    const now = performance.now()
    running.value = true
    endsAt = now + remaining.value * 1000
    lastTickAt = now
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
    writeSnapshot()
  }
  function prev() {
    if (index.value === 0) {
      remaining.value = phases[0]?.seconds ?? 0
    } else {
      enterPhase(index.value - 1)
    }
    if (running.value) endsAt = performance.now() + remaining.value * 1000
    writeSnapshot()
  }
  function reset() {
    finished.value = phases.length === 0
    enterPhase(0)
    remaining.value = phases[0]?.seconds ?? 0
    running.value = false
    activeSeconds.value = 0
    clearSnapshot()
  }
  function stop() {
    if (running.value) activeSeconds.value += (performance.now() - lastTickAt) / 1000
    running.value = false
    stopLoop()
    releaseWakeLock()
    writeSnapshot()
  }

  /** Remplace uniquement la suite du timer après une adaptation persistée côté serveur. */
  function applyAdaptedSession(adapted: WorkoutSession, skipCurrentExercise = false): void {
    const currentIndex = index.value
    const source = current.value
      ? {
          blockIndex: current.value.blockIndex,
          exerciseIndex: current.value.exerciseIndex,
        }
      : null
    const nextPhases = buildTimerPhases(adapted)
    activeSession = cloneSession(adapted)
    phases.splice(0, phases.length, ...nextPhases)

    if (skipCurrentExercise && source) {
      const nextIndex = phases.findIndex(
        (phase, phaseIndex) =>
          phaseIndex > currentIndex &&
          (phase.blockIndex !== source.blockIndex || phase.exerciseIndex !== source.exerciseIndex),
      )
      if (nextIndex < 0) {
        finish()
        return
      }
      enterPhase(nextIndex)
    } else if (index.value >= phases.length) {
      finish()
      return
    }
    writeSnapshot()
  }

  onMounted(() => {
    savedSnapshot.value = readSnapshot()
  })

  onScopeDispose(() => {
    stopLoop()
    releaseWakeLock()
    writeSnapshot()
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
    activeSeconds,
    phaseProgress,
    overallProgress,
    savedSnapshot,
    restoreSnapshot,
    discardSnapshot,
    start,
    pause,
    resume,
    toggle,
    skip,
    prev,
    stop,
    reset,
    applyAdaptedSession,
  }
}
