/** DELETE /api/preferences/:exerciseKey — oublie tous les signaux liés à cet exercice. */
export default defineEventHandler((event) => {
  const exerciseKey = getRouterParam(event, 'exerciseKey')
  if (!exerciseKey) {
    throw createError({ statusCode: 400, statusMessage: 'Préférence invalide.' })
  }
  forgetLearnedExercisePreference(exerciseKey)
  return { ok: true }
})
