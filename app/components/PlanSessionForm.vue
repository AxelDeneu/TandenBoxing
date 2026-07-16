<script setup lang="ts">
import { CATEGORY_OPTIONS, FOCUS_OPTIONS } from '~~/shared/recommendations'
import type { FocusRecommendation, SessionCategory } from '~/utils/session'

const props = defineProps<{
  /** Date visée par la planification. */
  date: string
  /** Valeurs de départ (édition d'une intention existante). */
  initial?: { category?: string | null; focus?: string | null; note?: string | null }
}>()

const emit = defineEmits<{ done: [] }>()

const toast = useToast()

/** Valeur sentinelle : aucun focus imposé, l'IA choisit. */
const AI_FOCUS = '__ia__'

const categoryItems = CATEGORY_OPTIONS.map((c) => ({
  value: c,
  label: SESSION_CATEGORY_META[c].label,
  icon: SESSION_CATEGORY_META[c].icon,
}))

const focusItems = [
  { value: AI_FOCUS, label: "Au choix de l'IA", icon: 'i-lucide-sparkles' },
  ...FOCUS_OPTIONS.map((f) => ({ value: f, label: focusLabel(f), icon: FOCUS_META[f]?.icon })),
]

// Typé SessionCategory (et non string) : USelect infère son v-model depuis `categoryItems`.
const category = ref<SessionCategory>((props.initial?.category as SessionCategory) ?? 'apprentissage')
const focus = ref<string>(props.initial?.focus ?? AI_FOCUS)
const note = ref<string>(props.initial?.note ?? '')
const loading = ref<'plan' | 'generate' | null>(null)

const categoryMeta = computed(() => SESSION_CATEGORY_META[category.value])

// Recommandations IA — non bloquantes : en cas d'échec la section est simplement masquée.
const recos = ref<FocusRecommendation[]>([])
const recosLoading = ref(true)

onMounted(async () => {
  try {
    recos.value = await $fetch<FocusRecommendation[]>('/api/sessions/recommendations', {
      query: { date: props.date },
    })
  } catch {
    recos.value = []
  } finally {
    recosLoading.value = false
  }
})

/** Une reco est « appliquée » quand catégorie ET focus correspondent. */
function isApplied(r: FocusRecommendation): boolean {
  return category.value === r.category && focus.value === r.focus
}

function applyReco(r: FocusRecommendation) {
  category.value = r.category
  focus.value = r.focus
}

async function submit(generateNow: boolean) {
  loading.value = generateNow ? 'generate' : 'plan'
  try {
    await $fetch('/api/sessions/plan', {
      method: 'POST',
      body: {
        date: props.date,
        category: category.value,
        focus: focus.value === AI_FOCUS ? null : focus.value,
        note: note.value.trim() || null,
        generateNow,
      },
    })
    toast.add(
      generateNow
        ? {
            title: 'Séance en préparation…',
            description: `Ton coach IA compose la séance du ${formatDateFr(props.date)}.`,
            icon: 'i-lucide-loader-circle',
            color: 'info',
          }
        : {
            title: 'Séance planifiée',
            description: `Prévue le ${formatDateFr(props.date)}.`,
            icon: 'i-lucide-calendar-check',
            color: 'success',
          },
    )
    emit('done')
  } catch (e: any) {
    toast.add({
      title: 'Échec',
      description: e?.data?.statusMessage ?? e?.message ?? 'Erreur inconnue',
      color: 'error',
      icon: 'i-lucide-triangle-alert',
    })
  } finally {
    loading.value = null
  }
}
</script>

<template>
  <div class="space-y-5">
    <!-- Recommandations du coach IA -->
    <section v-if="recosLoading || recos.length" class="space-y-2">
      <p class="flex items-center gap-1.5 text-sm font-medium">
        <UIcon name="i-lucide-sparkles" class="size-4 text-primary" />
        Suggestions du coach
      </p>

      <div v-if="recosLoading" class="space-y-2">
        <USkeleton v-for="i in 3" :key="i" class="h-16 w-full rounded-lg" />
      </div>

      <div v-else class="space-y-2">
        <button
          v-for="(r, i) in recos"
          :key="i"
          type="button"
          class="w-full rounded-lg border p-3 text-left transition-colors"
          :class="
            isApplied(r)
              ? 'border-primary bg-primary/10'
              : 'border-default hover:border-primary/40 hover:bg-elevated'
          "
          @click="applyReco(r)"
        >
          <div class="flex items-center gap-2">
            <UIcon
              :name="SESSION_CATEGORY_META[r.category]?.icon ?? 'i-lucide-dumbbell'"
              class="size-4 shrink-0"
              :class="SESSION_CATEGORY_META[r.category]?.iconClass"
            />
            <span class="text-sm font-medium">
              {{ categoryLabel(r.category) }} · {{ focusLabel(r.focus) }}
            </span>
            <UIcon
              v-if="isApplied(r)"
              name="i-lucide-check"
              class="ml-auto size-4 shrink-0 text-primary"
            />
          </div>
          <p class="mt-1 text-xs text-muted">{{ r.reason }}</p>
        </button>
      </div>
    </section>

    <USeparator v-if="recosLoading || recos.length" />

    <div class="space-y-4">
      <UFormField label="Catégorie" required :help="categoryMeta?.intent">
        <USelect
          v-model="category"
          :items="categoryItems"
          :icon="categoryMeta?.icon"
          class="w-full"
        />
      </UFormField>

      <UFormField label="Focus" help="Laisse l'IA choisir si tu n'as pas de préférence.">
        <USelect
          v-model="focus"
          :items="focusItems"
          :icon="focus === AI_FOCUS ? 'i-lucide-sparkles' : FOCUS_META[focus]?.icon"
          class="w-full"
        />
      </UFormField>

      <UFormField label="Note pour le coach" hint="Optionnel">
        <UTextarea
          v-model="note"
          :rows="2"
          autoresize
          placeholder="Ex : épaule sensible, 30 min max…"
          class="w-full"
        />
      </UFormField>
    </div>

    <div class="flex flex-col gap-2 sm:flex-row-reverse">
      <UButton
        class="justify-center sm:flex-1"
        color="primary"
        icon="i-lucide-sparkles"
        :loading="loading === 'generate'"
        :disabled="loading !== null"
        @click="submit(true)"
      >
        Générer maintenant
      </UButton>
      <UButton
        class="justify-center sm:flex-1"
        color="neutral"
        variant="soft"
        icon="i-lucide-calendar-plus"
        :loading="loading === 'plan'"
        :disabled="loading !== null"
        @click="submit(false)"
      >
        Planifier
      </UButton>
    </div>
  </div>
</template>
