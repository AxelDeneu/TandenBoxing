import { getCurriculumSkill, isSkillId, type SkillId } from '../../shared/curriculum'
import type { SessionPedagogicalIntent } from '../../shared/session-pedagogy'
import type { Session } from '../database/schema'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function uniqueSkillIds(values: unknown): SkillId[] {
  if (!Array.isArray(values)) return []
  return [...new Set(values.filter(isSkillId))]
}

function presentSkills(ids: readonly SkillId[]) {
  return ids.map((id) => ({ id, label: getCurriculumSkill(id).label }))
}

function targetExplanation(
  requested: SkillId,
  decision: 'automatic' | 'accepted' | 'adapted' | 'deferred',
  introduced: SkillId[],
  consolidated: SkillId[],
): string {
  const label = getCurriculumSkill(requested).label
  if (decision === 'accepted') {
    if (introduced.includes(requested)) {
      return `${label} est retenue comme nouveauté éligible de cette séance.`
    }
    return `${label} est retenue comme compétence à consolider, sans la traiter comme une nouveauté.`
  }
  if (decision === 'adapted') {
    const actual = [...introduced, ...consolidated]
      .filter((id) => id !== requested)
      .map((id) => getCurriculumSkill(id).label)
    return actual.length
      ? `${label} n’est pas forcée : la séance avance d’abord via ${actual.join(', ')}.`
      : `${label} n’est pas forcée : la séance renforce ses prérequis avant son introduction.`
  }
  if (decision === 'deferred') {
    return `${label} est reportée par le moteur selon le focus, la charge ou les contraintes de sécurité de cette séance.`
  }
  return `Le planner a choisi automatiquement l’étape pédagogique de cette séance.`
}

/** Extrait uniquement l'intention pédagogique sûre du contexte persisté avec la séance. */
export function buildSessionPedagogicalIntent(
  session: Pick<Session, 'structure' | 'generationContext'>,
): SessionPedagogicalIntent {
  const workedIds = uniqueSkillIds(
    session.structure.blocks.flatMap((block) =>
      block.exercises.flatMap((exercise) => exercise.skillIds ?? []),
    ),
  )
  const context = isRecord(session.generationContext) ? session.generationContext : null
  const prescription = context && isRecord(context.prescription) ? context.prescription : null
  const selection =
    prescription && isRecord(prescription.skillSelection) ? prescription.skillSelection : null

  const introducedIds = uniqueSkillIds(selection?.newSkillId ? [selection.newSkillId] : [])
  const consolidatedIds = uniqueSkillIds(selection?.consolidatedSkillIds)
  const missingPrerequisiteIds = uniqueSkillIds(selection?.missingPrerequisiteIds)
  const requestedSkillId = isSkillId(selection?.requestedSkillId)
    ? selection.requestedSkillId
    : null
  const rawDecision = selection?.targetDecision
  const targetDecision = ['automatic', 'accepted', 'adapted', 'deferred'].includes(
    String(rawDecision),
  )
    ? (rawDecision as 'automatic' | 'accepted' | 'adapted' | 'deferred')
    : requestedSkillId
      ? 'accepted'
      : 'automatic'
  const facts = Array.isArray(selection?.coachNoteFacts)
    ? selection.coachNoteFacts.filter((fact): fact is string => typeof fact === 'string')
    : []

  const target = requestedSkillId
    ? {
        skill: presentSkills([requestedSkillId])[0]!,
        decision: targetDecision,
        explanation: targetExplanation(
          requestedSkillId,
          targetDecision,
          introducedIds,
          consolidatedIds,
        ),
      }
    : null
  const summary =
    target?.explanation ??
    (introducedIds.length
      ? `Effet attendu : découvrir ${presentSkills(introducedIds)
          .map((skill) => skill.label)
          .join(', ')} tout en consolidant les bases prescrites.`
      : consolidatedIds.length
        ? `Effet attendu : consolider ${presentSkills(consolidatedIds)
            .map((skill) => skill.label)
            .join(', ')}.`
        : workedIds.length
          ? `Cette séance travaille ${presentSkills(workedIds)
              .map((skill) => skill.label)
              .join(', ')} ; son effet précis n’est pas disponible pour cette ancienne génération.`
          : 'Aucune compétence technique structurée n’est disponible pour cette séance.')

  return {
    worked: presentSkills(workedIds),
    consolidated: presentSkills(consolidatedIds),
    introduced: presentSkills(introducedIds),
    missingPrerequisites: presentSkills(missingPrerequisiteIds),
    target,
    facts,
    summary,
    partial: !selection,
  }
}
