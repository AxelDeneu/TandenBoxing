import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * Au démarrage du serveur : applique les migrations en attente (best-effort)
 * puis s'assure que les lignes singleton existent.
 *
 * En production le conteneur lance aussi `node scripts/migrate.mjs` avant le boot ;
 * la double application est sans risque (migrator idempotent).
 */
export default defineNitroPlugin(() => {
  const db = useDatabase()
  const migrationsFolder = resolve(process.cwd(), 'drizzle')

  try {
    if (existsSync(migrationsFolder)) {
      migrate(db, { migrationsFolder })
    }
  } catch (error) {
    console.error('[db] Échec des migrations au démarrage :', error)
  }

  ensureSingletons(db)

  // La file est en base : récupère les leases expirés et reprend les jobs après un redémarrage.
  resumeGenerationJobs()
})
