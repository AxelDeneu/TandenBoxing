import { z } from 'zod'

const schema = z.object({
  instruction: z.string().trim().min(1).max(500),
})

/**
 * POST /api/sessions/:date/adjust
 * Body: { instruction: "plus court aujourd'hui" }
 * Régénère la séance en gardant sa catégorie + son focus et en appliquant la consigne libre.
 * Traitement en arrière-plan (comme la génération) ; l'appli poll ensuite la séance.
 */
export default defineEventHandler(async (event) => {
  const date = getRouterParam(event, 'date')!
  const parsed = schema.safeParse(await readBody(event))
  if (!parsed.success) {
    throw createError({ statusCode: 400, statusMessage: 'Consigne invalide.' })
  }

  const { anthropicApiKey } = useRuntimeConfig()
  if (!anthropicApiKey) {
    throw createError({
      statusCode: 500,
      statusMessage: 'Clé API Anthropic manquante. Renseigne NUXT_ANTHROPIC_API_KEY.',
    })
  }

  if (!findSessionByDate(date)) {
    throw createError({ statusCode: 404, statusMessage: 'Séance introuvable.' })
  }

  triggerGeneration(date, { regenerate: true, adjustment: parsed.data.instruction })
  return { ok: true, generating: true, date }
})
