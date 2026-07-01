import { eq } from 'drizzle-orm'

/**
 * GET /api/sessions/today
 * Renvoie l'état de la journée. Si la séance manque (jour d'entraînement + clé API),
 * la génération est lancée en arrière-plan (non bloquant) et `generating` passe à true —
 * le client affiche un état « préparation » puis rafraîchit jusqu'à ce que la séance arrive.
 */
export default defineEventHandler(() => {
  const db = useDatabase()
  ensureSingletons(db)
  const settingsRow = db.select().from(settings).where(eq(settings.id, 1)).get()!

  const today = todayIso(settingsRow.timezone)
  const isTrainingDay = settingsRow.trainingDays.includes(isoWeekday(today))
  const { anthropicApiKey } = useRuntimeConfig()
  const hasApiKey = Boolean(anthropicApiKey)

  const session = db.select().from(sessions).where(eq(sessions.date, today)).get() ?? null

  if (!session && isTrainingDay && hasApiKey) {
    triggerGeneration(today)
  }

  return {
    date: today,
    isTrainingDay,
    hasApiKey,
    onboardingCompleted: settingsRow.onboardingCompleted,
    session,
    generating: isGenerating(today),
  }
})
