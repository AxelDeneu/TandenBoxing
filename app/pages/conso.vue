<script setup lang="ts">
import { modelLabel } from '~~/shared/ai-pricing'

useHead({ title: 'Consommation IA' })

const { data } = await useFetch('/api/usage', { key: 'usage' })

const KIND_LABELS: Record<string, string> = {
  seance: 'Séances',
  exercice: 'Remplacements d’exercice',
  ajustement: 'Ajustements',
}

/** « 12,3k » — compact pour les gros compteurs de tokens. */
function formatTokens(n: number): string {
  if (n < 1000) return String(n)
  return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0).replace('.', ',')}k`
}

/** Coût en USD, ou « — » si non estimable (modèle sans tarif de référence). */
function formatCost(usd: number | null): string {
  if (usd === null) return '—'
  if (usd === 0) return '0 $'
  if (usd < 0.01) return '< 0,01 $'
  return `${usd.toFixed(2).replace('.', ',')} $`
}

/** Part des tokens d'entrée servis par le cache (économie effective). */
const cacheHitRate = computed(() => {
  const t = data.value?.total
  if (!t) return null
  const cacheable = t.inputTokens + t.cacheReadTokens
  if (cacheable === 0) return null
  return Math.round((t.cacheReadTokens / cacheable) * 100)
})
</script>

<template>
  <div class="space-y-5 p-4">
    <header class="flex items-center gap-3">
      <UButton
        icon="i-lucide-arrow-left"
        color="neutral"
        variant="ghost"
        to="/reglages"
        aria-label="Retour aux réglages"
      />
      <h1 class="text-2xl font-bold">Consommation IA</h1>
    </header>

    <template v-if="data">
      <!-- Tuiles : mois courant + total -->
      <div class="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div class="rounded-xl border border-default p-4">
          <div class="flex items-center gap-2 text-primary">
            <UIcon name="i-lucide-calendar" class="size-5" />
            <span class="text-2xl font-bold">{{ formatCost(data.thisMonth.costUsd) }}</span>
          </div>
          <p class="mt-1 text-xs text-muted">Ce mois-ci ({{ data.thisMonth.calls }} appels)</p>
        </div>
        <div class="rounded-xl border border-default p-4">
          <div class="flex items-center gap-2 text-primary">
            <UIcon name="i-lucide-coins" class="size-5" />
            <span class="text-2xl font-bold">{{ formatCost(data.total.costUsd) }}</span>
          </div>
          <p class="mt-1 text-xs text-muted">Total ({{ data.total.calls }} appels)</p>
        </div>
        <div class="rounded-xl border border-default p-4">
          <div class="flex items-center gap-2 text-primary">
            <UIcon name="i-lucide-arrow-down-to-line" class="size-5" />
            <span class="text-2xl font-bold">{{ formatTokens(data.total.inputTokens) }}</span>
          </div>
          <p class="mt-1 text-xs text-muted">Tokens d'entrée</p>
        </div>
        <div class="rounded-xl border border-default p-4">
          <div class="flex items-center gap-2 text-primary">
            <UIcon name="i-lucide-arrow-up-from-line" class="size-5" />
            <span class="text-2xl font-bold">{{ formatTokens(data.total.outputTokens) }}</span>
          </div>
          <p class="mt-1 text-xs text-muted">Tokens de sortie</p>
        </div>
      </div>

      <UAlert
        v-if="cacheHitRate !== null"
        color="neutral"
        variant="soft"
        icon="i-lucide-database-zap"
        :title="`Cache de prompt : ${cacheHitRate}% des tokens d'entrée réutilisés`"
        description="Le prompt système est mis en cache : les appels rapprochés (régénération, ajustement, remplacement) coûtent moins cher."
      />

      <!-- Par modèle -->
      <UCard v-if="data.byModel.length">
        <template #header>
          <h2 class="text-sm font-semibold">Par modèle</h2>
        </template>
        <div class="space-y-2">
          <div
            v-for="row in data.byModel"
            :key="row.model"
            class="flex items-center justify-between gap-3 text-sm"
          >
            <span class="font-medium">{{ modelLabel(row.model) }}</span>
            <span class="text-muted">
              {{ row.calls }} appels ·
              {{ formatTokens(row.inputTokens + row.outputTokens) }} tokens ·
              <span class="text-default">{{ formatCost(row.costUsd) }}</span>
            </span>
          </div>
        </div>
      </UCard>

      <!-- Par type d'appel -->
      <UCard v-if="data.byKind.length">
        <template #header>
          <h2 class="text-sm font-semibold">Par type</h2>
        </template>
        <div class="space-y-2">
          <div
            v-for="row in data.byKind"
            :key="row.kind"
            class="flex items-center justify-between gap-3 text-sm"
          >
            <span class="font-medium">{{ KIND_LABELS[row.kind] ?? row.kind }}</span>
            <span class="text-muted">
              {{ row.calls }} appels ·
              <span class="text-default">{{ formatCost(row.costUsd) }}</span>
            </span>
          </div>
        </div>
      </UCard>

      <p v-if="!data.total.calls" class="rounded-xl border border-default p-6 text-center text-muted">
        Aucun appel au modèle enregistré pour l'instant.
      </p>
    </template>
  </div>
</template>
