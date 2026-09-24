/** POST /api/generation-jobs/:id/retry — relance explicite d'un job définitivement échoué. */
export default defineEventHandler((event) => {
  const id = Number(getRouterParam(event, 'id'))
  if (!Number.isInteger(id) || id <= 0) {
    throw createError({ statusCode: 400, statusMessage: 'Job de génération invalide.' })
  }
  try {
    return { ok: true, job: toPublicGenerationJob(retryGenerationJob(id)) }
  } catch {
    throw createError({
      statusCode: 409,
      statusMessage: 'Ce job ne peut pas être relancé dans son état actuel.',
    })
  }
})
