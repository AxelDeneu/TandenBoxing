import { z } from 'zod'

const schema = z
  .object({
    level: z.enum(['debutant', 'intermediaire', 'avance']).optional(),
    goal: z.string().min(1).max(64).optional(),
    fitnessLevel: z.enum(['sedentaire', 'actif', 'sportif']).nullable().optional(),
    experience: z.string().max(1000).nullable().optional(),
    age: z.number().int().min(10).max(100).nullable().optional(),
    heightCm: z.number().int().min(100).max(230).nullable().optional(),
    equipment: z.array(z.string()).optional(),
    constraints: z.string().max(2000).nullable().optional(),
    notes: z.string().max(2000).nullable().optional(),
  })
  .strict()

/** PUT /api/profile */
export default defineEventHandler(async (event) => {
  const parsed = schema.safeParse(await readBody(event))
  if (!parsed.success) {
    throw createError({ statusCode: 400, statusMessage: 'Profil invalide.' })
  }
  return updateProfile(parsed.data)
})
