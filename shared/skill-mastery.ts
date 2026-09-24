import {
  getCurriculumSkill,
  BEGINNER_CURRICULUM,
  skillIdsForFocus,
  type SkillId,
} from './curriculum'
import { daysBetween } from './dates'

export const MASTERY_STATES = ['nouveau', 'en_consolidation', 'acquis'] as const
export type MasteryState = (typeof MASTERY_STATES)[number]

export const MASTERY_RULES = {
  positiveExposuresForMastery: 3,
  challengingDifficulty: 4,
  lowEnergy: 2,
  consecutiveChallengesForRegression: 2,
  interruptionDays: 42,
} as const

export type SkillEvidenceSource = 'declared' | 'inferred_combo' | 'inferred_text' | 'inferred_focus'
export type ExposureQuality = 'positive' | 'neutral' | 'challenging'

export interface SkillExposure {
  sessionKey: string | number
  date: string
  skillId: SkillId
  completed: boolean
  difficulty: number | null
  energy: number | null
  source: SkillEvidenceSource
}

export interface SkillMastery {
  skillId: SkillId
  state: MasteryState
  exposures: number
  positiveExposures: number
  challengingExposures: number
  neutralExposures: number
  lastExposedAt: string | null
  daysSinceLastExposure: number | null
  missingPrerequisiteIds: SkillId[]
  reasons: string[]
}

export interface BlockedSkill {
  skillId: SkillId
  missingPrerequisiteIds: SkillId[]
}

export interface SkillProgressionSnapshot {
  curriculumId: typeof BEGINNER_CURRICULUM.id
  curriculumVersion: number
  asOfDate: string
  mastery: Record<SkillId, SkillMastery>
  reviewSkillIds: SkillId[]
  eligibleNewSkillIds: SkillId[]
  blockedSkills: BlockedSkill[]
}

export interface SkillPrescriptionRequest {
  /** Une demande explicite peut viser une compétence encore bloquée. */
  requestedSkillId?: SkillId | null
  /** Limite les choix automatiques au focus déjà décidé par le planner. */
  candidateSkillIds?: readonly SkillId[]
  maxConsolidatedSkills?: number
}

export interface SkillPrescriptionGuidance {
  mode: 'automatic' | 'explicit' | 'explicit_adapted'
  requestedSkillId: SkillId | null
  targetDecision: 'automatic' | 'accepted' | 'adapted' | 'deferred'
  /** Au plus une nouveauté, garantie par le type scalaire. */
  newSkillId: SkillId | null
  consolidatedSkillIds: SkillId[]
  missingPrerequisiteIds: SkillId[]
  intensityCap: number | null
  pedagogy: 'standard' | 'decomposition_fondamentaux'
  /** Faits calculés que le planner peut injecter dans coachNote. */
  coachNoteFacts: string[]
}

interface PlannerPrescriptionContract {
  intensity: number
  maxNewTechniques: number
}

export interface PrescriptionSkillSelection {
  curriculumVersion: number
  requestedSkillId: SkillId | null
  targetDecision: SkillPrescriptionGuidance['targetDecision']
  newSkillId: SkillId | null
  consolidatedSkillIds: SkillId[]
  missingPrerequisiteIds: SkillId[]
  pedagogy: SkillPrescriptionGuidance['pedagogy']
  coachNoteFacts: string[]
}

export type SkillAwarePrescription<T extends PlannerPrescriptionContract> = T & {
  skillSelection: PrescriptionSkillSelection
}

export function classifyExposure(exposure: SkillExposure): ExposureQuality {
  if (
    (exposure.difficulty != null && exposure.difficulty >= MASTERY_RULES.challengingDifficulty) ||
    (exposure.energy != null && exposure.energy <= MASTERY_RULES.lowEnergy)
  ) {
    return 'challenging'
  }
  if (exposure.difficulty != null && exposure.difficulty < MASTERY_RULES.challengingDifficulty) {
    return 'positive'
  }
  return 'neutral'
}

function sourcePriority(source: SkillEvidenceSource): number {
  return ['inferred_focus', 'inferred_text', 'inferred_combo', 'declared'].indexOf(source)
}

/** Une séance ne vaut jamais plusieurs expositions pour une même compétence. */
function collapseExposures(exposures: SkillExposure[]): SkillExposure[] {
  const bySession = new Map<string, SkillExposure>()
  for (const exposure of exposures) {
    const key = `${String(exposure.sessionKey)}:${exposure.skillId}`
    const current = bySession.get(key)
    if (!current) {
      bySession.set(key, { ...exposure })
      continue
    }
    current.completed ||= exposure.completed
    if (exposure.difficulty != null) {
      current.difficulty = Math.max(current.difficulty ?? exposure.difficulty, exposure.difficulty)
    }
    if (exposure.energy != null) {
      current.energy = Math.min(current.energy ?? exposure.energy, exposure.energy)
    }
    if (sourcePriority(exposure.source) > sourcePriority(current.source)) {
      current.source = exposure.source
    }
  }
  return [...bySession.values()]
}

function rawMastery(asOfDate: string, skillId: SkillId, all: SkillExposure[]): SkillMastery {
  const exposures = collapseExposures(
    all.filter(
      (exposure) => exposure.skillId === skillId && exposure.completed && exposure.date <= asOfDate,
    ),
  ).sort((a, b) => a.date.localeCompare(b.date))

  if (!exposures.length) {
    return {
      skillId,
      state: 'nouveau',
      exposures: 0,
      positiveExposures: 0,
      challengingExposures: 0,
      neutralExposures: 0,
      lastExposedAt: null,
      daysSinceLastExposure: null,
      missingPrerequisiteIds: [],
      reasons: ['aucune_exposition_completee'],
    }
  }

  const qualities = exposures.map(classifyExposure)
  const positiveExposures = qualities.filter((quality) => quality === 'positive').length
  const challengingExposures = qualities.filter((quality) => quality === 'challenging').length
  const neutralExposures = qualities.filter((quality) => quality === 'neutral').length
  const lastExposedAt = exposures.at(-1)!.date
  const daysSinceLastExposure = daysBetween(lastExposedAt, asOfDate)
  const recentQualities = qualities.slice(-MASTERY_RULES.consecutiveChallengesForRegression)
  const repeatedChallenges =
    recentQualities.length === MASTERY_RULES.consecutiveChallengesForRegression &&
    recentQualities.every((quality) => quality === 'challenging')
  const interrupted = daysSinceLastExposure > MASTERY_RULES.interruptionDays
  const enoughPositive = positiveExposures >= MASTERY_RULES.positiveExposuresForMastery

  const reasons: string[] = []
  if (!enoughPositive) reasons.push('feedbacks_positifs_insuffisants')
  if (repeatedChallenges) reasons.push('difficulte_elevee_repetee')
  if (interrupted) reasons.push('interruption_longue')
  if (enoughPositive && !repeatedChallenges && !interrupted) {
    reasons.push('signaux_positifs_suffisants')
  }

  return {
    skillId,
    state: enoughPositive && !repeatedChallenges && !interrupted ? 'acquis' : 'en_consolidation',
    exposures: exposures.length,
    positiveExposures,
    challengingExposures,
    neutralExposures,
    lastExposedAt,
    daysSinceLastExposure,
    missingPrerequisiteIds: [],
    reasons,
  }
}

/**
 * Calcule tous les états à partir d'événements immuables. Aucun accès DB ni effet de bord :
 * le planner peut donc rejouer le calcul pour n'importe quelle date.
 */
export function buildSkillProgression(
  asOfDate: string,
  exposures: SkillExposure[],
): SkillProgressionSnapshot {
  const mastery = {} as Record<SkillId, SkillMastery>

  // Le curriculum est ordonné topologiquement ; la validation du graphe le couvre par test.
  for (const skill of BEGINNER_CURRICULUM.skills) {
    const result = rawMastery(asOfDate, skill.id, exposures)
    const missingPrerequisiteIds = skill.prerequisites.filter(
      (prerequisite) => mastery[prerequisite]?.state !== 'acquis',
    )
    result.missingPrerequisiteIds = [...missingPrerequisiteIds]
    if (result.state === 'acquis' && missingPrerequisiteIds.length) {
      result.state = 'en_consolidation'
      result.reasons = [...result.reasons, 'prerequis_non_acquis']
    }
    mastery[skill.id] = result
  }

  const eligibleNewSkillIds = BEGINNER_CURRICULUM.skills
    .filter(
      (skill) =>
        mastery[skill.id].state === 'nouveau' &&
        skill.prerequisites.every((prerequisite) => mastery[prerequisite].state === 'acquis'),
    )
    .map((skill) => skill.id)
  const reviewSkillIds = BEGINNER_CURRICULUM.skills
    .filter((skill) => mastery[skill.id].state === 'en_consolidation')
    .map((skill) => skill.id)
  const blockedSkills = BEGINNER_CURRICULUM.skills
    .map((skill) => ({
      skillId: skill.id,
      missingPrerequisiteIds: skill.prerequisites.filter(
        (prerequisite) => mastery[prerequisite].state !== 'acquis',
      ),
    }))
    .filter((skill) => skill.missingPrerequisiteIds.length > 0)

  return {
    curriculumId: BEGINNER_CURRICULUM.id,
    curriculumVersion: BEGINNER_CURRICULUM.version,
    asOfDate,
    mastery,
    reviewSkillIds,
    eligibleNewSkillIds,
    blockedSkills,
  }
}

/** Interface d'intégration de #4 pour le planner de #2 ; ne décide aucun budget de séance. */
export function buildSkillPrescriptionGuidance(
  progression: SkillProgressionSnapshot,
  request: SkillPrescriptionRequest = {},
): SkillPrescriptionGuidance {
  const requested = request.requestedSkillId ?? null
  const candidates = new Set(
    request.candidateSkillIds ?? BEGINNER_CURRICULUM.skills.map((s) => s.id),
  )
  const maxConsolidated = Math.max(0, request.maxConsolidatedSkills ?? 2)

  if (requested) {
    const mastery = progression.mastery[requested]
    const blocked = mastery.missingPrerequisiteIds.length > 0
    const requestedInFocus = candidates.has(requested)
    const eligible = progression.eligibleNewSkillIds.includes(requested)

    const prerequisiteClosure = new Set<SkillId>()
    const visitPrerequisites = (skillId: SkillId): void => {
      for (const prerequisite of getCurriculumSkill(skillId).prerequisites) {
        if (prerequisiteClosure.has(prerequisite)) continue
        prerequisiteClosure.add(prerequisite)
        visitPrerequisites(prerequisite)
      }
    }
    visitPrerequisites(requested)

    const eligiblePrerequisiteId = progression.eligibleNewSkillIds.find(
      (id) => prerequisiteClosure.has(id) && candidates.has(id),
    )
    const newSkillId = blocked
      ? (eligiblePrerequisiteId ?? null)
      : mastery.state === 'nouveau' && eligible && requestedInFocus
        ? requested
        : null
    const consolidatedSkillIds = (
      blocked
        ? progression.reviewSkillIds.filter(
            (id) => prerequisiteClosure.has(id) && candidates.has(id),
          )
        : mastery.state !== 'nouveau' && requestedInFocus
          ? [requested]
          : []
    ).slice(0, maxConsolidated)
    const targetDecision = blocked
      ? 'adapted'
      : !requestedInFocus || (mastery.state === 'nouveau' && !eligible)
        ? 'deferred'
        : 'accepted'
    const requestedLabel = getCurriculumSkill(requested).label
    const prerequisiteLabels = mastery.missingPrerequisiteIds.map(
      (id) => getCurriculumSkill(id).label,
    )
    return {
      mode: targetDecision === 'accepted' ? 'explicit' : 'explicit_adapted',
      requestedSkillId: requested,
      targetDecision,
      newSkillId,
      consolidatedSkillIds: [...new Set(consolidatedSkillIds)],
      missingPrerequisiteIds: mastery.missingPrerequisiteIds,
      intensityCap: blocked ? 2 : null,
      pedagogy: blocked ? 'decomposition_fondamentaux' : 'standard',
      coachNoteFacts: [
        `${requestedLabel} : ${mastery.state} (${mastery.exposures} exposition(s)).`,
        ...(blocked
          ? [
              `Cible non éligible, jamais forcée. Prérequis à renforcer : ${prerequisiteLabels.join(', ')}.`,
              ...(eligiblePrerequisiteId
                ? [
                    `Adaptation sûre : introduire d’abord ${getCurriculumSkill(eligiblePrerequisiteId).label}.`,
                  ]
                : []),
            ]
          : []),
        ...(!requestedInFocus && !blocked
          ? [`Cible reportée : elle ne correspond pas au focus prescrit pour cette séance.`]
          : []),
        ...(mastery.state === 'nouveau' && !eligible && !blocked
          ? [`Cible reportée : le moteur ne la considère pas encore éligible.`]
          : []),
      ],
    }
  }

  const newSkillId = progression.eligibleNewSkillIds.find((id) => candidates.has(id)) ?? null
  const consolidatedSkillIds = progression.reviewSkillIds
    .filter((id) => candidates.has(id))
    .slice(0, maxConsolidated)
  return {
    mode: 'automatic',
    requestedSkillId: null,
    targetDecision: 'automatic',
    newSkillId,
    consolidatedSkillIds,
    missingPrerequisiteIds: [],
    intensityCap: null,
    pedagogy: 'standard',
    coachNoteFacts: [
      ...(newSkillId ? [`Nouveauté éligible : ${getCurriculumSkill(newSkillId).label}.`] : []),
      ...consolidatedSkillIds.map((id) => {
        const state = progression.mastery[id]
        return `${getCurriculumSkill(id).label} à consolider après ${state.exposures} exposition(s).`
      }),
    ],
  }
}

/** Raccourci pour aligner la sélection de compétences sur le focus décidé par #2. */
export function buildSkillGuidanceForFocus(
  progression: SkillProgressionSnapshot,
  focus: string,
  request: Omit<SkillPrescriptionRequest, 'candidateSkillIds'> = {},
): SkillPrescriptionGuidance {
  return buildSkillPrescriptionGuidance(progression, {
    ...request,
    candidateSkillIds: skillIdsForFocus(focus),
  })
}

/**
 * Raccord générique avec `WorkoutPrescription` de #2, sans importer ni réimplémenter son planner.
 * Il borne seulement les deux décisions que la maîtrise est autorisée à restreindre.
 */
export function applySkillGuidanceToPrescription<T extends PlannerPrescriptionContract>(
  prescription: T,
  guidance: SkillPrescriptionGuidance,
  curriculumVersion: number = BEGINNER_CURRICULUM.version,
): SkillAwarePrescription<T> {
  const newSkillId = prescription.maxNewTechniques > 0 ? guidance.newSkillId : null
  const newSkillDeferred = Boolean(guidance.requestedSkillId && guidance.newSkillId && !newSkillId)
  const targetDecision = newSkillDeferred
    ? guidance.consolidatedSkillIds.length
      ? 'adapted'
      : 'deferred'
    : guidance.targetDecision
  const coachNoteFacts = [
    ...guidance.coachNoteFacts,
    ...(newSkillDeferred
      ? [
          `La nouveauté ciblée est reportée par les contraintes de charge ou de sécurité de cette prescription.`,
        ]
      : []),
  ]

  return {
    ...prescription,
    intensity:
      guidance.intensityCap == null
        ? prescription.intensity
        : Math.min(prescription.intensity, guidance.intensityCap),
    maxNewTechniques: newSkillId ? Math.min(prescription.maxNewTechniques, 1) : 0,
    skillSelection: {
      curriculumVersion,
      requestedSkillId: guidance.requestedSkillId,
      targetDecision,
      newSkillId,
      consolidatedSkillIds: guidance.consolidatedSkillIds,
      missingPrerequisiteIds: guidance.missingPrerequisiteIds,
      pedagogy: guidance.pedagogy,
      coachNoteFacts,
    },
  }
}
