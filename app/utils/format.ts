const WEEKDAYS_FR = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche']

const MONTHS_FR = [
  'janvier',
  'février',
  'mars',
  'avril',
  'mai',
  'juin',
  'juillet',
  'août',
  'septembre',
  'octobre',
  'novembre',
  'décembre',
]

const MONTHS_SHORT_FR = [
  'janv.',
  'févr.',
  'mars',
  'avr.',
  'mai',
  'juin',
  'juil.',
  'août',
  'sept.',
  'oct.',
  'nov.',
  'déc.',
]

/** Jour de la semaine ISO (1 = lundi … 7 = dimanche). */
export function isoWeekday(dateIso: string): number {
  const d = new Date(`${dateIso}T12:00:00Z`)
  return ((d.getUTCDay() + 6) % 7) + 1
}

export function weekdayLabelFr(dateIso: string): string {
  return WEEKDAYS_FR[isoWeekday(dateIso) - 1] ?? ''
}

/** « mercredi 1 juillet 2026 ». */
export function formatDateFr(dateIso: string): string {
  const [y, m, d] = dateIso.split('-').map(Number)
  return `${weekdayLabelFr(dateIso)} ${d} ${MONTHS_FR[(m ?? 1) - 1]} ${y}`
}

/** « 1 juil. ». */
export function formatDateShort(dateIso: string): string {
  const [, m, d] = dateIso.split('-').map(Number)
  return `${d} ${MONTHS_SHORT_FR[(m ?? 1) - 1]}`
}

/** Chrono « M:SS » (pour le timer). */
export function formatClock(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds))
  const m = Math.floor(s / 60)
  const sec = s % 60
  return `${m}:${sec.toString().padStart(2, '0')}`
}

/** Durée lisible « 42 min » ou « 1 h 05 ». */
export function formatDuration(totalSeconds: number): string {
  const min = Math.round(totalSeconds / 60)
  if (min < 60) return `${min} min`
  const h = Math.floor(min / 60)
  const m = min % 60
  return m ? `${h} h ${m.toString().padStart(2, '0')}` : `${h} h`
}

/** Capitalise la première lettre. */
export function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1)
}

/** Décale une date ISO (YYYY-MM-DD) de `days` jours. */
export function addDaysIso(dateIso: string, days: number): string {
  const d = new Date(`${dateIso}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}
