import {
  estimateSessionSeconds,
  type SessionCategory,
  type WorkoutFocus,
  type WorkoutSession,
} from '../../shared/session-schema'
import type { NewExerciseFeedback, Session, SessionPlan } from '../database/schema'

function loadSessionOrThrow(date: string): Session {
  const row = findSessionByDate(date)
  if (!row) throw createError({ statusCode: 404, statusMessage: 'Séance introuvable.' })
  return row
}

/** Réécrit la structure d'une séance et recalcule sa durée estimée. */
function persistStructure(date: string, structure: WorkoutSession): Session {
  const estimatedDurationMin = Math.max(1, Math.round(estimateSessionSeconds(structure) / 60))
  return updateSessionByDate(date, { structure, estimatedDurationMin })
}

/** Marque la séance comme démarrée. */
export function startSession(date: string): Session {
  const row = loadSessionOrThrow(date)
  if (row.status === 'completed') return row
  return updateSessionByDate(date, {
    status: 'in_progress',
    startedAt: row.startedAt ?? new Date(),
  })
}

export interface PlanPayload {
  category: SessionCategory
  focus?: WorkoutFocus | null
  note?: string | null
  /** Génère la séance complète immédiatement au lieu d'attendre le jour J. */
  generateNow?: boolean
}

/**
 * Planifie l'intention d'une date (catégorie + focus optionnel). La séance complète est
 * générée le jour J par le cron, ou tout de suite si `generateNow`.
 */
export function planSession(
  date: string,
  payload: PlanPayload,
): { plan: SessionPlan; generating: boolean } {
  const plan = upsertPlan({
    date,
    category: payload.category,
    focus: payload.focus ?? null,
    note: payload.note ?? null,
  })
  // Planification explicite : la date redevient éligible à la génération automatique.
  undismissDate(date)
  if (payload.generateNow) triggerGeneration(date, { regenerate: true })
  return { plan, generating: isGenerating(date) }
}

/**
 * Reporte une séance à une autre date — ou, à défaut de séance générée, la simple
 * intention planifiée. Refuse si la date cible est déjà occupée.
 */
export function rescheduleSession(
  date: string,
  newDate: string,
): { session: Session | null; plan: SessionPlan | null } {
  const row = findSessionByDate(date)
  const plan = getPlan(date)
  if (!row && !plan) {
    throw createError({ statusCode: 404, statusMessage: 'Séance introuvable.' })
  }
  if (newDate === date) return { session: row ?? null, plan: plan ?? null }

  if (findSessionByDate(newDate)) {
    throw createError({
      statusCode: 409,
      statusMessage: 'Une séance existe déjà à cette date.',
    })
  }
  const planCible = getPlan(newDate)
  if (!row && planCible) {
    throw createError({
      statusCode: 409,
      statusMessage: 'Une séance est déjà planifiée à cette date.',
    })
  }

  // La date d'origine reste volontairement vide : pas de régénération automatique.
  dismissDate(date)
  undismissDate(newDate)

  // L'intention suit la séance ; si la cible a déjà la sienne, c'est elle qui fait foi.
  let planFinal: SessionPlan | null = planCible ?? null
  if (plan) {
    deletePlan(date)
    if (!planCible) {
      planFinal = upsertPlan({
        date: newDate,
        category: plan.category,
        focus: plan.focus,
        note: plan.note,
      })
    }
  }

  return { session: row ? updateSessionByDate(date, { date: newDate }) : null, plan: planFinal }
}

/** Supprime définitivement une séance (et son feedback, en cascade) ainsi que son intention. */
export function deleteSession(date: string): void {
  loadSessionOrThrow(date)
  deleteSessionByDate(date)
  // L'intention planifiée disparaît avec la séance : rien ne doit rester à cette date.
  deletePlan(date)
  // Suppression volontaire : la génération auto ne doit pas recréer la séance.
  dismissDate(date)
}

/** Retire un exercice (ou son bloc s'il devient vide). */
export function removeExerciseFromSession(
  date: string,
  blockIndex: number,
  exerciseIndex: number,
): Session {
  const row = loadSessionOrThrow(date)
  const structure = structuredClone(row.structure)
  const block = structure.blocks[blockIndex]
  if (!block || !block.exercises[exerciseIndex]) {
    throw createError({ statusCode: 400, statusMessage: 'Exercice introuvable.' })
  }
  if (block.exercises.length > 1) {
    block.exercises.splice(exerciseIndex, 1)
  } else if (structure.blocks.length > 1) {
    structure.blocks.splice(blockIndex, 1)
  } else {
    throw createError({
      statusCode: 400,
      statusMessage: 'Impossible de retirer le dernier exercice de la séance.',
    })
  }
  return persistStructure(date, structure)
}

/** Remplace un exercice par une alternative générée par l'IA. */
export async function replaceExerciseInSession(
  date: string,
  blockIndex: number,
  exerciseIndex: number,
  reason?: string,
): Promise<Session> {
  const row = loadSessionOrThrow(date)
  const structure = structuredClone(row.structure)
  const block = structure.blocks[blockIndex]
  const current = block?.exercises[exerciseIndex]
  if (!block || !current) {
    throw createError({ statusCode: 400, statusMessage: 'Exercice introuvable.' })
  }
  block.exercises[exerciseIndex] = await generateReplacementExercise(
    structure,
    blockIndex,
    exerciseIndex,
    reason,
    row.aiModel,
  )
  return persistStructure(date, structure)
}

export interface FeedbackPayload {
  completed: boolean
  overallDifficulty: number | null
  energyLevel: number | null
  soreness: string[]
  enjoyment: number | null
  comment: string | null
  actualDurationSec: number | null
  exercises: {
    blockIndex: number
    exerciseIndex: number
    exerciseName: string
    difficulty: number | null
    comment: string | null
  }[]
}

/**
 * Marque une séance comme sautée (non faite). La raison est stockée comme feedback global
 * (completed=false), ce qui la fait remonter au contexte IA pour adapter les séances suivantes.
 */
export function skipSession(date: string, reason: string | null): Session {
  const row = loadSessionOrThrow(date)

  upsertSessionFeedback(row.id, {
    completed: false,
    overallDifficulty: null,
    energyLevel: null,
    soreness: [],
    enjoyment: null,
    comment: reason,
    actualDurationSec: null,
  })

  // Le statut change : les recommandations en cache sont périmées.
  clearRecommendationCache()

  return updateSessionByDate(date, {
    status: 'skipped',
    startedAt: null,
    completedAt: null,
    actualDurationSec: null,
  })
}

/** Enregistre le feedback d'une séance et la clôt. */
export function submitFeedback(date: string, payload: FeedbackPayload): Session {
  const row = loadSessionOrThrow(date)

  upsertSessionFeedback(row.id, {
    completed: payload.completed,
    overallDifficulty: payload.overallDifficulty,
    energyLevel: payload.energyLevel,
    soreness: payload.soreness,
    enjoyment: payload.enjoyment,
    comment: payload.comment,
    actualDurationSec: payload.actualDurationSec,
  })

  const feedbackRows: NewExerciseFeedback[] = payload.exercises.map((e) => ({
    sessionId: row.id,
    blockIndex: e.blockIndex,
    exerciseIndex: e.exerciseIndex,
    exerciseName: e.exerciseName,
    difficulty: e.difficulty,
    comment: e.comment,
  }))
  replaceExerciseFeedback(row.id, feedbackRows)

  // L'historique vient de changer : les recommandations en cache sont périmées.
  if (payload.completed) clearRecommendationCache()

  return updateSessionByDate(date, {
    status: payload.completed ? 'completed' : row.status,
    completedAt: payload.completed ? new Date() : row.completedAt,
    actualDurationSec: payload.actualDurationSec ?? row.actualDurationSec,
  })
}
