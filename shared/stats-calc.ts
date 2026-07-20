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

/**
 * Nombre de séances complétées par mois calendaire, sur les `months` derniers mois,
 * du plus ancien au plus récent. Le mois est au format « YYYY-MM ».
 */
export function computeMonthlyBuckets(
  completedDates: string[],
  today: string,
  months = 6,
): { month: string; count: number }[] {
  const [y, m] = today.split('-').map(Number)
  const base = (y ?? 1970) * 12 + ((m ?? 1) - 1)
  const buckets: { month: string; count: number }[] = []
  for (let i = months - 1; i >= 0; i--) {
    const total = base - i
    const prefix = `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}`
    buckets.push({ month: prefix, count: completedDates.filter((d) => d.startsWith(prefix)).length })
  }
  return buckets
}

/**
 * Plus longue série historique de jours d'entraînement consécutifs complétés,
 * entre `fromDate` et `today` (record, indépendant de la série en cours).
 */
export function computeLongestStreak(
  completedDates: Set<string>,
  trainingDays: number[],
  fromDate: string,
  today: string,
  maxDays = 1095,
): number {
  if (!trainingDays.length || fromDate > today) return 0
  let best = 0
  let current = 0
  for (let i = 0; i <= maxDays; i++) {
    const day = addDays(fromDate, i)
    if (day > today) break
    if (!trainingDays.includes(isoWeekday(day))) continue
    if (completedDates.has(day)) {
      current += 1
      if (current > best) best = current
    } else {
      current = 0
    }
  }
  return best
}
