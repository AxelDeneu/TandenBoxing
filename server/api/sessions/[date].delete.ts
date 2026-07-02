/** DELETE /api/sessions/:date — supprime la séance (et son feedback). */
export default defineEventHandler((event) => {
  const date = getRouterParam(event, 'date')!
  deleteSession(date)
  return { ok: true }
})
