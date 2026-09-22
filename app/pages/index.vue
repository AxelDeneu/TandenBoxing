<script setup lang="ts">
import {
  PREFERENCE_REASON_OPTIONS,
  type PreferenceReasonCode,
} from '~~/shared/exercise-preferences'
import type { SessionCategory, TodayResponse } from '~/utils/session'

useHead({ title: "Aujourd'hui" })

// Récupération non bloquante : la page s'affiche immédiatement, la séance arrive ensuite.
const { data, refresh } = await useFetch<TodayResponse>('/api/sessions/today', {
  key: 'today',
  lazy: true,
})
const toast = useToast()

const showRegen = ref(false)
const showAdjust = ref(false)
const showReschedule = ref(false)
const showDelete = ref(false)
const showCustom = ref(false)
const showSwapReason = ref(false)
const regenLoading = ref(false)
const adjustLoading = ref(false)
const deleteLoading = ref(false)
const busyKey = ref<string | null>(null)
const pendingSwap = ref<{
  blockIndex: number
  exerciseIndex: number
  action: 'replace' | 'remove'
} | null>(null)
const swapReasonCode = ref<PreferenceReasonCode | undefined>()
const swapReasonOptions = PREFERENCE_REASON_OPTIONS.map(({ value, label }) => ({ value, label }))

const dialogs = {
  regenerate: showRegen,
  adjust: showAdjust,
  reschedule: showReschedule,
  deleteSession: showDelete,
  custom: showCustom,
} as const

function setDialog(dialog: keyof typeof dialogs, visible: boolean): void {
  dialogs[dialog].value = visible
}

const adjustInstruction = ref('')
const ADJUST_SUGGESTIONS = [
  'Plus court aujourd’hui',
  'Plus intense',
  'Plus facile, je récupère',
  'Sans sauts (voisins du dessous)',
  'Insiste sur la technique',
]

const session = computed(() => data.value?.session ?? null)
const totalSeconds = computed(() =>
  session.value ? estimateSessionSeconds(session.value.structure) : 0,
)
// Catégorie : absente des séances générées avant l'ajout du champ.
const categoryMeta = computed(() =>
  session.value?.category
    ? (SESSION_CATEGORY_META[session.value.category as SessionCategory] ?? null)
    : null,
)

function notifyError(e: any, title = 'Échec') {
  toast.add({
    title,
    description: e?.data?.statusMessage ?? e?.message ?? 'Erreur inconnue',
    color: 'error',
    icon: 'i-lucide-triangle-alert',
  })
}

// Tant qu'une génération est en cours, on rafraîchit régulièrement jusqu'à ce que la séance arrive.
let pollTimer: ReturnType<typeof setInterval> | null = null
onMounted(() => {
  pollTimer = setInterval(() => {
    if (data.value?.generating) refresh()
  }, 4000)
})
onBeforeUnmount(() => {
  if (pollTimer) clearInterval(pollTimer)
})

async function regenerate() {
  regenLoading.value = true
  try {
    await $fetch('/api/sessions/generate', { method: 'POST', body: { regenerate: true } })
    showRegen.value = false
    await refresh()
    toast.add({
      title: 'Régénération lancée',
      description: 'Nouvelle séance en préparation…',
      icon: 'i-lucide-loader-circle',
      color: 'info',
    })
  } catch (e) {
    notifyError(e)
  } finally {
    regenLoading.value = false
  }
}

async function adjust() {
  const instruction = adjustInstruction.value.trim()
  if (!session.value || !instruction) return
  adjustLoading.value = true
  try {
    await $fetch(`/api/sessions/${session.value.date}/adjust`, {
      method: 'POST',
      body: { instruction },
    })
    showAdjust.value = false
    adjustInstruction.value = ''
    await refresh()
    toast.add({
      title: 'Ajustement en cours…',
      description: 'Ta séance se met à jour dans un instant.',
      icon: 'i-lucide-wand-sparkles',
      color: 'info',
    })
  } catch (e) {
    notifyError(e)
  } finally {
    adjustLoading.value = false
  }
}

async function generateNow() {
  regenLoading.value = true
  try {
    await $fetch('/api/sessions/generate', { method: 'POST', body: {} })
    await refresh()
    toast.add({ title: 'Séance en préparation…', icon: 'i-lucide-loader-circle', color: 'info' })
  } catch (e) {
    notifyError(e)
  } finally {
    regenLoading.value = false
  }
}

async function deleteSession() {
  if (!session.value) return
  deleteLoading.value = true
  try {
    await $fetch(`/api/sessions/${session.value.date}`, { method: 'DELETE' })
    showDelete.value = false
    await refresh()
    toast.add({ title: 'Séance supprimée', icon: 'i-lucide-trash-2', color: 'success' })
  } catch (e) {
    notifyError(e)
  } finally {
    deleteLoading.value = false
  }
}

/** Séance sur mesure lancée : la génération tourne en fond, le polling l'affichera. */
async function customDone() {
  showCustom.value = false
  await refresh()
}

async function rescheduleDone(): Promise<void> {
  await refresh()
}

async function swap(blockIndex: number, exerciseIndex: number, action: 'replace' | 'remove') {
  if (!session.value) return
  busyKey.value = `${blockIndex}-${exerciseIndex}`
  try {
    await $fetch(`/api/sessions/${session.value.date}/swap-exercise`, {
      method: 'POST',
      body: { blockIndex, exerciseIndex, action, reasonCode: swapReasonCode.value ?? null },
    })
    showSwapReason.value = false
    pendingSwap.value = null
    swapReasonCode.value = undefined
    await refresh()
    toast.add({
      title: action === 'remove' ? 'Exercice retiré' : 'Exercice remplacé',
      icon: 'i-lucide-check',
      color: 'success',
    })
  } catch (e) {
    notifyError(e)
  } finally {
    busyKey.value = null
  }
}

function requestSwap(blockIndex: number, exerciseIndex: number, action: 'replace' | 'remove') {
  pendingSwap.value = { blockIndex, exerciseIndex, action }
  swapReasonCode.value = undefined
  showSwapReason.value = true
}

async function confirmSwap() {
  if (!pendingSwap.value) return
  await swap(
    pendingSwap.value.blockIndex,
    pendingSwap.value.exerciseIndex,
    pendingSwap.value.action,
  )
}

function closeSwapDialog(): void {
  showSwapReason.value = false
}
</script>

<template>
  <div class="space-y-5 p-4">
    <header class="flex items-center justify-between">
      <div>
        <p class="text-xs uppercase tracking-wide text-dimmed">
          {{ data ? capitalize(formatDateFr(data.date)) : '' }}
        </p>
        <h1 class="text-2xl font-bold">Aujourd'hui</h1>
      </div>
      <UDropdownMenu
        v-if="session"
        :items="[
          {
            label: 'Ajuster la séance',
            icon: 'i-lucide-wand-sparkles',
            onSelect: () => (showAdjust = true),
          },
          {
            label: 'Régénérer la séance',
            icon: 'i-lucide-refresh-cw',
            onSelect: () => (showRegen = true),
          },
          {
            label: 'Reporter à une autre date',
            icon: 'i-lucide-calendar-clock',
            onSelect: () => (showReschedule = true),
          },
          {
            label: 'Supprimer la séance',
            icon: 'i-lucide-trash-2',
            color: 'error',
            onSelect: () => (showDelete = true),
          },
        ]"
        :content="{ align: 'end' }"
      >
        <UButton icon="i-lucide-ellipsis-vertical" color="neutral" variant="ghost" />
      </UDropdownMenu>
    </header>

    <div v-if="!data" class="space-y-3">
      <USkeleton class="h-40 w-full rounded-xl" />
      <USkeleton class="h-24 w-full rounded-xl" />
      <USkeleton class="h-24 w-full rounded-xl" />
    </div>

    <template v-else>
      <!-- Onboarding non terminé -->
      <UAlert
        v-if="!data.onboardingCompleted"
        color="info"
        variant="soft"
        icon="i-lucide-sparkles"
        title="Bienvenue sur Tanden Boxing !"
        description="Réponds à quelques questions pour calibrer tes séances."
        :actions="[{ label: 'Commencer', to: '/onboarding', color: 'info' }]"
        class="mb-1"
      />

      <!-- Séance prête -->
      <template v-if="session">
        <UAlert
          v-if="data.generating"
          color="info"
          variant="soft"
          icon="i-lucide-loader-circle"
          title="Régénération en cours…"
          description="Ta séance va se mettre à jour dans un instant."
          :ui="{ icon: 'animate-spin' }"
        />

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
              <UBadge color="primary" variant="soft" :icon="FOCUS_META[session.focus]?.icon">
                {{ FOCUS_META[session.focus]?.label ?? session.focus }}
              </UBadge>
              <UBadge
                v-if="session.status === 'completed'"
                color="success"
                variant="soft"
                icon="i-lucide-check"
              >
                Terminée
              </UBadge>
            </div>

            <h2 class="text-xl font-bold leading-tight">{{ session.structure.title }}</h2>
            <p class="text-sm text-muted">{{ session.structure.summary }}</p>

            <div class="flex gap-4 text-sm">
              <span class="flex items-center gap-1.5">
                <UIcon name="i-lucide-clock" class="size-4 text-primary" />
                {{ formatDuration(totalSeconds) }}
              </span>
              <span class="flex items-center gap-1.5">
                <UIcon name="i-lucide-layers" class="size-4 text-primary" />
                {{ session.structure.blocks.length }} blocs
              </span>
            </div>

            <div
              v-if="session.coachNote"
              class="rounded-lg border border-primary/20 bg-primary/5 p-3 text-sm"
            >
              <p class="mb-1 flex items-center gap-1.5 font-medium text-primary">
                <UIcon name="i-lucide-message-circle" class="size-4" /> Mot du coach
              </p>
              <p class="whitespace-pre-line text-muted">{{ session.coachNote }}</p>
            </div>
          </div>
        </UCard>

        <div class="space-y-6">
          <BlockCard
            v-for="(block, bi) in session.structure.blocks"
            :key="bi"
            :block="block"
            :block-index="bi"
            :editable="session.status !== 'completed'"
            :busy-key="busyKey"
            @replace="(ei) => requestSwap(bi, ei, 'replace')"
            @remove="(ei) => requestSwap(bi, ei, 'remove')"
          />
        </div>

        <UButton
          block
          size="xl"
          color="primary"
          icon="i-lucide-play"
          :to="`/seance/${session.date}/timer`"
        >
          {{ session.status === 'completed' ? 'Refaire la séance' : 'Démarrer la séance' }}
        </UButton>
      </template>

      <!-- Génération en cours -->
      <UCard v-else-if="data.generating">
        <div class="flex flex-col items-center gap-3 py-10 text-center">
          <UIcon name="i-lucide-loader-circle" class="size-10 animate-spin text-primary" />
          <div>
            <h2 class="text-lg font-semibold">Séance en préparation…</h2>
            <p class="text-sm text-muted">
              Ton coach IA compose ta séance du jour. Ça prend une vingtaine de secondes.
            </p>
          </div>
        </div>
      </UCard>

      <!-- Séance supprimée volontairement : pas de régénération sans demande explicite -->
      <UCard v-else-if="data.dismissed && data.isTrainingDay">
        <div class="flex flex-col items-center gap-3 py-8 text-center">
          <UIcon name="i-lucide-calendar-off" class="size-10 text-muted" />
          <div>
            <h2 class="text-lg font-semibold">Pas de séance aujourd'hui</h2>
            <p class="text-sm text-muted">
              Tu as supprimé (ou déplacé) la séance du jour. Rien ne sera recréé automatiquement.
            </p>
          </div>
          <UButton
            v-if="data.hasApiKey"
            color="primary"
            icon="i-lucide-sparkles"
            :loading="regenLoading"
            @click="generateNow"
          >
            Générer une nouvelle séance
          </UButton>
        </div>
      </UCard>

      <!-- Jour de repos -->
      <UCard v-else-if="!data.isTrainingDay">
        <div class="flex flex-col items-center gap-3 py-6 text-center">
          <UIcon name="i-lucide-bed" class="size-12 text-muted" />
          <div>
            <h2 class="text-lg font-semibold">Jour de repos</h2>
            <p class="text-sm text-muted">
              Pas d'entraînement prévu aujourd'hui. Récupère bien&nbsp;!
            </p>
          </div>
          <UButton
            v-if="data.hasApiKey"
            color="neutral"
            variant="soft"
            icon="i-lucide-plus"
            :loading="regenLoading"
            @click="generateNow"
          >
            Générer une séance quand même
          </UButton>
        </div>
      </UCard>

      <!-- Clé API manquante -->
      <UAlert
        v-else-if="!data.hasApiKey"
        color="warning"
        variant="soft"
        icon="i-lucide-key-round"
        title="Clé API manquante"
        description="Configure NUXT_ANTHROPIC_API_KEY côté serveur pour générer automatiquement tes séances."
      />

      <!-- Échec de génération -->
      <UCard v-else>
        <div class="flex flex-col items-center gap-3 py-8 text-center">
          <UIcon name="i-lucide-triangle-alert" class="size-10 text-amber-400" />
          <div>
            <h2 class="text-lg font-semibold">Séance indisponible</h2>
            <p class="text-sm text-muted">La génération n'a pas abouti. Réessaie.</p>
          </div>
          <UButton
            color="primary"
            icon="i-lucide-refresh-cw"
            :loading="regenLoading"
            @click="generateNow"
          >
            Réessayer
          </UButton>
        </div>
      </UCard>

      <!-- Points d'entrée : séance sur mesure du jour + planification. -->
      <div class="grid grid-cols-2 gap-2">
        <UButton
          block
          color="neutral"
          variant="soft"
          icon="i-lucide-wand-sparkles"
          :disabled="!data.hasApiKey"
          @click="setDialog('custom', true)"
        >
          Séance sur mesure
        </UButton>
        <UButton block color="neutral" variant="ghost" icon="i-lucide-calendar-days" to="/planning">
          Planifier
        </UButton>
      </div>
    </template>

    <USlideover
      v-model:open="showCustom"
      title="Séance sur mesure"
      :description="
        session
          ? 'Compose ta séance du jour — elle remplacera la séance actuelle.'
          : 'Décris ce que tu veux : ton coach IA compose une séance unique pour aujourd\'hui.'
      "
    >
      <template #body>
        <PlanSessionForm v-if="data" :date="data.date" generate-only @done="customDone" />
      </template>
    </USlideover>

    <UModal
      v-model:open="showSwapReason"
      :title="
        pendingSwap?.action === 'remove' ? 'Retirer cet exercice ?' : 'Remplacer cet exercice ?'
      "
      description="Le motif est optionnel. S’il est renseigné, il aidera les prochaines séances."
    >
      <template #body>
        <USelect
          v-model="swapReasonCode"
          :items="swapReasonOptions"
          placeholder="Motif (optionnel)"
          class="w-full"
        />
        <p class="mt-2 text-xs text-muted">
          Douleur, matériel indisponible et mouvement impossible créent une exclusion stricte. Les
          autres motifs restent des préférences souples.
        </p>
      </template>
      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <UButton color="neutral" variant="ghost" @click="closeSwapDialog"> Annuler </UButton>
          <UButton
            :color="pendingSwap?.action === 'remove' ? 'error' : 'primary'"
            :icon="pendingSwap?.action === 'remove' ? 'i-lucide-trash-2' : 'i-lucide-refresh-cw'"
            :loading="busyKey !== null"
            @click="confirmSwap"
          >
            {{ pendingSwap?.action === 'remove' ? 'Retirer' : 'Remplacer' }}
          </UButton>
        </div>
      </template>
    </UModal>

    <UModal
      v-model:open="showRegen"
      title="Régénérer la séance ?"
      description="La séance actuelle sera remplacée par une nouvelle proposition de l'IA (~20 s)."
    >
      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <UButton color="neutral" variant="ghost" @click="setDialog('regenerate', false)">
            Annuler
          </UButton>
          <UButton
            color="primary"
            icon="i-lucide-refresh-cw"
            :loading="regenLoading"
            @click="regenerate"
          >
            Régénérer
          </UButton>
        </div>
      </template>
    </UModal>

    <UModal
      v-model:open="showAdjust"
      title="Ajuster la séance"
      description="Dis à ton coach ce que tu veux changer : il ajuste la séance en gardant sa catégorie et son focus."
    >
      <template #body>
        <div class="space-y-3">
          <UTextarea
            v-model="adjustInstruction"
            :rows="3"
            autofocus
            placeholder="ex : plus court aujourd'hui, j'ai 30 min"
            class="w-full"
          />
          <div class="flex flex-wrap gap-2">
            <button
              v-for="s in ADJUST_SUGGESTIONS"
              :key="s"
              type="button"
              class="rounded-full border border-default px-3 py-1 text-xs text-muted transition-colors hover:border-primary/40 hover:text-default"
              @click="adjustInstruction = s"
            >
              {{ s }}
            </button>
          </div>
        </div>
      </template>
      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <UButton color="neutral" variant="ghost" @click="setDialog('adjust', false)">
            Annuler
          </UButton>
          <UButton
            color="primary"
            icon="i-lucide-wand-sparkles"
            :loading="adjustLoading"
            :disabled="!adjustInstruction.trim()"
            @click="adjust"
          >
            Ajuster
          </UButton>
        </div>
      </template>
    </UModal>

    <RescheduleModal
      v-if="session"
      v-model:open="showReschedule"
      :date="session.date"
      @done="rescheduleDone"
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
  </div>
</template>
