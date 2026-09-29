<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { BODY_AREA_OPTIONS, type BodyArea } from '~~/shared/session-autoregulation'
import { formatClock, formatDuration } from '~/utils/format'
import type { WorkoutSession } from '~/utils/session'
import {
  createSessionExecutionLifecycle,
  flushPendingSessionLifecycle,
} from '~/utils/session-lifecycle-sync'

const props = defineProps<{
  session: WorkoutSession
  date: string
  initialSafetyNotice?: string | null
  replay?: boolean
  started?: boolean
}>()

const {
  activeSession,
  phases,
  remaining,
  running,
  finished,
  current,
  next,
  nextExercise,
  guideExercise,
  totalSeconds,
  elapsedSeconds,
  activeSeconds,
  skippedBlockCount,
  phaseProgress,
  overallProgress,
  savedSnapshot,
  restoreSnapshot,
  discardSnapshot,
  toggle: toggleTimerState,
  pause,
  skip,
  prev,
  stop,
  reset,
  start,
  applyAdaptedSession,
} = useWorkoutTimer(props.session, props.date)

const CIRC = 2 * Math.PI * 100

const painOpen = ref(false)
const painLocations = ref<BodyArea[]>([])
const adaptingAction = ref<'too_hard' | 'too_easy' | 'pain' | null>(null)
const safetyNotice = ref(props.initialSafetyNotice ?? null)
const safetyOpen = ref(Boolean(props.initialSafetyNotice))
const toast = useToast()
const replayMode = ref(props.replay ?? false)
const sessionStarted = ref(props.started ?? false)
const executionLifecycle = createSessionExecutionLifecycle(props.date, {
  replay: props.replay,
  started: props.started,
})

function errorMessage(error: unknown): string {
  if (!error || typeof error !== 'object') return 'Erreur inconnue'
  const candidate = error as { data?: { statusMessage?: unknown }; message?: unknown }
  if (typeof candidate.data?.statusMessage === 'string') return candidate.data.statusMessage
  if (typeof candidate.message === 'string') return candidate.message
  return 'Erreur inconnue'
}

// Séance interrompue (rechargement, crash, appel entrant) : on laisse l'utilisateur trancher.
const resumeAt = computed(() => {
  const snap = savedSnapshot.value
  if (!snap) return null
  return {
    label: phases[snap.index]?.label ?? 'la séance',
    done: formatDuration(snap.activeSeconds),
  }
})

const kindStyle = computed(() => {
  if (finished.value)
    return { bg: 'bg-zinc-950', accent: 'text-zinc-300', ring: 'stroke-zinc-400', label: 'Terminé' }
  switch (current.value?.kind) {
    case 'work':
      return { bg: 'bg-red-950', accent: 'text-red-400', ring: 'stroke-red-500', label: 'Effort' }
    case 'rest':
      return {
        bg: 'bg-emerald-950',
        accent: 'text-emerald-400',
        ring: 'stroke-emerald-500',
        label: 'Repos',
      }
    case 'prepare':
      return {
        bg: 'bg-amber-950',
        accent: 'text-amber-400',
        ring: 'stroke-amber-500',
        label: 'Prépare-toi',
      }
    default:
      return { bg: 'bg-zinc-950', accent: 'text-zinc-300', ring: 'stroke-zinc-400', label: '' }
  }
})

function syncLifecycle(): void {
  void flushPendingSessionLifecycle(props.date).catch(() => {
    // La file locale sera rejouée par le plugin au retour du réseau.
  })
}

/** Le montage reste en lecture seule : seul le premier vrai appui sur Lecture démarre la séance. */
function toggleTimer(): void {
  if (!running.value && !finished.value && executionLifecycle.start()) {
    sessionStarted.value = true
    syncLifecycle()
  }
  toggleTimerState()
}

watch(finished, (isFinished, wasFinished) => {
  if (!isFinished || wasFinished) return
  if (
    executionLifecycle.finish({
      actualDurationSec: activeSeconds.value,
      skippedBlockCount: skippedBlockCount.value,
    })
  ) {
    syncLifecycle()
  }
})

const confirmExitOpen = ref(false)

function continueSession(): void {
  confirmExitOpen.value = false
}

/** Une séance entamée ne se quitte pas sur une mauvaise tape — mais l'état reste repris. */
function requestExit() {
  if (finished.value || activeSeconds.value <= 0) {
    exit()
    return
  }
  confirmExitOpen.value = true
}
function exit() {
  stop()
  navigateTo('/')
}
function restart() {
  // Une répétition est un entraînement local : elle ne réouvre ni ne réécrit l'historique clôturé.
  executionLifecycle.restartAsReplay()
  replayMode.value = true
  reset()
  start()
}

function togglePainLocation(location: BodyArea): void {
  const index = painLocations.value.indexOf(location)
  if (index >= 0) painLocations.value.splice(index, 1)
  else painLocations.value.push(location)
}

async function adapt(action: 'too_hard' | 'too_easy' | 'pain'): Promise<void> {
  const phase = current.value
  if (!phase || adaptingAction.value) return
  pause()
  adaptingAction.value = action
  try {
    const result = await $fetch<{
      session: { structure: WorkoutSession }
      adaptation: { changes: unknown[] }
      safetyNotice: string | null
    }>(`/api/sessions/${props.date}/adapt`, {
      method: 'POST',
      body: {
        action,
        cursor: { blockIndex: phase.blockIndex, exerciseIndex: phase.exerciseIndex },
        painLocations: action === 'pain' ? painLocations.value : [],
      },
    })
    applyAdaptedSession(result.session.structure, action === 'pain')
    painOpen.value = false
    painLocations.value = []
    if (result.safetyNotice) {
      safetyNotice.value = result.safetyNotice
      safetyOpen.value = true
    }
    toast.add({
      title:
        action === 'too_hard'
          ? 'Suite allégée'
          : action === 'too_easy'
            ? 'Suite intensifiée'
            : 'Mouvements incompatibles retirés',
      description: `${result.adaptation.changes.length} changement(s) appliqué(s) à la suite uniquement.`,
      color: action === 'pain' ? 'warning' : 'success',
      icon: action === 'pain' ? 'i-lucide-shield-alert' : 'i-lucide-check',
    })
  } catch (error: unknown) {
    toast.add({
      title: "L'adaptation a échoué",
      description: errorMessage(error),
      color: 'error',
      icon: 'i-lucide-triangle-alert',
    })
  } finally {
    adaptingAction.value = null
  }
}

function requestPainAdaptation(): void {
  pause()
  painOpen.value = true
}

function closePainDialog(): void {
  painOpen.value = false
}

function acknowledgeSafetyNotice(): void {
  safetyOpen.value = false
}
</script>

<template>
  <!--
    Pas de z-index ici : les overlays Nuxt UI (surfaces Détails/Adapter, drawer du glossaire) sont
    téléportés en fin de <body>. Un z-50 sur ce plein écran les masquerait.
    La route timer est en `layout: false` → aucune barre de nav à recouvrir.
  -->
  <div
    class="timer-shell fixed inset-0 flex flex-col overflow-x-hidden text-white"
    :class="kindStyle.bg"
  >
    <!-- Barre supérieure -->
    <div class="timer-header flex shrink-0 items-center justify-between px-3 py-2 sm:px-4 sm:py-3">
      <UButton
        icon="i-lucide-x"
        color="neutral"
        variant="ghost"
        class="min-h-11 min-w-11 justify-center text-white/80 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
        aria-label="Quitter"
        @click="requestExit"
      />
      <p class="min-w-0 truncate px-2 text-xs font-medium uppercase tracking-widest opacity-70">
        {{ current?.blockTitle }}
      </p>
      <div class="w-11 shrink-0" aria-hidden="true" />
    </div>

    <!-- Progression globale -->
    <div class="shrink-0 px-3 sm:px-4">
      <div
        class="h-1 w-full overflow-hidden rounded-full bg-white/10"
        role="progressbar"
        aria-label="Progression de la séance"
        aria-valuemin="0"
        aria-valuemax="100"
        :aria-valuenow="Math.round(overallProgress * 100)"
      >
        <div
          class="h-full bg-white/70 transition-all duration-300"
          :style="{ width: overallProgress * 100 + '%' }"
        />
      </div>
      <div class="mt-1 flex justify-between text-[11px] opacity-60">
        <span>{{ formatClock(elapsedSeconds) }}</span>
        <span>{{ formatClock(totalSeconds) }}</span>
      </div>
    </div>

    <!-- La zone centrale peut défiler ; le dock reste un frère stable et ne la recouvre jamais. -->
    <main v-if="!finished" class="timer-main min-h-0 flex-1 overflow-y-auto overscroll-contain">
      <div class="timer-stage flex min-h-full flex-col items-center justify-center text-center">
        <p class="text-sm font-bold uppercase tracking-[0.2em]" :class="kindStyle.accent">
          {{ kindStyle.label }}
        </p>

        <div class="relative flex items-center justify-center">
          <svg viewBox="0 0 220 220" class="timer-dial -rotate-90" aria-hidden="true">
            <circle
              cx="110"
              cy="110"
              r="100"
              fill="none"
              class="stroke-white/10"
              stroke-width="10"
            />
            <circle
              cx="110"
              cy="110"
              r="100"
              fill="none"
              :class="kindStyle.ring"
              stroke-width="10"
              stroke-linecap="round"
              :stroke-dasharray="CIRC"
              :stroke-dashoffset="CIRC * (1 - phaseProgress)"
              style="transition: stroke-dashoffset 0.2s linear"
            />
          </svg>
          <div class="absolute flex flex-col items-center">
            <span class="timer-clock font-mono font-bold tabular-nums">{{
              formatClock(remaining)
            }}</span>
            <span v-if="current?.round" class="mt-1 text-sm opacity-70">
              Round {{ current.round }}/{{ current.totalRounds }}
            </span>
          </div>
        </div>

        <div>
          <h2 class="text-pretty break-words text-2xl font-bold leading-tight">
            {{ current?.label }}
          </h2>
          <p v-if="current?.sublabel" class="mt-1 break-words opacity-70">
            {{ current.sublabel }}
          </p>
        </div>

        <p v-if="next" class="break-words text-sm opacity-50">
          <UIcon
            name="i-lucide-arrow-right"
            class="inline size-3.5 align-[-2px]"
            aria-hidden="true"
          />
          Prochain : {{ next.label }}
        </p>
      </div>
    </main>

    <!-- Fin de séance -->
    <main
      v-else
      class="min-h-0 flex-1 overflow-y-auto overscroll-contain"
      aria-labelledby="timer-finished-title"
    >
      <div class="flex min-h-full flex-col items-center justify-center gap-6 p-6 text-center">
        <UIcon name="i-lucide-party-popper" class="size-16 text-primary" aria-hidden="true" />
        <div>
          <h2 id="timer-finished-title" class="text-3xl font-bold">Séance terminée&nbsp;!</h2>
          <p class="mt-2 opacity-70">Durée réelle : {{ formatDuration(activeSeconds) }}</p>
          <p v-if="replayMode" class="mt-1 text-sm opacity-60">
            Répétition locale — l’historique terminé reste inchangé.
          </p>
        </div>
        <div class="flex w-full max-w-xs flex-col gap-2">
          <UButton
            v-if="!replayMode && sessionStarted"
            block
            size="xl"
            color="primary"
            icon="i-lucide-clipboard-check"
            :to="`/seance/${date}/feedback?duree=${Math.round(activeSeconds)}&blocsIgnores=${skippedBlockCount}`"
          >
            Noter la séance
          </UButton>
          <UButton block color="neutral" variant="soft" icon="i-lucide-rotate-ccw" @click="restart">
            Refaire
          </UButton>
          <UButton block color="neutral" variant="ghost" class="text-white/70" @click="exit">
            Quitter
          </UButton>
        </div>
      </div>
    </main>

    <TimerControls
      v-if="!finished"
      :running="running"
      :replay-mode="replayMode"
      :adapting-action="adaptingAction"
      :session="activeSession"
      :guide-exercise="guideExercise"
      :next-exercise="nextExercise"
      :current-block-index="current?.blockIndex ?? null"
      :current-exercise-index="current?.exerciseIndex ?? null"
      @previous="prev"
      @toggle="toggleTimer"
      @next="skip"
      @adapt="adapt"
      @pain="requestPainAdaptation"
    />

    <!-- Reprise d'une séance interrompue — pas d'échappatoire : il faut choisir. -->
    <UModal
      :open="resumeAt !== null"
      :dismissible="false"
      :close="false"
      title="Reprendre ta séance ?"
      :description="`Tu t'étais arrêté sur « ${resumeAt?.label} », après ${resumeAt?.done} d'effort.`"
    >
      <template #footer>
        <div class="flex w-full flex-col gap-2">
          <UButton block color="primary" icon="i-lucide-play" @click="restoreSnapshot">
            Reprendre où j'en étais
          </UButton>
          <UButton block color="neutral" variant="soft" @click="discardSnapshot">
            Recommencer depuis le début
          </UButton>
        </div>
      </template>
    </UModal>

    <!-- Sortie en cours de séance. -->
    <UModal
      v-model:open="confirmExitOpen"
      title="Quitter la séance ?"
      description="Ta progression est gardée : tu pourras reprendre où tu en es en revenant."
      :ui="{ close: 'min-h-11 min-w-11' }"
    >
      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <UButton color="neutral" variant="ghost" @click="continueSession"> Continuer </UButton>
          <UButton color="primary" icon="i-lucide-log-out" @click="exit">Quitter</UButton>
        </div>
      </template>
    </UModal>

    <UModal
      v-model:open="painOpen"
      title="Où ressens-tu la douleur ?"
      description="Le mouvement courant sera arrêté et les mouvements incompatibles seront retirés uniquement de la suite."
      :ui="{ close: 'min-h-11 min-w-11' }"
    >
      <template #body>
        <div class="flex flex-wrap gap-2">
          <button
            v-for="area in BODY_AREA_OPTIONS"
            :key="area.value"
            type="button"
            class="min-h-11 rounded-full border px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            :class="
              painLocations.includes(area.value)
                ? 'border-error bg-error/15 text-error'
                : 'border-default text-muted'
            "
            @click="togglePainLocation(area.value)"
          >
            {{ area.label }}
          </button>
        </div>
        <p class="mt-3 text-xs text-amber-300">
          Arrête le mouvement douloureux. Cette action adapte la séance mais ne fournit aucun
          diagnostic médical.
        </p>
      </template>
      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <UButton color="neutral" variant="ghost" @click="closePainDialog">Annuler</UButton>
          <UButton
            color="warning"
            icon="i-lucide-shield-alert"
            :loading="adaptingAction === 'pain'"
            :disabled="painLocations.length === 0"
            @click="adapt('pain')"
          >
            Adapter la suite
          </UButton>
        </div>
      </template>
    </UModal>

    <UModal
      v-model:open="safetyOpen"
      :dismissible="false"
      :close="false"
      title="Consigne de prudence"
      :description="safetyNotice ?? undefined"
    >
      <template #footer>
        <UButton block color="warning" icon="i-lucide-check" @click="acknowledgeSafetyNotice">
          J’ai compris
        </UButton>
      </template>
    </UModal>

    <!-- La route timer n'a pas de layout : on monte le drawer du glossaire ici. -->
    <GlossaryDrawer />
  </div>
</template>

<style scoped>
.timer-shell {
  --timer-dial-size: clamp(144px, min(58vw, 36dvh), 256px);
  height: 100dvh;
  padding-top: env(safe-area-inset-top);
  padding-right: env(safe-area-inset-right);
  padding-left: env(safe-area-inset-left);
  transition: background-color 500ms;
}

.timer-stage {
  gap: clamp(0.625rem, 2.2dvh, 1.25rem);
  padding: clamp(0.625rem, 2dvh, 1rem);
}

.timer-dial {
  width: var(--timer-dial-size);
  height: var(--timer-dial-size);
}

.timer-clock {
  font-size: clamp(2.75rem, min(18vw, 9dvh), 4.5rem);
  line-height: 1;
}

.timer-main {
  scroll-padding-block: 1rem;
}

@media (max-height: 700px), (orientation: landscape) {
  .timer-shell {
    --timer-dial-size: clamp(116px, min(34vw, 29dvh), 176px);
  }

  .timer-header {
    padding-top: 0.25rem;
    padding-bottom: 0.25rem;
  }

  .timer-stage {
    gap: clamp(0.375rem, 1.4dvh, 0.75rem);
    padding-top: 0.375rem;
    padding-bottom: 0.375rem;
  }

  .timer-clock {
    font-size: clamp(2.25rem, min(14vw, 8dvh), 3.5rem);
  }
}

@media (orientation: landscape) and (max-height: 568px) {
  .timer-stage {
    display: grid;
    grid-template-columns: minmax(0, 0.8fr) minmax(0, 1.2fr);
    grid-template-rows: auto auto auto;
    column-gap: clamp(1rem, 5vw, 3rem);
    max-width: 58rem;
    margin-inline: auto;
    text-align: left;
  }

  .timer-stage > p:first-child,
  .timer-stage > div:not(.relative),
  .timer-stage > p:last-child {
    grid-column: 2;
  }

  .timer-stage > .relative {
    grid-column: 1;
    grid-row: 1 / span 3;
  }
}
</style>
