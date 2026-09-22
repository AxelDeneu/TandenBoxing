import { desc, eq, lte } from 'drizzle-orm'
import type { ExercisePreferenceEventRow, NewExercisePreferenceEventRow } from '../database/schema'

type EventValues = Omit<NewExercisePreferenceEventRow, 'id' | 'createdAt' | 'updatedAt'>

export function listExercisePreferenceEvents(asOfDate?: string): ExercisePreferenceEventRow[] {
  const query = useDatabase().select().from(exercisePreferenceEvents)
  return (asOfDate ? query.where(lte(exercisePreferenceEvents.occurredOn, asOfDate)) : query)
    .orderBy(desc(exercisePreferenceEvents.occurredOn), desc(exercisePreferenceEvents.id))
    .all()
}

export function listExercisePreferenceEventsForKey(
  exerciseKey: string,
): ExercisePreferenceEventRow[] {
  return useDatabase()
    .select()
    .from(exercisePreferenceEvents)
    .where(eq(exercisePreferenceEvents.exerciseKey, exerciseKey))
    .orderBy(desc(exercisePreferenceEvents.occurredOn), desc(exercisePreferenceEvents.id))
    .all()
}

export function recordExercisePreferenceEvent(values: EventValues): ExercisePreferenceEventRow {
  return useDatabase().insert(exercisePreferenceEvents).values(values).returning().get()
}

/** Un feedback réenregistré remplace son signal, sans créer artificiellement de fréquence. */
export function upsertExercisePreferenceEvent(values: EventValues): ExercisePreferenceEventRow {
  if (!values.sourceKey) return recordExercisePreferenceEvent(values)
  return useDatabase()
    .insert(exercisePreferenceEvents)
    .values(values)
    .onConflictDoUpdate({
      target: exercisePreferenceEvents.sourceKey,
      set: { ...values, updatedAt: new Date() },
    })
    .returning()
    .get()
}

/** Remplace tout l'apprentissage d'un exercice par la préférence explicite de l'utilisateur. */
export function replaceExercisePreferenceEvents(
  exerciseKey: string,
  values: EventValues,
): ExercisePreferenceEventRow {
  return useDatabase().transaction((tx) => {
    tx.delete(exercisePreferenceEvents)
      .where(eq(exercisePreferenceEvents.exerciseKey, exerciseKey))
      .run()
    return tx.insert(exercisePreferenceEvents).values(values).returning().get()
  })
}

export function deleteExercisePreferenceEvents(exerciseKey: string): number {
  return useDatabase()
    .delete(exercisePreferenceEvents)
    .where(eq(exercisePreferenceEvents.exerciseKey, exerciseKey))
    .run().changes
}
