import { computeStreak, computeWeeklyBuckets } from '../../shared/stats-calc'

/** Agrégats et séries pour le tableau de bord. */
export function getStats() {
  const s = getSettings()
  const today = todayIso(s.timezone)
  const monday = addDays(today, -(isoWeekday(today) - 1))

  const completed = listCompletedSessions()
  const fbs = listSessionFeedbackByIds(completed.map((r) => r.id))
  const fbById = new Map(fbs.map((f) => [f.sessionId, f]))

  const totalSessions = completed.length
  const totalSeconds = completed.reduce(
    (acc, r) => acc + (r.actualDurationSec ?? r.estimatedDurationMin * 60),
    0,
  )
  const thisWeekCount = completed.filter((r) => r.date >= monday && r.date <= today).length

  const streak = computeStreak(new Set(completed.map((r) => r.date)), s.trainingDays, today)
  const weeklyCounts = computeWeeklyBuckets(
    completed.map((r) => r.date),
    today,
  )

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
    weights: s.weightTrackingEnabled ? listWeights() : [],
    weightTrackingEnabled: s.weightTrackingEnabled,
  }
}
