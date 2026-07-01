/** POST /api/sessions/:date/start — marque la séance comme démarrée. */
export default defineEventHandler((event) => {
  const date = getRouterParam(event, 'date')!
  return startSession(date)
})
