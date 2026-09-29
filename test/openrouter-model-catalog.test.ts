import type { Model } from '@openrouter/sdk/models'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  compatibleOpenRouterModels,
  getOpenRouterModelCatalog,
  OPENROUTER_MODEL_CATALOG_TIMEOUT_MS,
  resetOpenRouterModelCatalogForTests,
} from '../server/services/openrouter-model-catalog.service'

function rawModel(id: string, overrides: Partial<Model> = {}): Model {
  return {
    id,
    canonicalSlug: id,
    name: id.split('/')[1] ?? id,
    created: 1,
    contextLength: 128_000,
    architecture: {
      modality: 'text->text',
      inputModalities: ['text'],
      outputModalities: ['text'],
    },
    defaultParameters: null,
    links: {},
    perRequestLimits: null,
    pricing: { prompt: '0.000001', completion: '0.000002' },
    supportedParameters: ['response_format', 'max_completion_tokens'],
    supportedVoices: null,
    topProvider: {
      contextLength: 128_000,
      maxCompletionTokens: 16_384,
      isModerated: false,
    },
    ...overrides,
  } as Model
}

function pageIterator(models: Model[]) {
  const page = {
    result: {
      data: models,
      links: { next: null },
      totalCount: models.length,
    },
  }
  return Object.assign(page, {
    next: async () => null,
    async *[Symbol.asyncIterator]() {
      yield page
    },
  })
}

function sdkWith(models: Model[]) {
  return {
    models: {
      list: vi.fn().mockResolvedValue(pageIterator(models)),
      listForUser: vi.fn().mockResolvedValue(pageIterator(models)),
    },
  }
}

beforeEach(() => resetOpenRouterModelCatalogForTests())

describe('catalogue OpenRouter serveur', () => {
  it('filtre les modalités, JSON Schema et le budget de sortie sans allowlist', () => {
    const models = compatibleOpenRouterModels(
      [
        rawModel('google/gemini-compatible', { name: 'Gemini compatible' }),
        rawModel('openai/too-short', {
          topProvider: { isModerated: false, maxCompletionTokens: 11_999 },
        }),
        rawModel('mistral/no-schema', { supportedParameters: ['temperature'] }),
        rawModel('vendor/image-output', {
          architecture: {
            modality: 'text->image',
            inputModalities: ['text'],
            outputModalities: ['image'],
          },
        }),
      ],
      { requireZeroDataRetention: true },
    )

    expect(models).toEqual([
      expect.objectContaining({
        id: 'google/gemini-compatible',
        author: 'google',
        contextLength: 128_000,
        capabilities: {
          textInput: true,
          textOutput: true,
          structuredOutputs: true,
          maxOutputTokens: 16_384,
          zeroDataRetention: true,
        },
        pricing: {
          prompt: 0.000001,
          completion: 0.000002,
          cacheRead: null,
          cacheWrite: null,
        },
      }),
    ])
  })

  it('trie le DTO stable et ne renvoie aucune donnée brute ou clé', async () => {
    const sdk = sdkWith([
      rawModel('openai/z-model', { description: 'champ brut à ne pas exposer' }),
      rawModel('google/a-model'),
    ])
    const response = await getOpenRouterModelCatalog({
      sdk: sdk as never,
      requireZeroDataRetention: true,
      now: () => 1_800_000_000_000,
    })

    expect(response.models.map((model) => model.id)).toEqual(['google/a-model', 'openai/z-model'])
    expect(JSON.stringify(response)).not.toContain('champ brut à ne pas exposer')
    expect(JSON.stringify(response)).not.toContain('sk-or-v1-secret')
    expect(response.ttlSeconds).toBe(900)
    expect(sdk.models.list).toHaveBeenCalledWith(
      expect.objectContaining({
        inputModalities: 'text',
        outputModalities: 'text',
        supportedParameters: 'response_format',
        zdr: 'true',
      }),
      { timeoutMs: OPENROUTER_MODEL_CATALOG_TIMEOUT_MS, retries: { strategy: 'none' } },
    )
  })

  it('réutilise le cache puis le renouvelle après expiration', async () => {
    let now = 1_000
    const sdk = sdkWith([rawModel('google/gemini-compatible')])
    const options = {
      sdk: sdk as never,
      requireZeroDataRetention: true,
      now: () => now,
      ttlMs: 100,
    }

    await getOpenRouterModelCatalog(options)
    now = 1_099
    await getOpenRouterModelCatalog(options)
    expect(sdk.models.list).toHaveBeenCalledTimes(1)

    now = 1_100
    await getOpenRouterModelCatalog(options)
    expect(sdk.models.list).toHaveBeenCalledTimes(2)
  })

  it('intersecte le catalogue avec les modèles réellement accessibles à la clé', async () => {
    const publicModels = [rawModel('google/allowed'), rawModel('openai/restricted')]
    const sdk = sdkWith(publicModels)
    sdk.models.listForUser.mockResolvedValue(pageIterator([publicModels[0]!]))

    const response = await getOpenRouterModelCatalog({
      sdk: sdk as never,
      apiKey: 'sk-or-v1-server-only',
      requireZeroDataRetention: true,
    })

    expect(response.models.map((model) => model.id)).toEqual(['google/allowed'])
    expect(sdk.models.listForUser).toHaveBeenCalledWith(
      { bearer: 'sk-or-v1-server-only' },
      { limit: 1_000, outputModalities: 'text' },
      { timeoutMs: OPENROUTER_MODEL_CATALOG_TIMEOUT_MS, retries: { strategy: 'none' } },
    )
    expect(JSON.stringify(response)).not.toContain('sk-or-v1-server-only')
  })

  it('propage timeout et panne sans inventer de catalogue statique', async () => {
    const sdk = { models: { list: vi.fn().mockRejectedValue({ statusCode: 529 }) } }
    await expect(
      getOpenRouterModelCatalog({
        sdk: sdk as never,
        requireZeroDataRetention: true,
      }),
    ).rejects.toMatchObject({ statusCode: 529 })
  })

  it("traduit la panne de l'endpoint sans exposer le secret", async () => {
    const secret = 'sk-or-v1-ne-doit-jamais-sortir'
    vi.stubGlobal('defineEventHandler', (handler: () => unknown) => handler)
    vi.stubGlobal('getOpenRouterModelCatalog', () =>
      Promise.reject({ statusCode: 401, body: secret }),
    )
    vi.stubGlobal('classifyOpenRouterError', () => ({
      code: 'OPENROUTER_AUTHENTICATION_FAILED',
      statusCode: 401,
    }))
    vi.stubGlobal('createError', (details: { statusCode: number; statusMessage: string }) =>
      Object.assign(new Error(details.statusMessage), details),
    )
    const handler = (await import('../server/api/ai/models.get')).default as () => Promise<unknown>

    let failure: unknown
    try {
      await handler()
    } catch (error) {
      failure = error
    } finally {
      vi.unstubAllGlobals()
    }
    expect(failure).toMatchObject({
      statusCode: 503,
      statusMessage:
        'Le catalogue OpenRouter est temporairement indisponible. Le modèle enregistré est conservé.',
    })
    expect(JSON.stringify(failure)).not.toContain(secret)
  })
})
