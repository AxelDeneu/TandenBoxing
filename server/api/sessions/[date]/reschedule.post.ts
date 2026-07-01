import { z } from 'zod'

const schema = z.object({
  newDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
})

/** POST /api/sessions/:date/reschedule — reporte la séance à une autre date. */
export default defineEventHandler(async (event) => {
  const date = getRouterParam(event, 'date')!
  const parsed = schema.safeParse(await readBody(event))
  if (!parsed.success) {
    throw createError({ statusCode: 400, statusMessage: 'Date invalide.' })
  }
  return rescheduleSession(date, parsed.data.newDate)
})
