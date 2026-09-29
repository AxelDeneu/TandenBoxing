import { describe, expect, it, vi } from 'vitest'
import { candidateRun } from '../evaluation/fixtures/reference-candidate'
import { SYNTHETIC_CORPUS } from '../evaluation/fixtures/corpus'
import {
  EXERCISE_OUTPUT,
  PARTIAL_SESSION_OUTPUT,
  SESSION_OUTPUT,
} from '../server/services/generation.service'
import { generateStructuredOutput } from '../server/utils/openrouter'
import { exerciseSchema, workoutSessionSchema } from '../shared/session-schema'

const session = candidateRun.outputs[SYNTHETIC_CORPUS.cases[0]!.id]!
const exercise = session.blocks[0]!.exercises[0]!

function fakeClient(output: unknown) {
  return {
    chat: {
      send: vi.fn().mockResolvedValue({
        id: 'generation-flow',
        object: 'chat.completion',
        created: 1,
        model: 'mistralai/mistral-large-resolved',
        systemFingerprint: null,
        choices: [
          {
            index: 0,
            finishReason: 'stop',
            message: { role: 'assistant', content: JSON.stringify(output) },
          },
        ],
        usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30, cost: 0.001 },
      }),
    },
  }
}

async function simulateFlow(
  output: unknown,
  outputSchema: typeof SESSION_OUTPUT,
  maxOutputTokens: number,
) {
  const client = fakeClient(output)
  const result = await generateStructuredOutput(
    {
      model: 'mistralai/mistral-large',
      systemPrompt: 'Coach',
      userPrompt: 'Génère',
      maxOutputTokens,
      timeoutMs: 1_000,
      maxRetries: 0,
      requireZeroDataRetention: true,
      outputSchema,
    },
    client as never,
  )
  expect(client.chat.send).toHaveBeenCalledWith(
    expect.objectContaining({
      chatRequest: expect.objectContaining({ model: 'mistralai/mistral-large' }),
    }),
    expect.anything(),
  )
  return result.output
}

describe('flux OpenRouter non-Anthropic simulés', () => {
  it('valide séance complète, partielle et correction ciblée avec les schémas Zod existants', async () => {
    const full = await simulateFlow(session, SESSION_OUTPUT, 12_000)
    const partial = await simulateFlow(session, PARTIAL_SESSION_OUTPUT, 9_000)
    const correction = await simulateFlow(session, SESSION_OUTPUT, 12_000)

    expect(workoutSessionSchema.safeParse(full).success).toBe(true)
    expect(workoutSessionSchema.safeParse(partial).success).toBe(true)
    expect(workoutSessionSchema.safeParse(correction).success).toBe(true)
  })

  it('valide un remplacement avec le schéma Zod existant', async () => {
    const output = await simulateFlow(exercise, EXERCISE_OUTPUT, 2_000)
    expect(exerciseSchema.safeParse(output).success).toBe(true)
  })

  it('valide une recommandation structurée avec un modèle Mistral simulé', async () => {
    vi.stubGlobal('CATEGORY_GUIDE', 'guide')
    const { RECO_OUTPUT, recoSchema } = await import('../server/services/recommendation.service')
    const recommendations = {
      recommandations: [
        {
          category: 'apprentissage',
          focus: 'fondations',
          reason: 'Consolider la garde.',
        },
      ],
    }
    const output = await simulateFlow(recommendations, RECO_OUTPUT, 1_500)
    vi.unstubAllGlobals()
    expect(recoSchema.safeParse(output).success).toBe(true)
  })
})
