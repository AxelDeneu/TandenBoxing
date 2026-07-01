import { desc, inArray } from 'drizzle-orm'

/** GET /api/sessions — liste des séances (récentes d'abord) avec résumé de feedback. */
export default defineEventHandler(() => {
  const db = useDatabase()

  const rows = db
    .select({
      id: sessions.id,
      date: sessions.date,
      status: sessions.status,
      title: sessions.title,
      focus: sessions.focus,
      estimatedDurationMin: sessions.estimatedDurationMin,
      actualDurationSec: sessions.actualDurationSec,
      completedAt: sessions.completedAt,
    })
    .from(sessions)
    .orderBy(desc(sessions.date))
    .limit(120)
    .all()

  const ids = rows.map((r) => r.id)
  const fbs = ids.length
    ? db.select().from(sessionFeedback).where(inArray(sessionFeedback.sessionId, ids)).all()
    : []
  const byId = new Map(fbs.map((f) => [f.sessionId, f]))

  return rows.map((r) => ({
    ...r,
    difficulty: byId.get(r.id)?.overallDifficulty ?? null,
    energy: byId.get(r.id)?.energyLevel ?? null,
  }))
})
