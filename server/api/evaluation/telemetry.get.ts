import { z } from 'zod'

const querySchema = z
  .object({
    from: z.iso.date().optional(),
    to: z.iso.date().optional(),
    minimumGroupSize: z.coerce.number().int().min(3).max(100).default(3),
  })
  .refine((value) => !value.from || !value.to || value.from <= value.to, {
    message: 'La borne from doit précéder to.',
  })

/** GET /api/evaluation/telemetry — uniquement des agrégats structurés, jamais de texte libre. */
export default defineEventHandler((event) => {
  const parsed = querySchema.safeParse(getQuery(event))
  if (!parsed.success) {
    throw createError({ statusCode: 400, statusMessage: 'Fenêtre de télémétrie invalide.' })
  }
  const settings = getSettings()
  const today = todayIso(settings.timezone)
  const to = parsed.data.to ?? today
  const from = parsed.data.from ?? addDays(to, -29)
  return getEvaluationTelemetry(from, to, parsed.data.minimumGroupSize)
})
