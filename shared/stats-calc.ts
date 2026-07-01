import { addDays, isoWeekday } from './dates'

/**
 * Série : nombre de jours d'entraînement consécutifs complétés en remontant depuis `today`.
 * Aujourd'hui non encore fait = toléré (ne casse pas la série).
 */
export function computeStreak(
  completedDates: Set<string>,
  trainingDays: number[],
  today: string,
  maxLookbackDays = 180,
): number {
  let streak = 0
  for (let i = 0; i < maxLookbackDays; i++) {
    const day = addDays(today, -i)
    if (!trainingDays.includes(isoWeekday(day))) continue
    if (completedDates.has(day)) streak++
    else if (i > 0) break
  }
  return streak
}

/**
 * Nombre de séances complétées par semaine (lundi → dimanche) sur les `weeks` dernières semaines,
 * de la plus ancienne à la plus récente.
 */
export function computeWeeklyBuckets(
  completedDates: string[],
  today: string,
  weeks = 8,
): { weekStart: string; count: number }[] {
  const monday = addDays(today, -(isoWeekday(today) - 1))
  const buckets: { weekStart: string; count: number }[] = []
  for (let w = weeks - 1; w >= 0; w--) {
    const start = addDays(monday, -7 * w)
    const end = addDays(start, 6)
    buckets.push({
      weekStart: start,
      count: completedDates.filter((d) => d >= start && d <= end).length,
    })
  }
  return buckets
}
