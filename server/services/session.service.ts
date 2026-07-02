import { estimateSessionSeconds, type WorkoutSession } from '../../shared/session-schema'
import type { NewExerciseFeedback, Session } from '../database/schema'

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

/** Reporte une séance à une autre date (refuse si une séance existe déjà à la cible). */
export function rescheduleSession(date: string, newDate: string): Session {
  const row = loadSessionOrThrow(date)
  if (newDate === date) return row
  if (findSessionByDate(newDate)) {
    throw createError({
      statusCode: 409,
      statusMessage: 'Une séance existe déjà à cette date.',
    })
  }
  return updateSessionByDate(date, { date: newDate })
}

/** Supprime définitivement une séance (et son feedback, en cascade). */
export function deleteSession(date: string): void {
  loadSessionOrThrow(date)
  deleteSessionByDate(date)
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

  return updateSessionByDate(date, {
    status: payload.completed ? 'completed' : row.status,
    completedAt: payload.completed ? new Date() : row.completedAt,
    actualDurationSec: payload.actualDurationSec ?? row.actualDurationSec,
  })
}
