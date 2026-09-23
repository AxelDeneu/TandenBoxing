import { inSessionAdaptationSchema } from '../../../../shared/session-autoregulation'

/** POST /api/sessions/:date/adapt — adapte uniquement la partie restant après le curseur. */
export default defineEventHandler(async (event) => {
  const date = getRouterParam(event, 'date')!
  const parsed = inSessionAdaptationSchema.safeParse(await readBody(event))
  if (!parsed.success) {
    throw createError({ statusCode: 400, statusMessage: "Demande d'adaptation invalide." })
  }
  return adaptSessionDuringWorkout(date, parsed.data)
})
