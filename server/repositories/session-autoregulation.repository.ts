import { and, desc, eq, gte, lt, lte } from 'drizzle-orm'
import type {
  NewSession,
  NewSessionAdaptationRow,
  NewSessionCheckInRow,
  Session,
  SessionAdaptationRow,
  SessionCheckInRow,
} from '../database/schema'

type CheckInValues = Omit<NewSessionCheckInRow, 'id' | 'createdAt' | 'updatedAt'>
type AdaptationValues = Omit<NewSessionAdaptationRow, 'id' | 'createdAt'>

export function findSessionCheckIn(sessionId: number): SessionCheckInRow | undefined {
  return useDatabase()
    .select()
    .from(sessionCheckIns)
    .where(eq(sessionCheckIns.sessionId, sessionId))
    .get()
}

export function upsertSessionCheckIn(values: CheckInValues): SessionCheckInRow {
  return useDatabase()
    .insert(sessionCheckIns)
    .values(values)
    .onConflictDoUpdate({
      target: sessionCheckIns.sessionId,
      set: { ...values, updatedAt: new Date() },
    })
    .returning()
    .get()
}

export function recordSessionAdaptation(values: AdaptationValues): SessionAdaptationRow {
  return useDatabase().insert(sessionAdaptations).values(values).returning().get()
}

/** La structure adaptée et sa trace append-only sont validées dans la même transaction. */
export function persistSessionAutoregulation(
  date: string,
  sessionPatch: Partial<NewSession>,
  adaptationValues: AdaptationValues,
): { session: Session; adaptation: SessionAdaptationRow } {
  return useDatabase().transaction((tx) => {
    tx.update(sessions)
      .set({ ...sessionPatch, updatedAt: new Date() })
      .where(eq(sessions.date, date))
      .run()
    const session = tx.select().from(sessions).where(eq(sessions.date, date)).get()
    if (!session) throw new Error('Séance introuvable pendant la transaction.')
    const adaptation = tx.insert(sessionAdaptations).values(adaptationValues).returning().get()
    return { session, adaptation }
  })
}

export function listSessionAdaptations(sessionId: number): SessionAdaptationRow[] {
  return useDatabase()
    .select()
    .from(sessionAdaptations)
    .where(eq(sessionAdaptations.sessionId, sessionId))
    .orderBy(desc(sessionAdaptations.id))
    .all()
}

export function listSessionAdaptationsBefore(date: string, limit = 20): SessionAdaptationRow[] {
  return useDatabase()
    .select()
    .from(sessionAdaptations)
    .where(lt(sessionAdaptations.sessionDate, date))
    .orderBy(desc(sessionAdaptations.sessionDate), desc(sessionAdaptations.id))
    .limit(limit)
    .all()
}

export function listSessionAdaptationsBetween(from: string, to: string): SessionAdaptationRow[] {
  return useDatabase()
    .select()
    .from(sessionAdaptations)
    .where(and(gte(sessionAdaptations.sessionDate, from), lte(sessionAdaptations.sessionDate, to)))
    .orderBy(sessionAdaptations.sessionDate, sessionAdaptations.id)
    .all()
}
