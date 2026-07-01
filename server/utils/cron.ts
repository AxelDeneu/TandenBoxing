import { Cron } from 'croner'

let job: Cron | null = null

/**
 * (Re)planifie la génération quotidienne selon les réglages (heure + fuseau).
 * La vérification « jour d'entraînement » est faite à l'exécution (ensureTodaySession).
 */
export function scheduleGeneration(): void {
  const s = getSettings()
  const [hh = '7', mm = '0'] = s.generationTime.split(':')
  const pattern = `${Number(mm)} ${Number(hh)} * * *`

  job?.stop()
  job = new Cron(
    pattern,
    { timezone: s.timezone, name: 'generation-seance', protect: true },
    () => {
      try {
        ensureTodaySession()
      } catch (error) {
        console.error('[cron] Génération planifiée échouée :', error)
      }
    },
  )

  console.log(`[cron] Génération planifiée à ${s.generationTime} (${s.timezone}).`)
}

export function stopGeneration(): void {
  job?.stop()
  job = null
}
