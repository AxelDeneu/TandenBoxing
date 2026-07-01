import { eq } from 'drizzle-orm'

/** POST /api/sessions/:date/start — marque la séance comme démarrée. */
export default defineEventHandler((event) => {
  const date = getRouterParam(event, 'date')!
  const db = useDatabase()

  const row = db.select().from(sessions).where(eq(sessions.date, date)).get()
  if (!row) {
    throw createError({ statusCode: 404, statusMessage: 'Séance introuvable.' })
  }

  if (row.status !== 'completed') {
    db.update(sessions)
      .set({ status: 'in_progress', startedAt: row.startedAt ?? new Date(), updatedAt: new Date() })
      .where(eq(sessions.date, date))
      .run()
  }

  return db.select().from(sessions).where(eq(sessions.date, date)).get()!
})
