import { z } from 'zod'

const schema = z
  .object({
    actualDurationSec: z.number().int().min(0).max(36_000),
    skippedBlockCount: z.number().int().min(0).max(100),
  })
  .strict()

/** POST /api/sessions/:date/finish — clôture idempotente, indépendante du feedback. */
export default defineEventHandler(async (event) => {
  const date = getRouterParam(event, 'date')!
  const parsed = schema.safeParse(await readBody(event))
  if (!parsed.success) {
    throw createError({ statusCode: 400, statusMessage: 'Clôture de séance invalide.' })
  }
  return finishSession(date, parsed.data)
})
