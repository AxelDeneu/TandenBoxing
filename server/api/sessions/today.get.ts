/**
 * GET /api/sessions/today
 * État de la journée. Si la séance manque (jour d'entraînement + clé API), la génération
 * est lancée en arrière-plan — sauf si la date a été volontairement vidée (suppression/report) :
 * dans ce cas seule une génération explicite recrée une séance.
 */
export default defineEventHandler(() => {
  const s = getSettings()
  const today = todayIso(s.timezone)
  const isTrainingDay = s.trainingDays.includes(isoWeekday(today))
  const { openrouterApiKey } = useRuntimeConfig()
  const hasApiKey = Boolean(openrouterApiKey)

  const session = findSessionByDate(today) ?? null
  const dismissed = !session && isDateDismissed(today)

  if (s.onboardingCompleted && !session && !dismissed && isTrainingDay) {
    requestGenerationJob(today, { source: 'automatic' })
  }

  const generationJob = generationJobForDate(today)

  return {
    date: today,
    isTrainingDay,
    hasApiKey,
    onboardingCompleted: s.onboardingCompleted,
    session,
    dismissed,
    generating: isGenerating(today),
    generationJob,
  }
})
