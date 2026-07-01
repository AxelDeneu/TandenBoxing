<script setup lang="ts">
const props = defineProps<{
  modelValue: number | null
  max?: number
  labels?: [string, string]
}>()
const emit = defineEmits<{ 'update:modelValue': [number] }>()

const values = computed(() => Array.from({ length: props.max ?? 5 }, (_, i) => i + 1))
</script>

<template>
  <div>
    <div class="flex gap-1.5">
      <button
        v-for="v in values"
        :key="v"
        type="button"
        class="flex-1 rounded-lg border py-2 text-sm font-semibold transition-colors"
        :class="
          modelValue === v
            ? 'border-primary bg-primary text-inverted'
            : 'border-default text-muted hover:border-primary/50'
        "
        @click="emit('update:modelValue', v)"
      >
        {{ v }}
      </button>
    </div>
    <div v-if="labels" class="mt-1 flex justify-between text-[11px] text-dimmed">
      <span>{{ labels[0] }}</span>
      <span>{{ labels[1] }}</span>
    </div>
  </div>
</template>
