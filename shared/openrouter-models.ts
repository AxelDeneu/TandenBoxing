import type { ModelPricing } from './ai-pricing'

export const DEFAULT_AI_MODEL = 'anthropic/claude-opus-4.8'
export const REQUIRED_MODEL_OUTPUT_TOKENS = 12_000

const LEGACY_MODEL_SLUGS: Readonly<Record<string, string>> = {
  'claude-opus-4-8': 'anthropic/claude-opus-4.8',
  'claude-sonnet-5': 'anthropic/claude-sonnet-5',
  'claude-haiku-4-5-20251001': 'anthropic/claude-haiku-4.5',
}

/** Normalise uniquement les identifiants historiques connus ; les slugs OpenRouter restent intacts. */
export function normalizeOpenRouterModelSlug(model: string): string {
  const normalized = model.trim()
  return LEGACY_MODEL_SLUGS[normalized] ?? normalized
}

export interface OpenRouterModelCapabilities {
  textInput: true
  textOutput: true
  structuredOutputs: true
  maxOutputTokens: number
  zeroDataRetention: boolean
}

/** Contrat public minimal du catalogue. La réponse OpenRouter brute reste côté serveur. */
export interface OpenRouterModelDto {
  id: string
  name: string
  author: string
  contextLength: number
  pricing: ModelPricing
  capabilities: OpenRouterModelCapabilities
}

export interface OpenRouterModelCatalogResponse {
  models: OpenRouterModelDto[]
  fetchedAt: string
  ttlSeconds: number
}
