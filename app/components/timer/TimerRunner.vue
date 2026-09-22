<script setup lang="ts">
import type { WorkoutSession } from '~/utils/session'

const props = defineProps<{ session: WorkoutSession; date: string }>()

const {
  phases,
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
  toggle,
  skip,
  prev,
  stop,
  reset,
  start,
} = useWorkoutTimer(props.session, props.date)

const CIRC = 2 * Math.PI * 100

// Sur mobile le guide est escamoté dans un slideover ; sur desktop il est toujours visible.
const guideOpen = ref(false)

function openGuide(): void {
  guideOpen.value = true
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

onMounted(() => {
  // Marque la séance comme démarrée (best-effort, tolère l'offline).
  $fetch(`/api/sessions/${props.date}/start`, { method: 'POST' }).catch(() => {})
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
  reset()
  start()
}
</script>

<template>
  <!--
    Pas de z-index ici : les overlays Nuxt UI (slideover du guide, drawer du glossaire) sont
    téléportés en fin de <body> sans z-index. Un z-50 sur ce plein écran les masquerait.
    La route timer est en `layout: false` → aucune barre de nav à recouvrir.
  -->
  <div
    class="fixed inset-0 flex flex-col text-white transition-colors duration-500"
    :class="kindStyle.bg"
  >
    <!-- Barre supérieure -->
    <div class="flex items-center justify-between p-4">
      <UButton
        icon="i-lucide-x"
        color="neutral"
        variant="ghost"
        class="text-white/80"
        aria-label="Quitter"
        @click="requestExit"
      />
      <p class="text-xs font-medium uppercase tracking-widest opacity-70">
        {{ current?.blockTitle }}
      </p>
      <div class="w-9" />
    </div>

    <!-- Progression globale -->
    <div class="px-4">
      <div class="h-1 w-full overflow-hidden rounded-full bg-white/10">
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

    <!-- Phase en cours — chrono seul en mobile, chrono + guide côte à côte en ≥ lg -->
    <div v-if="!finished" class="flex min-h-0 flex-1 flex-col lg:flex-row lg:gap-8 lg:px-8 lg:py-4">
      <div class="flex flex-1 flex-col items-center justify-center gap-5 p-4 text-center">
        <p class="text-sm font-bold uppercase tracking-[0.2em]" :class="kindStyle.accent">
          {{ kindStyle.label }}
        </p>

        <div class="relative flex items-center justify-center">
          <svg viewBox="0 0 220 220" class="size-60 -rotate-90 sm:size-64">
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
            <span class="font-mono text-7xl font-bold tabular-nums">{{
              formatClock(remaining)
            }}</span>
            <span v-if="current?.round" class="mt-1 text-sm opacity-70">
              Round {{ current.round }}/{{ current.totalRounds }}
            </span>
          </div>
        </div>

        <div>
          <h2 class="text-2xl font-bold leading-tight">{{ current?.label }}</h2>
          <p v-if="current?.sublabel" class="mt-1 opacity-70">{{ current.sublabel }}</p>
        </div>

        <p v-if="next" class="text-sm opacity-50">
          <UIcon name="i-lucide-arrow-right" class="inline size-3.5 align-[-2px]" />
          Prochain : {{ next.label }}
        </p>

        <!-- Accès au guide en mobile (sur desktop il est affiché en permanence à droite) -->
        <UButton
          icon="i-lucide-book-open"
          color="neutral"
          variant="soft"
          size="sm"
          label="Guide"
          class="lg:hidden"
          @click="openGuide"
        />
      </div>

      <!-- Guide de l'activité en cours (desktop) -->
      <div class="hidden min-h-0 flex-1 items-center lg:flex">
        <div class="max-h-full w-full max-w-[420px] overflow-y-auto">
          <ExerciseGuidePanel :exercise="currentExercise" :next="nextExercise" />
        </div>
      </div>
    </div>

    <!-- Fin de séance -->
    <div v-else class="flex flex-1 flex-col items-center justify-center gap-6 p-6 text-center">
      <UIcon name="i-lucide-party-popper" class="size-16 text-primary" />
      <div>
        <h2 class="text-3xl font-bold">Séance terminée&nbsp;!</h2>
        <p class="mt-2 opacity-70">Durée réelle : {{ formatDuration(activeSeconds) }}</p>
      </div>
      <div class="flex w-full max-w-xs flex-col gap-2">
        <UButton
          block
          size="xl"
          color="primary"
          icon="i-lucide-clipboard-check"
          :to="`/seance/${date}/feedback?duree=${Math.round(activeSeconds)}`"
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

    <!-- Contrôles -->
    <div v-if="!finished" class="flex items-center justify-center gap-8 p-6 pb-10">
      <UButton
        icon="i-lucide-skip-back"
        size="xl"
        color="neutral"
        variant="soft"
        aria-label="Précédent"
        @click="prev"
      />
      <UButton
        :icon="running ? 'i-lucide-pause' : 'i-lucide-play'"
        size="xl"
        color="primary"
        class="size-16 justify-center rounded-full"
        :aria-label="running ? 'Pause' : 'Démarrer'"
        @click="toggle"
      />
      <UButton
        icon="i-lucide-skip-forward"
        size="xl"
        color="neutral"
        variant="soft"
        aria-label="Suivant"
        @click="skip"
      />
    </div>

    <!-- Guide escamotable (mobile) -->
    <USlideover
      v-model:open="guideOpen"
      side="bottom"
      title="Guide de l'exercice"
      :ui="{ content: 'max-h-[85dvh]' }"
    >
      <template #body>
        <ExerciseGuidePanel :exercise="currentExercise" :next="nextExercise" />
      </template>
    </USlideover>

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
    >
      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <UButton color="neutral" variant="ghost" @click="continueSession"> Continuer </UButton>
          <UButton color="primary" icon="i-lucide-log-out" @click="exit">Quitter</UButton>
        </div>
      </template>
    </UModal>

    <!-- La route timer n'a pas de layout : on monte le drawer du glossaire ici. -->
    <GlossaryDrawer />
  </div>
</template>
