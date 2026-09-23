import { z } from 'zod'
import { preferenceReasonCode } from '../../../../shared/exercise-preferences'

const schema = z
  .object({
    blockIndex: z.number().int().nonnegative(),
    exerciseIndex: z.number().int().nonnegative(),
    action: z.enum(['replace', 'remove']),
    reasonCode: preferenceReasonCode.nullable().optional(),
  })
  .strict()

/**
 * POST /api/sessions/:date/swap-exercise
 * Body: { blockIndex, exerciseIndex, action: 'replace' | 'remove', reasonCode? }
 */
export default defineEventHandler(async (event) => {
  const date = getRouterParam(event, 'date')!
  const parsed = schema.safeParse(await readBody(event))
  if (!parsed.success) {
    throw createError({ statusCode: 400, statusMessage: 'Requête invalide.' })
  }
  const body = parsed.data

  if (body.action === 'remove') {
    return removeExerciseFromSession(date, body.blockIndex, body.exerciseIndex, body.reasonCode)
  }
  return replaceExerciseInSession(date, body.blockIndex, body.exerciseIndex, body.reasonCode)
})
