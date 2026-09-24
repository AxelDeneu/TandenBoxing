import {
  BEGINNER_CURRICULUM,
  getCurriculumSkill,
  type CurriculumSkill,
  type SkillId,
} from './curriculum'
import { MASTERY_RULES, type MasteryState, type SkillProgressionSnapshot } from './skill-mastery'

export const SKILL_DISPLAY_STATES = ['acquired', 'consolidating', 'eligible', 'blocked'] as const
export type SkillDisplayState = (typeof SKILL_DISPLAY_STATES)[number]

export interface SkillProgressionApiItem {
  id: SkillId
  label: string
  description: string
  order: number
  state: SkillDisplayState
  stateLabel: string
  masteryState: MasteryState
  exposures: number
  positiveExposures: number
  progress: {
    current: number
    required: number
    percent: number
    label: string
  }
  prerequisiteIds: SkillId[]
  missingPrerequisites: Array<{ id: SkillId; label: string }>
  reasons: string[]
  criteria: string
  targeting: {
    outcome: 'introduce' | 'consolidate' | 'adapt'
    explanation: string
  }
}

export interface SkillProgressionApiResponse {
  schemaVersion: 1
  curriculum: {
    id: string
    version: number
    expectedSkillCount: number
  }
  asOfDate: string
  criteria: {
    positiveExposuresRequired: number
    interruptionDays: number
    consecutiveChallengesForRegression: number
    explanation: string
  }
  summary: Record<SkillDisplayState, number>
  skills: SkillProgressionApiItem[]
  dataQuality: {
    complete: boolean
    warnings: string[]
  }
}

const STATE_LABELS: Record<SkillDisplayState, string> = {
  acquired: 'Acquise',
  consolidating: 'En consolidation',
  eligible: 'Prochaine compétence',
  blocked: 'Bloquée',
}

const REASON_LABELS: Record<string, string> = {
  aucune_exposition_completee: 'Pas encore travaillée dans une séance terminée.',
  feedbacks_positifs_insuffisants: 'Il manque encore des retours positifs pour la consolider.',
  difficulte_elevee_repetee: 'Les deux derniers retours signalent une difficulté élevée.',
  interruption_longue: 'Une reprise progressive est prévue après plus de 42 jours sans pratique.',
  signaux_positifs_suffisants: 'Les retours positifs et la récence valident cette compétence.',
  prerequis_non_acquis: 'Un ou plusieurs prérequis restent à acquérir.',
}

function displayState(snapshot: SkillProgressionSnapshot, skillId: SkillId): SkillDisplayState {
  const mastery = snapshot.mastery[skillId]
  if (mastery.state === 'acquis') return 'acquired'
  if (snapshot.blockedSkills.some((skill) => skill.skillId === skillId)) return 'blocked'
  if (mastery.state === 'en_consolidation') return 'consolidating'
  if (snapshot.eligibleNewSkillIds.includes(skillId)) return 'eligible'
  return 'blocked'
}

function progressLabel(state: SkillDisplayState, current: number, required: number): string {
  if (state === 'acquired') return 'Critères de consolidation atteints'
  if (state === 'eligible') return 'Prête à être découverte en séance'
  if (state === 'blocked') return 'Prérequis à valider avant de l’introduire'
  return `${Math.min(current, required)} retour${current === 1 ? '' : 's'} positif${
    current === 1 ? '' : 's'
  } sur ${required}`
}

function criteriaFor(
  skill: CurriculumSkill,
  state: SkillDisplayState,
  missingLabels: string[],
): string {
  if (state === 'blocked') {
    return missingLabels.length
      ? `À débloquer d’abord : ${missingLabels.join(', ')}.`
      : 'Le moteur ne dispose pas encore de tous les éléments pour confirmer son éligibilité.'
  }
  if (state === 'eligible') {
    return 'Tous les prérequis sont acquis : le planner peut l’introduire comme unique nouveauté.'
  }

  const prerequisiteText = skill.prerequisites.length ? ' avec tous ses prérequis acquis' : ''
  return `${MASTERY_RULES.positiveExposuresForMastery} retours positifs${prerequisiteText}, sans deux difficultés récentes consécutives et avec une pratique datant de moins de ${MASTERY_RULES.interruptionDays} jours.`
}

function targetingFor(
  skill: CurriculumSkill,
  state: SkillDisplayState,
  missingLabels: string[],
): SkillProgressionApiItem['targeting'] {
  if (state === 'eligible') {
    return {
      outcome: 'introduce',
      explanation: `${skill.label} peut être proposée comme nouveauté à la prochaine prescription.`,
    }
  }
  if (state === 'blocked') {
    return {
      outcome: 'adapt',
      explanation: missingLabels.length
        ? `La cible ne sera pas forcée : le planner privilégiera ${missingLabels.join(', ')} ou reportera l’introduction selon les contraintes de la séance.`
        : 'La cible ne sera pas forcée : le planner la reportera tant que son éligibilité ne sera pas confirmée.',
    }
  }
  return {
    outcome: 'consolidate',
    explanation: `${skill.label} peut être ciblée pour être ${
      state === 'acquired' ? 'entretenue' : 'consolidée'
    } sans être traitée comme une nouveauté.`,
  }
}

/**
 * Présente le résultat du moteur sous une forme directement consommable par l’interface.
 * Toute décision d’éligibilité reste ici, côté domaine/API ; le client ne fait que rendre l’état.
 */
export function presentSkillProgression(
  snapshot: SkillProgressionSnapshot,
): SkillProgressionApiResponse {
  const warnings: string[] = []
  const required = MASTERY_RULES.positiveExposuresForMastery
  const skills = BEGINNER_CURRICULUM.skills.flatMap((skill, order) => {
    const mastery = snapshot.mastery[skill.id]
    if (!mastery) {
      warnings.push(`Données de progression absentes pour ${skill.id}.`)
      return []
    }

    const state = displayState(snapshot, skill.id)
    const missingPrerequisiteIds = [
      ...new Set([
        ...mastery.missingPrerequisiteIds,
        ...(snapshot.blockedSkills.find((blocked) => blocked.skillId === skill.id)
          ?.missingPrerequisiteIds ?? []),
      ]),
    ]
    const missingPrerequisites = missingPrerequisiteIds.map((id) => ({
      id,
      label: getCurriculumSkill(id).label,
    }))
    const current = Math.min(mastery.positiveExposures, required)

    return [
      {
        id: skill.id,
        label: skill.label,
        description: skill.description,
        order,
        state,
        stateLabel: STATE_LABELS[state],
        masteryState: mastery.state,
        exposures: mastery.exposures,
        positiveExposures: mastery.positiveExposures,
        progress: {
          current,
          required,
          percent: state === 'acquired' ? 100 : Math.round((current / required) * 100),
          label: progressLabel(state, current, required),
        },
        prerequisiteIds: [...skill.prerequisites],
        missingPrerequisites,
        reasons: mastery.reasons.map((reason) => REASON_LABELS[reason] ?? reason),
        criteria: criteriaFor(
          skill,
          state,
          missingPrerequisites.map((item) => item.label),
        ),
        targeting: targetingFor(
          skill,
          state,
          missingPrerequisites.map((item) => item.label),
        ),
      },
    ]
  })

  const summary = Object.fromEntries(
    SKILL_DISPLAY_STATES.map((state) => [
      state,
      skills.filter((skill) => skill.state === state).length,
    ]),
  ) as Record<SkillDisplayState, number>

  return {
    schemaVersion: 1,
    curriculum: {
      id: snapshot.curriculumId,
      version: snapshot.curriculumVersion,
      expectedSkillCount: BEGINNER_CURRICULUM.skills.length,
    },
    asOfDate: snapshot.asOfDate,
    criteria: {
      positiveExposuresRequired: required,
      interruptionDays: MASTERY_RULES.interruptionDays,
      consecutiveChallengesForRegression: MASTERY_RULES.consecutiveChallengesForRegression,
      explanation: `Une compétence devient acquise après ${required} retours positifs, si ses prérequis sont acquis, sans deux difficultés récentes consécutives et sans interruption de plus de ${MASTERY_RULES.interruptionDays} jours.`,
    },
    summary,
    skills,
    dataQuality: {
      complete: warnings.length === 0 && skills.length === BEGINNER_CURRICULUM.skills.length,
      warnings,
    },
  }
}
