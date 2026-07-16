<script setup lang="ts">
useHead({ title: 'Statistiques' })

const toast = useToast()
const { data: stats, refresh } = await useFetch('/api/stats', { key: 'stats' })

const TEXT = '#a1a1aa'
const GRID = 'rgba(255,255,255,0.06)'

const baseOptions = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: { legend: { labels: { color: TEXT, boxWidth: 12, font: { size: 11 } } } },
  scales: {
    x: { ticks: { color: TEXT, font: { size: 10 } }, grid: { color: GRID } },
    y: { ticks: { color: TEXT, font: { size: 10 } }, grid: { color: GRID } },
  },
}

const weeklyChart = computed(() => ({
  labels: (stats.value?.weeklyCounts ?? []).map((w) => formatDateShort(w.weekStart)),
  datasets: [
    {
      label: 'Séances',
      data: (stats.value?.weeklyCounts ?? []).map((w) => w.count),
      backgroundColor: 'rgba(244,63,94,0.6)',
      borderRadius: 6,
    },
  ],
}))
const weeklyOptions = {
  ...baseOptions,
  scales: {
    ...baseOptions.scales,
    y: {
      ...baseOptions.scales.y,
      beginAtZero: true,
      ticks: { ...baseOptions.scales.y.ticks, precision: 0 },
    },
  },
}

const trendChart = computed(() => ({
  labels: (stats.value?.difficultySeries ?? []).map((d) => formatDateShort(d.date)),
  datasets: [
    {
      label: 'Difficulté',
      data: (stats.value?.difficultySeries ?? []).map((d) => d.difficulty),
      borderColor: '#f43f5e',
      backgroundColor: '#f43f5e',
      tension: 0.3,
      spanGaps: true,
    },
    {
      label: 'Énergie',
      data: (stats.value?.difficultySeries ?? []).map((d) => d.energy),
      borderColor: '#34d399',
      backgroundColor: '#34d399',
      tension: 0.3,
      spanGaps: true,
    },
  ],
}))
const trendOptions = {
  ...baseOptions,
  scales: { ...baseOptions.scales, y: { ...baseOptions.scales.y, min: 0, max: 5 } },
}

const weightChart = computed(() => ({
  labels: (stats.value?.weights ?? []).map((w) => formatDateShort(w.date)),
  datasets: [
    {
      label: 'Poids (kg)',
      data: (stats.value?.weights ?? []).map((w) => w.weightKg),
      borderColor: '#60a5fa',
      backgroundColor: '#60a5fa',
      tension: 0.3,
    },
  ],
}))

const newWeight = ref<number | null>(null)
const savingWeight = ref(false)
async function saveWeight() {
  if (!newWeight.value) return
  savingWeight.value = true
  try {
    await $fetch('/api/weights', { method: 'POST', body: { weightKg: newWeight.value } })
    newWeight.value = null
    await refresh()
    toast.add({ title: 'Poids enregistré', icon: 'i-lucide-check', color: 'success' })
  } catch (e: any) {
    toast.add({ title: 'Échec', description: e?.data?.statusMessage ?? e?.message, color: 'error' })
  } finally {
    savingWeight.value = false
  }
}
</script>

<template>
  <div class="space-y-5 p-4">
    <h1 class="text-2xl font-bold">Statistiques</h1>

    <template v-if="stats">
      <!-- Tuiles -->
      <div class="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div class="rounded-xl border border-default p-4">
          <div class="flex items-center gap-2 text-primary">
            <UIcon name="i-lucide-flame" class="size-5" />
            <span class="text-2xl font-bold">{{ stats.streak }}</span>
          </div>
          <p class="mt-1 text-xs text-muted">Série (jours d'entraînement)</p>
        </div>
        <div class="rounded-xl border border-default p-4">
          <div class="flex items-center gap-2 text-primary">
            <UIcon name="i-lucide-calendar-check" class="size-5" />
            <span class="text-2xl font-bold"
              >{{ stats.thisWeekCount }}/{{ stats.weeklyTarget }}</span
            >
          </div>
          <p class="mt-1 text-xs text-muted">Cette semaine</p>
        </div>
        <div class="rounded-xl border border-default p-4">
          <div class="flex items-center gap-2 text-primary">
            <UIcon name="i-lucide-dumbbell" class="size-5" />
            <span class="text-2xl font-bold">{{ stats.totalSessions }}</span>
          </div>
          <p class="mt-1 text-xs text-muted">Séances totales</p>
        </div>
        <div class="rounded-xl border border-default p-4">
          <div class="flex items-center gap-2 text-primary">
            <UIcon name="i-lucide-clock" class="size-5" />
            <span class="text-2xl font-bold">{{ formatDuration(stats.totalMinutes * 60) }}</span>
          </div>
          <p class="mt-1 text-xs text-muted">Temps cumulé</p>
        </div>
      </div>

      <!-- Graphiques : empilés en mobile, 2 colonnes en desktop -->
      <div class="grid gap-5 lg:grid-cols-2 lg:items-start">
        <!-- Régularité -->
        <UCard>
          <template #header>
            <h2 class="text-sm font-semibold">Régularité (8 dernières semaines)</h2>
          </template>
          <div class="h-48 lg:h-56">
            <BarChart :data="weeklyChart" :options="weeklyOptions" />
          </div>
        </UCard>

        <!-- Difficulté / énergie -->
        <UCard v-if="stats.difficultySeries.length">
          <template #header>
            <h2 class="text-sm font-semibold">Difficulté & énergie ressenties</h2>
          </template>
          <div class="h-48 lg:h-56">
            <LineChart :data="trendChart" :options="trendOptions" />
          </div>
          <div class="mt-3 flex gap-4 text-xs text-muted">
            <span v-if="stats.avgDifficulty">Difficulté moy. : {{ stats.avgDifficulty }}/5</span>
            <span v-if="stats.avgEnergy">Énergie moy. : {{ stats.avgEnergy }}/5</span>
          </div>
        </UCard>

        <!-- Poids -->
        <UCard v-if="stats.weightTrackingEnabled" class="lg:col-span-2">
          <template #header>
            <h2 class="text-sm font-semibold">Poids</h2>
          </template>
          <div class="flex items-end gap-2 lg:max-w-md">
            <div class="flex-1">
              <label class="mb-1.5 block text-xs text-muted">Poids du jour (kg)</label>
              <UInput v-model.number="newWeight" type="number" step="0.1" placeholder="ex : 78.5" />
            </div>
            <UButton
              icon="i-lucide-plus"
              color="primary"
              :loading="savingWeight"
              :disabled="!newWeight"
              @click="saveWeight"
            >
              Ajouter
            </UButton>
          </div>
          <div v-if="stats.weights.length" class="mt-4 h-48 lg:h-56">
            <LineChart :data="weightChart" :options="baseOptions" />
          </div>
        </UCard>
      </div>
    </template>
  </div>
</template>
