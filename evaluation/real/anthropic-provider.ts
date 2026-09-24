import Anthropic from '@anthropic-ai/sdk'
import { z } from 'zod'
import { workoutSessionSchema } from '../../shared/session-schema'
import type { RealGenerationProvider } from './types'

const SESSION_TOOL = {
  name: 'proposer_seance',
  description: 'Renvoie la séance structurée évaluée par le banc Tanden Boxing.',
  input_schema: z.toJSONSchema(workoutSessionSchema, {
    target: 'draft-2020-12',
  }) as Anthropic.Tool.InputSchema,
}

export function createAnthropicRealProvider(apiKey: string): RealGenerationProvider {
  if (!apiKey.trim()) throw new Error('NUXT_ANTHROPIC_API_KEY est requis pour le fournisseur réel.')
  const client = new Anthropic({ apiKey })
  return {
    id: 'anthropic/messages',
    capabilities: { seed: false, temperature: true },
    async generate(request) {
      const startedAt = Date.now()
      const response = await client.messages.create(
        {
          model: request.model,
          max_tokens: request.maxOutputTokens,
          temperature: request.temperature,
          system: [{ type: 'text', text: request.systemPrompt }],
          tools: [SESSION_TOOL],
          tool_choice: { type: 'tool', name: SESSION_TOOL.name },
          messages: [{ role: 'user', content: request.userPrompt }],
        },
        { timeout: request.timeoutMs, maxRetries: 0 },
      )
      const toolUse = response.content.find(
        (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use',
      )
      if (!toolUse) throw new Error("Le fournisseur n'a pas renvoyé l'outil proposer_seance.")
      return {
        model: response.model,
        output: toolUse.input,
        latencyMs: Date.now() - startedAt,
        usage: {
          inputTokens: response.usage.input_tokens ?? 0,
          outputTokens: response.usage.output_tokens ?? 0,
          cacheCreationTokens: response.usage.cache_creation_input_tokens ?? 0,
          cacheReadTokens: response.usage.cache_read_input_tokens ?? 0,
        },
      }
    },
  }
}
