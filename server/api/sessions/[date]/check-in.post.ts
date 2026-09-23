import { sessionCheckInSchema } from '../../../../shared/session-autoregulation'

/** POST /api/sessions/:date/check-in — check-in facultatif avant le démarrage. */
export default defineEventHandler(async (event) => {
  const date = getRouterParam(event, 'date')!
  const parsed = sessionCheckInSchema.safeParse(await readBody(event))
  if (!parsed.success) {
    throw createError({ statusCode: 400, statusMessage: 'Check-in invalide.' })
  }
  return applySessionCheckIn(date, parsed.data)
})
