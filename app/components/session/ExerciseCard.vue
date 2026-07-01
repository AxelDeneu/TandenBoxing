<script setup lang="ts">
import type { Exercise } from '~/utils/session'

const props = defineProps<{
  exercise: Exercise
  editable?: boolean
  busy?: boolean
}>()

const emit = defineEmits<{ replace: []; remove: [] }>()

const open = ref(false)
const cat = computed(() => CATEGORY_META[props.exercise.category] ?? CATEGORY_META.cardio)

const menuItems = [
  { label: 'Remplacer (IA)', icon: 'i-lucide-refresh-cw', onSelect: () => emit('replace') },
  { label: 'Retirer', icon: 'i-lucide-trash-2', onSelect: () => emit('remove') },
]
</script>

<template>
  <div class="rounded-xl border border-default bg-elevated/40 p-3">
    <div class="flex items-start gap-3">
      <UIcon :name="cat.icon" class="mt-0.5 size-5 shrink-0" :class="cat.iconClass" />

      <div class="min-w-0 flex-1">
        <div class="flex items-start justify-between gap-2">
          <h4 class="font-semibold leading-tight">{{ exercise.name }}</h4>
          <UDropdownMenu v-if="editable" :items="menuItems" :content="{ align: 'end' }">
            <UButton
              icon="i-lucide-ellipsis-vertical"
              color="neutral"
              variant="ghost"
              size="xs"
              :loading="busy"
              aria-label="Options de l'exercice"
            />
          </UDropdownMenu>
        </div>

        <IntervalBadge
          :work="exercise.intervals.work"
          :rest="exercise.intervals.rest"
          :rounds="exercise.intervals.rounds"
          class="mt-1.5"
        />

        <div v-if="exercise.combo" class="mt-1.5 text-sm">
          <span class="font-mono font-semibold text-primary">{{ exercise.combo }}</span>
          <span class="text-muted"> — {{ comboToText(exercise.combo) }}</span>
        </div>
      </div>
    </div>

    <UCollapsible v-model:open="open" class="mt-2">
      <UButton
        :label="open ? 'Masquer les explications' : 'Voir les explications'"
        :trailing-icon="open ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'"
        color="neutral"
        variant="link"
        size="xs"
        class="px-0"
      />
      <template #content>
        <div class="space-y-3 pt-2 text-sm">
          <p class="whitespace-pre-line text-muted">{{ exercise.explanation }}</p>

          <div v-if="exercise.comboExplanation" class="rounded-lg bg-primary/10 p-2.5 text-primary">
            <UIcon name="i-lucide-info" class="mr-1 inline size-3.5 align-[-2px]" />
            {{ exercise.comboExplanation }}
          </div>

          <div v-if="exercise.tips?.length">
            <p class="mb-1 font-medium">Conseils</p>
            <ul class="space-y-1 text-muted">
              <li v-for="(tip, i) in exercise.tips" :key="i" class="flex gap-1.5">
                <UIcon name="i-lucide-check" class="mt-0.5 size-3.5 shrink-0 text-emerald-400" />
                <span>{{ tip }}</span>
              </li>
            </ul>
          </div>

          <div v-if="exercise.commonMistakes?.length">
            <p class="mb-1 font-medium">Erreurs à éviter</p>
            <ul class="space-y-1 text-muted">
              <li v-for="(mistake, i) in exercise.commonMistakes" :key="i" class="flex gap-1.5">
                <UIcon name="i-lucide-x" class="mt-0.5 size-3.5 shrink-0 text-rose-400" />
                <span>{{ mistake }}</span>
              </li>
            </ul>
          </div>
        </div>
      </template>
    </UCollapsible>
  </div>
</template>
