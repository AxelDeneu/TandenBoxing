import { eq } from 'drizzle-orm'
import { z } from 'zod'

const schema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  weightKg: z.number().positive().max(400),
})

/** POST /api/weights — enregistre (ou met à jour) le poids d'une date. */
export default defineEventHandler(async (event) => {
  const parsed = schema.safeParse(await readBody(event))
  if (!parsed.success) {
    throw createError({ statusCode: 400, statusMessage: 'Poids invalide.' })
  }

  const db = useDatabase()
  ensureSingletons(db)
  const s = db.select().from(settings).where(eq(settings.id, 1)).get()!
  const date = parsed.data.date ?? todayIso(s.timezone)

  db.insert(weights)
    .values({ date, weightKg: parsed.data.weightKg })
    .onConflictDoUpdate({ target: weights.date, set: { weightKg: parsed.data.weightKg } })
    .run()

  return db.select().from(weights).where(eq(weights.date, date)).get()!
})
