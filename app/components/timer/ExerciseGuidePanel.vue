<script setup lang="ts">
import type { Exercise } from '~/utils/session'

// Guide de l'activité en cours pendant une séance : reprend le contenu d'ExerciseCard
// (explication / combo / conseils / erreurs) mais en lecture directe, sans repli.
const props = defineProps<{
  exercise: Exercise | null
  next?: Exercise | null
}>()

const cat = computed(() =>
  props.exercise ? (CATEGORY_META[props.exercise.category] ?? CATEGORY_META.cardio) : null,
)
const combo = computed(() => props.exercise?.combo ?? null)
const comboText = computed(() => (combo.value ? comboToText(combo.value) : ''))

// Les rounds d'un même exercice partagent la même référence : inutile d'annoncer
// « Prochain » quand il s'agit encore de l'exercice affiché.
const showNext = computed(() => !!props.next && props.next !== props.exercise)
</script>

<template>
  <div
    class="flex flex-col gap-4 rounded-2xl border border-white/10 bg-black/25 p-5 text-left text-white"
  >
    <template v-if="exercise">
      <!-- En-tête : nom + catégorie -->
      <div class="flex items-start gap-3">
        <UIcon v-if="cat" :name="cat.icon" class="mt-0.5 size-5 shrink-0" :class="cat.iconClass" />
        <div class="min-w-0 flex-1">
          <h3 class="font-bold leading-tight">{{ exercise.name }}</h3>
          <p v-if="cat" class="mt-0.5 text-[11px] uppercase tracking-widest text-white/50">
            {{ cat.label }}
          </p>
        </div>
      </div>

      <!-- Combo + son explication -->
      <div v-if="combo" class="space-y-1.5 rounded-lg bg-white/5 p-3 text-sm">
        <p>
          <span class="font-mono font-semibold">{{ combo }}</span>
          <span class="text-white/60"> — {{ comboText }}</span>
        </p>
        <p v-if="exercise.comboExplanation" class="text-white/70">
          <UIcon name="i-lucide-info" class="mr-1 inline size-3.5 align-[-2px]" />
          <GlossaryText :text="exercise.comboExplanation" />
        </p>
      </div>

      <!-- Explication -->
      <p v-if="exercise.explanation" class="whitespace-pre-line text-sm text-white/75">
        <GlossaryText :text="exercise.explanation" />
      </p>

      <!-- Conseils -->
      <div v-if="exercise.tips?.length">
        <p class="mb-1.5 text-sm font-semibold">Conseils</p>
        <ul class="space-y-1 text-sm text-white/70">
          <li v-for="(tip, i) in exercise.tips" :key="i" class="flex gap-1.5">
            <UIcon name="i-lucide-check" class="mt-0.5 size-3.5 shrink-0 text-emerald-400" />
            <span><GlossaryText :text="tip" /></span>
          </li>
        </ul>
      </div>

      <!-- Erreurs à éviter -->
      <div v-if="exercise.commonMistakes?.length">
        <p class="mb-1.5 text-sm font-semibold">Erreurs à éviter</p>
        <ul class="space-y-1 text-sm text-white/70">
          <li v-for="(mistake, i) in exercise.commonMistakes" :key="i" class="flex gap-1.5">
            <UIcon name="i-lucide-x" class="mt-0.5 size-3.5 shrink-0 text-rose-400" />
            <span><GlossaryText :text="mistake" /></span>
          </li>
        </ul>
      </div>
    </template>

    <!-- Phase sans exercice rattaché -->
    <div v-else class="flex flex-col items-center gap-2 py-8 text-center">
      <UIcon name="i-lucide-leaf" class="size-8 text-emerald-400" />
      <p class="text-sm text-white/70">Repos / récupération</p>
      <p class="text-xs text-white/40">Respire calmement, relâche les épaules.</p>
    </div>

    <!-- Exercice suivant -->
    <p v-if="showNext" class="mt-auto border-t border-white/10 pt-3 text-sm text-white/50">
      <UIcon name="i-lucide-arrow-right" class="inline size-3.5 align-[-2px]" />
      Prochain : <span class="font-medium text-white/80">{{ next?.name }}</span>
    </p>
  </div>
</template>
