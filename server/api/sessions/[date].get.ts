/** GET /api/sessions/:date — détail d'une séance + son feedback. */
export default defineEventHandler((event) => {
  const date = getRouterParam(event, 'date')!
  const row = findSessionByDate(date)
  if (!row) {
    throw createError({ statusCode: 404, statusMessage: 'Séance introuvable.' })
  }
  return {
    ...row,
    pedagogicalIntent: buildSessionPedagogicalIntent(row),
    feedback: findSessionFeedback(row.id) ?? null,
    exerciseFeedback: listExerciseFeedbackBySession(row.id),
    checkIn: findSessionCheckIn(row.id) ?? null,
    adaptations: listSessionAdaptations(row.id),
  }
})
