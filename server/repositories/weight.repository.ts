import { asc, eq } from 'drizzle-orm'
import type { Weight } from '../database/schema'

/** Accès au suivi de poids. */

export function listWeights(): Weight[] {
  return useDatabase().select().from(weights).orderBy(asc(weights.date)).all()
}

export function upsertWeight(date: string, weightKg: number): Weight {
  const db = useDatabase()
  db.insert(weights)
    .values({ date, weightKg })
    .onConflictDoUpdate({ target: weights.date, set: { weightKg } })
    .run()
  return db.select().from(weights).where(eq(weights.date, date)).get()!
}
