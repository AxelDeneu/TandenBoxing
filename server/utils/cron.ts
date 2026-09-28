import { Cron } from 'croner'
import { generationScheduleSchema, type GenerationSchedule } from '../../shared/schedule'

let job: Cron | null = null

export interface SchedulableJob {
  nextRun(): Date | null
  pause(): void
  resume(): void
  stop(): void
}

export interface PreparedCronReplacement {
  activate(): void
  finalize(): void
  rollback(): void
}

export class GenerationScheduleError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'GenerationScheduleError'
  }
}

function safeStop(candidate: SchedulableJob): void {
  try {
    candidate.stop()
  } catch (error) {
    console.error('[cron] Impossible de nettoyer un job inactif :', error)
  }
}

/**
 * Prépare un remplacement en deux phases. Le job courant reste actif tant que le nouveau job
 * n'a pas été construit, validé et démarré avec succès.
 */
export function prepareCronReplacement<T extends SchedulableJob>(
  current: T | null,
  build: () => T,
  setCurrent: (next: T | null) => void,
): PreparedCronReplacement {
  let next: T | undefined
  try {
    next = build()
    if (!next.nextRun()) throw new Error('Aucune prochaine exécution calculable.')
  } catch (error) {
    if (next) safeStop(next)
    throw new GenerationScheduleError('Impossible de construire la nouvelle planification.', {
      cause: error,
    })
  }

  const candidate = next

  let activated = false
  let currentPaused = false

  return {
    activate() {
      if (activated) return
      try {
        candidate.resume()
        if (current) {
          current.pause()
          currentPaused = true
        }
        setCurrent(candidate)
        activated = true
      } catch (error) {
        safeStop(candidate)
        if (currentPaused && current) {
          try {
            current.resume()
          } catch (resumeError) {
            console.error('[cron] Impossible de réactiver le job précédent :', resumeError)
          }
          setCurrent(current)
        }
        throw new GenerationScheduleError('Impossible d’activer la nouvelle planification.', {
          cause: error,
        })
      }
    },
    finalize() {
      if (!activated || !current) return
      // Le nouveau job est déjà actif et l'ancien en pause : un échec de nettoyage ne crée pas
      // d'interruption de service ni de double déclenchement.
      safeStop(current)
      currentPaused = false
    },
    rollback() {
      safeStop(candidate)
      if (activated) {
        if (current) {
          try {
            current.resume()
          } catch (error) {
            console.error('[cron] Impossible de restaurer le job précédent :', error)
          }
        }
        setCurrent(current)
      }
      activated = false
      currentPaused = false
    },
  }
}

/** Construit un job en pause afin de valider la configuration sans toucher au job courant. */
export function prepareGenerationSchedule(input: GenerationSchedule): PreparedCronReplacement {
  const parsed = generationScheduleSchema.safeParse(input)
  if (!parsed.success) {
    throw new GenerationScheduleError(
      parsed.error.issues[0]?.message ?? 'Planification invalide.',
      {
        cause: parsed.error,
      },
    )
  }

  const schedule = parsed.data
  const [hh, mm] = schedule.generationTime.split(':').map(Number)
  const pattern = `${mm} ${hh} * * *`

  return prepareCronReplacement(
    job,
    () =>
      new Cron(
        pattern,
        {
          timezone: schedule.timezone,
          paused: true,
          protect: true,
        },
        () => {
          try {
            ensureTodaySession()
          } catch (error) {
            console.error('[cron] Génération planifiée échouée :', error)
          }
        },
      ),
    (next) => {
      job = next as Cron | null
    },
  )
}

/**
 * (Re)planifie la génération quotidienne selon les réglages (heure + fuseau).
 * La vérification « jour d'entraînement » est faite à l'exécution (ensureTodaySession).
 */
export function scheduleGeneration(schedule: GenerationSchedule = getSettings()): void {
  const parsed = generationScheduleSchema.safeParse(schedule)
  if (!parsed.success) {
    throw new GenerationScheduleError(
      parsed.error.issues[0]?.message ?? 'Planification invalide.',
      { cause: parsed.error },
    )
  }

  const replacement = prepareGenerationSchedule(parsed.data)
  try {
    replacement.activate()
    replacement.finalize()
  } catch (error) {
    replacement.rollback()
    throw error
  }

  console.log(
    `[cron] Génération planifiée à ${parsed.data.generationTime} (${parsed.data.timezone}).`,
  )
}

export function stopGeneration(): void {
  job?.stop()
  job = null
}
