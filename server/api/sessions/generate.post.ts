/**
 * POST /api/sessions/generate
 * Body: { date?: "YYYY-MM-DD", regenerate?: boolean }
 * Lance la génération en arrière-plan et répond immédiatement.
 */
export default defineEventHandler(async (event) => {
  const body = await readBody<{ date?: string; regenerate?: boolean }>(event).catch(() => ({}))

  const { anthropicApiKey } = useRuntimeConfig()
  if (!anthropicApiKey) {
    throw createError({
      statusCode: 500,
      statusMessage:
        'Clé API Anthropic manquante. Renseigne NUXT_ANTHROPIC_API_KEY dans l’environnement.',
    })
  }

  const date =
    body?.date && /^\d{4}-\d{2}-\d{2}$/.test(body.date)
      ? body.date
      : todayIso(getSettings().timezone)

  // Demande explicite : lève le marqueur « volontairement vide » posé par une suppression/report.
  undismissDate(date)

  triggerGeneration(date, { regenerate: Boolean(body?.regenerate) })
  return { ok: true, generating: true, date }
})
