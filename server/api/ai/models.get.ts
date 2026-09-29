/** GET /api/ai/models — DTO filtré ; ni la clé ni la réponse OpenRouter brute ne sortent du serveur. */
export default defineEventHandler(async () => {
  try {
    return await getOpenRouterModelCatalog()
  } catch (error) {
    const classified = classifyOpenRouterError(error)
    console.error('[openrouter-catalog] Chargement impossible :', classified.code)
    throw createError({
      statusCode: classified.statusCode === 401 || classified.statusCode === 403 ? 503 : 502,
      statusMessage:
        'Le catalogue OpenRouter est temporairement indisponible. Le modèle enregistré est conservé.',
    })
  }
})
