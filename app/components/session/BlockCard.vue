<script setup lang="ts">
import type { WorkoutBlock } from '~/utils/session'

const props = defineProps<{
  block: WorkoutBlock
  blockIndex: number
  editable?: boolean
  busyKey?: string | null
}>()

const emit = defineEmits<{ replace: [exerciseIndex: number]; remove: [exerciseIndex: number] }>()

const meta = computed(
  () => BLOCK_META[props.block.type] ?? { label: props.block.title, icon: 'i-lucide-circle' },
)
const seconds = computed(() =>
  props.block.exercises.reduce((acc, ex) => acc + estimateExerciseSeconds(ex), 0),
)
</script>

<template>
  <section>
    <div class="mb-1.5 flex items-center gap-2">
      <UIcon :name="meta.icon" class="size-4 text-primary" />
      <h3 class="text-sm font-bold uppercase tracking-wide">{{ block.title }}</h3>
      <span class="ml-auto text-xs text-dimmed">{{ formatDuration(seconds) }}</span>
    </div>
    <p class="mb-3 text-sm text-muted">{{ block.description }}</p>

    <div class="space-y-2">
      <ExerciseCard
        v-for="(ex, i) in block.exercises"
        :key="i"
        :exercise="ex"
        :editable="editable"
        :busy="busyKey === `${blockIndex}-${i}`"
        @replace="emit('replace', i)"
        @remove="emit('remove', i)"
      />
    </div>
  </section>
</template>
