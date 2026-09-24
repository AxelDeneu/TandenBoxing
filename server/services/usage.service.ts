import { estimateCostUsd, type TokenUsage } from '../../shared/ai-pricing'
import type { AiUsage } from '../database/schema'

interface UsageBucket extends TokenUsage {
  calls: number
  costUsd: number | null
}

function emptyBucket(): UsageBucket {
  return {
    calls: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheCreationTokens: 0,
    cacheReadTokens: 0,
    costUsd: 0,
  }
}

/** Ajoute un appel à un bucket, en cumulant le coût (null si un modèle inconnu casse l'estimation). */
function addToBucket(bucket: UsageBucket, row: AiUsage): void {
  bucket.calls += 1
  bucket.inputTokens += row.inputTokens
  bucket.outputTokens += row.outputTokens
  bucket.cacheCreationTokens += row.cacheCreationTokens
  bucket.cacheReadTokens += row.cacheReadTokens
  const cost = estimateCostUsd(row.model, row)
  if (cost === null || bucket.costUsd === null) bucket.costUsd = null
  else bucket.costUsd += cost
}

/** Agrégats de consommation IA pour la vue « conso » : total, mois courant, par modèle, par type. */
export function getUsageStats() {
  const s = getSettings()
  const today = todayIso(s.timezone)
  const monthPrefix = today.slice(0, 7) // YYYY-MM

  const rows = listAiUsage(1000)

  const total = emptyBucket()
  const thisMonth = emptyBucket()
  const byModel: Record<string, UsageBucket> = {}
  const byKind: Record<string, UsageBucket> = {}

  for (const row of rows) {
    addToBucket(total, row)

    // La date de la ligne est un timestamp ; on la ramène au fuseau utilisateur.
    const rowMonth = isoDateInTz(row.createdAt, s.timezone).slice(0, 7)
    if (rowMonth === monthPrefix) addToBucket(thisMonth, row)

    byModel[row.model] ??= emptyBucket()
    addToBucket(byModel[row.model]!, row)

    byKind[row.kind] ??= emptyBucket()
    addToBucket(byKind[row.kind]!, row)
  }

  const generationRows = listGenerationJobs(1_000)
  const terminalJobs = generationRows.filter((job) => ['succeeded', 'failed'].includes(job.status))
  const succeededJobs = terminalJobs.filter((job) => job.status === 'succeeded')
  const sum = (values: number[]) => values.reduce((total, value) => total + value, 0)
  const generation = {
    jobs: generationRows.length,
    activeJobs: generationRows.filter((job) =>
      ['queued', 'running', 'retry_scheduled'].includes(job.status),
    ).length,
    succeededJobs: succeededJobs.length,
    failedJobs: terminalJobs.filter((job) => job.status === 'failed').length,
    successRate: terminalJobs.length ? succeededJobs.length / terminalJobs.length : null,
    averageLatencyMs: succeededJobs.length
      ? Math.round(sum(succeededJobs.map((job) => job.durationMs ?? 0)) / succeededJobs.length)
      : null,
    modelCalls: sum(generationRows.map((job) => job.modelCalls)),
    inputTokens: sum(generationRows.map((job) => job.inputTokens)),
    outputTokens: sum(generationRows.map((job) => job.outputTokens)),
    estimatedCostUsd: generationRows.every((job) => job.estimatedCostUsd !== null)
      ? sum(generationRows.map((job) => job.estimatedCostUsd ?? 0))
      : null,
    reusedJobs: succeededJobs.filter((job) => job.reuseKind !== 'none').length,
    reuseRate: succeededJobs.length
      ? succeededJobs.filter((job) => job.reuseKind !== 'none').length / succeededJobs.length
      : null,
    fallbackJobs: succeededJobs.filter((job) => job.fallbackUsed).length,
    fallbackRate: succeededJobs.length
      ? succeededJobs.filter((job) => job.fallbackUsed).length / succeededJobs.length
      : null,
  }

  return {
    total,
    thisMonth,
    monthLabel: monthPrefix,
    byModel: Object.entries(byModel).map(([model, bucket]) => ({ model, ...bucket })),
    byKind: Object.entries(byKind).map(([kind, bucket]) => ({ kind, ...bucket })),
    recent: rows.slice(0, 20),
    generation,
  }
}
