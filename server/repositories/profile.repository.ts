import { eq } from 'drizzle-orm'
import type { NewProfile, Profile } from '../database/schema'

/** Accès au profil sportif (ligne singleton id = 1). */

export function getProfile(): Profile {
  const db = useDatabase()
  ensureSingletons(db)
  return db.select().from(profile).where(eq(profile.id, 1)).get()!
}

export function updateProfile(patch: Partial<NewProfile>): Profile {
  const db = useDatabase()
  db.update(profile)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(profile.id, 1))
    .run()
  return getProfile()
}
