<script setup lang="ts">
import type { ApiSession } from '~/utils/session'

interface SessionDetail extends ApiSession {
  feedback: {
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
const { data, error } = await useFetch<SessionDetail>(`/api/sessions/${date}`)

useHead({ title: () => data.value?.structure.title ?? 'Séance' })

const totalSeconds = computed(() => (data.value ? estimateSessionSeconds(data.value.structure) : 0))
const showReschedule = ref(false)
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
            <UBadge color="primary" variant="soft" :icon="FOCUS_META[data.focus]?.icon">
              {{ FOCUS_META[data.focus]?.label ?? data.focus }}
            </UBadge>
            <UBadge
              v-if="data.status === 'completed'"
              color="success"
              variant="soft"
              icon="i-lucide-check"
            >
              Terminée
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

      <!-- Récap feedback -->
      <UCard v-if="data.feedback">
        <template #header>
          <h2 class="flex items-center gap-2 text-sm font-semibold">
            <UIcon name="i-lucide-clipboard-check" class="size-4 text-primary" /> Ton feedback
          </h2>
        </template>
        <div class="grid grid-cols-3 gap-3 text-center">
          <div>
            <p class="text-lg font-bold">
              {{ data.feedback.overallDifficulty ?? '—'
              }}<span class="text-sm text-dimmed">/5</span>
            </p>
            <p class="text-xs text-muted">Difficulté</p>
          </div>
          <div>
            <p class="text-lg font-bold">
              {{ data.feedback.energyLevel ?? '—' }}<span class="text-sm text-dimmed">/5</span>
            </p>
            <p class="text-xs text-muted">Énergie</p>
          </div>
          <div>
            <p class="text-lg font-bold">
              {{ data.feedback.enjoyment ?? '—' }}<span class="text-sm text-dimmed">/5</span>
            </p>
            <p class="text-xs text-muted">Plaisir</p>
          </div>
        </div>
        <div v-if="data.feedback.soreness?.length" class="mt-3 flex flex-wrap gap-1.5">
          <UBadge
            v-for="z in data.feedback.soreness"
            :key="z"
            color="neutral"
            variant="soft"
            size="sm"
          >
            {{ z }}
          </UBadge>
        </div>
        <p v-if="data.feedback.comment" class="mt-3 text-sm text-muted">
          « {{ data.feedback.comment }} »
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
        block
        color="neutral"
        variant="ghost"
        icon="i-lucide-calendar-clock"
        @click="showReschedule = true"
      >
        Reporter à une autre date
      </UButton>

      <RescheduleModal
        v-model:open="showReschedule"
        :date="data.date"
        @done="() => navigateTo('/historique')"
      />
    </template>
  </div>
</template>
