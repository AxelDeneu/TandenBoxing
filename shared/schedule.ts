import { z } from 'zod'

const INVALID_GENERATION_TIME_MESSAGE =
  "L'heure de génération doit être comprise entre 00:00 et 23:59."
const INVALID_TIMEZONE_MESSAGE =
  'Le fuseau horaire doit être un identifiant valide, par exemple Europe/Paris ou UTC.'

/** Vérifie qu'un fuseau est réellement accepté par Intl dans le runtime courant. */
export function isUsableTimezone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat('fr-FR', { timeZone: timezone }).format(0)
    return true
  } catch {
    return false
  }
}

export const generationTimeSchema = z
  .string()
  .regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/, INVALID_GENERATION_TIME_MESSAGE)

export const timezoneSchema = z
  .string()
  .trim()
  .min(1, INVALID_TIMEZONE_MESSAGE)
  .max(64, INVALID_TIMEZONE_MESSAGE)
  .refine(isUsableTimezone, INVALID_TIMEZONE_MESSAGE)

export const generationScheduleSchema = z.object({
  generationTime: generationTimeSchema,
  timezone: timezoneSchema,
})

export type GenerationSchedule = z.infer<typeof generationScheduleSchema>

/** Message horaire exploitable d'une validation Zod, avec repli adapté à l'endpoint. */
export function scheduleValidationMessage(error: z.ZodError, fallback: string): string {
  return (
    error.issues.find(({ path }) => path[0] === 'generationTime' || path[0] === 'timezone')
      ?.message ?? fallback
  )
}

/** Liste utilisable par les sélecteurs UI, en conservant UTC et les valeurs déjà persistées. */
export function runtimeTimezones(...additional: Array<string | undefined>): string[] {
  const supported =
    typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : []
  return [...new Set(['UTC', 'Europe/Paris', ...additional, ...supported])]
    .filter((value): value is string => typeof value === 'string' && isUsableTimezone(value))
    .sort()
}
