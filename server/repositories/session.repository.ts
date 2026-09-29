import { and, desc, eq, gte, isNull } from 'drizzle-orm'
import type { SessionStatus } from '../../shared/session-lifecycle'
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
        isNull(sessions.startedAt),
        isNull(sessions.completedAt),
      ),
    )
    .orderBy(sessions.date)
    .all()
}

/**
 * Insère ou remplace une proposition encore modifiable. Le filtre protège aussi contre un job de
 * génération qui se terminerait après le démarrage ou la clôture de la séance.
 */
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
      },
      setWhere: eq(sessions.status, 'generated'),
    })
    .run()
  return db.select().from(sessions).where(eq(sessions.date, values.date)).get()!
}

/** Compare-and-set atomique utilisé par la machine d'état de séance. */
export function transitionSessionByDate(
  date: string,
  fromStatus: SessionStatus,
  patch: Partial<NewSession>,
): { changed: boolean; session: Session | undefined } {
  const db = useDatabase()
  const result = db
    .update(sessions)
    .set({ ...patch, updatedAt: new Date() })
    .where(and(eq(sessions.date, date), eq(sessions.status, fromStatus)))
    .run()
  return {
    changed: result.changes > 0,
    session: db
      .select()
      .from(sessions)
      .where(eq(sessions.date, (patch.date as string | undefined) ?? date))
      .get(),
  }
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
