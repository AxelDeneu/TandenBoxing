import { buildSkillExposures } from '../../shared/skill-history'
import { buildSkillProgression, type SkillProgressionSnapshot } from '../../shared/skill-mastery'

/**
 * Adaptateur de lecture uniquement entre le stockage actuel et le moteur pur de maîtrise.
 * Aucun état dérivé n'est persisté : un changement de règle/curriculum reste rejouable.
 */
export function getSkillProgression(asOfDate: string): SkillProgressionSnapshot {
  const completed = listCompletedSessions().filter((session) => session.date <= asOfDate)
  const sessionIds = completed.map((session) => session.id)
  const exposures = buildSkillExposures(
    completed,
    listSessionFeedbackByIds(sessionIds),
    listExerciseFeedbackByIds(sessionIds),
  )
  return buildSkillProgression(asOfDate, exposures)
}
