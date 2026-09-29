import { OpenRouter } from '@openrouter/sdk'
import { z } from 'zod'
import { workoutSessionSchema } from '../../shared/session-schema'
import { getOpenRouterModelCatalog } from '../../server/services/openrouter-model-catalog.service'
import { generateStructuredOutput } from '../../server/utils/openrouter'
import type { RealGenerationProvider } from './types'

const SESSION_OUTPUT = {
  name: 'proposer_seance',
  description: 'Renvoie la séance structurée évaluée par le banc Tanden Boxing.',
  schema: z.toJSONSchema(workoutSessionSchema, {
    target: 'draft-2020-12',
  }) as Record<string, unknown>,
}

export function createOpenRouterRealProvider(apiKey: string): RealGenerationProvider {
  if (!apiKey.trim()) {
    throw new Error('NUXT_OPENROUTER_API_KEY est requis pour le fournisseur réel.')
  }
  const client = new OpenRouter({
    apiKey,
    ...(process.env.NUXT_OPENROUTER_HTTP_REFERER
      ? { httpReferer: process.env.NUXT_OPENROUTER_HTTP_REFERER }
      : {}),
    appTitle: process.env.NUXT_OPENROUTER_APP_TITLE || 'Tanden Boxing Evaluation',
    retryConfig: { strategy: 'none' },
  })

  const getModel = async (model: string) => {
    const catalog = await getOpenRouterModelCatalog({
      sdk: client,
      requireZeroDataRetention: true,
      apiKey,
    })
    return catalog.models.find((candidate) => candidate.id === model) ?? null
  }

  return {
    id: 'openrouter/chat-completions',
    capabilities: { seed: false, temperature: true },
    async getModelPricing(model) {
      return (await getModel(model))?.pricing ?? null
    },
    async generate(request) {
      const catalogModel = await getModel(request.model)
      if (!catalogModel) {
        throw new Error(`Modèle OpenRouter indisponible ou incompatible : ${request.model}.`)
      }
      const startedAt = Date.now()
      const response = await generateStructuredOutput(
        {
          model: request.model,
          maxOutputTokens: request.maxOutputTokens,
          temperature: request.temperature,
          ...(request.seed ? { seed: request.seed } : {}),
          systemPrompt: request.systemPrompt,
          userPrompt: request.userPrompt,
          outputSchema: SESSION_OUTPUT,
          pricing: catalogModel.pricing,
          timeoutMs: request.timeoutMs,
          maxRetries: 0,
          requireZeroDataRetention: true,
        },
        client,
      )
      return {
        model: response.model,
        output: response.output,
        latencyMs: Date.now() - startedAt,
        usage: { ...response.usage, costUsd: response.costUsd },
      }
    },
  }
}
