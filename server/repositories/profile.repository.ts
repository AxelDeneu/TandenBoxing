import { eq } from 'drizzle-orm'
import {
  PROFILE_PERSONALIZATION_VERSION,
  canonicalEquipment,
  normalizeTrainingGoal,
  resolveProfilePersonalization,
} from '../../shared/profile-personalization'
import type { NewProfile, Profile } from '../database/schema'

/** Accès au profil sportif (ligne singleton id = 1). */

export function getProfile(): Profile {
  const db = useDatabase()
  ensureSingletons(db)
  const stored = db.select().from(profile).where(eq(profile.id, 1)).get()!
  const personalization = resolveProfilePersonalization(stored)
  return {
    ...stored,
    goal: personalization.goal,
    equipment: personalization.equipment,
    personalizationVersion: personalization.version,
  }
}

export function updateProfile(patch: Partial<NewProfile>): Profile {
  const db = useDatabase()
  const updatesPersonalization = patch.goal !== undefined || patch.equipment !== undefined
  let normalizedPatch = patch
  if (updatesPersonalization) {
    const current = getProfile()
    normalizedPatch = {
      ...patch,
      goal: normalizeTrainingGoal(patch.goal ?? current.goal),
      equipment: canonicalEquipment(patch.equipment ?? current.equipment),
      personalizationVersion: PROFILE_PERSONALIZATION_VERSION,
    }
  }
  db.update(profile)
    .set({ ...normalizedPatch, updatedAt: new Date() })
    .where(eq(profile.id, 1))
    .run()
  return getProfile()
}
