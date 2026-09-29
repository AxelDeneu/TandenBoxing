export interface ModelPricing {
  /** USD par token d'entrée, tel que publié par le catalogue OpenRouter. */
  prompt: number
  /** USD par token de sortie, tel que publié par le catalogue OpenRouter. */
  completion: number
  /** USD par token lu depuis le cache, si le modèle le publie. */
  cacheRead: number | null
  /** USD par token écrit dans le cache, si le modèle le publie. */
  cacheWrite: number | null
}

export interface TokenUsage {
  inputTokens: number
  outputTokens: number
  cacheCreationTokens: number
  cacheReadTokens: number
}

/**
 * Estime un coût depuis les prix dynamiques du catalogue. Si le prix spécifique du cache
 * n'est pas publié, les tokens concernés utilisent le tarif d'entrée plutôt qu'une constante
 * propre à un fournisseur.
 */
export function estimateCostUsd(pricing: ModelPricing, usage: TokenUsage): number {
  return (
    usage.inputTokens * pricing.prompt +
    usage.outputTokens * pricing.completion +
    usage.cacheCreationTokens * (pricing.cacheWrite ?? pricing.prompt) +
    usage.cacheReadTokens * (pricing.cacheRead ?? pricing.prompt)
  )
}
