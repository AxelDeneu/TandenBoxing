import { z } from 'zod'

const schema = z.object({
  fitnessLevel: z.enum(['sedentaire', 'actif', 'sportif']),
  experience: z.string().max(1000).nullable().default(null),
  age: z.number().int().min(10).max(100).nullable().default(null),
  constraints: z.string().max(2000).nullable().default(null),
  trainingDays: z.array(z.number().int().min(1).max(7)).min(1),
  generationTime: z.string().regex(/^\d{2}:\d{2}$/),
  targetDurationMin: z.number().int().min(10).max(120),
})

/** POST /api/onboarding — enregistre le profil initial et marque l'onboarding terminé. */
export default defineEventHandler(async (event) => {
  const parsed = schema.safeParse(await readBody(event))
  if (!parsed.success) {
    throw createError({ statusCode: 400, statusMessage: "Réponses d'onboarding invalides." })
  }
  const b = parsed.data

  updateProfile({
    fitnessLevel: b.fitnessLevel,
    experience: b.experience,
    age: b.age,
    constraints: b.constraints,
  })
  updateSettings({
    trainingDays: [...new Set(b.trainingDays)].sort((x, y) => x - y),
    generationTime: b.generationTime,
    targetDurationMin: b.targetDurationMin,
    onboardingCompleted: true,
  })

  const { disableCron } = useRuntimeConfig()
  if (!disableCron) scheduleGeneration()

  invalidatePreparedSessions()

  return { ok: true }
})
