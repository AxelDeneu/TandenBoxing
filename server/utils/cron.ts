import { Cron } from 'croner'
import { eq } from 'drizzle-orm'

let job: Cron | null = null

/**
 * (Re)planifie la génération quotidienne de la séance selon les réglages
 * (heure + fuseau). Appelée au démarrage et après toute modification des réglages.
 * La vérification « jour d'entraînement » est faite à l'exécution (dans ensureTodaySession),
 * donc changer les jours ne nécessite pas de replanification.
 */
export function scheduleGeneration(): void {
  const db = useDatabase()
  ensureSingletons(db)
  const s = db.select().from(settings).where(eq(settings.id, 1)).get()!

  const [hh = '7', mm = '0'] = s.generationTime.split(':')
  const pattern = `${Number(mm)} ${Number(hh)} * * *`

  job?.stop()
  job = new Cron(pattern, { timezone: s.timezone, name: 'generation-seance', protect: true }, () => {
    try {
      ensureTodaySession()
    } catch (error) {
      console.error('[cron] Génération planifiée échouée :', error)
    }
  })

  console.log(`[cron] Génération planifiée à ${s.generationTime} (${s.timezone}).`)
}

export function stopGeneration(): void {
  job?.stop()
  job = null
}
