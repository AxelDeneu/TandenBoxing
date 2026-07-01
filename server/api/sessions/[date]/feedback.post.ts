import { eq } from 'drizzle-orm'
import { z } from 'zod'

const bodySchema = z.object({
  completed: z.boolean().default(true),
  overallDifficulty: z.number().int().min(1).max(5).nullable().default(null),
  energyLevel: z.number().int().min(1).max(5).nullable().default(null),
  soreness: z.array(z.string()).default([]),
  enjoyment: z.number().int().min(1).max(5).nullable().default(null),
  comment: z.string().max(2000).nullable().default(null),
  actualDurationSec: z.number().int().min(0).max(36_000).nullable().default(null),
  exercises: z
    .array(
      z.object({
        blockIndex: z.number().int(),
        exerciseIndex: z.number().int(),
        exerciseName: z.string(),
        difficulty: z.number().int().min(1).max(5).nullable().default(null),
        comment: z.string().max(1000).nullable().default(null),
      }),
    )
    .default([]),
})

/** POST /api/sessions/:date/feedback — enregistre le feedback et clôt la séance. */
export default defineEventHandler(async (event) => {
  const date = getRouterParam(event, 'date')!
  const parsed = bodySchema.safeParse(await readBody(event))
  if (!parsed.success) {
    throw createError({ statusCode: 400, statusMessage: 'Feedback invalide.' })
  }
  const body = parsed.data

  const db = useDatabase()
  const row = db.select().from(sessions).where(eq(sessions.date, date)).get()
  if (!row) {
    throw createError({ statusCode: 404, statusMessage: 'Séance introuvable.' })
  }

  const now = new Date()

  const feedbackValues = {
    completed: body.completed,
    overallDifficulty: body.overallDifficulty,
    energyLevel: body.energyLevel,
    soreness: body.soreness,
    enjoyment: body.enjoyment,
    comment: body.comment,
    actualDurationSec: body.actualDurationSec,
  }

  db.insert(sessionFeedback)
    .values({ sessionId: row.id, ...feedbackValues })
    .onConflictDoUpdate({ target: sessionFeedback.sessionId, set: feedbackValues })
    .run()

  db.delete(exerciseFeedback).where(eq(exerciseFeedback.sessionId, row.id)).run()
  if (body.exercises.length) {
    db.insert(exerciseFeedback)
      .values(
        body.exercises.map((e) => ({
          sessionId: row.id,
          blockIndex: e.blockIndex,
          exerciseIndex: e.exerciseIndex,
          exerciseName: e.exerciseName,
          difficulty: e.difficulty,
          comment: e.comment,
        })),
      )
      .run()
  }

  db.update(sessions)
    .set({
      status: body.completed ? 'completed' : row.status,
      completedAt: body.completed ? now : row.completedAt,
      actualDurationSec: body.actualDurationSec ?? row.actualDurationSec,
      updatedAt: now,
    })
    .where(eq(sessions.date, date))
    .run()

  return { ok: true }
})
