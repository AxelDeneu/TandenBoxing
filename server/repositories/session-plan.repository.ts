import { and, eq, gte, lte } from 'drizzle-orm'
import type { NewSessionPlan, SessionPlan } from '../database/schema'

/** Accès aux intentions de planification (une par date). */

export function getPlan(date: string): SessionPlan | undefined {
  return useDatabase().select().from(sessionPlans).where(eq(sessionPlans.date, date)).get()
}

/** Insère ou met à jour l'intention d'une date. */
export function upsertPlan(values: NewSessionPlan): SessionPlan {
  const db = useDatabase()
  db.insert(sessionPlans)
    .values(values)
    .onConflictDoUpdate({
      target: sessionPlans.date,
      set: { ...values, updatedAt: new Date() },
    })
    .run()
  return db.select().from(sessionPlans).where(eq(sessionPlans.date, values.date)).get()!
}

export function deletePlan(date: string): void {
  useDatabase().delete(sessionPlans).where(eq(sessionPlans.date, date)).run()
}

/** Intentions comprises entre deux dates incluses (pour le calendrier). */
export function listPlansBetween(from: string, to: string): SessionPlan[] {
  return useDatabase()
    .select()
    .from(sessionPlans)
    .where(and(gte(sessionPlans.date, from), lte(sessionPlans.date, to)))
    .all()
}
