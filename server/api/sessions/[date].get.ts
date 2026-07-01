import { eq } from 'drizzle-orm'

/** GET /api/sessions/:date — détail d'une séance + son feedback. */
export default defineEventHandler((event) => {
  const date = getRouterParam(event, 'date')!
  const db = useDatabase()

  const row = db.select().from(sessions).where(eq(sessions.date, date)).get()
  if (!row) {
    throw createError({ statusCode: 404, statusMessage: 'Séance introuvable.' })
  }

  const feedback =
    db.select().from(sessionFeedback).where(eq(sessionFeedback.sessionId, row.id)).get() ?? null
  const exerciseFeedbackRows = db
    .select()
    .from(exerciseFeedback)
    .where(eq(exerciseFeedback.sessionId, row.id))
    .all()

  return { ...row, feedback, exerciseFeedback: exerciseFeedbackRows }
})
