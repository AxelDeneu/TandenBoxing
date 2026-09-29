import type { OpenRouter } from '@openrouter/sdk'
import type { Model } from '@openrouter/sdk/models'
import type { ModelPricing } from '../../shared/ai-pricing'
import {
  REQUIRED_MODEL_OUTPUT_TOKENS,
  type OpenRouterModelCatalogResponse,
  type OpenRouterModelDto,
} from '../../shared/openrouter-models'

export const OPENROUTER_MODEL_CATALOG_TTL_MS = 15 * 60 * 1_000
export const OPENROUTER_MODEL_CATALOG_TIMEOUT_MS = 8_000

interface CatalogCache {
  expiresAt: number
  response: OpenRouterModelCatalogResponse
}

let catalogCache: CatalogCache | null = null

function finitePrice(value: string | undefined): number | null {
  if (value == null || value.trim() === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null
}

function modelPricing(model: Model): ModelPricing | null {
  const prompt = finitePrice(model.pricing.prompt)
  const completion = finitePrice(model.pricing.completion)
  if (prompt == null || completion == null) return null
  return {
    prompt,
    completion,
    cacheRead: finitePrice(model.pricing.inputCacheRead),
    cacheWrite: finitePrice(model.pricing.inputCacheWrite),
  }
}

function maximumOutputTokens(model: Model): number | null {
  const candidates = [
    model.topProvider.maxCompletionTokens,
    model.perRequestLimits?.completionTokens,
  ].filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
  return candidates.length ? Math.min(...candidates) : null
}

/** Transforme et filtre la réponse brute sans allowlist de slugs. */
export function compatibleOpenRouterModels(
  models: readonly Model[],
  options: { requireZeroDataRetention: boolean },
): OpenRouterModelDto[] {
  const unique = new Map<string, OpenRouterModelDto>()
  for (const model of models) {
    const textInput = model.architecture.inputModalities.includes('text')
    const textOutput = model.architecture.outputModalities.includes('text')
    const structuredOutputs =
      model.supportedParameters.includes('response_format') ||
      model.supportedParameters.includes('structured_outputs')
    const maxOutputTokens = maximumOutputTokens(model)
    const pricing = modelPricing(model)
    if (
      !model.id ||
      !textInput ||
      !textOutput ||
      !structuredOutputs ||
      maxOutputTokens == null ||
      maxOutputTokens < REQUIRED_MODEL_OUTPUT_TOKENS ||
      !pricing
    ) {
      continue
    }

    unique.set(model.id, {
      id: model.id,
      name: model.name || model.id,
      author: model.id.split('/')[0] || 'unknown',
      contextLength: model.contextLength ?? model.topProvider.contextLength ?? 0,
      pricing,
      capabilities: {
        textInput: true,
        textOutput: true,
        structuredOutputs: true,
        maxOutputTokens,
        zeroDataRetention: options.requireZeroDataRetention,
      },
    })
  }

  return [...unique.values()].sort(
    (left, right) =>
      left.author.localeCompare(right.author) ||
      left.name.localeCompare(right.name) ||
      left.id.localeCompare(right.id),
  )
}

type ModelsClient = Pick<OpenRouter, 'models'>

async function listAllModels(
  sdk: ModelsClient,
  requireZeroDataRetention: boolean,
  apiKey?: string,
): Promise<Model[]> {
  const requestOptions = {
    timeoutMs: OPENROUTER_MODEL_CATALOG_TIMEOUT_MS,
    retries: { strategy: 'none' as const },
  }
  const iterator = await sdk.models.list(
    {
      limit: 1_000,
      inputModalities: 'text',
      outputModalities: 'text',
      supportedParameters: 'response_format',
      ...(requireZeroDataRetention ? { zdr: 'true' as const } : {}),
    },
    requestOptions,
  )
  const models: Model[] = []
  for await (const page of iterator) models.push(...page.result.data)
  if (!apiKey) return models

  // Cet endpoint authentifié applique les préférences, garde-fous et accès réels de la clé.
  const accessibleIterator = await sdk.models.listForUser(
    { bearer: apiKey },
    { limit: 1_000, outputModalities: 'text' },
    requestOptions,
  )
  const accessibleIds = new Set<string>()
  for await (const page of accessibleIterator) {
    for (const model of page.result.data) accessibleIds.add(model.id)
  }
  return models.filter((model) => accessibleIds.has(model.id))
}

export interface ModelCatalogOptions {
  sdk?: ModelsClient
  now?: () => number
  ttlMs?: number
  requireZeroDataRetention?: boolean
  apiKey?: string
}

/** Catalogue authentifié, filtré et mis en cache uniquement dans le processus serveur. */
export async function getOpenRouterModelCatalog(
  options: ModelCatalogOptions = {},
): Promise<OpenRouterModelCatalogResponse> {
  const now = options.now ?? Date.now
  const timestamp = now()
  if (catalogCache && timestamp < catalogCache.expiresAt) return catalogCache.response

  const requireZeroDataRetention =
    options.requireZeroDataRetention ?? openRouterRequiresZeroDataRetention()
  const sdk = options.sdk ?? useOpenRouter()
  const apiKey =
    options.apiKey ??
    (options.sdk ? undefined : String(useRuntimeConfig().openrouterApiKey ?? '').trim())
  const models = compatibleOpenRouterModels(
    await listAllModels(sdk, requireZeroDataRetention, apiKey || undefined),
    { requireZeroDataRetention },
  )
  const ttlMs = options.ttlMs ?? OPENROUTER_MODEL_CATALOG_TTL_MS
  const response = {
    models,
    fetchedAt: new Date(timestamp).toISOString(),
    ttlSeconds: Math.floor(ttlMs / 1_000),
  }
  catalogCache = { response, expiresAt: timestamp + ttlMs }
  return response
}

/** Refuse explicitement un slug retiré ou incompatible avant tout appel de génération. */
export async function requireAvailableOpenRouterModel(model: string): Promise<OpenRouterModelDto> {
  const catalog = await getOpenRouterModelCatalog()
  const available = catalog.models.find((candidate) => candidate.id === model)
  if (!available) {
    throw new OpenRouterAdapterError(
      'permanent',
      'OPENROUTER_MODEL_UNAVAILABLE',
      `Le modèle « ${model} » n’est plus disponible ou compatible.`,
      'Choisis un modèle disponible dans les réglages, puis relance la génération.',
    )
  }
  return available
}

export function resetOpenRouterModelCatalogForTests(): void {
  catalogCache = null
}
