/**
 * GET /api/sessions/today
 * État de la journée. Si la séance manque (jour d'entraînement + clé API), la génération
 * est lancée en arrière-plan et `generating` passe à true.
 */
export default defineEventHandler(() => {
  const s = getSettings()
  const today = todayIso(s.timezone)
  const isTrainingDay = s.trainingDays.includes(isoWeekday(today))
  const { anthropicApiKey } = useRuntimeConfig()
  const hasApiKey = Boolean(anthropicApiKey)

  const session = findSessionByDate(today) ?? null
  if (!session && isTrainingDay && hasApiKey) {
    triggerGeneration(today)
  }

  return {
    date: today,
    isTrainingDay,
    hasApiKey,
    onboardingCompleted: s.onboardingCompleted,
    session,
    generating: isGenerating(today),
  }
})
