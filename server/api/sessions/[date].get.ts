/** GET /api/sessions/:date — détail d'une séance + son feedback. */
export default defineEventHandler((event) => {
  const date = getRouterParam(event, 'date')!
  const row = findSessionByDate(date)
  if (!row) {
    throw createError({ statusCode: 404, statusMessage: 'Séance introuvable.' })
  }
  return {
    ...row,
    feedback: findSessionFeedback(row.id) ?? null,
    exerciseFeedback: listExerciseFeedbackBySession(row.id),
  }
})
