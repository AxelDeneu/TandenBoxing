import { z } from 'zod'
import {
  canonicalEquipment,
  trainingEquipmentSchema,
  trainingGoalSchema,
} from '../../shared/profile-personalization'
import {
  generationScheduleSchema,
  generationTimeSchema,
  scheduleValidationMessage,
  timezoneSchema,
} from '../../shared/schedule'
import { GenerationScheduleError, prepareGenerationSchedule } from '../utils/cron'

export const onboardingSchema = z
  .object({
    goal: trainingGoalSchema,
    equipment: z.array(trainingEquipmentSchema).max(trainingEquipmentSchema.options.length),
    fitnessLevel: z.enum(['sedentaire', 'actif', 'sportif']),
    experience: z.string().max(1000).nullable().default(null),
    age: z.number().int().min(10).max(100).nullable().default(null),
    constraints: z.string().max(2000).nullable().default(null),
    trainingDays: z.array(z.number().int().min(1).max(7)).min(1),
    generationTime: generationTimeSchema,
    timezone: timezoneSchema,
    targetDurationMin: z.number().int().min(10).max(120),
  })
  .strict()

/** POST /api/onboarding — enregistre le profil initial et marque l'onboarding terminé. */
export default defineEventHandler(async (event) => {
  const parsed = onboardingSchema.safeParse(await readBody(event))
  if (!parsed.success) {
    throw createError({
      statusCode: 400,
      statusMessage: scheduleValidationMessage(parsed.error, "Réponses d'onboarding invalides."),
    })
  }
  const b = parsed.data

  const schedule = generationScheduleSchema.parse({
    generationTime: b.generationTime,
    timezone: b.timezone,
  })
  const { disableCron } = useRuntimeConfig()
  let replacement: ReturnType<typeof prepareGenerationSchedule> | null = null
  if (!disableCron) {
    try {
      replacement = prepareGenerationSchedule(schedule)
    } catch (error) {
      throw createError({
        statusCode: 400,
        statusMessage:
          error instanceof GenerationScheduleError
            ? error.message
            : 'Impossible de planifier la génération avec ces réglages.',
      })
    }
  }

  try {
    useDatabase().transaction(() => {
      updateProfile({
        goal: b.goal,
        equipment: canonicalEquipment(b.equipment),
        fitnessLevel: b.fitnessLevel,
        experience: b.experience,
        age: b.age,
        constraints: b.constraints,
      })
      updateSettings({
        trainingDays: [...new Set(b.trainingDays)].sort((x, y) => x - y),
        generationTime: schedule.generationTime,
        timezone: schedule.timezone,
        targetDurationMin: b.targetDurationMin,
        onboardingCompleted: true,
      })
      replacement?.activate()
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
  // La première demande automatique ne part qu'après le commit du profil complet et
  // l'activation réussie du cron. `ensureTodaySession` revalide aussi cette frontière.
  try {
    ensureTodaySession()
  } catch (error) {
    console.error('[onboarding] Premier rattrapage automatique échoué :', error)
  }

  return { ok: true }
})
