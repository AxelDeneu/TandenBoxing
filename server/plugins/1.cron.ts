/**
 * Planifie la génération quotidienne (7h par défaut) et rattrape la séance du jour
 * au démarrage si le serveur était éteint à l'heure prévue.
 *
 * Désactivable via NUXT_DISABLE_CRON=1 (utile en développement).
 */
export default defineNitroPlugin(() => {
  const { disableCron } = useRuntimeConfig()
  if (disableCron) {
    console.log('[cron] Désactivé (NUXT_DISABLE_CRON).')
    return
  }

  scheduleGeneration()

  // Rattrapage : lance la génération de la séance du jour si elle manque.
  try {
    ensureTodaySession()
  } catch (error) {
    console.error('[cron] Rattrapage au démarrage échoué :', error)
  }
})
