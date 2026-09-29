<script setup lang="ts">
import { nextTick, onMounted, ref, watch, type ComponentPublicInstance } from 'vue'
import { BLOCK_META, type WorkoutSession } from '~/utils/session'

type ExerciseState = 'completed' | 'current' | 'upcoming'

const props = defineProps<{
  session: WorkoutSession
  currentBlockIndex: number | null
  currentExerciseIndex: number | null
  finished?: boolean
}>()

const currentExerciseElement = ref<HTMLElement | null>(null)

function exerciseState(blockIndex: number, exerciseIndex: number): ExerciseState {
  if (props.finished) return 'completed'
  if (props.currentBlockIndex === null || props.currentExerciseIndex === null) return 'upcoming'
  if (blockIndex < props.currentBlockIndex) return 'completed'
  if (blockIndex > props.currentBlockIndex) return 'upcoming'
  if (exerciseIndex < props.currentExerciseIndex) return 'completed'
  if (exerciseIndex > props.currentExerciseIndex) return 'upcoming'
  return 'current'
}

function captureCurrentExercise(element: Element | ComponentPublicInstance | null): void {
  currentExerciseElement.value = element instanceof HTMLElement ? element : null
}

async function revealCurrentExercise(): Promise<void> {
  await nextTick()
  currentExerciseElement.value?.scrollIntoView?.({ block: 'center' })
}

onMounted(revealCurrentExercise)
watch(
  () => [props.currentBlockIndex, props.currentExerciseIndex, props.finished],
  revealCurrentExercise,
  { flush: 'post' },
)
</script>

<template>
  <div class="space-y-6" aria-label="Déroulé complet de la séance">
    <section v-for="(block, blockIndex) in session.blocks" :key="blockIndex">
      <div class="mb-2 flex items-center gap-2">
        <UIcon
          :name="BLOCK_META[block.type]?.icon ?? 'i-lucide-circle'"
          class="size-4 shrink-0 text-primary"
          aria-hidden="true"
        />
        <h3 class="text-sm font-bold uppercase tracking-wide">{{ block.title }}</h3>
      </div>

      <ol class="space-y-2">
        <li
          v-for="(exercise, exerciseIndex) in block.exercises"
          :id="`timer-exercise-${blockIndex}-${exerciseIndex}`"
          :key="exerciseIndex"
          :ref="
            exerciseState(blockIndex, exerciseIndex) === 'current'
              ? captureCurrentExercise
              : undefined
          "
          class="rounded-xl border p-3 transition-colors"
          :class="{
            'border-emerald-400/20 bg-emerald-950/20 text-white/55':
              exerciseState(blockIndex, exerciseIndex) === 'completed',
            'border-primary/70 bg-primary/10 text-white ring-1 ring-primary/30':
              exerciseState(blockIndex, exerciseIndex) === 'current',
            'border-white/10 bg-white/[0.03] text-white/75':
              exerciseState(blockIndex, exerciseIndex) === 'upcoming',
          }"
          :data-timer-state="exerciseState(blockIndex, exerciseIndex)"
          :aria-current="
            exerciseState(blockIndex, exerciseIndex) === 'current' ? 'step' : undefined
          "
        >
          <div class="flex items-start gap-3">
            <UIcon
              :name="
                exerciseState(blockIndex, exerciseIndex) === 'completed'
                  ? 'i-lucide-check'
                  : exerciseState(blockIndex, exerciseIndex) === 'current'
                    ? 'i-lucide-play'
                    : 'i-lucide-clock-3'
              "
              class="mt-0.5 size-4 shrink-0"
              aria-hidden="true"
            />
            <div class="min-w-0 flex-1">
              <div class="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
                <h4 class="break-words font-semibold leading-tight">{{ exercise.name }}</h4>
                <span class="text-xs font-medium uppercase tracking-wide">
                  {{
                    exerciseState(blockIndex, exerciseIndex) === 'completed'
                      ? 'Terminé'
                      : exerciseState(blockIndex, exerciseIndex) === 'current'
                        ? 'En cours'
                        : 'À venir'
                  }}
                </span>
              </div>
              <IntervalBadge
                :work="exercise.intervals.work"
                :rest="exercise.intervals.rest"
                :rounds="exercise.intervals.rounds"
                class="mt-2"
              />
            </div>
          </div>
        </li>
      </ol>
    </section>
  </div>
</template>
