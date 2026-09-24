import { z } from 'zod'

const schema = z.object({
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  weightKg: z.number().positive().max(400),
})

/** POST /api/weights — enregistre (ou met à jour) le poids d'une date. */
export default defineEventHandler(async (event) => {
  const parsed = schema.safeParse(await readBody(event))
  if (!parsed.success) {
    throw createError({ statusCode: 400, statusMessage: 'Poids invalide.' })
  }
  const date = parsed.data.date ?? todayIso(getSettings().timezone)
  const updated = upsertWeight(date, parsed.data.weightKg)
  invalidatePreparedSessions()
  return updated
})
