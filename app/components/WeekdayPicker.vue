<script setup lang="ts">
const props = defineProps<{ modelValue: number[] }>()
const emit = defineEmits<{ 'update:modelValue': [number[]] }>()

const days = [
  { n: 1, l: 'L' },
  { n: 2, l: 'M' },
  { n: 3, l: 'M' },
  { n: 4, l: 'J' },
  { n: 5, l: 'V' },
  { n: 6, l: 'S' },
  { n: 7, l: 'D' },
]

function toggle(n: number) {
  const set = new Set(props.modelValue)
  if (set.has(n)) set.delete(n)
  else set.add(n)
  emit(
    'update:modelValue',
    [...set].sort((a, b) => a - b),
  )
}
</script>

<template>
  <div class="flex gap-1.5">
    <button
      v-for="d in days"
      :key="d.n"
      type="button"
      class="flex size-10 items-center justify-center rounded-full border text-sm font-semibold transition-colors"
      :class="
        modelValue.includes(d.n)
          ? 'border-primary bg-primary text-inverted'
          : 'border-default text-muted hover:border-primary/50'
      "
      @click="toggle(d.n)"
    >
      {{ d.l }}
    </button>
  </div>
</template>
