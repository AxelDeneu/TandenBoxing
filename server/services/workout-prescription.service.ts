import {
  planWorkoutPrescription,
  type VarietyAwareWorkoutPrescription,
  type WorkoutPrescriptionRequest,
} from '../../shared/workout-prescription'
import { sessionCategory, workoutFocus } from '../../shared/session-schema'
import {
  applySkillGuidanceToPrescription,
  buildSkillGuidanceForFocus,
  buildSkillPrescriptionGuidance,
  type SkillProgressionSnapshot,
} from '../../shared/skill-mastery'
import { getCurriculumSkill, isSkillId, type SkillId } from '../../shared/curriculum'
import {
  buildVarietyMemory,
  buildWorkoutVarietyConstraints,
  type ConsolidationIntent,
} from '../../shared/session-variety'

type PrescriptionOverrides = Omit<WorkoutPrescriptionRequest, 'category' | 'focus'> & {
  category?: string | null
  focus?: string | null
  requestedSkillId?: SkillId | null
}

/**
 * Adapte les données persistées au planner pur. Cette frontière garde le contrat indépendant
 * de la base et du fournisseur IA, et permet à tous les chemins de génération de le partager.
 */
export function buildWorkoutPrescription(
  date: string,
  overrides: PrescriptionOverrides = {},
  progression: SkillProgressionSnapshot = getSkillProgression(date),
): VarietyAwareWorkoutPrescription {
  const settingsRow = getSettings()
  const profileRow = getProfile()
  const sessionPlan = getPlan(date)
  // Une génération passée ne doit jamais apprendre d'une séance située dans son futur.
  const completed = listCompletedSessions().filter((session) => session.date < date)
  const feedbackBySessionId = new Map(
    listSessionFeedbackByIds(completed.map((session) => session.id)).map((feedback) => [
      feedback.sessionId,
      feedback,
    ]),
  )

  const skipped = listRecentSessions(30)
    .filter((session) => session.status === 'skipped' && session.date < date)
    .slice(0, 5)
  const skippedFeedbackBySessionId = new Map(
    listSessionFeedbackByIds(skipped.map((session) => session.id)).map((feedback) => [
      feedback.sessionId,
      feedback,
    ]),
  )

  const rawCategory = overrides.category !== undefined ? overrides.category : sessionPlan?.category
  const rawRequestedSkillId =
    overrides.requestedSkillId !== undefined
      ? overrides.requestedSkillId
      : sessionPlan?.requestedSkillId
  const requestedSkillId = isSkillId(rawRequestedSkillId) ? rawRequestedSkillId : null
  const preliminaryGuidance = requestedSkillId
    ? buildSkillPrescriptionGuidance(progression, { requestedSkillId })
    : null
  const focusSkillId =
    preliminaryGuidance?.newSkillId ??
    preliminaryGuidance?.consolidatedSkillIds[0] ??
    requestedSkillId
  const targetFocus = focusSkillId
    ? getCurriculumSkill(focusSkillId).focuses.find(
        (focus) => workoutFocus.safeParse(focus).success,
      )
    : null
  const rawFocus =
    overrides.focus !== undefined ? overrides.focus : (sessionPlan?.focus ?? targetFocus)
  const parsedCategory = sessionCategory.safeParse(rawCategory)
  const parsedFocus = workoutFocus.safeParse(rawFocus)
  const recentAdaptations = listSessionAdaptationsBefore(date).map((adaptation) => ({
    date: adaptation.sessionDate,
    cause: adaptation.cause,
  }))

  const prescription = planWorkoutPrescription({
    today: date,
    targetDurationMin: settingsRow.targetDurationMin,
    constraints: profileRow.constraints,
    recentAdaptations,
    history: completed.map((session) => {
      const feedback = feedbackBySessionId.get(session.id)
      return {
        date: session.date,
        category: session.category,
        focus: session.focus,
        completed: true,
        difficulty: feedback?.overallDifficulty ?? null,
        energy: feedback?.energyLevel ?? null,
      }
    }),
    skipped: skipped.map((session) => ({
      date: session.date,
      reason: skippedFeedbackBySessionId.get(session.id)?.comment ?? null,
    })),
    request: {
      category: parsedCategory.success ? parsedCategory.data : null,
      focus: parsedFocus.success ? parsedFocus.data : null,
      customFocus:
        overrides.customFocus !== undefined ? overrides.customFocus : sessionPlan?.customFocus,
      durationMin:
        overrides.durationMin !== undefined ? overrides.durationMin : sessionPlan?.durationMin,
      note: overrides.note !== undefined ? overrides.note : sessionPlan?.note,
    },
  })

  const skillAwarePrescription = applySkillGuidanceToPrescription(
    prescription,
    buildSkillGuidanceForFocus(progression, prescription.focus, { requestedSkillId }),
    progression.curriculumVersion,
  )
  const varietyMemory = buildVarietyMemory(
    completed.map((session) => ({ date: session.date, structure: session.structure })),
  )
  const exercisePreferences = getExercisePreferenceConstraints(date)
  const consolidation: ConsolidationIntent | undefined =
    prescription.category === 'renforcement'
      ? {
          intentional: true,
          reason: `La prescription de renforcement consolide intentionnellement le focus ${prescription.focus}.`,
        }
      : undefined

  return {
    ...skillAwarePrescription,
    variety: buildWorkoutVarietyConstraints(varietyMemory, consolidation),
    exercisePreferences,
  }
}
