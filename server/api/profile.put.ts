import { z } from 'zod'
import {
  canonicalEquipment,
  trainingEquipmentSchema,
  trainingGoalSchema,
} from '../../shared/profile-personalization'

export const profilePatchSchema = z
  .object({
    level: z.enum(['debutant', 'intermediaire', 'avance']).optional(),
    goal: trainingGoalSchema.optional(),
    fitnessLevel: z.enum(['sedentaire', 'actif', 'sportif']).nullable().optional(),
    experience: z.string().max(1000).nullable().optional(),
    age: z.number().int().min(10).max(100).nullable().optional(),
    heightCm: z.number().int().min(100).max(230).nullable().optional(),
    equipment: z
      .array(trainingEquipmentSchema)
      .max(trainingEquipmentSchema.options.length)
      .optional(),
    constraints: z.string().max(2000).nullable().optional(),
    notes: z.string().max(2000).nullable().optional(),
  })
  .strict()

/** PUT /api/profile */
export default defineEventHandler(async (event) => {
  const parsed = profilePatchSchema.safeParse(await readBody(event))
  if (!parsed.success) {
    throw createError({ statusCode: 400, statusMessage: 'Profil invalide.' })
  }
  const updated = updateProfile({
    ...parsed.data,
    ...(parsed.data.equipment ? { equipment: canonicalEquipment(parsed.data.equipment) } : {}),
  })
  invalidatePreparedSessions()
  return updated
})
