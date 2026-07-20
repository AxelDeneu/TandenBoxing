<script setup lang="ts">
import type { ApiSession } from '~/utils/session'

useHead({ title: 'Noter la séance' })

const route = useRoute()
const date = route.params.date as string
const toast = useToast()

const { data } = await useFetch<ApiSession>(`/api/sessions/${date}`)

const SORENESS_ZONES = [
  'Épaules',
  'Bras',
  'Dos',
  'Pectoraux',
  'Abdos',
  'Jambes',
  'Mollets',
  'Poignets',
  'Aucune',
]

/** Durée mesurée par le timer (`?duree=` en secondes) — absente si la séance a été notée à la main. */
const timedSeconds = Number(route.query.duree)
const timedMinutes =
  Number.isFinite(timedSeconds) && timedSeconds > 0 ? Math.round(timedSeconds / 60) : null

const form = reactive({
  overallDifficulty: null as number | null,
  energyLevel: null as number | null,
  enjoyment: null as number | null,
  soreness: [] as string[],
  comment: '',
  actualDurationMin: timedMinutes,
})

const exercises = ref(
  (data.value?.structure.blocks ?? []).flatMap((b, bi) =>
    b.exercises.map((e, ei) => ({
      blockIndex: bi,
      exerciseIndex: ei,
      name: e.name,
      difficulty: null as number | null,
    })),
  ),
)

function toggleSoreness(zone: string) {
  if (zone === 'Aucune') {
    form.soreness = form.soreness.includes('Aucune') ? [] : ['Aucune']
    return
  }
  form.soreness = form.soreness.filter((z) => z !== 'Aucune')
  form.soreness = form.soreness.includes(zone)
    ? form.soreness.filter((z) => z !== zone)
    : [...form.soreness, zone]
}

const saving = ref(false)
async function submit() {
  saving.value = true
  try {
    await $fetch(`/api/sessions/${date}/feedback`, {
      method: 'POST',
      body: {
        completed: true,
        overallDifficulty: form.overallDifficulty,
        energyLevel: form.energyLevel,
        enjoyment: form.enjoyment,
        soreness: form.soreness,
        comment: form.comment || null,
        actualDurationSec: form.actualDurationMin ? Math.round(form.actualDurationMin * 60) : null,
        exercises: exercises.value.map((e) => ({
          blockIndex: e.blockIndex,
          exerciseIndex: e.exerciseIndex,
          exerciseName: e.name,
          difficulty: e.difficulty,
        })),
      },
    })
    toast.add({
      title: 'Feedback enregistré',
      description: 'Ta prochaine séance en tiendra compte.',
      icon: 'i-lucide-check',
      color: 'success',
    })
    await navigateTo('/historique')
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
    <header class="flex items-center gap-3">
      <UButton
        icon="i-lucide-arrow-left"
        color="neutral"
        variant="ghost"
        :to="`/seance/${date}/timer`"
        aria-label="Retour"
      />
      <div>
        <h1 class="text-2xl font-bold">Noter la séance</h1>
        <p class="text-sm text-muted">{{ data?.structure.title }}</p>
      </div>
    </header>

    <UAlert
      v-if="!data"
      color="warning"
      variant="soft"
      title="Séance introuvable"
      icon="i-lucide-triangle-alert"
    />

    <template v-else>
      <!-- Ressenti global -->
      <section class="space-y-4">
        <h2 class="text-sm font-bold uppercase tracking-wide text-muted">Ressenti global</h2>

        <div>
          <label class="mb-1.5 block text-sm font-medium">Difficulté de la séance</label>
          <RatingScale v-model="form.overallDifficulty" :labels="['Trop facile', 'Trop dure']" />
        </div>

        <div>
          <label class="mb-1.5 block text-sm font-medium">Niveau d'énergie</label>
          <RatingScale v-model="form.energyLevel" :labels="['Épuisé', 'Plein d\'énergie']" />
        </div>

        <div>
          <label class="mb-1.5 block text-sm font-medium">Plaisir / motivation</label>
          <RatingScale v-model="form.enjoyment" :labels="['Pénible', 'Kiffé']" />
        </div>
      </section>

      <!-- Courbatures -->
      <section>
        <h2 class="mb-2 text-sm font-bold uppercase tracking-wide text-muted">Courbatures</h2>
        <div class="flex flex-wrap gap-2">
          <button
            v-for="zone in SORENESS_ZONES"
            :key="zone"
            type="button"
            class="rounded-full border px-3 py-1.5 text-sm transition-colors"
            :class="
              form.soreness.includes(zone)
                ? 'border-primary bg-primary/15 text-primary'
                : 'border-default text-muted hover:border-primary/40'
            "
            @click="toggleSoreness(zone)"
          >
            {{ zone }}
          </button>
        </div>
      </section>

      <!-- Par exercice -->
      <section>
        <h2 class="mb-2 text-sm font-bold uppercase tracking-wide text-muted">
          Difficulté par exercice
        </h2>
        <div class="space-y-3">
          <div v-for="(ex, i) in exercises" :key="i" class="rounded-xl border border-default p-3">
            <p class="mb-2 text-sm font-medium">{{ ex.name }}</p>
            <RatingScale v-model="ex.difficulty" />
          </div>
        </div>
      </section>

      <!-- Divers -->
      <section class="space-y-4">
        <div>
          <label class="mb-1.5 block text-sm font-medium">Durée réelle (min, optionnel)</label>
          <UInput
            v-model.number="form.actualDurationMin"
            type="number"
            placeholder="ex : 43"
            icon="i-lucide-clock"
          />
          <p v-if="timedMinutes" class="mt-1.5 text-xs text-muted">
            Mesurée par le timer, pauses déduites. Ajuste si besoin.
          </p>
        </div>
        <div>
          <label class="mb-1.5 block text-sm font-medium">Commentaire (optionnel)</label>
          <UTextarea
            v-model="form.comment"
            :rows="3"
            placeholder="Sensations, douleurs, remarques pour le coach…"
            class="w-full"
          />
        </div>
      </section>

      <UButton
        block
        size="xl"
        color="primary"
        icon="i-lucide-check"
        :loading="saving"
        @click="submit"
      >
        Enregistrer et terminer
      </UButton>
    </template>
  </div>
</template>
