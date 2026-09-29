import { OpenRouter } from '@openrouter/sdk'
import type { ChatResult } from '@openrouter/sdk/models'
import { estimateCostUsd, type ModelPricing, type TokenUsage } from '../../shared/ai-pricing'

let client: OpenRouter | null = null
let clientConfiguration = ''

export type OpenRouterErrorKind = 'temporary' | 'permanent'

export class OpenRouterAdapterError extends Error {
  readonly kind: OpenRouterErrorKind
  readonly code: string
  readonly actionableMessage: string
  readonly statusCode: number | null

  constructor(
    kind: OpenRouterErrorKind,
    code: string,
    message: string,
    actionableMessage: string,
    options: { cause?: unknown; statusCode?: number | null } = {},
  ) {
    super(message, { cause: options.cause })
    this.name = 'OpenRouterAdapterError'
    this.kind = kind
    this.code = code
    this.actionableMessage = actionableMessage
    this.statusCode = options.statusCode ?? null
  }
}

function errorStatus(error: unknown): number | null {
  if (!error || typeof error !== 'object') return null
  const candidate = error as Record<string, unknown>
  for (const field of ['statusCode', 'status'] as const) {
    const value = candidate[field]
    if (typeof value === 'number') return value
  }
  return null
}

/** Classe les erreurs OpenRouter sans dépendre des classes internes générées du SDK. */
export function classifyOpenRouterError(error: unknown): OpenRouterAdapterError {
  if (error instanceof OpenRouterAdapterError) return error
  const status = errorStatus(error)
  const details = { cause: error, statusCode: status }

  if (status === 401 || status === 403) {
    return new OpenRouterAdapterError(
      'permanent',
      'OPENROUTER_AUTHENTICATION_FAILED',
      'OpenRouter a refusé l’authentification.',
      'Vérifie NUXT_OPENROUTER_API_KEY et les restrictions de la clé, puis relance.',
      details,
    )
  }
  if (status === 402) {
    return new OpenRouterAdapterError(
      'permanent',
      'OPENROUTER_CREDITS_EXHAUSTED',
      'Les crédits OpenRouter sont insuffisants.',
      'Recharge les crédits du compte OpenRouter, puis relance la génération.',
      details,
    )
  }
  if (status === 404) {
    return new OpenRouterAdapterError(
      'permanent',
      'OPENROUTER_MODEL_UNAVAILABLE',
      'Le modèle configuré n’est plus disponible avec cette clé OpenRouter.',
      'Choisis un modèle disponible dans les réglages, puis relance la génération.',
      details,
    )
  }
  if (status === 400 || status === 422) {
    return new OpenRouterAdapterError(
      'permanent',
      'OPENROUTER_MODEL_INCOMPATIBLE',
      'Le modèle ou son fournisseur ne prend pas en charge les paramètres requis.',
      'Choisis un modèle compatible avec les sorties structurées dans les réglages.',
      details,
    )
  }
  if (status === 408 || status === 429 || (status !== null && status >= 500)) {
    return new OpenRouterAdapterError(
      'temporary',
      status === 429 ? 'OPENROUTER_RATE_LIMITED' : 'OPENROUTER_PROVIDER_UNAVAILABLE',
      status === 429
        ? 'Le quota temporaire OpenRouter ou fournisseur est atteint.'
        : 'OpenRouter ou le fournisseur sélectionné est temporairement indisponible.',
      'Une nouvelle tentative sera lancée automatiquement.',
      details,
    )
  }
  return new OpenRouterAdapterError(
    'temporary',
    'OPENROUTER_UNAVAILABLE',
    'OpenRouter est temporairement inaccessible.',
    'Une nouvelle tentative sera lancée automatiquement.',
    details,
  )
}

/** Client singleton serveur. Aucune valeur de runtimeConfig public n'est utilisée. */
export function useOpenRouter(): OpenRouter {
  const config = useRuntimeConfig()
  const apiKey = String(config.openrouterApiKey ?? '').trim()
  if (!apiKey) {
    throw new OpenRouterAdapterError(
      'permanent',
      'OPENROUTER_NOT_CONFIGURED',
      'Aucune clé OpenRouter n’est configurée.',
      'Configure NUXT_OPENROUTER_API_KEY, puis relance la génération.',
    )
  }

  const httpReferer = String(config.openrouterHttpReferer ?? '').trim()
  const appTitle = String(config.openrouterAppTitle ?? '').trim()
  const signature = JSON.stringify([apiKey, httpReferer, appTitle])
  if (!client || clientConfiguration !== signature) {
    client = new OpenRouter({
      apiKey,
      ...(httpReferer ? { httpReferer } : {}),
      ...(appTitle ? { appTitle } : {}),
      retryConfig: { strategy: 'none' },
    })
    clientConfiguration = signature
  }
  return client
}

export function openRouterRequiresZeroDataRetention(): boolean {
  const value = String(useRuntimeConfig().openrouterRequireZdr ?? '1')
    .trim()
    .toLowerCase()
  return !['0', 'false', 'no'].includes(value)
}

export interface StructuredOutputSchema {
  name: string
  description: string
  schema: Record<string, unknown>
}

export interface StructuredGenerationRequest {
  model: string
  systemPrompt: string
  userPrompt: string
  maxOutputTokens: number
  timeoutMs: number
  maxRetries: number
  outputSchema: StructuredOutputSchema
  pricing?: ModelPricing
  temperature?: number
  seed?: number
  requireZeroDataRetention?: boolean
}

export interface StructuredGenerationResponse {
  model: string
  output: unknown
  usage: TokenUsage
  costUsd: number | null
  costSource: 'provider' | 'catalog' | null
}

type OpenRouterChatClient = Pick<OpenRouter, 'chat'>

function normalizedUsage(response: ChatResult): TokenUsage {
  return {
    inputTokens: response.usage?.promptTokens ?? 0,
    outputTokens: response.usage?.completionTokens ?? 0,
    cacheCreationTokens: response.usage?.promptTokensDetails?.cacheWriteTokens ?? 0,
    cacheReadTokens: response.usage?.promptTokensDetails?.cachedTokens ?? 0,
  }
}

function parseStructuredResponse(
  response: ChatResult,
  request: StructuredGenerationRequest,
): StructuredGenerationResponse {
  const message = response.choices[0]?.message
  if (message?.refusal) {
    throw new OpenRouterAdapterError(
      'permanent',
      'OPENROUTER_MODEL_REFUSAL',
      'Le modèle a refusé de produire la sortie structurée demandée.',
      'Choisis un autre modèle compatible dans les réglages.',
    )
  }
  if (typeof message?.content !== 'string' || !message.content.trim()) {
    throw new OpenRouterAdapterError(
      'temporary',
      'OPENROUTER_EMPTY_RESPONSE',
      'Le modèle n’a renvoyé aucune sortie structurée.',
      'Une nouvelle tentative sera lancée automatiquement.',
    )
  }

  let output: unknown
  try {
    output = JSON.parse(message.content)
  } catch (error) {
    throw new OpenRouterAdapterError(
      'temporary',
      'OPENROUTER_INVALID_JSON',
      'Le modèle a renvoyé une sortie JSON illisible.',
      'Une nouvelle tentative sera lancée automatiquement.',
      { cause: error },
    )
  }

  const usage = normalizedUsage(response)
  const providerCost = response.usage?.cost
  const hasProviderCost = typeof providerCost === 'number' && Number.isFinite(providerCost)
  return {
    model: response.model || message.model || request.model,
    output,
    usage,
    costUsd: hasProviderCost
      ? providerCost
      : request.pricing
        ? estimateCostUsd(request.pricing, usage)
        : null,
    costSource: hasProviderCost ? 'provider' : request.pricing ? 'catalog' : null,
  }
}

/**
 * Appel JSON Schema commun à tous les flux IA. Le SDK ne retente jamais de lui-même : les
 * quelques retries historiques sont explicites ici, et la file durable reste maître des séances.
 */
export async function generateStructuredOutput(
  request: StructuredGenerationRequest,
  sdk: OpenRouterChatClient = useOpenRouter(),
): Promise<StructuredGenerationResponse> {
  let lastError: OpenRouterAdapterError | null = null
  for (let attempt = 0; attempt <= request.maxRetries; attempt += 1) {
    try {
      const response = (await sdk.chat.send(
        {
          chatRequest: {
            model: request.model,
            messages: [
              { role: 'system', content: request.systemPrompt },
              { role: 'user', content: request.userPrompt },
            ],
            maxCompletionTokens: request.maxOutputTokens,
            responseFormat: {
              type: 'json_schema',
              jsonSchema: {
                name: request.outputSchema.name,
                description: request.outputSchema.description,
                schema: request.outputSchema.schema,
                strict: true,
              },
            },
            provider: {
              requireParameters: true,
              dataCollection: 'deny',
              ...((request.requireZeroDataRetention ?? openRouterRequiresZeroDataRetention())
                ? { zdr: true }
                : {}),
            },
            cacheControl: { type: 'ephemeral' },
            ...(request.temperature == null ? {} : { temperature: request.temperature }),
            ...(request.seed == null ? {} : { seed: request.seed }),
            stream: false,
          },
        },
        { timeoutMs: request.timeoutMs, retries: { strategy: 'none' } },
      )) as ChatResult
      return parseStructuredResponse(response, request)
    } catch (error) {
      lastError = classifyOpenRouterError(error)
      if (lastError.kind === 'permanent' || attempt === request.maxRetries) throw lastError
    }
  }
  throw lastError!
}

export function resetOpenRouterClientForTests(): void {
  client = null
  clientConfiguration = ''
}
