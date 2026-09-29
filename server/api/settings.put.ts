import { z } from 'zod'
import {
  generationScheduleSchema,
  generationTimeSchema,
  scheduleValidationMessage,
  timezoneSchema,
} from '../../shared/schedule'
import { GenerationScheduleError, prepareGenerationSchedule } from '../utils/cron'

const schema = z
  .object({
    trainingDays: z.array(z.number().int().min(1).max(7)).min(1).optional(),
    generationTime: generationTimeSchema.optional(),
    targetDurationMin: z.number().int().min(10).max(120).optional(),
    timezone: timezoneSchema.optional(),
    aiModel: z.string().trim().min(1).max(200).optional(),
    weightTrackingEnabled: z.boolean().optional(),
    authEnabled: z.boolean().optional(),
  })
  .strict()

/** PUT /api/settings */
export default defineEventHandler(async (event) => {
  const parsed = schema.safeParse(await readBody(event))
  if (!parsed.success) {
    throw createError({
      statusCode: 400,
      statusMessage: scheduleValidationMessage(parsed.error, 'Réglages invalides.'),
    })
  }

  const patch = { ...parsed.data }
  if (patch.trainingDays) {
    patch.trainingDays = [...new Set(patch.trainingDays)].sort((a, b) => a - b)
  }

  const current = getSettings()
  const nextSchedule = generationScheduleSchema.safeParse({
    generationTime: patch.generationTime ?? current.generationTime,
    timezone: patch.timezone ?? current.timezone,
  })
  if (!nextSchedule.success) {
    throw createError({
      statusCode: 400,
      statusMessage: scheduleValidationMessage(nextSchedule.error, 'Réglages invalides.'),
    })
  }

  const scheduleChanged =
    nextSchedule.data.generationTime !== current.generationTime ||
    nextSchedule.data.timezone !== current.timezone
  const { disableCron } = useRuntimeConfig()
  let replacement: ReturnType<typeof prepareGenerationSchedule> | null = null
  if (!disableCron && scheduleChanged) {
    try {
      replacement = prepareGenerationSchedule(nextSchedule.data)
    } catch (error) {
      throw createError({
        statusCode: 400,
        statusMessage:
          error instanceof GenerationScheduleError
            ? error.message
            : 'Impossible de replanifier la génération avec ces réglages.',
      })
    }
  }

  let updated: ReturnType<typeof updateSettings>
  try {
    updated = useDatabase().transaction(() => {
      const result = updateSettings(patch)
      replacement?.activate()
      return result
    })
  } catch (error) {
    replacement?.rollback()
    if (error instanceof GenerationScheduleError) {
      throw createError({ statusCode: 400, statusMessage: error.message })
    }
    throw error
  }
  replacement?.finalize()

  invalidatePreparedSessions()
  return updated
})
