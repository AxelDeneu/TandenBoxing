/** GET /api/health — sonde de disponibilité (healthcheck Docker/Dokploy). */
export default defineEventHandler(() => {
  return { status: 'ok', time: new Date().toISOString() }
})
