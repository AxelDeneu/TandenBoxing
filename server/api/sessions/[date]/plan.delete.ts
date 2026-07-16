/** DELETE /api/sessions/:date/plan — annule l'intention planifiée (la séance générée, elle, reste). */
export default defineEventHandler((event) => {
  const date = getRouterParam(event, 'date')!
  deletePlan(date)
  return { ok: true }
})
