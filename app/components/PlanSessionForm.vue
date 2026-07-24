<script setup lang="ts">
import { CATEGORY_OPTIONS, FOCUS_OPTIONS } from '~~/shared/recommendations'
import type { FocusRecommendation, SessionCategory } from '~/utils/session'

const props = defineProps<{
  /** Date visée par la planification. */
  date: string
  /** Valeurs de départ (édition d'une intention existante). */
  initial?: {
    category?: string | null
    focus?: string | null
    customFocus?: string | null
    durationMin?: number | null
    note?: string | null
  }
  /** Séance unique : ne propose que « Générer maintenant » (pas de planification différée). */
  generateOnly?: boolean
}>()

const emit = defineEmits<{ done: [] }>()

const toast = useToast()

/** Valeurs sentinelles : choix laissé à l'IA / thème libre saisi par l'utilisateur. */
const AI_CHOICE = '__ia__'
const FREE_FOCUS = '__libre__'

const categoryItems = [
  { value: AI_CHOICE, label: "Au choix de l'IA", icon: 'i-lucide-sparkles' },
  ...CATEGORY_OPTIONS.map((c) => ({
    value: c,
    label: SESSION_CATEGORY_META[c].label,
    icon: SESSION_CATEGORY_META[c].icon,
  })),
]

const focusItems = [
  { value: AI_CHOICE, label: "Au choix de l'IA", icon: 'i-lucide-sparkles' },
  { value: FREE_FOCUS, label: 'Thème libre…', icon: 'i-lucide-pencil-line' },
  ...FOCUS_OPTIONS.map((f) => ({ value: f, label: focusLabel(f), icon: FOCUS_META[f]?.icon })),
]

/** Durées proposées (minutes) ; 0 = durée habituelle des réglages. */
const DURATION_CHOICES = [15, 20, 30, 45, 60, 75, 90]

const category = ref<string>(props.initial?.category ?? AI_CHOICE)
const focus = ref<string>(
  props.initial?.customFocus ? FREE_FOCUS : (props.initial?.focus ?? AI_CHOICE),
)
const customFocus = ref<string>(props.initial?.customFocus ?? '')
const duration = ref<number>(props.initial?.durationMin ?? 0)
const note = ref<string>(props.initial?.note ?? '')
const loading = ref<'plan' | 'generate' | null>(null)

const categoryMeta = computed(() =>
  category.value === AI_CHOICE ? null : SESSION_CATEGORY_META[category.value as SessionCategory],
)
const categoryHelp = computed(
  () => categoryMeta.value?.intent ?? "L'IA choisit selon ta progression et ton historique.",
)

/** Durée cible des réglages, pour libeller l'option « habituelle ». */
const defaultDurationMin = ref<number | null>(null)
const durationItems = computed(() => [
  {
    value: 0,
    label: defaultDurationMin.value ? `Habituelle (${defaultDurationMin.value} min)` : 'Habituelle',
    icon: 'i-lucide-clock',
  },
  // Une durée hors liste (posée via l'API) reste sélectionnable telle quelle.
  ...(duration.value && !DURATION_CHOICES.includes(duration.value) ? [duration.value] : [])
    .concat(DURATION_CHOICES)
    .sort((a, b) => a - b)
    .map((m) => ({ value: m, label: `${m} min`, icon: 'i-lucide-clock' })),
])

// Recommandations IA — non bloquantes : en cas d'échec la section est simplement masquée.
const recos = ref<FocusRecommendation[]>([])
const recosLoading = ref(true)

onMounted(async () => {
  $fetch<{ targetDurationMin: number }>('/api/settings')
    .then((s) => (defaultDurationMin.value = s.targetDurationMin))
    .catch(() => {})
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

/** Thème libre sélectionné mais vide : rien à envoyer, on bloque l'envoi. */
const missingCustomFocus = computed(() => focus.value === FREE_FOCUS && !customFocus.value.trim())

async function submit(generateNow: boolean) {
  loading.value = generateNow ? 'generate' : 'plan'
  try {
    await $fetch('/api/sessions/plan', {
      method: 'POST',
      body: {
        date: props.date,
        category: category.value === AI_CHOICE ? null : category.value,
        focus: (FOCUS_OPTIONS as string[]).includes(focus.value) ? focus.value : null,
        customFocus: focus.value === FREE_FOCUS ? customFocus.value.trim() || null : null,
        durationMin: duration.value || null,
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
      <UFormField label="Catégorie" :help="categoryHelp">
        <USelect
          v-model="category"
          :items="categoryItems"
          :icon="categoryMeta?.icon ?? 'i-lucide-sparkles'"
          class="w-full"
        />
      </UFormField>

      <UFormField
        label="Focus"
        help="Laisse l'IA choisir, prends un thème du programme, ou décris le tien."
      >
        <USelect
          v-model="focus"
          :items="focusItems"
          :icon="
            focus === AI_CHOICE
              ? 'i-lucide-sparkles'
              : focus === FREE_FOCUS
                ? 'i-lucide-pencil-line'
                : FOCUS_META[focus]?.icon
          "
          class="w-full"
        />
      </UFormField>

      <UFormField
        v-if="focus === FREE_FOCUS"
        label="Thème libre"
        required
        help="Ce que tu veux travailler : l'IA construit la séance autour."
      >
        <UInput
          v-model="customFocus"
          autofocus
          placeholder="Ex : pectoraux, biceps, explosivité…"
          class="w-full"
        />
      </UFormField>

      <UFormField label="Durée" help="Juste pour cette séance ; ne change pas tes réglages.">
        <USelect v-model="duration" :items="durationItems" icon="i-lucide-clock" class="w-full" />
      </UFormField>

      <UFormField label="Note pour le coach" hint="Optionnel">
        <UTextarea
          v-model="note"
          :rows="2"
          autoresize
          placeholder="Ex : épaule sensible, envie de me défouler…"
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
        :disabled="loading !== null || missingCustomFocus"
        @click="submit(true)"
      >
        Générer maintenant
      </UButton>
      <UButton
        v-if="!generateOnly"
        class="justify-center sm:flex-1"
        color="neutral"
        variant="soft"
        icon="i-lucide-calendar-plus"
        :loading="loading === 'plan'"
        :disabled="loading !== null || missingCustomFocus"
        @click="submit(false)"
      >
        Planifier
      </UButton>
    </div>
  </div>
</template>
