/**
 * POST /api/sessions/:date/swap-exercise
 * Body: { blockIndex, exerciseIndex, action: 'replace' | 'remove', reason? }
 */
export default defineEventHandler(async (event) => {
  const date = getRouterParam(event, 'date')!
  const body = await readBody<{
    blockIndex?: number
    exerciseIndex?: number
    action?: 'replace' | 'remove'
    reason?: string
  }>(event)

  if (
    !body ||
    typeof body.blockIndex !== 'number' ||
    typeof body.exerciseIndex !== 'number' ||
    (body.action !== 'replace' && body.action !== 'remove')
  ) {
    throw createError({ statusCode: 400, statusMessage: 'Requête invalide.' })
  }

  if (body.action === 'remove') {
    return removeExerciseFromSession(date, body.blockIndex, body.exerciseIndex)
  }
  return replaceExerciseInSession(date, body.blockIndex, body.exerciseIndex, body.reason)
})
