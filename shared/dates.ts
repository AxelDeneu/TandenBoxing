export const WEEKDAYS_FR = [
  'lundi',
  'mardi',
  'mercredi',
  'jeudi',
  'vendredi',
  'samedi',
  'dimanche',
] as const

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

/** Date du jour (YYYY-MM-DD) dans le fuseau donné. */
export function todayIso(timezone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
}

/** Heure actuelle « HH:mm » dans le fuseau donné. */
export function currentTimeIso(timezone: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date())
}

/** Jour de la semaine ISO (1 = lundi … 7 = dimanche) d'une date YYYY-MM-DD. */
export function isoWeekday(dateIso: string): number {
  const d = new Date(`${dateIso}T12:00:00Z`)
  return ((d.getUTCDay() + 6) % 7) + 1
}

/** Libellé FR du jour de la semaine (« mercredi »). */
export function weekdayLabel(dateIso: string): string {
  return WEEKDAYS_FR[isoWeekday(dateIso) - 1]!
}

/** Libellé FR complet (« mercredi 1 juillet 2026 »). */
export function formatDateFr(dateIso: string): string {
  const [y, m, d] = dateIso.split('-').map(Number)
  return `${weekdayLabel(dateIso)} ${d} ${MONTHS_FR[(m ?? 1) - 1]} ${y}`
}

/** Décale une date ISO de `days` jours (peut être négatif). */
export function addDays(dateIso: string, days: number): string {
  const d = new Date(`${dateIso}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

/** Nombre de jours entre deux dates ISO (b - a). */
export function daysBetween(a: string, b: string): number {
  const da = new Date(`${a}T12:00:00Z`).getTime()
  const db = new Date(`${b}T12:00:00Z`).getTime()
  return Math.round((db - da) / 86_400_000)
}
