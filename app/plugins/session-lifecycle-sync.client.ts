import { flushPendingSessionLifecycle } from '~/utils/session-lifecycle-sync'

/** Rejoue une seule file locale ; l'idempotence serveur couvre une coupure après accusé réseau. */
export default defineNuxtPlugin(() => {
  const sync = () => {
    void flushPendingSessionLifecycle().catch(() => {
      // Hors ligne ou serveur indisponible : la file locale reste intacte jusqu'au prochain `online`.
    })
  }

  sync()
  window.addEventListener('online', sync)
})
