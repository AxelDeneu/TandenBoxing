/**
 * GET /api/sessions/recommendations?date=YYYY-MM-DD
 * 3 à 4 couples (catégorie, focus) conseillés pour la date (défaut : aujourd'hui).
 * Ne renvoie jamais d'erreur : repli heuristique si l'IA est indisponible.
 */
export default defineEventHandler(async (event) => {
  const raw = getQuery(event).date
  const date =
    typeof raw === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw)
      ? raw
      : todayIso(getSettings().timezone)

  return getRecommendations(date)
})
