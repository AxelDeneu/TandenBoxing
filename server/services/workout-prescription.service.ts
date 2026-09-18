import {
  planWorkoutPrescription,
  type WorkoutPrescription,
  type WorkoutPrescriptionRequest,
} from '../../shared/workout-prescription'
import { sessionCategory, workoutFocus } from '../../shared/session-schema'

type PrescriptionOverrides = Omit<WorkoutPrescriptionRequest, 'category' | 'focus'> & {
  category?: string | null
  focus?: string | null
}

/**
 * Adapte les données persistées au planner pur. Cette frontière garde le contrat indépendant
 * de la base et du fournisseur IA, et permet à tous les chemins de génération de le partager.
 */
export function buildWorkoutPrescription(
  date: string,
  overrides: PrescriptionOverrides = {},
): WorkoutPrescription {
  const settingsRow = getSettings()
  const profileRow = getProfile()
  const plan = getPlan(date)
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

  const rawCategory = overrides.category !== undefined ? overrides.category : plan?.category
  const rawFocus = overrides.focus !== undefined ? overrides.focus : plan?.focus
  const parsedCategory = sessionCategory.safeParse(rawCategory)
  const parsedFocus = workoutFocus.safeParse(rawFocus)

  return planWorkoutPrescription({
    today: date,
    targetDurationMin: settingsRow.targetDurationMin,
    constraints: profileRow.constraints,
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
      customFocus: overrides.customFocus !== undefined ? overrides.customFocus : plan?.customFocus,
      durationMin: overrides.durationMin !== undefined ? overrides.durationMin : plan?.durationMin,
      note: overrides.note !== undefined ? overrides.note : plan?.note,
    },
  })
}
