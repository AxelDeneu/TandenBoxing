/** GET /api/sessions — liste des séances (récentes d'abord) avec résumé de feedback. */
export default defineEventHandler(() => {
  const rows = listRecentSessions(120)
  const byId = new Map(listSessionFeedbackByIds(rows.map((r) => r.id)).map((f) => [f.sessionId, f]))

  return rows.map((r) => ({
    id: r.id,
    date: r.date,
    status: r.status,
    title: r.title,
    focus: r.focus,
    estimatedDurationMin: r.estimatedDurationMin,
    actualDurationSec: r.actualDurationSec,
    completedAt: r.completedAt,
    difficulty: byId.get(r.id)?.overallDifficulty ?? null,
    energy: byId.get(r.id)?.energyLevel ?? null,
  }))
})
