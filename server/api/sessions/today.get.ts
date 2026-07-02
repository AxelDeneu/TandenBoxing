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
  const { anthropicApiKey } = useRuntimeConfig()
  const hasApiKey = Boolean(anthropicApiKey)

  const session = findSessionByDate(today) ?? null
  const dismissed = !session && isDateDismissed(today)

  if (!session && !dismissed && isTrainingDay && hasApiKey) {
    triggerGeneration(today)
  }

  return {
    date: today,
    isTrainingDay,
    hasApiKey,
    onboardingCompleted: s.onboardingCompleted,
    session,
    dismissed,
    generating: isGenerating(today),
  }
})
