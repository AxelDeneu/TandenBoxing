import {
  estimateSessionSeconds,
  type SessionCategory,
  type WorkoutFocus,
  type WorkoutSession,
} from '../../shared/session-schema'
import type { PreferenceAction, PreferenceReasonCode } from '../../shared/exercise-preferences'
import type { SkillId } from '../../shared/curriculum'
import {
  canRewriteGeneratedSession,
  resolveSessionTransition,
  type SessionStatus,
} from '../../shared/session-lifecycle'
import type { NewExerciseFeedback, Session, SessionPlan } from '../database/schema'
import { normalizeOpenRouterModelSlug } from '../../shared/openrouter-models'

function loadSessionOrThrow(date: string): Session {
  const row = findSessionByDate(date)
  if (!row) throw createError({ statusCode: 404, statusMessage: 'Séance introuvable.' })
  return row
}

function statusOf(row: Session): SessionStatus {
  return row.status as SessionStatus
}

function lifecycleConflict(statusMessage: string): never {
  throw createError({ statusCode: 409, statusMessage })
}

function assertRewritable(row: Session, statusMessage: string): void {
  if (!canRewriteGeneratedSession(row.status)) lifecycleConflict(statusMessage)
}

/** Réécrit la structure d'une séance et recalcule sa durée estimée. */
function persistStructure(date: string, structure: WorkoutSession): Session {
  const estimatedDurationMin = Math.max(1, Math.round(estimateSessionSeconds(structure) / 60))
  const updated = transitionSessionByDate(date, 'generated', { structure, estimatedDurationMin })
  if (!updated.changed || !updated.session) {
    lifecycleConflict('Une séance démarrée ou clôturée ne peut plus être modifiée.')
  }
  return updated.session
}

/** Marque la séance comme démarrée via un compare-and-set idempotent. */
export function startSession(date: string): Session {
  const row = loadSessionOrThrow(date)
  const outcome = resolveSessionTransition(statusOf(row), 'start')
  if (outcome.kind === 'idempotent') return row
  if (outcome.kind === 'rejected') {
    lifecycleConflict('Cette séance clôturée ne peut pas être démarrée.')
  }

  const transitioned = transitionSessionByDate(date, 'generated', {
    status: outcome.status,
    startedAt: new Date(),
  }).session
  if (!transitioned) throw createError({ statusCode: 404, statusMessage: 'Séance introuvable.' })

  const concurrentOutcome = resolveSessionTransition(statusOf(transitioned), 'start')
  if (concurrentOutcome.kind === 'rejected') {
    lifecycleConflict('Cette séance clôturée ne peut pas être démarrée.')
  }
  return transitioned
}

export interface FinishSessionPayload {
  actualDurationSec: number
  skippedBlockCount: number
}

/** Clôt la séance indépendamment du feedback ; la première clôture gagne. */
export function finishSession(date: string, payload: FinishSessionPayload): Session {
  const row = loadSessionOrThrow(date)
  const outcome = resolveSessionTransition(statusOf(row), 'finish')
  if (outcome.kind === 'idempotent') return row
  if (outcome.kind === 'rejected') {
    lifecycleConflict('Seule une séance démarrée peut être clôturée.')
  }

  const transitioned = transitionSessionByDate(date, 'in_progress', {
    status: outcome.status,
    completedAt: new Date(),
    actualDurationSec: payload.actualDurationSec,
    skippedBlockCount: payload.skippedBlockCount,
  })
  if (!transitioned.session) {
    throw createError({ statusCode: 404, statusMessage: 'Séance introuvable.' })
  }
  if (!transitioned.changed && transitioned.session.status !== 'completed') {
    lifecycleConflict('Cette séance ne peut plus être clôturée.')
  }
  if (transitioned.changed) {
    clearRecommendationCache()
    invalidatePreparedSessions()
  }
  return transitioned.session
}

export interface PlanPayload {
  /** Null = catégorie laissée au choix de l'IA. */
  category?: SessionCategory | null
  focus?: WorkoutFocus | null
  /** Suggestion uniquement : le moteur conserve l'autorité sur l'éligibilité et la sécurité. */
  requestedSkillId?: SkillId | null
  /** Thème libre d'une séance sur mesure (ex : « pectoraux ») ; prime sur `focus`. */
  customFocus?: string | null
  /** Durée voulue pour cette séance (minutes) ; null = durée cible des réglages. */
  durationMin?: number | null
  note?: string | null
  /** Génère la séance complète immédiatement au lieu d'attendre le jour J. */
  generateNow?: boolean
}

/**
 * Planifie l'intention d'une date (catégorie, focus, durée… tous optionnels). La séance
 * complète est générée le jour J par le cron, ou tout de suite si `generateNow`.
 */
export function planSession(
  date: string,
  payload: PlanPayload,
): { plan: SessionPlan; generating: boolean } {
  const existing = findSessionByDate(date)
  if (payload.generateNow && existing && !canRewriteGeneratedSession(existing.status)) {
    lifecycleConflict('Une séance démarrée ou clôturée ne peut pas être régénérée.')
  }
  const plan = upsertPlan({
    date,
    category: payload.category ?? null,
    focus: payload.focus ?? null,
    requestedSkillId: payload.requestedSkillId ?? null,
    customFocus: payload.customFocus ?? null,
    durationMin: payload.durationMin ?? null,
    note: payload.note ?? null,
  })
  // Planification explicite : la date redevient éligible à la génération automatique.
  undismissDate(date)
  invalidatePreparedSessions()
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
  if (row && !canRewriteGeneratedSession(row.status)) {
    lifecycleConflict('Une séance démarrée ou clôturée ne peut pas être reportée.')
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

  const movedSession = row
    ? transitionSessionByDate(date, 'generated', {
        date: newDate,
        generationSource: 'model',
        generationContextHash: null,
      })
    : null
  if (movedSession && (!movedSession.changed || !movedSession.session)) {
    lifecycleConflict('Cette séance a démarré entre-temps et ne peut plus être reportée.')
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
        requestedSkillId: plan.requestedSkillId,
        customFocus: plan.customFocus,
        durationMin: plan.durationMin,
        note: plan.note,
      })
    }
  }

  const result = {
    session: movedSession?.session ?? null,
    plan: planFinal,
  }
  invalidatePreparedSessions()
  return result
}

/** Supprime définitivement une séance (et son feedback, en cascade) ainsi que son intention. */
export function deleteSession(date: string): void {
  loadSessionOrThrow(date)
  deleteSessionByDate(date)
  // L'intention planifiée disparaît avec la séance : rien ne doit rester à cette date.
  deletePlan(date)
  // Suppression volontaire : la génération auto ne doit pas recréer la séance.
  dismissDate(date)
  invalidatePreparedSessions()
}

/** Retire un exercice (ou son bloc s'il devient vide). */
export function removeExerciseFromSession(
  date: string,
  blockIndex: number,
  exerciseIndex: number,
  reasonCode?: PreferenceReasonCode | null,
): Session {
  const row = loadSessionOrThrow(date)
  assertRewritable(row, 'Une séance démarrée ou clôturée ne peut plus être modifiée.')
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
  const updated = persistStructure(date, structure)
  recordSessionExercisePreference(row, blockIndex, exerciseIndex, 'removed', reasonCode, {
    source: 'session_edit',
  })
  invalidatePreparedSessions()
  return updated
}

/** Remplace un exercice par une alternative générée par l'IA. */
export async function replaceExerciseInSession(
  date: string,
  blockIndex: number,
  exerciseIndex: number,
  reasonCode?: PreferenceReasonCode | null,
): Promise<Session> {
  const row = loadSessionOrThrow(date)
  assertRewritable(row, 'Une séance démarrée ou clôturée ne peut plus être modifiée.')
  const structure = structuredClone(row.structure)
  const block = structure.blocks[blockIndex]
  const current = block?.exercises[exerciseIndex]
  if (!block || !current) {
    throw createError({ statusCode: 400, statusMessage: 'Exercice introuvable.' })
  }
  const pendingPreference = previewSessionExercisePreference(
    row,
    blockIndex,
    exerciseIndex,
    'replaced',
    reasonCode,
    { source: 'session_edit' },
  )
  const preferences = getExercisePreferenceConstraints(date, pendingPreference)
  const profile = getProfile()
  const replacement = await generateReplacementExercise(
    structure,
    blockIndex,
    exerciseIndex,
    reasonCode,
    preferences,
    {
      goal: profile.goal,
      equipment: profile.equipment,
    },
    normalizeOpenRouterModelSlug(row.aiModel),
  )
  block.exercises[exerciseIndex] = replacement
  const updated = persistStructure(date, structure)
  recordSessionExercisePreference(row, blockIndex, exerciseIndex, 'replaced', reasonCode, {
    source: 'session_edit',
    replacement,
  })
  invalidatePreparedSessions()
  return updated
}

export interface FeedbackPayload {
  completed: boolean
  overallDifficulty: number | null
  energyLevel: number | null
  soreness: string[]
  enjoyment: number | null
  comment: string | null
  actualDurationSec: number | null
  skippedBlockCount: number | null
  exercises: {
    blockIndex: number
    exerciseIndex: number
    exerciseName: string
    difficulty: number | null
    comment: string | null
    preferenceAction: Extract<PreferenceAction, 'liked' | 'disliked'> | null
    preferenceReasonCode: PreferenceReasonCode | null
  }[]
}

/**
 * Marque une séance comme sautée (non faite). La raison est stockée comme feedback global
 * (completed=false), ce qui la fait remonter au contexte IA pour adapter les séances suivantes.
 */
export function skipSession(date: string, reason: string | null): Session {
  const row = loadSessionOrThrow(date)
  const outcome = resolveSessionTransition(statusOf(row), 'skip')
  if (outcome.kind === 'idempotent') return row
  if (outcome.kind === 'rejected') {
    lifecycleConflict('Une séance terminée ne peut pas être marquée comme sautée.')
  }

  const transitioned = transitionSessionByDate(date, statusOf(row), {
    status: outcome.status,
    completedAt: null,
    actualDurationSec: null,
    skippedBlockCount: null,
  })
  if (!transitioned.changed || !transitioned.session) {
    lifecycleConflict(
      'Cette séance a changé entre-temps et ne peut plus être marquée comme sautée.',
    )
  }

  upsertSessionFeedback(row.id, {
    completed: false,
    overallDifficulty: null,
    energyLevel: null,
    soreness: [],
    enjoyment: null,
    comment: reason,
    actualDurationSec: null,
    skippedBlockCount: null,
  })

  // Le statut change : les recommandations en cache sont périmées.
  clearRecommendationCache()
  invalidatePreparedSessions()
  return transitioned.session
}

/** Enregistre ou remplace le feedback d'une séance déjà clôturée, sans rejouer sa transition. */
export function submitFeedback(date: string, payload: FeedbackPayload): Session {
  const row = loadSessionOrThrow(date)
  if (row.status !== 'completed' || !payload.completed) {
    lifecycleConflict("Le feedback ne peut être enregistré qu'après la clôture de la séance.")
  }

  upsertSessionFeedback(row.id, {
    completed: true,
    overallDifficulty: payload.overallDifficulty,
    energyLevel: payload.energyLevel,
    soreness: payload.soreness,
    enjoyment: payload.enjoyment,
    comment: payload.comment,
    actualDurationSec: row.actualDurationSec ?? payload.actualDurationSec,
    skippedBlockCount: row.skippedBlockCount ?? payload.skippedBlockCount,
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

  for (const exercise of payload.exercises) {
    if (!exercise.preferenceAction) continue
    recordSessionExercisePreference(
      row,
      exercise.blockIndex,
      exercise.exerciseIndex,
      exercise.preferenceAction,
      exercise.preferenceReasonCode,
      {
        source: 'feedback',
        sourceKey: `feedback:${row.id}:${exercise.blockIndex}:${exercise.exerciseIndex}`,
      },
    )
  }

  // Le feedback enrichit l'historique sans modifier la source de vérité de la clôture.
  clearRecommendationCache()
  invalidatePreparedSessions()
  return row
}
