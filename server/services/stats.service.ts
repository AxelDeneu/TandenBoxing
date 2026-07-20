import {
  computeLongestStreak,
  computeMonthlyBuckets,
  computeStreak,
  computeWeeklyBuckets,
} from '../../shared/stats-calc'

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

  // Volume par focus et par catégorie (séances complétées).
  const byFocus: Record<string, number> = {}
  const byCategory: Record<string, number> = {}
  for (const r of completed) {
    byFocus[r.focus] = (byFocus[r.focus] ?? 0) + 1
    if (r.category) byCategory[r.category] = (byCategory[r.category] ?? 0) + 1
  }

  // Vue mensuelle (6 derniers mois).
  const monthlyCounts = computeMonthlyBuckets(
    completed.map((r) => r.date),
    today,
  )

  // Records : plus longue série, séance la plus dure encaissée, mois le plus assidu.
  // `completed` est trié du plus récent au plus ancien → la dernière entrée est la plus ancienne.
  const earliest = completed.length ? completed[completed.length - 1]!.date : today
  const longestStreak = computeLongestStreak(
    new Set(completed.map((r) => r.date)),
    s.trainingDays,
    earliest,
    today,
  )

  let hardest: { date: string; title: string; difficulty: number } | null = null
  for (const r of completed) {
    const d = fbById.get(r.id)?.overallDifficulty
    if (d != null && (!hardest || d > hardest.difficulty)) {
      hardest = { date: r.date, title: r.title, difficulty: d }
    }
  }

  const bestMonth = monthlyCounts.reduce<{ month: string; count: number } | null>(
    (best, b) => (b.count > 0 && (!best || b.count > best.count) ? b : best),
    null,
  )

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
    byFocus,
    byCategory,
    monthlyCounts,
    records: { longestStreak, hardest, bestMonth },
    weights: s.weightTrackingEnabled ? listWeights() : [],
    weightTrackingEnabled: s.weightTrackingEnabled,
  }
}
