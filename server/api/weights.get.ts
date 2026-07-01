import { asc } from 'drizzle-orm'

/** GET /api/weights — historique de poids (chronologique). */
export default defineEventHandler(() => {
  const db = useDatabase()
  return db.select().from(weights).orderBy(asc(weights.date)).all()
})
