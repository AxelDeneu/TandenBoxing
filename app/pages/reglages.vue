<script setup lang="ts">
useHead({ title: 'Réglages' })

const toast = useToast()

const { data: settingsData } = await useFetch('/api/settings', { key: 'settings' })
const { data: profileData } = await useFetch('/api/profile', { key: 'profile' })

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
  fitnessLevel: profileData.value?.fitnessLevel ?? null,
  age: profileData.value?.age ?? null,
  constraints: profileData.value?.constraints ?? '',
})

const saving = ref(false)
async function save() {
  saving.value = true
  try {
    await Promise.all([
      $fetch('/api/settings', { method: 'PUT', body: { ...form } }),
      $fetch('/api/profile', {
        method: 'PUT',
        body: {
          level: profileForm.level,
          fitnessLevel: profileForm.fitnessLevel,
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
  </div>
</template>
