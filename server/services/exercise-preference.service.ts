import {
  buildExercisePreferenceConstraints,
  exercisePreferenceIdentity,
  normalizePreferenceReason,
  preferenceTarget,
  scoreExercisePreferences,
  type ExercisePreferenceConstraints,
  type ExercisePreferenceSummary,
  type PreferenceAction,
  type PreferenceEventContext,
  type PreferenceEventSource,
  type PreferenceReasonCode,
} from '../../shared/exercise-preferences'
import type { Exercise } from '../../shared/session-schema'
import type { NewExercisePreferenceEventRow, Session } from '../database/schema'

type PreferenceEventValues = Omit<NewExercisePreferenceEventRow, 'id' | 'createdAt' | 'updatedAt'>

interface RecordPreferenceOptions {
  source: PreferenceEventSource
  sourceKey?: string | null
  replacement?: Exercise | null
}

function exerciseAt(
  session: Session,
  blockIndex: number,
  exerciseIndex: number,
): { exercise: Exercise; blockType: string } {
  const block = session.structure.blocks[blockIndex]
  const exercise = block?.exercises[exerciseIndex]
  if (!block || !exercise) {
    throw createError({ statusCode: 400, statusMessage: 'Exercice introuvable.' })
  }
  return { exercise, blockType: block.type }
}

function eventValues(
  session: Session,
  exercise: Exercise,
  blockType: string,
  action: PreferenceAction,
  reasonCode: PreferenceReasonCode | null | undefined,
  options: RecordPreferenceOptions,
): PreferenceEventValues {
  const normalizedReason = normalizePreferenceReason(action, reasonCode)
  const identity = exercisePreferenceIdentity(exercise, blockType)
  const target = preferenceTarget(identity, normalizedReason)
  const replacementIdentity = options.replacement
    ? exercisePreferenceIdentity(options.replacement, blockType)
    : null
  const context: PreferenceEventContext = {
    sessionDate: session.date,
    blockType,
    exerciseCategory: exercise.category,
    workoutFocus: session.focus,
    replacementExerciseKey: replacementIdentity?.exerciseKey ?? null,
  }

  return {
    ...identity,
    exerciseName: exercise.name,
    action,
    reasonCode: normalizedReason,
    signalKind: target.kind,
    scope: target.scope,
    scopeKey: target.scopeKey,
    occurredOn: session.date,
    source: options.source,
    sourceKey: options.sourceKey ?? null,
    context,
  }
}

export function recordSessionExercisePreference(
  session: Session,
  blockIndex: number,
  exerciseIndex: number,
  action: PreferenceAction,
  reasonCode: PreferenceReasonCode | null | undefined,
  options: RecordPreferenceOptions,
): void {
  const values = previewSessionExercisePreference(
    session,
    blockIndex,
    exerciseIndex,
    action,
    reasonCode,
    options,
  )
  upsertExercisePreferenceEvent(values)
}

export function previewSessionExercisePreference(
  session: Session,
  blockIndex: number,
  exerciseIndex: number,
  action: PreferenceAction,
  reasonCode: PreferenceReasonCode | null | undefined,
  options: RecordPreferenceOptions,
): PreferenceEventValues {
  const { exercise, blockType } = exerciseAt(session, blockIndex, exerciseIndex)
  return eventValues(session, exercise, blockType, action, reasonCode, options)
}

export function getExercisePreferenceConstraints(
  asOfDate: string,
  pendingEvent?: PreferenceEventValues,
): ExercisePreferenceConstraints {
  const events = listExercisePreferenceEvents(asOfDate)
  return buildExercisePreferenceConstraints(
    pendingEvent ? [...events, pendingEvent] : events,
    asOfDate,
  )
}

export function getExercisePreferenceSummaries(asOfDate: string): ExercisePreferenceSummary[] {
  return scoreExercisePreferences(listExercisePreferenceEvents(asOfDate), asOfDate)
}

export function replaceLearnedExercisePreference(
  exerciseKey: string,
  action: Extract<PreferenceAction, 'liked' | 'disliked'>,
  reasonCode: PreferenceReasonCode | null | undefined,
): ExercisePreferenceSummary {
  const existing = listExercisePreferenceEventsForKey(exerciseKey)
  const latest = existing[0]
  if (!latest) {
    throw createError({ statusCode: 404, statusMessage: 'Préférence introuvable.' })
  }

  const normalizedReason = normalizePreferenceReason(action, reasonCode)
  const target = preferenceTarget(
    {
      exerciseKey: latest.exerciseKey,
      movementFamily: latest.movementFamily,
      modality: latest.modality,
    },
    normalizedReason,
  )
  const settingsRow = getSettings()
  const occurredOn = todayIso(settingsRow.timezone)
  const context: PreferenceEventContext = {
    sessionDate: null,
    blockType: null,
    exerciseCategory: null,
    workoutFocus: null,
  }

  const event = replaceExercisePreferenceEvents(exerciseKey, {
    exerciseKey,
    exerciseName: latest.exerciseName,
    movementFamily: latest.movementFamily,
    modality: latest.modality,
    action,
    reasonCode: normalizedReason,
    signalKind: target.kind,
    scope: target.scope,
    scopeKey: target.scopeKey,
    occurredOn,
    source: 'settings',
    sourceKey: null,
    context,
  })

  return scoreExercisePreferences([event], occurredOn)[0]!
}

export function forgetLearnedExercisePreference(exerciseKey: string): void {
  const deleted = deleteExercisePreferenceEvents(exerciseKey)
  if (!deleted) {
    throw createError({ statusCode: 404, statusMessage: 'Préférence introuvable.' })
  }
}
