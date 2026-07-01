<script setup lang="ts">
useHead({ title: 'Bienvenue' })

const toast = useToast()

const FITNESS = [
  { value: 'sedentaire', label: 'Sédentaire', hint: 'Peu ou pas de sport' },
  { value: 'actif', label: 'Actif', hint: 'Un peu de sport régulier' },
  { value: 'sportif', label: 'Sportif', hint: 'Sport plusieurs fois/semaine' },
]

const DURATIONS = [
  { label: '30 min', value: 30 },
  { label: '35 min', value: 35 },
  { label: '40 min', value: 40 },
  { label: '45 min', value: 45 },
]

const form = reactive({
  fitnessLevel: null as string | null,
  experience: '',
  age: null as number | null,
  constraints: '',
  trainingDays: [1, 3, 5],
  generationTime: '07:00',
  targetDurationMin: 45,
})

const saving = ref(false)

async function submit() {
  if (!form.fitnessLevel) {
    toast.add({ title: 'Indique ta condition physique', color: 'warning' })
    return
  }
  if (!form.trainingDays.length) {
    toast.add({ title: 'Choisis au moins un jour', color: 'warning' })
    return
  }
  saving.value = true
  try {
    await $fetch('/api/onboarding', {
      method: 'POST',
      body: {
        fitnessLevel: form.fitnessLevel,
        experience: form.experience || null,
        age: form.age,
        constraints: form.constraints || null,
        trainingDays: form.trainingDays,
        generationTime: form.generationTime,
        targetDurationMin: form.targetDurationMin,
      },
    })
    toast.add({
      title: "C'est parti !",
      description: 'Ton profil est configuré.',
      icon: 'i-lucide-check',
      color: 'success',
    })
    await navigateTo('/')
  } catch (e: any) {
    toast.add({ title: 'Échec', description: e?.data?.statusMessage ?? e?.message, color: 'error' })
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div class="space-y-6 p-4">
    <header class="pt-2 text-center">
      <UIcon name="i-lucide-swords" class="mx-auto size-12 text-primary" />
      <h1 class="mt-2 text-2xl font-bold">Bienvenue sur Tanden Boxing</h1>
      <p class="mt-1 text-sm text-muted">Quelques questions pour calibrer tes séances de boxe.</p>
    </header>

    <section>
      <label class="mb-2 block text-sm font-medium">Ta condition physique actuelle</label>
      <div class="grid grid-cols-1 gap-2">
        <button
          v-for="f in FITNESS"
          :key="f.value"
          type="button"
          class="flex items-center justify-between rounded-xl border p-3 text-left transition-colors"
          :class="
            form.fitnessLevel === f.value
              ? 'border-primary bg-primary/10'
              : 'border-default hover:border-primary/40'
          "
          @click="form.fitnessLevel = f.value"
        >
          <div>
            <p class="font-medium">{{ f.label }}</p>
            <p class="text-xs text-muted">{{ f.hint }}</p>
          </div>
          <UIcon
            v-if="form.fitnessLevel === f.value"
            name="i-lucide-check-circle-2"
            class="size-5 text-primary"
          />
        </button>
      </div>
    </section>

    <section>
      <label class="mb-1.5 block text-sm font-medium">Ton expérience en boxe (optionnel)</label>
      <UTextarea
        v-model="form.experience"
        :rows="2"
        placeholder="ex : jamais fait de boxe, ou quelques cours il y a 2 ans…"
        class="w-full"
      />
    </section>

    <section class="grid grid-cols-2 gap-3">
      <div>
        <label class="mb-1.5 block text-sm font-medium">Âge (optionnel)</label>
        <UInput v-model.number="form.age" type="number" placeholder="ex : 32" />
      </div>
      <div>
        <label class="mb-1.5 block text-sm font-medium">Durée cible</label>
        <USelect v-model="form.targetDurationMin" :items="DURATIONS" />
      </div>
    </section>

    <section>
      <label class="mb-1.5 block text-sm font-medium"> Blessures / limitations (optionnel) </label>
      <UTextarea
        v-model="form.constraints"
        :rows="2"
        placeholder="ex : épaule droite sensible, genou fragile…"
        class="w-full"
      />
    </section>

    <section>
      <label class="mb-2 block text-sm font-medium">Tes jours d'entraînement</label>
      <WeekdayPicker v-model="form.trainingDays" />
      <p class="mt-1.5 text-xs text-dimmed">Minimum 3 jours conseillé.</p>
    </section>

    <section>
      <label class="mb-1.5 block text-sm font-medium">Heure de préparation de la séance</label>
      <UInput v-model="form.generationTime" type="time" />
      <p class="mt-1.5 text-xs text-dimmed">
        Ta séance sera générée automatiquement à cette heure les jours d'entraînement.
      </p>
    </section>

    <UButton
      block
      size="xl"
      color="primary"
      icon="i-lucide-rocket"
      :loading="saving"
      @click="submit"
    >
      Commencer l'aventure
    </UButton>
  </div>
</template>
