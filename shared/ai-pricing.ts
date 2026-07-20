/**
 * Tarifs Anthropic (USD par million de tokens) pour l'estimation de coût de la vue « conso ».
 * Source : tarification publique Anthropic. Le cache-write coûte 1,25× l'entrée, le
 * cache-read 0,1× l'entrée. À revoir si les prix changent.
 */
export interface ModelPricing {
  label: string
  /** USD / million de tokens d'entrée. */
  input: number
  /** USD / million de tokens de sortie. */
  output: number
}

export const MODEL_PRICING: Record<string, ModelPricing> = {
  'claude-opus-4-8': { label: 'Opus 4.8', input: 5, output: 25 },
  'claude-sonnet-5': { label: 'Sonnet 5', input: 3, output: 15 },
  'claude-haiku-4-5': { label: 'Haiku 4.5', input: 1, output: 5 },
}

const CACHE_WRITE_MULTIPLIER = 1.25
const CACHE_READ_MULTIPLIER = 0.1

export interface TokenUsage {
  inputTokens: number
  outputTokens: number
  cacheCreationTokens: number
  cacheReadTokens: number
}

/** Libellé lisible d'un modèle, avec repli sur l'identifiant brut. */
export function modelLabel(model: string): string {
  return MODEL_PRICING[model]?.label ?? model
}

/**
 * Coût estimé (USD) d'un usage pour un modèle donné. Renvoie null si le modèle est inconnu
 * (pas de tarif de référence) — on préfère ne rien afficher plutôt qu'un chiffre faux.
 */
export function estimateCostUsd(model: string, usage: TokenUsage): number | null {
  const pricing = MODEL_PRICING[model]
  if (!pricing) return null
  const perMillion = (tokens: number, rate: number) => (tokens / 1_000_000) * rate
  return (
    perMillion(usage.inputTokens, pricing.input) +
    perMillion(usage.outputTokens, pricing.output) +
    perMillion(usage.cacheCreationTokens, pricing.input * CACHE_WRITE_MULTIPLIER) +
    perMillion(usage.cacheReadTokens, pricing.input * CACHE_READ_MULTIPLIER)
  )
}
