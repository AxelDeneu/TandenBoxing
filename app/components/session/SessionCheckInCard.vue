<script setup lang="ts">
import {
  BODY_AREA_OPTIONS,
  SESSION_INTENTION_OPTIONS,
  type BodyArea,
  type SessionCheckIn,
  type SessionIntention,
} from '~~/shared/session-autoregulation'

const props = defineProps<{ durationMin: number; loading?: boolean }>()
const emit = defineEmits<{
  submit: [value: SessionCheckIn]
  skip: []
}>()

const availableTimeMin = ref(Math.min(90, Math.max(10, props.durationMin)))
const energy = ref(3)
const sorenessLevel = ref(0)
const sorenessLocations = ref<BodyArea[]>([])
const painLocations = ref<BodyArea[]>([])
const intention = ref<SessionIntention>('maintain')

function toggle(list: BodyArea[], value: BodyArea): void {
  const index = list.indexOf(value)
  if (index >= 0) list.splice(index, 1)
  else list.push(value)
}

function submit(): void {
  emit('submit', {
    availableTimeMin: availableTimeMin.value,
    energy: energy.value,
    sorenessLevel: sorenessLevel.value,
    sorenessLocations: sorenessLevel.value > 0 ? sorenessLocations.value : [],
    painLocations: painLocations.value,
    intention: intention.value,
  })
}
</script>

<template>
  <div class="mx-auto flex min-h-dvh w-full max-w-xl items-center p-4">
    <UCard class="w-full">
      <template #header>
        <div>
          <p class="text-xs font-medium uppercase tracking-wider text-primary">Facultatif · 30 s</p>
          <h1 class="mt-1 text-xl font-bold">Comment tu te sens aujourd’hui&nbsp;?</h1>
          <p class="mt-1 text-sm text-muted">
            Ces réponses adaptent localement la séance avant de lancer le chrono.
          </p>
        </div>
      </template>

      <div class="space-y-5">
        <label class="block">
          <span class="flex justify-between text-sm font-medium">
            <span>Temps disponible</span><span>{{ availableTimeMin }} min</span>
          </span>
          <input
            v-model.number="availableTimeMin"
            type="range"
            min="10"
            max="90"
            step="5"
            class="mt-2 w-full accent-primary"
          />
        </label>

        <label class="block">
          <span class="flex justify-between text-sm font-medium">
            <span>Énergie</span><span>{{ energy }}/5</span>
          </span>
          <input
            v-model.number="energy"
            type="range"
            min="1"
            max="5"
            step="1"
            class="mt-2 w-full accent-primary"
          />
        </label>

        <div>
          <p class="text-sm font-medium">Courbatures</p>
          <div class="mt-2 grid grid-cols-4 gap-2">
            <button
              v-for="option in [
                { value: 0, label: 'Aucune' },
                { value: 1, label: 'Légères' },
                { value: 2, label: 'Marquées' },
                { value: 3, label: 'Fortes' },
              ]"
              :key="option.value"
              type="button"
              class="rounded-lg border px-2 py-2 text-xs transition-colors"
              :class="
                sorenessLevel === option.value
                  ? 'border-primary bg-primary/15 text-primary'
                  : 'border-default text-muted'
              "
              @click="sorenessLevel = option.value"
            >
              {{ option.label }}
            </button>
          </div>
          <div v-if="sorenessLevel > 0" class="mt-2 flex flex-wrap gap-1.5">
            <button
              v-for="area in BODY_AREA_OPTIONS"
              :key="area.value"
              type="button"
              class="rounded-full border px-2.5 py-1 text-xs"
              :class="
                sorenessLocations.includes(area.value)
                  ? 'border-primary bg-primary/15 text-primary'
                  : 'border-default text-muted'
              "
              @click="toggle(sorenessLocations, area.value)"
            >
              {{ area.label }}
            </button>
          </div>
        </div>

        <div>
          <p class="text-sm font-medium">Douleur localisée maintenant</p>
          <div class="mt-2 flex flex-wrap gap-1.5">
            <button
              v-for="area in BODY_AREA_OPTIONS"
              :key="area.value"
              type="button"
              class="rounded-full border px-2.5 py-1 text-xs"
              :class="
                painLocations.includes(area.value)
                  ? 'border-error bg-error/15 text-error'
                  : 'border-default text-muted'
              "
              @click="toggle(painLocations, area.value)"
            >
              {{ area.label }}
            </button>
          </div>
          <p v-if="painLocations.length" class="mt-2 text-xs text-amber-300">
            Les mouvements incompatibles seront retirés. Ne poursuis aucun mouvement douloureux ; si
            la douleur est forte, inhabituelle ou persiste, interromps la séance et demande un avis
            professionnel. Ceci n’est pas un diagnostic médical.
          </p>
        </div>

        <div>
          <p class="text-sm font-medium">Intention du jour</p>
          <div class="mt-2 grid grid-cols-2 gap-2">
            <button
              v-for="option in SESSION_INTENTION_OPTIONS"
              :key="option.value"
              type="button"
              class="rounded-lg border px-3 py-2 text-sm"
              :class="
                intention === option.value
                  ? 'border-primary bg-primary/15 text-primary'
                  : 'border-default text-muted'
              "
              @click="intention = option.value"
            >
              {{ option.label }}
            </button>
          </div>
        </div>
      </div>

      <template #footer>
        <div class="flex flex-col gap-2 sm:flex-row-reverse">
          <UButton block size="lg" icon="i-lucide-sparkles" :loading="loading" @click="submit">
            Adapter et démarrer
          </UButton>
          <UButton block size="lg" color="neutral" variant="ghost" @click="emit('skip')">
            Passer le check-in
          </UButton>
        </div>
      </template>
    </UCard>
  </div>
</template>
