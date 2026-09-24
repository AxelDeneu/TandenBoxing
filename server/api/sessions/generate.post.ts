/**
 * POST /api/sessions/generate
 * Body: { date?: "YYYY-MM-DD", regenerate?: boolean }
 * Lance la génération en arrière-plan et répond immédiatement.
 */
export default defineEventHandler(async (event) => {
  const body = await readBody<{ date?: string; regenerate?: boolean }>(event).catch(
    (): { date?: string; regenerate?: boolean } => ({}),
  )

  const date =
    body?.date && /^\d{4}-\d{2}-\d{2}$/.test(body.date)
      ? body.date
      : todayIso(getSettings().timezone)

  if (body?.regenerate && findSessionByDate(date)?.status === 'in_progress') {
    throw createError({
      statusCode: 409,
      statusMessage:
        'Une séance démarrée ne peut être régénérée. Utilise les actions du timer pour adapter uniquement la suite.',
    })
  }

  // Demande explicite : lève le marqueur « volontairement vide » posé par une suppression/report.
  undismissDate(date)

  const job = requestGenerationJob(date, {
    regenerate: Boolean(body?.regenerate),
    source: 'user',
    retryFailed: true,
  })
  return {
    ok: true,
    generating: isGenerating(date),
    date,
    job: toPublicGenerationJob(job ?? findLatestGenerationJob(date)),
  }
})
