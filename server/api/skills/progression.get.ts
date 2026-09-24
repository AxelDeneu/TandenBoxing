import { presentSkillProgression } from '../../../shared/skill-progression-api'

/** GET /api/skills/progression?date=YYYY-MM-DD — état calculé du curriculum débutant. */
export default defineEventHandler((event) => {
  const raw = getQuery(event).date
  const date =
    typeof raw === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw)
      ? raw
      : todayIso(getSettings().timezone)

  return presentSkillProgression(getSkillProgression(date))
})
