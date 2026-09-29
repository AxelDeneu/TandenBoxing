import { describe, expect, it, vi } from 'vitest'
import {
  classifyOpenRouterError,
  generateStructuredOutput,
  OpenRouterAdapterError,
  type StructuredGenerationRequest,
} from '../server/utils/openrouter'

const baseRequest: StructuredGenerationRequest = {
  model: 'google/gemini-2.5-pro',
  systemPrompt: 'Système',
  userPrompt: 'Utilisateur',
  maxOutputTokens: 12_000,
  timeoutMs: 1_000,
  maxRetries: 0,
  requireZeroDataRetention: true,
  pricing: { prompt: 0.000001, completion: 0.000002, cacheRead: 0.0000001, cacheWrite: 0.00000125 },
  outputSchema: {
    name: 'test_schema',
    description: 'Réponse de test',
    schema: { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'] },
  },
}

function response(overrides: Record<string, unknown> = {}) {
  return {
    id: 'generation-1',
    object: 'chat.completion',
    created: 1,
    model: 'google/gemini-2.5-pro-resolved',
    systemFingerprint: null,
    choices: [
      {
        index: 0,
        finishReason: 'stop',
        message: { role: 'assistant', content: '{"ok":true}' },
      },
    ],
    usage: {
      promptTokens: 100,
      completionTokens: 20,
      totalTokens: 120,
      promptTokensDetails: { cacheWriteTokens: 5, cachedTokens: 10 },
      cost: 0.0042,
    },
    ...overrides,
  }
}

function clientWith(result: unknown) {
  return { chat: { send: vi.fn().mockResolvedValue(result) } }
}

describe('adaptateur OpenRouter', () => {
  it('envoie un JSON Schema strict avec routage privé et renvoie modèle, usage et coût réels', async () => {
    const client = clientWith(response())
    const result = await generateStructuredOutput(baseRequest, client as never)

    expect(result).toEqual({
      model: 'google/gemini-2.5-pro-resolved',
      output: { ok: true },
      usage: {
        inputTokens: 100,
        outputTokens: 20,
        cacheCreationTokens: 5,
        cacheReadTokens: 10,
      },
      costUsd: 0.0042,
      costSource: 'provider',
    })
    expect(client.chat.send).toHaveBeenCalledWith(
      expect.objectContaining({
        chatRequest: expect.objectContaining({
          model: 'google/gemini-2.5-pro',
          maxCompletionTokens: 12_000,
          responseFormat: {
            type: 'json_schema',
            jsonSchema: expect.objectContaining({ name: 'test_schema', strict: true }),
          },
          provider: { requireParameters: true, dataCollection: 'deny', zdr: true },
          cacheControl: { type: 'ephemeral' },
        }),
      }),
      { timeoutMs: 1_000, retries: { strategy: 'none' } },
    )
  })

  it('utilise les tarifs du catalogue lorsque la réponse ne fournit pas de coût', async () => {
    const raw = response()
    delete raw.usage.cost
    const result = await generateStructuredOutput(baseRequest, clientWith(raw) as never)
    expect(result.costSource).toBe('catalog')
    expect(result.costUsd).toBeCloseTo(0.00014725)
  })

  it('transmet le signal d’annulation applicatif au SDK', async () => {
    const controller = new AbortController()
    const client = clientWith(response())

    await generateStructuredOutput({ ...baseRequest, signal: controller.signal }, client as never)

    expect(client.chat.send).toHaveBeenCalledWith(expect.anything(), {
      timeoutMs: 1_000,
      retries: { strategy: 'none' },
      signal: controller.signal,
    })
  })

  it.each([
    [
      {
        choices: [{ index: 0, finishReason: 'stop', message: { role: 'assistant', content: '' } }],
      },
      'OPENROUTER_EMPTY_RESPONSE',
    ],
    [
      {
        choices: [
          {
            index: 0,
            finishReason: 'stop',
            message: { role: 'assistant', content: null, refusal: 'non' },
          },
        ],
      },
      'OPENROUTER_MODEL_REFUSAL',
    ],
    [
      {
        choices: [
          {
            index: 0,
            finishReason: 'stop',
            message: { role: 'assistant', content: 'pas du json' },
          },
        ],
      },
      'OPENROUTER_INVALID_JSON',
    ],
  ])('rejette une réponse vide, refusée ou illisible (%s)', async (overrides, code) => {
    await expect(
      generateStructuredOutput(baseRequest, clientWith(response(overrides)) as never),
    ).rejects.toMatchObject({ code })
  })

  it.each([
    [401, 'permanent', 'OPENROUTER_AUTHENTICATION_FAILED'],
    [402, 'permanent', 'OPENROUTER_CREDITS_EXHAUSTED'],
    [404, 'permanent', 'OPENROUTER_MODEL_UNAVAILABLE'],
    [422, 'permanent', 'OPENROUTER_MODEL_INCOMPATIBLE'],
    [429, 'temporary', 'OPENROUTER_RATE_LIMITED'],
    [500, 'temporary', 'OPENROUTER_PROVIDER_UNAVAILABLE'],
    [529, 'temporary', 'OPENROUTER_PROVIDER_UNAVAILABLE'],
  ])('classe le statut HTTP %i', (statusCode, kind, code) => {
    expect(classifyOpenRouterError({ statusCode })).toMatchObject({ kind, code, statusCode })
  })

  it('ne retente que les erreurs temporaires dans la limite explicite', async () => {
    const send = vi
      .fn()
      .mockRejectedValueOnce({ statusCode: 529 })
      .mockResolvedValueOnce(response())
    await expect(
      generateStructuredOutput({ ...baseRequest, maxRetries: 1 }, { chat: { send } } as never),
    ).resolves.toMatchObject({ output: { ok: true } })
    expect(send).toHaveBeenCalledTimes(2)

    await expect(
      generateStructuredOutput({ ...baseRequest, maxRetries: 1 }, {
        chat: { send: vi.fn().mockRejectedValue({ statusCode: 402 }) },
      } as never),
    ).rejects.toBeInstanceOf(OpenRouterAdapterError)
  })
})
