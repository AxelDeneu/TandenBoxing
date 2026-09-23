import { z } from 'zod'
import { preferenceReasonCode } from '../../../shared/exercise-preferences'

const schema = z
  .object({
    action: z.enum(['liked', 'disliked']),
    reasonCode: preferenceReasonCode.nullable().optional(),
  })
  .strict()

/** PUT /api/preferences/:exerciseKey — remplace l'apprentissage par un choix explicite. */
export default defineEventHandler(async (event) => {
  const exerciseKey = getRouterParam(event, 'exerciseKey')
  const parsed = schema.safeParse(await readBody(event))
  if (!exerciseKey || !parsed.success) {
    throw createError({ statusCode: 400, statusMessage: 'Préférence invalide.' })
  }
  return replaceLearnedExercisePreference(exerciseKey, parsed.data.action, parsed.data.reasonCode)
})
