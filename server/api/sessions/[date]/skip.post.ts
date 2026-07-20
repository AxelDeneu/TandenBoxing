import { z } from 'zod'

const schema = z.object({
  reason: z.string().trim().max(500).nullable().default(null),
})

/**
 * POST /api/sessions/:date/skip
 * Body: { reason?: "pas eu le temps" }
 * Marque la séance comme sautée ; la raison remonte au contexte IA.
 */
export default defineEventHandler(async (event) => {
  const date = getRouterParam(event, 'date')!
  const parsed = schema.safeParse(await readBody(event).catch(() => ({})))
  if (!parsed.success) {
    throw createError({ statusCode: 400, statusMessage: 'Requête invalide.' })
  }
  const reason = parsed.data.reason?.trim() || null
  skipSession(date, reason)
  return { ok: true }
})
