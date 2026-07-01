import { eq, inArray } from 'drizzle-orm'
import type {
  ExerciseFeedback,
  NewExerciseFeedback,
  NewSessionFeedback,
  SessionFeedback,
} from '../database/schema'

/** Accès au feedback (global + par exercice). */

type SessionFeedbackValues = Omit<NewSessionFeedback, 'id' | 'sessionId' | 'createdAt'>

export function findSessionFeedback(sessionId: number): SessionFeedback | undefined {
  return useDatabase()
    .select()
    .from(sessionFeedback)
    .where(eq(sessionFeedback.sessionId, sessionId))
    .get()
}

export function listSessionFeedbackByIds(ids: number[]): SessionFeedback[] {
  if (!ids.length) return []
  return useDatabase()
    .select()
    .from(sessionFeedback)
    .where(inArray(sessionFeedback.sessionId, ids))
    .all()
}

export function upsertSessionFeedback(sessionId: number, values: SessionFeedbackValues): void {
  useDatabase()
    .insert(sessionFeedback)
    .values({ sessionId, ...values })
    .onConflictDoUpdate({ target: sessionFeedback.sessionId, set: values })
    .run()
}

export function listExerciseFeedbackByIds(ids: number[]): ExerciseFeedback[] {
  if (!ids.length) return []
  return useDatabase()
    .select()
    .from(exerciseFeedback)
    .where(inArray(exerciseFeedback.sessionId, ids))
    .all()
}

export function listExerciseFeedbackBySession(sessionId: number): ExerciseFeedback[] {
  return useDatabase()
    .select()
    .from(exerciseFeedback)
    .where(eq(exerciseFeedback.sessionId, sessionId))
    .all()
}

export function replaceExerciseFeedback(sessionId: number, rows: NewExerciseFeedback[]): void {
  const db = useDatabase()
  db.delete(exerciseFeedback).where(eq(exerciseFeedback.sessionId, sessionId)).run()
  if (rows.length) db.insert(exerciseFeedback).values(rows).run()
}
