<script setup lang="ts">
import { nextTick, ref } from 'vue'
import type { Exercise, WorkoutSession } from '~/utils/session'

type AdaptationAction = 'too_hard' | 'too_easy' | 'pain'
type DetailsTab = 'exercise' | 'session'

defineProps<{
  running: boolean
  replayMode: boolean
  adaptingAction: AdaptationAction | null
  session: WorkoutSession
  guideExercise: Exercise | null
  nextExercise: Exercise | null
  currentBlockIndex: number | null
  currentExerciseIndex: number | null
}>()

const emit = defineEmits<{
  previous: []
  toggle: []
  next: []
  adapt: [action: 'too_hard' | 'too_easy']
  pain: []
}>()

const detailsOpen = ref(false)
const adapterOpen = ref(false)
const detailsTab = ref<DetailsTab>('exercise')

function openDetails(): void {
  detailsOpen.value = true
}

function openAdapter(): void {
  adapterOpen.value = true
}

function requestAdaptation(action: 'too_hard' | 'too_easy'): void {
  adapterOpen.value = false
  emit('adapt', action)
}

function requestPainAdaptation(): void {
  adapterOpen.value = false
  emit('pain')
}

function handleDetailsTabKeydown(event: KeyboardEvent): void {
  const nextTab =
    event.key === 'ArrowLeft' || event.key === 'ArrowRight'
      ? detailsTab.value === 'exercise'
        ? 'session'
        : 'exercise'
      : event.key === 'Home'
        ? 'exercise'
        : event.key === 'End'
          ? 'session'
          : null
  if (!nextTab) return
  event.preventDefault()
  detailsTab.value = nextTab
  void nextTick(() => document.getElementById(`timer-details-${nextTab}-tab`)?.focus())
}
</script>

<template>
  <footer class="timer-control-dock" aria-label="Commandes du minuteur">
    <div class="timer-secondary-actions" aria-label="Actions de séance">
      <UButton
        block
        icon="i-lucide-list-tree"
        label="Détails"
        color="neutral"
        variant="ghost"
        class="timer-secondary-button"
        aria-label="Ouvrir les détails de la séance"
        @click="openDetails"
      />
      <UButton
        v-if="!replayMode"
        block
        icon="i-lucide-sliders-horizontal"
        label="Adapter"
        color="neutral"
        variant="ghost"
        class="timer-secondary-button"
        aria-label="Adapter la difficulté"
        :disabled="adaptingAction !== null"
        @click="openAdapter"
      />
      <UButton
        v-if="!replayMode"
        block
        icon="i-lucide-shield-alert"
        label="Douleur"
        color="warning"
        variant="ghost"
        class="timer-secondary-button"
        aria-label="Signaler une douleur"
        :disabled="adaptingAction !== null"
        @click="requestPainAdaptation"
      />
    </div>

    <nav class="timer-transport" aria-label="Navigation du minuteur">
      <UButton
        icon="i-lucide-skip-back"
        size="xl"
        color="neutral"
        variant="soft"
        class="timer-transport-button"
        aria-label="Précédent"
        @click="emit('previous')"
      />
      <UButton
        :icon="running ? 'i-lucide-pause' : 'i-lucide-play'"
        size="xl"
        color="primary"
        class="timer-play-button"
        :aria-label="running ? 'Pause' : 'Démarrer'"
        @click="emit('toggle')"
      />
      <UButton
        icon="i-lucide-skip-forward"
        size="xl"
        color="neutral"
        variant="soft"
        class="timer-transport-button"
        aria-label="Suivant"
        @click="emit('next')"
      />
    </nav>
  </footer>

  <USlideover
    v-model:open="detailsOpen"
    side="bottom"
    title="Détails de la séance"
    description="Consulte le guide courant ou le déroulé complet sans interrompre le minuteur."
    :ui="{
      content: 'h-[min(88dvh,56rem)] max-h-[88dvh] rounded-t-2xl',
      header: 'shrink-0',
      body: 'flex min-h-0 flex-1 flex-col overflow-hidden p-0 sm:p-0',
    }"
  >
    <template #close>
      <UButton
        icon="i-lucide-x"
        color="neutral"
        variant="ghost"
        class="min-h-11 min-w-11 justify-center"
        aria-label="Fermer les détails"
      />
    </template>
    <template #body>
      <div class="flex min-h-0 flex-1 flex-col">
        <div
          class="grid shrink-0 grid-cols-2 gap-1 border-b border-default p-2"
          role="tablist"
          aria-label="Contenu des détails"
        >
          <button
            id="timer-details-exercise-tab"
            type="button"
            role="tab"
            class="timer-tab"
            :class="{ 'timer-tab-active': detailsTab === 'exercise' }"
            :aria-selected="detailsTab === 'exercise'"
            :tabindex="detailsTab === 'exercise' ? 0 : -1"
            aria-controls="timer-details-exercise-panel"
            @click="detailsTab = 'exercise'"
            @keydown="handleDetailsTabKeydown"
          >
            Exercice
          </button>
          <button
            id="timer-details-session-tab"
            type="button"
            role="tab"
            class="timer-tab"
            :class="{ 'timer-tab-active': detailsTab === 'session' }"
            :aria-selected="detailsTab === 'session'"
            :tabindex="detailsTab === 'session' ? 0 : -1"
            aria-controls="timer-details-session-panel"
            @click="detailsTab = 'session'"
            @keydown="handleDetailsTabKeydown"
          >
            Séance complète
          </button>
        </div>

        <div
          v-if="detailsTab === 'exercise'"
          id="timer-details-exercise-panel"
          role="tabpanel"
          aria-labelledby="timer-details-exercise-tab"
          tabindex="0"
          class="timer-details-scroll"
        >
          <div class="mx-auto w-full max-w-2xl">
            <ExerciseGuidePanel :exercise="guideExercise" :next="nextExercise" />
          </div>
        </div>
        <div
          v-else
          id="timer-details-session-panel"
          role="tabpanel"
          aria-labelledby="timer-details-session-tab"
          tabindex="0"
          class="timer-details-scroll"
        >
          <div class="mx-auto w-full max-w-2xl">
            <TimerSessionOverview
              :session="session"
              :current-block-index="currentBlockIndex"
              :current-exercise-index="currentExerciseIndex"
            />
          </div>
        </div>
      </div>
    </template>
  </USlideover>

  <USlideover
    v-model:open="adapterOpen"
    side="bottom"
    title="Adapter la séance"
    description="Les changements s’appliquent uniquement à la suite de la séance."
    :ui="{
      content: 'max-h-[85dvh] rounded-t-2xl',
      body: 'overflow-y-auto overscroll-contain pb-[max(1rem,env(safe-area-inset-bottom))]',
    }"
  >
    <template #close>
      <UButton
        icon="i-lucide-x"
        color="neutral"
        variant="ghost"
        class="min-h-11 min-w-11 justify-center"
        aria-label="Fermer les adaptations"
      />
    </template>
    <template #body>
      <div class="mx-auto grid w-full max-w-lg gap-3 sm:grid-cols-2">
        <UButton
          block
          size="lg"
          color="neutral"
          variant="soft"
          icon="i-lucide-trending-down"
          class="min-h-12 justify-start"
          :loading="adaptingAction === 'too_hard'"
          :disabled="adaptingAction !== null"
          @click="requestAdaptation('too_hard')"
        >
          Trop difficile
        </UButton>
        <UButton
          block
          size="lg"
          color="neutral"
          variant="soft"
          icon="i-lucide-trending-up"
          class="min-h-12 justify-start"
          :loading="adaptingAction === 'too_easy'"
          :disabled="adaptingAction !== null"
          @click="requestAdaptation('too_easy')"
        >
          Trop facile
        </UButton>
        <UButton
          block
          size="lg"
          color="warning"
          variant="soft"
          icon="i-lucide-shield-alert"
          class="min-h-12 justify-start sm:col-span-2"
          :disabled="adaptingAction !== null"
          @click="requestPainAdaptation"
        >
          Signaler une douleur
        </UButton>
      </div>
    </template>
  </USlideover>
</template>

<style scoped>
.timer-control-dock {
  flex: none;
  border-top: 1px solid rgb(255 255 255 / 10%);
  background: rgb(9 9 11 / 92%);
  padding-bottom: max(0.625rem, env(safe-area-inset-bottom));
  backdrop-filter: blur(16px);
}

.timer-secondary-actions {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(0, 1fr));
  gap: 0.25rem;
  border-bottom: 1px solid rgb(255 255 255 / 8%);
  padding: 0.25rem 0.5rem;
}

.timer-secondary-button {
  min-height: 2.75rem;
  min-width: 0;
  justify-content: center;
  text-wrap: balance;
}

.timer-transport {
  display: flex;
  min-height: 4.75rem;
  align-items: center;
  justify-content: center;
  gap: clamp(1.5rem, 10vw, 3.5rem);
  padding: 0.5rem 1rem;
}

.timer-transport-button {
  min-height: 3rem;
  min-width: 3rem;
  justify-content: center;
}

.timer-play-button {
  min-height: 4rem;
  min-width: 4rem;
  justify-content: center;
  border-radius: 9999px;
}

.timer-secondary-button:focus-visible,
.timer-transport-button:focus-visible,
.timer-play-button:focus-visible,
.timer-tab:focus-visible {
  outline: 2px solid white;
  outline-offset: 2px;
}

.timer-tab {
  min-height: 2.75rem;
  border-radius: 0.625rem;
  padding: 0.5rem 0.75rem;
  color: var(--ui-text-muted);
  font-size: 0.875rem;
  font-weight: 600;
}

.timer-tab:hover {
  background: var(--ui-bg-elevated);
  color: var(--ui-text);
}

.timer-tab-active {
  background: var(--ui-primary);
  color: var(--ui-bg);
}

.timer-details-scroll {
  min-height: 0;
  flex: 1;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: 1rem;
  padding-bottom: max(1rem, env(safe-area-inset-bottom));
  scroll-padding-block: 4rem;
}

@media (orientation: landscape) and (max-height: 568px) {
  .timer-control-dock {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: center;
    padding-bottom: max(0.375rem, env(safe-area-inset-bottom));
  }

  .timer-secondary-actions {
    border-right: 1px solid rgb(255 255 255 / 8%);
    border-bottom: 0;
    padding: 0.25rem;
  }

  .timer-transport {
    min-height: 4.25rem;
    gap: clamp(1rem, 4vw, 2rem);
    padding: 0.25rem 0.75rem;
  }
}
</style>
