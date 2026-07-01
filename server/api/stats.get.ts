import { asc, desc, eq, inArray } from 'drizzle-orm'

/** GET /api/stats — agrégats et séries pour le tableau de bord. */
export default defineEventHandler(() => {
  const db = useDatabase()
  ensureSingletons(db)
  const s = db.select().from(settings).where(eq(settings.id, 1)).get()!
  const today = todayIso(s.timezone)
  const monday = addDays(today, -(isoWeekday(today) - 1))

  const completed = db
    .select()
    .from(sessions)
    .where(eq(sessions.status, 'completed'))
    .orderBy(desc(sessions.date))
    .all()

  const ids = completed.map((r) => r.id)
  const fbs = ids.length
    ? db.select().from(sessionFeedback).where(inArray(sessionFeedback.sessionId, ids)).all()
    : []
  const fbById = new Map(fbs.map((f) => [f.sessionId, f]))

  const totalSessions = completed.length
  const totalSeconds = completed.reduce(
    (acc, r) => acc + (r.actualDurationSec ?? r.estimatedDurationMin * 60),
    0,
  )
  const thisWeekCount = completed.filter((r) => r.date >= monday && r.date <= today).length

  // Série en cours : jours d'entraînement consécutifs complétés (aujourd'hui non fait = toléré).
  const completedDates = new Set(completed.map((r) => r.date))
  let streak = 0
  for (let i = 0; i < 180; i++) {
    const day = addDays(today, -i)
    if (!s.trainingDays.includes(isoWeekday(day))) continue
    if (completedDates.has(day)) streak++
    else if (i > 0) break
  }

  // 8 dernières semaines.
  const weeklyCounts: { weekStart: string; count: number }[] = []
  for (let w = 7; w >= 0; w--) {
    const start = addDays(monday, -7 * w)
    const end = addDays(start, 6)
    weeklyCounts.push({
      weekStart: start,
      count: completed.filter((r) => r.date >= start && r.date <= end).length,
    })
  }

  // 12 dernières séances (chronologique) : difficulté + énergie.
  const chrono = [...completed].reverse().slice(-12)
  const difficultySeries = chrono.map((r) => ({
    date: r.date,
    difficulty: fbById.get(r.id)?.overallDifficulty ?? null,
    energy: fbById.get(r.id)?.energyLevel ?? null,
  }))

  const diffs = fbs.map((f) => f.overallDifficulty).filter((v): v is number => v != null)
  const energies = fbs.map((f) => f.energyLevel).filter((v): v is number => v != null)
  const avg = (arr: number[]) =>
    arr.length ? Math.round((arr.reduce((a, b) => a + b, 0) / arr.length) * 10) / 10 : null

  const weightsRows = s.weightTrackingEnabled
    ? db.select().from(weights).orderBy(asc(weights.date)).all()
    : []

  return {
    totalSessions,
    totalMinutes: Math.round(totalSeconds / 60),
    thisWeekCount,
    weeklyTarget: s.trainingDays.length,
    streak,
    avgDifficulty: avg(diffs),
    avgEnergy: avg(energies),
    weeklyCounts,
    difficultySeries,
    weights: weightsRows,
    weightTrackingEnabled: s.weightTrackingEnabled,
  }
})
