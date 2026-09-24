import { z } from 'zod'

const schema = z
  .object({
    trainingDays: z.array(z.number().int().min(1).max(7)).min(1).optional(),
    generationTime: z
      .string()
      .regex(/^\d{2}:\d{2}$/)
      .optional(),
    targetDurationMin: z.number().int().min(10).max(120).optional(),
    timezone: z.string().min(1).max(64).optional(),
    aiModel: z.string().min(1).max(64).optional(),
    weightTrackingEnabled: z.boolean().optional(),
    authEnabled: z.boolean().optional(),
  })
  .strict()

/** PUT /api/settings */
export default defineEventHandler(async (event) => {
  const parsed = schema.safeParse(await readBody(event))
  if (!parsed.success) {
    throw createError({ statusCode: 400, statusMessage: 'Réglages invalides.' })
  }

  const patch = { ...parsed.data }
  if (patch.trainingDays) {
    patch.trainingDays = [...new Set(patch.trainingDays)].sort((a, b) => a - b)
  }

  const updated = updateSettings(patch)

  // Replanifie le cron si l'heure ou le fuseau a changé.
  const { disableCron } = useRuntimeConfig()
  if (!disableCron && (patch.generationTime || patch.timezone)) {
    scheduleGeneration()
  }

  invalidatePreparedSessions()
  return updated
})
