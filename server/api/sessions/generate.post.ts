import { eq } from 'drizzle-orm'

/**
 * POST /api/sessions/generate
 * Body: { date?: "YYYY-MM-DD", regenerate?: boolean }
 * Lance la génération en arrière-plan et répond immédiatement. Le client suit l'avancement
 * via le flag `generating` de /api/sessions/today.
 */
export default defineEventHandler(async (event) => {
  const body = await readBody<{ date?: string; regenerate?: boolean }>(event).catch(() => ({}))

  const db = useDatabase()
  ensureSingletons(db)
  const settingsRow = db.select().from(settings).where(eq(settings.id, 1)).get()!

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
      : todayIso(settingsRow.timezone)

  triggerGeneration(date, { regenerate: Boolean(body?.regenerate) })

  return { ok: true, generating: true, date }
})
