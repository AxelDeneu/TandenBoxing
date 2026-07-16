import { z } from 'zod'
import { sessionCategory, workoutFocus } from '../../../shared/session-schema'

const schema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  category: sessionCategory,
  focus: workoutFocus.nullish(),
  note: z.string().nullish(),
  generateNow: z.boolean().optional(),
})

/**
 * POST /api/sessions/plan
 * Body: { date, category, focus?, note?, generateNow? }
 * Enregistre l'intention de séance. La génération complète a lieu le jour J,
 * ou immédiatement (en arrière-plan) si `generateNow`.
 */
export default defineEventHandler(async (event) => {
  const parsed = schema.safeParse(await readBody(event))
  if (!parsed.success) {
    throw createError({ statusCode: 400, statusMessage: 'Planification invalide.' })
  }
  const { date, category, focus, note, generateNow } = parsed.data

  if (generateNow) {
    const { anthropicApiKey } = useRuntimeConfig()
    if (!anthropicApiKey) {
      throw createError({
        statusCode: 500,
        statusMessage:
          'Clé API Anthropic manquante. Renseigne NUXT_ANTHROPIC_API_KEY dans l’environnement.',
      })
    }
  }

  const { plan, generating } = planSession(date, { category, focus, note, generateNow })
  return { ok: true, plan, generating }
})
