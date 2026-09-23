/** GET /api/preferences — préférences apprises, agrégées pour la gestion utilisateur. */
export default defineEventHandler(() => {
  const settingsRow = getSettings()
  const asOfDate = todayIso(settingsRow.timezone)
  return {
    asOfDate,
    preferences: getExercisePreferenceSummaries(asOfDate),
  }
})
