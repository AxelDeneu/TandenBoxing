import { eq } from 'drizzle-orm'
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
  const body = parsed.data
  const now = new Date()

  const db = useDatabase()
  ensureSingletons(db)

  db.update(profile)
    .set({
      fitnessLevel: body.fitnessLevel,
      experience: body.experience,
      age: body.age,
      constraints: body.constraints,
      updatedAt: now,
    })
    .where(eq(profile.id, 1))
    .run()

  db.update(settings)
    .set({
      trainingDays: [...new Set(body.trainingDays)].sort((a, b) => a - b),
      generationTime: body.generationTime,
      targetDurationMin: body.targetDurationMin,
      onboardingCompleted: true,
      updatedAt: now,
    })
    .where(eq(settings.id, 1))
    .run()

  const { disableCron } = useRuntimeConfig()
  if (!disableCron) scheduleGeneration()

  return { ok: true }
})
