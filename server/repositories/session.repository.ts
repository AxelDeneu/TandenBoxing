import { and, desc, eq, gte } from 'drizzle-orm'
import type { NewSession, Session } from '../database/schema'

/** Accès aux séances. */

export function findSessionByDate(date: string): Session | undefined {
  return useDatabase().select().from(sessions).where(eq(sessions.date, date)).get()
}

export function listRecentSessions(limit = 120): Session[] {
  return useDatabase().select().from(sessions).orderBy(desc(sessions.date)).limit(limit).all()
}

export function listCompletedSessions(): Session[] {
  return useDatabase()
    .select()
    .from(sessions)
    .where(eq(sessions.status, 'completed'))
    .orderBy(desc(sessions.date))
    .all()
}

export function listSessionsSince(dateFrom: string): Session[] {
  return useDatabase().select().from(sessions).where(gte(sessions.date, dateFrom)).all()
}

export function listPreparedSessions(dateFrom: string): Session[] {
  return useDatabase()
    .select()
    .from(sessions)
    .where(
      and(
        gte(sessions.date, dateFrom),
        eq(sessions.generationSource, 'prefetch'),
        eq(sessions.status, 'generated'),
      ),
    )
    .orderBy(sessions.date)
    .all()
}

/** Insère ou remplace la séance d'une date (réinitialise l'état d'exécution en cas de régénération). */
export function upsertSessionByDate(values: NewSession): Session {
  const db = useDatabase()
  const now = new Date()
  db.insert(sessions)
    .values(values)
    .onConflictDoUpdate({
      target: sessions.date,
      set: {
        ...values,
        updatedAt: now,
        startedAt: null,
        completedAt: null,
        actualDurationSec: null,
      },
    })
    .run()
  return db.select().from(sessions).where(eq(sessions.date, values.date)).get()!
}

export function updateSessionByDate(date: string, patch: Partial<NewSession>): Session {
  const db = useDatabase()
  db.update(sessions)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(sessions.date, date))
    .run()
  const key = (patch.date as string | undefined) ?? date
  return db.select().from(sessions).where(eq(sessions.date, key)).get()!
}

/** Supprime la séance d'une date (le feedback lié part en cascade). */
export function deleteSessionByDate(date: string): void {
  useDatabase().delete(sessions).where(eq(sessions.date, date)).run()
}
