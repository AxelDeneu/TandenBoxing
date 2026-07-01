import { eq } from 'drizzle-orm'

/** GET /api/settings */
export default defineEventHandler(() => {
  const db = useDatabase()
  ensureSingletons(db)
  return db.select().from(settings).where(eq(settings.id, 1)).get()!
})
