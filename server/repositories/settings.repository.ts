import { eq } from 'drizzle-orm'
import type { NewSettings, Settings } from '../database/schema'

/** Accès aux réglages (ligne singleton id = 1). */

export function getSettings(): Settings {
  const db = useDatabase()
  ensureSingletons(db)
  return db.select().from(settings).where(eq(settings.id, 1)).get()!
}

export function updateSettings(patch: Partial<NewSettings>): Settings {
  const db = useDatabase()
  db.update(settings)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(settings.id, 1))
    .run()
  return getSettings()
}
