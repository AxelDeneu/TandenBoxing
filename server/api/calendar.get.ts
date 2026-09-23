const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/
const MAX_DAYS = 366

/**
 * GET /api/calendar?from=YYYY-MM-DD&to=YYYY-MM-DD
 * Une case par jour de la plage (bornes incluses) : jour d'entraînement ou non,
 * résumé de la séance et/ou intention planifiée. Réponse : CalendarDay[] (app/utils/session.ts).
 */
export default defineEventHandler((event) => {
  const query = getQuery(event)
  const from = typeof query.from === 'string' ? query.from : ''
  const to = typeof query.to === 'string' ? query.to : ''

  if (!ISO_DATE.test(from) || !ISO_DATE.test(to) || from > to) {
    throw createError({ statusCode: 400, statusMessage: 'Plage de dates invalide.' })
  }
  if (daysBetween(from, to) > MAX_DAYS) {
    throw createError({
      statusCode: 400,
      statusMessage: `Plage de dates trop large (${MAX_DAYS} jours maximum).`,
    })
  }

  const settingsRow = getSettings()

  // Chargement en batch : deux requêtes pour toute la plage, pas une par jour.
  const sessionsByDate = new Map(
    listSessionsSince(from)
      .filter((row) => row.date <= to)
      .map((row) => [row.date, row]),
  )
  const plansByDate = new Map(listPlansBetween(from, to).map((plan) => [plan.date, plan]))

  const days = []
  for (let date = from; date <= to; date = addDays(date, 1)) {
    const session = sessionsByDate.get(date)
    const plan = plansByDate.get(date)

    days.push({
      date,
      isTrainingDay: settingsRow.trainingDays.includes(isoWeekday(date)),
      session: session
        ? {
            date: session.date,
            status: session.status,
            title: session.title,
            category: session.category,
            focus: session.focus,
            estimatedDurationMin: session.estimatedDurationMin,
            completedAt: session.completedAt?.getTime() ?? null,
          }
        : null,
      plan: plan
        ? {
            date: plan.date,
            category: plan.category,
            focus: plan.focus,
            requestedSkillId: plan.requestedSkillId,
            customFocus: plan.customFocus,
            durationMin: plan.durationMin,
            note: plan.note,
          }
        : null,
    })
  }

  return days
})
