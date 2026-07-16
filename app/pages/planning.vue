<script setup lang="ts">
import { addMonths, monthGridDays, monthLabel, startOfMonth, todayIso } from '~~/shared/dates'
import type { CalendarDay, TodayResponse } from '~/utils/session'

useHead({ title: 'Planning' })

/** Repli SSR-stable tant que le fuseau réglé par l'utilisateur n'est pas connu. */
const FALLBACK_TZ = 'Europe/Paris'

// Même clé que la page d'accueil : la date du jour vient du fuseau réglé côté serveur.
const { data: todayData } = await useFetch<TodayResponse>('/api/sessions/today', {
  key: 'today',
  lazy: true,
})
const today = computed(() => todayData.value?.date ?? todayIso(FALLBACK_TZ))

/** Mois affiché (ancré sur son 1er jour). */
const anchor = ref(startOfMonth(todayIso(FALLBACK_TZ)))

/** Bornes de la grille affichée (42 jours, débordements de mois inclus). */
const range = computed(() => {
  const grid = monthGridDays(anchor.value)
  return { from: grid[0]!, to: grid[grid.length - 1]! }
})

const {
  data: days,
  refresh,
  status,
} = await useFetch<CalendarDay[]>('/api/calendar', {
  query: computed(() => ({ from: range.value.from, to: range.value.to })),
  lazy: true,
})

const selectedDate = ref<string | null>(null)
const drawerOpen = ref(false)

/** Le jour ouvert dans le tiroir suit les données rafraîchies (après mutation). */
const selectedDay = computed<CalendarDay | null>(() => {
  if (!selectedDate.value) return null
  return (
    days.value?.find((d) => d.date === selectedDate.value) ?? {
      date: selectedDate.value,
      isTrainingDay: false,
      session: null,
      plan: null,
    }
  )
})

function openDay(date: string) {
  selectedDate.value = date
  drawerOpen.value = true
}

function shift(months: number) {
  anchor.value = addMonths(anchor.value, months)
}

function goToday() {
  anchor.value = startOfMonth(today.value)
}
</script>

<template>
  <div class="space-y-4 p-4">
    <header class="flex items-center justify-between gap-3">
      <div class="min-w-0">
        <p class="text-xs uppercase tracking-wide text-dimmed">Planning</p>
        <h1 class="truncate text-2xl font-bold">{{ capitalize(monthLabel(anchor)) }}</h1>
      </div>

      <div class="flex shrink-0 items-center gap-1">
        <UButton
          icon="i-lucide-chevron-left"
          color="neutral"
          variant="ghost"
          aria-label="Mois précédent"
          @click="shift(-1)"
        />
        <UButton color="neutral" variant="soft" size="sm" @click="goToday">Aujourd'hui</UButton>
        <UButton
          icon="i-lucide-chevron-right"
          color="neutral"
          variant="ghost"
          aria-label="Mois suivant"
          @click="shift(1)"
        />
      </div>
    </header>

    <USkeleton v-if="!days" class="h-96 w-full rounded-xl" />
    <SessionCalendar
      v-else
      :days="days"
      :anchor="anchor"
      :today="today"
      class="transition-opacity"
      :class="status === 'pending' && 'opacity-60'"
      @select="openDay"
    />

    <p class="text-center text-xs text-dimmed">
      Touche un jour pour planifier, générer ou modifier une séance.
    </p>

    <DayPlanDrawer v-model:open="drawerOpen" :day="selectedDay" @changed="refresh" />
  </div>
</template>
