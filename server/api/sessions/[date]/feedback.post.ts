import { z } from 'zod'
import { preferenceReasonCode } from '../../../../shared/exercise-preferences'

const schema = z.object({
  completed: z.boolean().default(true),
  overallDifficulty: z.number().int().min(1).max(5).nullable().default(null),
  energyLevel: z.number().int().min(1).max(5).nullable().default(null),
  soreness: z.array(z.string()).default([]),
  enjoyment: z.number().int().min(1).max(5).nullable().default(null),
  comment: z.string().max(2000).nullable().default(null),
  actualDurationSec: z.number().int().min(0).max(36_000).nullable().default(null),
  exercises: z
    .array(
      z.object({
        blockIndex: z.number().int(),
        exerciseIndex: z.number().int(),
        exerciseName: z.string(),
        difficulty: z.number().int().min(1).max(5).nullable().default(null),
        comment: z.string().max(1000).nullable().default(null),
        preferenceAction: z.enum(['liked', 'disliked']).nullable().default(null),
        preferenceReasonCode: preferenceReasonCode.nullable().default(null),
      }),
    )
    .default([]),
})

/** POST /api/sessions/:date/feedback — enregistre le feedback et clôt la séance. */
export default defineEventHandler(async (event) => {
  const date = getRouterParam(event, 'date')!
  const parsed = schema.safeParse(await readBody(event))
  if (!parsed.success) {
    throw createError({ statusCode: 400, statusMessage: 'Feedback invalide.' })
  }
  submitFeedback(date, parsed.data)
  return { ok: true }
})
