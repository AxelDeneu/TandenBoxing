import Anthropic from '@anthropic-ai/sdk'

let _client: Anthropic | null = null

/**
 * Client Anthropic (singleton). La clé vient de NUXT_ANTHROPIC_API_KEY et
 * reste strictement côté serveur.
 */
export function useAnthropic(): Anthropic {
  const { anthropicApiKey } = useRuntimeConfig()
  if (!anthropicApiKey) {
    throw createError({
      statusCode: 500,
      statusMessage:
        'Clé API Anthropic manquante. Renseigne NUXT_ANTHROPIC_API_KEY dans l’environnement.',
    })
  }
  if (!_client) {
    _client = new Anthropic({ apiKey: anthropicApiKey })
  }
  return _client
}
