<script setup lang="ts">
import {
  PREFERENCE_REASON_OPTIONS,
  preferenceReasonLabel,
  type ExercisePreferenceSummary,
  type PreferenceReasonCode,
} from '~~/shared/exercise-preferences'

useHead({ title: 'Réglages' })

const toast = useToast()

const { data: settingsData } = await useFetch('/api/settings', { key: 'settings' })
const { data: profileData } = await useFetch('/api/profile', { key: 'profile' })
const { data: preferenceData, refresh: refreshPreferences } = await useFetch<{
  asOfDate: string
  preferences: ExercisePreferenceSummary[]
}>('/api/preferences', { key: 'exercise-preferences' })

const MODELS = [
  { label: 'Opus 4.8 — qualité max', value: 'claude-opus-4-8' },
  { label: 'Sonnet 5 — équilibré', value: 'claude-sonnet-5' },
  { label: 'Haiku 4.5 — économique', value: 'claude-haiku-4-5-20251001' },
]
const DURATIONS = [30, 35, 40, 45, 50, 60].map((v) => ({ label: `${v} min`, value: v }))
const LEVELS = [
  { label: 'Débutant', value: 'debutant' },
  { label: 'Intermédiaire', value: 'intermediaire' },
  { label: 'Avancé', value: 'avance' },
]
const FITNESS = [
  { label: 'Sédentaire', value: 'sedentaire' },
  { label: 'Actif', value: 'actif' },
  { label: 'Sportif', value: 'sportif' },
]
const PREFERENCE_REASONS = PREFERENCE_REASON_OPTIONS.map(({ value, label }) => ({ value, label }))

const form = reactive({
  trainingDays: [...(settingsData.value?.trainingDays ?? [1, 3, 5])],
  generationTime: settingsData.value?.generationTime ?? '07:00',
  targetDurationMin: settingsData.value?.targetDurationMin ?? 45,
  timezone: settingsData.value?.timezone ?? 'Europe/Paris',
  aiModel: settingsData.value?.aiModel ?? 'claude-opus-4-8',
  weightTrackingEnabled: settingsData.value?.weightTrackingEnabled ?? true,
})

const profileForm = reactive({
  level: profileData.value?.level ?? 'debutant',
  fitnessLevel: profileData.value?.fitnessLevel ?? undefined,
  age: profileData.value?.age ?? null,
  constraints: profileData.value?.constraints ?? '',
})

const saving = ref(false)
const savingPreference = ref(false)
const deletingPreference = ref(false)
const editingPreference = ref<ExercisePreferenceSummary | null>(null)
const preferenceToDelete = ref<ExercisePreferenceSummary | null>(null)
const preferenceAction = ref<'liked' | 'disliked'>('liked')
const preferenceReason = ref<PreferenceReasonCode | undefined>()

function errorMessage(error: unknown): string | undefined {
  if (!error || typeof error !== 'object') return undefined
  const candidate = error as { data?: { statusMessage?: unknown }; message?: unknown }
  if (typeof candidate.data?.statusMessage === 'string') return candidate.data.statusMessage
  return typeof candidate.message === 'string' ? candidate.message : undefined
}

function editPreference(preference: ExercisePreferenceSummary) {
  editingPreference.value = preference
  preferenceAction.value =
    preference.score > 0 && !preference.strictExclusion ? 'liked' : 'disliked'
  preferenceReason.value =
    preference.reasonCodes.find((reason) => reason !== 'liked') ?? 'no_reason'
}

function closePreferenceEditor(): void {
  editingPreference.value = null
}

function requestPreferenceDeletion(preference: ExercisePreferenceSummary): void {
  preferenceToDelete.value = preference
}

function closePreferenceDeletion(): void {
  preferenceToDelete.value = null
}

function handlePreferenceEditorOpen(open: boolean): void {
  if (!open) closePreferenceEditor()
}

function handlePreferenceDeletionOpen(open: boolean): void {
  if (!open) closePreferenceDeletion()
}

async function savePreference() {
  if (!editingPreference.value) return
  savingPreference.value = true
  try {
    await $fetch(`/api/preferences/${encodeURIComponent(editingPreference.value.exerciseKey)}`, {
      method: 'PUT',
      body: {
        action: preferenceAction.value,
        reasonCode: preferenceAction.value === 'liked' ? 'liked' : (preferenceReason.value ?? null),
      },
    })
    await refreshPreferences()
    editingPreference.value = null
    toast.add({
      title: 'Préférence modifiée',
      description: 'Les prochaines séances utiliseront ce nouveau signal.',
      icon: 'i-lucide-check',
      color: 'success',
    })
  } catch (error: unknown) {
    toast.add({
      title: 'Échec',
      description: errorMessage(error),
      color: 'error',
      icon: 'i-lucide-triangle-alert',
    })
  } finally {
    savingPreference.value = false
  }
}

async function deletePreference() {
  if (!preferenceToDelete.value) return
  deletingPreference.value = true
  try {
    await $fetch(`/api/preferences/${encodeURIComponent(preferenceToDelete.value.exerciseKey)}`, {
      method: 'DELETE',
    })
    await refreshPreferences()
    preferenceToDelete.value = null
    toast.add({
      title: 'Préférence effacée',
      description: "L'exercice repart sans a priori appris.",
      icon: 'i-lucide-eraser',
      color: 'success',
    })
  } catch (error: unknown) {
    toast.add({
      title: 'Échec',
      description: errorMessage(error),
      color: 'error',
      icon: 'i-lucide-triangle-alert',
    })
  } finally {
    deletingPreference.value = false
  }
}

async function save() {
  saving.value = true
  try {
    await Promise.all([
      $fetch('/api/settings', { method: 'PUT', body: { ...form } }),
      $fetch('/api/profile', {
        method: 'PUT',
        body: {
          level: profileForm.level,
          fitnessLevel: profileForm.fitnessLevel ?? null,
          age: profileForm.age,
          constraints: profileForm.constraints || null,
        },
      }),
    ])
    toast.add({ title: 'Réglages enregistrés', icon: 'i-lucide-check', color: 'success' })
  } catch (e: any) {
    toast.add({
      title: 'Échec',
      description: e?.data?.statusMessage ?? e?.message,
      color: 'error',
      icon: 'i-lucide-triangle-alert',
    })
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div class="space-y-6 p-4">
    <h1 class="text-2xl font-bold">Réglages</h1>

    <!-- Cartes empilées en mobile, 2 colonnes en desktop -->
    <div class="grid gap-6 lg:grid-cols-2 lg:items-start">
      <!-- Entraînement -->
      <UCard>
        <template #header>
          <h2 class="flex items-center gap-2 font-semibold">
            <UIcon name="i-lucide-calendar-days" class="size-5 text-primary" /> Entraînement
          </h2>
        </template>
        <div class="space-y-4">
          <div>
            <label class="mb-2 block text-sm font-medium">Jours d'entraînement</label>
            <WeekdayPicker v-model="form.trainingDays" />
          </div>
          <div class="grid grid-cols-2 gap-3">
            <div>
              <label class="mb-1.5 block text-sm font-medium">Heure de génération</label>
              <UInput v-model="form.generationTime" type="time" />
            </div>
            <div>
              <label class="mb-1.5 block text-sm font-medium">Durée cible</label>
              <USelect v-model="form.targetDurationMin" :items="DURATIONS" />
            </div>
          </div>
          <div>
            <label class="mb-1.5 block text-sm font-medium">Fuseau horaire</label>
            <UInput v-model="form.timezone" placeholder="Europe/Paris" />
          </div>
        </div>
      </UCard>

      <!-- IA -->
      <UCard>
        <template #header>
          <h2 class="flex items-center gap-2 font-semibold">
            <UIcon name="i-lucide-sparkles" class="size-5 text-primary" /> Génération IA
          </h2>
        </template>
        <div>
          <label class="mb-1.5 block text-sm font-medium">Modèle Anthropic</label>
          <USelect v-model="form.aiModel" :items="MODELS" />
          <p class="mt-1.5 text-xs text-dimmed">
            1 génération par jour — le coût reste minime même avec Opus.
          </p>
        </div>
      </UCard>

      <!-- Profil -->
      <UCard>
        <template #header>
          <h2 class="flex items-center gap-2 font-semibold">
            <UIcon name="i-lucide-user" class="size-5 text-primary" /> Profil
          </h2>
        </template>
        <div class="space-y-4">
          <div class="grid grid-cols-2 gap-3">
            <div>
              <label class="mb-1.5 block text-sm font-medium">Niveau</label>
              <USelect v-model="profileForm.level" :items="LEVELS" />
            </div>
            <div>
              <label class="mb-1.5 block text-sm font-medium">Condition physique</label>
              <USelect v-model="profileForm.fitnessLevel" :items="FITNESS" placeholder="—" />
            </div>
          </div>
          <div>
            <label class="mb-1.5 block text-sm font-medium">Âge</label>
            <UInput v-model.number="profileForm.age" type="number" placeholder="ex : 32" />
          </div>
          <div>
            <label class="mb-1.5 block text-sm font-medium">Blessures / limitations</label>
            <UTextarea
              v-model="profileForm.constraints"
              :rows="2"
              placeholder="ex : épaule droite sensible…"
              class="w-full"
            />
          </div>
        </div>
      </UCard>

      <!-- Options -->
      <UCard>
        <template #header>
          <h2 class="flex items-center gap-2 font-semibold">
            <UIcon name="i-lucide-sliders-horizontal" class="size-5 text-primary" /> Options
          </h2>
        </template>
        <div class="space-y-4">
          <div class="flex items-center justify-between gap-4">
            <div>
              <p class="text-sm font-medium">Suivi du poids</p>
              <p class="text-xs text-muted">Affiche la saisie et la courbe de poids.</p>
            </div>
            <USwitch v-model="form.weightTrackingEnabled" />
          </div>
          <div class="flex items-center justify-between gap-4 opacity-60">
            <div>
              <p class="text-sm font-medium">Protection par mot de passe</p>
              <p class="text-xs text-muted">À venir — l'appli est en accès libre.</p>
            </div>
            <USwitch :model-value="false" disabled />
          </div>
        </div>
      </UCard>

      <!-- Préférences apprises -->
      <UCard class="lg:col-span-2">
        <template #header>
          <div>
            <h2 class="flex items-center gap-2 font-semibold">
              <UIcon name="i-lucide-brain" class="size-5 text-primary" /> Préférences d'exercice
            </h2>
            <p class="mt-1 text-xs text-muted">
              Issues de tes avis, remplacements et retraits. Tu gardes toujours le dernier mot.
            </p>
          </div>
        </template>

        <div v-if="preferenceData?.preferences.length" class="divide-y divide-default">
          <div
            v-for="preference in preferenceData.preferences"
            :key="preference.exerciseKey"
            class="flex flex-col gap-3 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-center"
          >
            <div class="min-w-0 flex-1">
              <div class="flex flex-wrap items-center gap-2">
                <p class="truncate text-sm font-medium">{{ preference.exerciseName }}</p>
                <UBadge v-if="preference.strictExclusion" color="error" variant="soft" size="sm">
                  Exclusion stricte
                </UBadge>
                <UBadge
                  v-else
                  :color="preference.score > 0 ? 'success' : 'warning'"
                  variant="soft"
                  size="sm"
                >
                  {{ preference.score > 0 ? 'À favoriser' : 'À éviter' }}
                </UBadge>
              </div>
              <p class="mt-1 text-xs text-muted">
                {{ preference.eventCount }} {{ preference.eventCount > 1 ? 'signaux' : 'signal' }} ·
                confiance {{ Math.round(preference.confidence * 100) }} % ·
                {{ preference.reasonCodes.map(preferenceReasonLabel).join(', ') }}
              </p>
            </div>
            <div class="flex shrink-0 gap-2">
              <UButton
                size="sm"
                color="neutral"
                variant="soft"
                icon="i-lucide-pencil"
                @click="editPreference(preference)"
              >
                Modifier
              </UButton>
              <UButton
                size="sm"
                color="error"
                variant="ghost"
                icon="i-lucide-trash-2"
                aria-label="Effacer la préférence"
                @click="requestPreferenceDeletion(preference)"
              />
            </div>
          </div>
        </div>
        <div v-else class="py-4 text-center text-sm text-muted">
          Aucune préférence apprise pour le moment.
        </div>
      </UCard>
    </div>

    <div class="lg:flex lg:justify-end">
      <UButton
        block
        size="xl"
        color="primary"
        icon="i-lucide-save"
        class="lg:w-auto"
        :loading="saving"
        @click="save"
      >
        Enregistrer
      </UButton>
    </div>

    <!-- Accès secondaires (repris dans la barre latérale en desktop). -->
    <div class="grid gap-3 sm:grid-cols-2">
      <NuxtLink
        to="/glossaire"
        class="flex items-center gap-3 rounded-xl border border-default p-4 transition-colors hover:border-primary/40"
      >
        <UIcon name="i-lucide-book-open" class="size-5 text-primary" />
        <div>
          <p class="text-sm font-medium">Glossaire</p>
          <p class="text-xs text-muted">Les termes de boxe expliqués</p>
        </div>
      </NuxtLink>
      <NuxtLink
        to="/conso"
        class="flex items-center gap-3 rounded-xl border border-default p-4 transition-colors hover:border-primary/40"
      >
        <UIcon name="i-lucide-coins" class="size-5 text-primary" />
        <div>
          <p class="text-sm font-medium">Consommation IA</p>
          <p class="text-xs text-muted">Tokens & coût estimé</p>
        </div>
      </NuxtLink>
    </div>

    <UModal
      :open="editingPreference !== null"
      title="Modifier la préférence"
      :description="editingPreference?.exerciseName"
      @update:open="handlePreferenceEditorOpen"
    >
      <template #body>
        <div class="space-y-4">
          <UFormField label="Préférence">
            <USelect
              v-model="preferenceAction"
              :items="[
                { label: 'À favoriser', value: 'liked' },
                { label: 'À éviter', value: 'disliked' },
              ]"
              class="w-full"
            />
          </UFormField>
          <UFormField v-if="preferenceAction === 'disliked'" label="Motif">
            <USelect v-model="preferenceReason" :items="PREFERENCE_REASONS" class="w-full" />
          </UFormField>
          <p class="text-xs text-muted">
            Enregistrer remplace les anciens signaux de cet exercice par ce choix explicite.
          </p>
        </div>
      </template>
      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <UButton color="neutral" variant="ghost" @click="closePreferenceEditor">
            Annuler
          </UButton>
          <UButton icon="i-lucide-save" :loading="savingPreference" @click="savePreference">
            Enregistrer
          </UButton>
        </div>
      </template>
    </UModal>

    <UModal
      :open="preferenceToDelete !== null"
      title="Effacer cette préférence ?"
      :description="`Tous les signaux appris pour « ${preferenceToDelete?.exerciseName ?? ''} » seront supprimés.`"
      @update:open="handlePreferenceDeletionOpen"
    >
      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <UButton color="neutral" variant="ghost" @click="closePreferenceDeletion">
            Annuler
          </UButton>
          <UButton
            color="error"
            icon="i-lucide-trash-2"
            :loading="deletingPreference"
            @click="deletePreference"
          >
            Effacer
          </UButton>
        </div>
      </template>
    </UModal>
  </div>
</template>
