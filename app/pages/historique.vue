<script setup lang="ts">
import type { SessionCategory } from '~/utils/session'

useHead({ title: 'Historique' })

interface SessionListItem {
  id: number
  date: string
  status: string
  title: string
  /** Catégorie (type) de la séance ; null pour les séances antérieures au champ. */
  category: string | null
  focus: string
  estimatedDurationMin: number
  actualDurationSec: number | null
  difficulty: number | null
}

const { data } = await useFetch<SessionListItem[]>('/api/sessions', { key: 'sessions-list' })

const STATUS: Record<string, { label: string; color: any; icon: string }> = {
  completed: { label: 'Terminée', color: 'success', icon: 'i-lucide-check' },
  generated: { label: 'À faire', color: 'primary', icon: 'i-lucide-play' },
  in_progress: { label: 'En cours', color: 'warning', icon: 'i-lucide-loader' },
  skipped: { label: 'Manquée', color: 'neutral', icon: 'i-lucide-x' },
  planned: { label: 'Prévue', color: 'neutral', icon: 'i-lucide-clock' },
}

/** Lignes prêtes à l'affichage : catégorie résolue une seule fois (tolérante aux anciennes séances). */
const rows = computed(() =>
  (data.value ?? []).map((s) => ({
    ...s,
    categoryMeta: s.category
      ? (SESSION_CATEGORY_META[s.category as SessionCategory] ?? null)
      : null,
  })),
)
</script>

<template>
  <div class="space-y-4 p-4">
    <h1 class="text-2xl font-bold">Historique</h1>

    <div
      v-if="!rows.length"
      class="flex flex-col items-center gap-2 rounded-xl border border-dashed border-default py-12 text-center"
    >
      <UIcon name="i-lucide-history" class="size-10 text-muted" />
      <p class="text-muted">Aucune séance pour le moment.</p>
    </div>

    <div v-else class="space-y-2">
      <NuxtLink v-for="s in rows" :key="s.id" :to="`/seance/${s.date}`" class="block">
        <div
          class="flex items-center gap-3 rounded-xl border border-default p-3 transition-colors hover:border-primary/40"
        >
          <div class="min-w-0 flex-1">
            <p class="text-xs text-dimmed">{{ capitalize(formatDateFr(s.date)) }}</p>
            <p class="truncate font-medium">{{ s.title }}</p>
            <div class="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
              <UBadge
                :color="STATUS[s.status]?.color ?? 'neutral'"
                variant="soft"
                size="sm"
                :icon="STATUS[s.status]?.icon"
              >
                {{ STATUS[s.status]?.label ?? s.status }}
              </UBadge>
              <UBadge
                v-if="s.categoryMeta"
                color="neutral"
                variant="soft"
                size="sm"
                :icon="s.categoryMeta.icon"
                :ui="{ leadingIcon: s.categoryMeta.iconClass }"
              >
                {{ s.categoryMeta.label }}
              </UBadge>
              <span class="text-xs text-muted">{{ FOCUS_META[s.focus]?.label ?? s.focus }}</span>
              <span v-if="s.difficulty" class="text-xs text-muted">
                · difficulté {{ s.difficulty }}/5
              </span>
            </div>
          </div>
          <UIcon name="i-lucide-chevron-right" class="size-5 shrink-0 text-dimmed" />
        </div>
      </NuxtLink>
    </div>
  </div>
</template>
