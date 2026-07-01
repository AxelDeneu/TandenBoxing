import { eq } from 'drizzle-orm'

/** GET /api/profile */
export default defineEventHandler(() => {
  const db = useDatabase()
  ensureSingletons(db)
  return db.select().from(profile).where(eq(profile.id, 1)).get()!
})
