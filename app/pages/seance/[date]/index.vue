<script setup lang="ts">
import type { ApiSession, SessionCategory } from '~/utils/session'
import type { SessionPedagogicalIntent } from '~~/shared/session-pedagogy'

interface SessionDetail extends ApiSession {
  pedagogicalIntent: SessionPedagogicalIntent
  feedback: {
    completed: boolean
    overallDifficulty: number | null
    energyLevel: number | null
    enjoyment: number | null
    soreness: string[]
    comment: string | null
    actualDurationSec: number | null
  } | null
  exerciseFeedback: { exerciseName: string; difficulty: number | null }[]
}

const route = useRoute()
const date = route.params.date as string
const { data, error, refresh } = await useFetch<SessionDetail>(`/api/sessions/${date}`)

useHead({ title: () => data.value?.structure.title ?? 'Séance' })

const totalSeconds = computed(() => (data.value ? estimateSessionSeconds(data.value.structure) : 0))
// Catégorie : absente des séances générées avant l'ajout du champ.
const categoryMeta = computed(() =>
  data.value?.category
    ? (SESSION_CATEGORY_META[data.value.category as SessionCategory] ?? null)
    : null,
)
const isCompleted = computed(() => data.value?.status === 'completed')
const isSkipped = computed(() => data.value?.status === 'skipped')
// Un vrai feedback (séance faite) — à distinguer du marqueur d'une séance sautée (completed=false).
const ratedFeedback = computed(() => (data.value?.feedback?.completed ? data.value.feedback : null))

const TARGET_DECISION_META = {
  automatic: { label: 'Choix automatique', color: 'neutral' },
  accepted: { label: 'Cible retenue', color: 'success' },
  adapted: { label: 'Cible adaptée', color: 'warning' },
  deferred: { label: 'Cible reportée', color: 'neutral' },
} as const

const showReschedule = ref(false)
const showDelete = ref(false)
const showSkip = ref(false)
const deleteLoading = ref(false)
const skipLoading = ref(false)
const skipReason = ref('')
const toast = useToast()

const dialogs = {
  reschedule: showReschedule,
  deleteSession: showDelete,
  skip: showSkip,
} as const

function setDialog(dialog: keyof typeof dialogs, visible: boolean): void {
  dialogs[dialog].value = visible
}

async function markSkipped() {
  skipLoading.value = true
  try {
    await $fetch(`/api/sessions/${date}/skip`, {
      method: 'POST',
      body: { reason: skipReason.value.trim() || null },
    })
    showSkip.value = false
    skipReason.value = ''
    await refresh()
    toast.add({
      title: 'Séance marquée comme sautée',
      icon: 'i-lucide-calendar-off',
      color: 'success',
    })
  } catch (e: any) {
    toast.add({
      title: 'Échec',
      description: e?.data?.statusMessage ?? e?.message,
      color: 'error',
      icon: 'i-lucide-triangle-alert',
    })
  } finally {
    skipLoading.value = false
  }
}

async function deleteSession() {
  deleteLoading.value = true
  try {
    await $fetch(`/api/sessions/${date}`, { method: 'DELETE' })
    toast.add({ title: 'Séance supprimée', icon: 'i-lucide-trash-2', color: 'success' })
    await navigateTo('/historique')
  } catch (e: any) {
    toast.add({
      title: 'Échec',
      description: e?.data?.statusMessage ?? e?.message,
      color: 'error',
      icon: 'i-lucide-triangle-alert',
    })
  } finally {
    deleteLoading.value = false
  }
}
</script>

<template>
  <div class="space-y-5 p-4">
    <header class="flex items-center gap-3">
      <UButton
        icon="i-lucide-arrow-left"
        color="neutral"
        variant="ghost"
        to="/historique"
        aria-label="Retour"
      />
      <div class="min-w-0">
        <p class="truncate text-xs text-dimmed">
          {{ data ? capitalize(formatDateFr(data.date)) : '' }}
        </p>
        <h1 class="text-xl font-bold">Détail de la séance</h1>
      </div>
    </header>

    <UAlert
      v-if="error"
      color="warning"
      variant="soft"
      icon="i-lucide-triangle-alert"
      title="Séance introuvable"
    />

    <template v-else-if="data">
      <UCard>
        <div class="space-y-3">
          <div class="flex flex-wrap items-center gap-2">
            <UBadge
              v-if="categoryMeta"
              color="neutral"
              variant="soft"
              :icon="categoryMeta.icon"
              :ui="{ leadingIcon: categoryMeta.iconClass }"
            >
              {{ categoryMeta.label }}
            </UBadge>
            <UBadge color="primary" variant="soft" :icon="FOCUS_META[data.focus]?.icon">
              {{ FOCUS_META[data.focus]?.label ?? data.focus }}
            </UBadge>
            <UBadge v-if="isCompleted" color="success" variant="soft" icon="i-lucide-check">
              Terminée
            </UBadge>
            <UBadge
              v-else-if="isSkipped"
              color="warning"
              variant="soft"
              icon="i-lucide-calendar-off"
            >
              Sautée
            </UBadge>
          </div>
          <h2 class="text-xl font-bold leading-tight">{{ data.structure.title }}</h2>
          <p class="text-sm text-muted">{{ data.structure.summary }}</p>
          <div class="flex gap-4 text-sm">
            <span class="flex items-center gap-1.5">
              <UIcon name="i-lucide-clock" class="size-4 text-primary" />
              {{ formatDuration(totalSeconds) }}
            </span>
            <span class="flex items-center gap-1.5">
              <UIcon name="i-lucide-layers" class="size-4 text-primary" />
              {{ data.structure.blocks.length }} blocs
            </span>
          </div>
        </div>
      </UCard>

      <UCard aria-labelledby="pedagogical-intent-title">
        <template #header>
          <div class="flex flex-wrap items-center justify-between gap-2">
            <h2 id="pedagogical-intent-title" class="flex items-center gap-2 text-sm font-semibold">
              <UIcon name="i-lucide-route" class="size-4 text-primary" />
              Intention pédagogique
            </h2>
            <UBadge
              v-if="data.pedagogicalIntent.target"
              :color="TARGET_DECISION_META[data.pedagogicalIntent.target.decision].color"
              variant="soft"
            >
              {{ TARGET_DECISION_META[data.pedagogicalIntent.target.decision].label }}
            </UBadge>
          </div>
        </template>

        <p class="text-sm text-muted">{{ data.pedagogicalIntent.summary }}</p>

        <dl class="mt-4 grid gap-3 sm:grid-cols-3">
          <div class="rounded-lg bg-elevated p-3">
            <dt class="text-xs font-medium text-dimmed">Travaillées</dt>
            <dd class="mt-1 text-sm">
              {{
                data.pedagogicalIntent.worked.map((skill) => skill.label).join(', ') ||
                'Non renseignées'
              }}
            </dd>
          </div>
          <div class="rounded-lg bg-elevated p-3">
            <dt class="text-xs font-medium text-dimmed">Consolidées</dt>
            <dd class="mt-1 text-sm">
              {{
                data.pedagogicalIntent.consolidated.map((skill) => skill.label).join(', ') ||
                'Aucune cible explicite'
              }}
            </dd>
          </div>
          <div class="rounded-lg bg-elevated p-3">
            <dt class="text-xs font-medium text-dimmed">Introduites</dt>
            <dd class="mt-1 text-sm">
              {{
                data.pedagogicalIntent.introduced.map((skill) => skill.label).join(', ') ||
                'Aucune nouveauté'
              }}
            </dd>
          </div>
        </dl>

        <UAlert
          v-if="data.pedagogicalIntent.missingPrerequisites.length"
          class="mt-4"
          color="warning"
          variant="soft"
          icon="i-lucide-lock-keyhole"
          title="Prérequis renforcés avant la cible"
          :description="
            data.pedagogicalIntent.missingPrerequisites.map((skill) => skill.label).join(', ')
          "
        />

        <ul
          v-if="data.pedagogicalIntent.facts.length"
          class="mt-4 list-disc space-y-1 pl-5 text-sm text-muted"
          aria-label="Explications de la prescription"
        >
          <li v-for="fact in data.pedagogicalIntent.facts" :key="fact">{{ fact }}</li>
        </ul>

        <p v-if="data.pedagogicalIntent.partial" class="mt-4 text-xs text-dimmed">
          Détail partiel : cette séance a été générée avant l’enregistrement de l’intention de
          progression.
        </p>
      </UCard>

      <!-- Séance sautée : rappel de la raison -->
      <UCard v-if="isSkipped">
        <div class="flex items-start gap-3">
          <UIcon name="i-lucide-calendar-off" class="mt-0.5 size-5 shrink-0 text-amber-400" />
          <div>
            <p class="text-sm font-medium">Séance sautée</p>
            <p v-if="data.feedback?.comment" class="mt-1 text-sm text-muted">
              « {{ data.feedback.comment }} »
            </p>
            <p v-else class="mt-1 text-sm text-muted">Marquée comme non faite.</p>
          </div>
        </div>
      </UCard>

      <!-- Récap feedback (séance réellement faite et notée) -->
      <UCard v-if="ratedFeedback">
        <template #header>
          <h2 class="flex items-center gap-2 text-sm font-semibold">
            <UIcon name="i-lucide-clipboard-check" class="size-4 text-primary" /> Ton feedback
          </h2>
        </template>
        <div class="grid grid-cols-3 gap-3 text-center">
          <div>
            <p class="text-lg font-bold">
              {{ ratedFeedback.overallDifficulty ?? '—'
              }}<span class="text-sm text-dimmed">/5</span>
            </p>
            <p class="text-xs text-muted">Difficulté</p>
          </div>
          <div>
            <p class="text-lg font-bold">
              {{ ratedFeedback.energyLevel ?? '—' }}<span class="text-sm text-dimmed">/5</span>
            </p>
            <p class="text-xs text-muted">Énergie</p>
          </div>
          <div>
            <p class="text-lg font-bold">
              {{ ratedFeedback.enjoyment ?? '—' }}<span class="text-sm text-dimmed">/5</span>
            </p>
            <p class="text-xs text-muted">Plaisir</p>
          </div>
        </div>
        <div v-if="ratedFeedback.soreness.length" class="mt-3 flex flex-wrap gap-1.5">
          <UBadge
            v-for="z in ratedFeedback.soreness"
            :key="z"
            color="neutral"
            variant="soft"
            size="sm"
          >
            {{ z }}
          </UBadge>
        </div>
        <p v-if="ratedFeedback.comment" class="mt-3 text-sm text-muted">
          « {{ ratedFeedback.comment }} »
        </p>
      </UCard>

      <div class="space-y-6">
        <BlockCard
          v-for="(block, bi) in data.structure.blocks"
          :key="bi"
          :block="block"
          :block-index="bi"
          :editable="false"
        />
      </div>

      <UButton
        block
        size="xl"
        :color="data.status === 'completed' ? 'neutral' : 'primary'"
        :variant="data.status === 'completed' ? 'soft' : 'solid'"
        icon="i-lucide-play"
        :to="`/seance/${data.date}/timer`"
      >
        {{ data.status === 'completed' ? 'Refaire la séance' : 'Démarrer la séance' }}
      </UButton>

      <UButton
        v-if="!isCompleted && !isSkipped"
        block
        color="primary"
        variant="soft"
        icon="i-lucide-clipboard-check"
        :to="`/seance/${data.date}/feedback`"
      >
        Noter la séance
      </UButton>

      <UButton
        v-if="!isCompleted && !isSkipped"
        block
        color="neutral"
        variant="ghost"
        icon="i-lucide-calendar-off"
        @click="setDialog('skip', true)"
      >
        Marquer comme sautée
      </UButton>

      <UButton
        block
        color="neutral"
        variant="ghost"
        icon="i-lucide-calendar-clock"
        @click="setDialog('reschedule', true)"
      >
        Reporter à une autre date
      </UButton>

      <UButton
        block
        color="error"
        variant="ghost"
        icon="i-lucide-trash-2"
        @click="setDialog('deleteSession', true)"
      >
        Supprimer la séance
      </UButton>

      <UModal
        v-model:open="showSkip"
        title="Marquer la séance comme sautée ?"
        description="Elle sera enregistrée comme non faite. La raison aide ton coach à adapter la suite."
      >
        <template #body>
          <UTextarea
            v-model="skipReason"
            :rows="3"
            placeholder="Raison (optionnel) : pas eu le temps, fatigue, petite douleur…"
            class="w-full"
          />
        </template>
        <template #footer>
          <div class="flex w-full justify-end gap-2">
            <UButton color="neutral" variant="ghost" @click="setDialog('skip', false)">
              Annuler
            </UButton>
            <UButton
              color="primary"
              icon="i-lucide-calendar-off"
              :loading="skipLoading"
              @click="markSkipped"
            >
              Marquer sautée
            </UButton>
          </div>
        </template>
      </UModal>

      <RescheduleModal
        v-model:open="showReschedule"
        :date="data.date"
        @done="() => navigateTo('/historique')"
      />

      <UModal
        v-model:open="showDelete"
        title="Supprimer la séance ?"
        description="Cette action est définitive : la séance et son feedback seront supprimés."
      >
        <template #footer>
          <div class="flex w-full justify-end gap-2">
            <UButton color="neutral" variant="ghost" @click="setDialog('deleteSession', false)">
              Annuler
            </UButton>
            <UButton
              color="error"
              icon="i-lucide-trash-2"
              :loading="deleteLoading"
              @click="deleteSession"
            >
              Supprimer
            </UButton>
          </div>
        </template>
      </UModal>
    </template>
  </div>
</template>
