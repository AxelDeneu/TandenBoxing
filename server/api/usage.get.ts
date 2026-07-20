/** GET /api/usage — agrégats de consommation IA (tokens, coût estimé) pour la vue « conso ». */
export default defineEventHandler(() => {
  return getUsageStats()
})
