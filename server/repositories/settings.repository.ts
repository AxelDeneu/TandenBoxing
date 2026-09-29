import { eq } from 'drizzle-orm'
import type { NewSettings, Settings } from '../database/schema'
import { normalizeOpenRouterModelSlug } from '../../shared/openrouter-models'

/** Accès aux réglages (ligne singleton id = 1). */

export function getSettings(): Settings {
  const db = useDatabase()
  ensureSingletons(db)
  let row = db.select().from(settings).where(eq(settings.id, 1)).get()!
  const normalizedModel = normalizeOpenRouterModelSlug(row.aiModel)
  if (normalizedModel !== row.aiModel) {
    db.update(settings)
      .set({ aiModel: normalizedModel, updatedAt: new Date() })
      .where(eq(settings.id, 1))
      .run()
    row = db.select().from(settings).where(eq(settings.id, 1)).get()!
  }
  return row
}

export function updateSettings(patch: Partial<NewSettings>): Settings {
  const db = useDatabase()
  const normalizedPatch =
    typeof patch.aiModel === 'string'
      ? { ...patch, aiModel: normalizeOpenRouterModelSlug(patch.aiModel) }
      : patch
  db.update(settings)
    .set({ ...normalizedPatch, updatedAt: new Date() })
    .where(eq(settings.id, 1))
    .run()
  return getSettings()
}
