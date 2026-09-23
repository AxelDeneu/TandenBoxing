import { exercisePreferenceIdentity } from '../../shared/exercise-preferences'
import {
  adaptWorkoutSession,
  estimateRunnableSessionSeconds,
  sessionCheckInSchema,
  type InSessionAdaptation,
  type SessionCheckIn,
} from '../../shared/session-autoregulation'
import type { Session, SessionAdaptationRow, SessionCheckInRow } from '../database/schema'

export interface PersistedAutoregulationResult {
  session: Session
  checkIn: SessionCheckInRow | null
  adaptation: SessionAdaptationRow
  safetyNotice: string | null
}

function loadAdaptableSession(date: string): Session {
  const row = findSessionByDate(date)
  if (!row) throw createError({ statusCode: 404, statusMessage: 'Séance introuvable.' })
  if (row.status === 'completed' || row.status === 'skipped') {
    throw createError({
      statusCode: 409,
      statusMessage: 'Cette séance clôturée ne peut plus être adaptée.',
    })
  }
  return row
}

function currentIntensity(sessionId: number): number | null {
  return listSessionAdaptations(sessionId)[0]?.afterIntensity ?? null
}

function persistAdaptation(
  row: Session,
  result: ReturnType<typeof adaptWorkoutSession>,
): { session: Session; adaptation: SessionAdaptationRow } {
  return persistSessionAutoregulation(
    row.date,
    {
      structure: result.session,
      estimatedDurationMin: Math.max(
        10,
        Math.ceil(estimateRunnableSessionSeconds(result.session) / 60),
      ),
    },
    {
      sessionId: row.id,
      sessionDate: row.date,
      cause: result.trace.cause,
      cursor: result.trace.cursor,
      constraints: result.trace.constraints,
      changes: result.trace.changes,
      beforeDurationSec: result.trace.beforeDurationSec,
      afterDurationSec: result.trace.afterDurationSec,
      beforeIntensity: result.trace.beforeIntensity,
      afterIntensity: result.trace.afterIntensity,
      ruleVersion: result.trace.ruleVersion,
      safetyNoticeShown: Boolean(result.trace.safetyNotice),
    },
  )
}

/** Enregistre le check-in puis adapte toute la séance, avant son démarrage. */
export function applySessionCheckIn(
  date: string,
  rawCheckIn: SessionCheckIn,
): PersistedAutoregulationResult {
  const row = loadAdaptableSession(date)
  if (row.status === 'in_progress' || row.startedAt) {
    throw createError({
      statusCode: 409,
      statusMessage: 'Le check-in doit être effectué avant de démarrer la séance.',
    })
  }
  const checkIn = sessionCheckInSchema.parse(rawCheckIn)
  const result = adaptWorkoutSession(row.structure, {
    cause: 'check_in',
    checkIn,
    currentIntensity: currentIntensity(row.id),
  })
  const persistedCheckIn = upsertSessionCheckIn({
    sessionId: row.id,
    availableTimeMin: checkIn.availableTimeMin,
    energy: checkIn.energy,
    sorenessLevel: checkIn.sorenessLevel,
    sorenessLocations: checkIn.sorenessLocations,
    painLocations: checkIn.painLocations,
    intention: checkIn.intention,
  })
  const persisted = persistAdaptation(row, result)
  return {
    ...persisted,
    checkIn: persistedCheckIn,
    safetyNotice: result.trace.safetyNotice,
  }
}

/** Adapte uniquement les exercices situés après l'exercice courant. */
export function adaptSessionDuringWorkout(
  date: string,
  input: InSessionAdaptation,
): PersistedAutoregulationResult {
  const row = loadAdaptableSession(date)
  const block = row.structure.blocks[input.cursor.blockIndex]
  const current = block?.exercises[input.cursor.exerciseIndex]
  if (!block || !current) {
    throw createError({ statusCode: 400, statusMessage: 'Position de séance invalide.' })
  }

  const currentMovementFamily =
    input.action === 'pain' ? exercisePreferenceIdentity(current, block.type).movementFamily : null
  const result = adaptWorkoutSession(row.structure, {
    cause: input.action,
    cursor: input.cursor,
    painLocations: input.painLocations,
    currentMovementFamily,
    currentIntensity: currentIntensity(row.id),
  })
  const persisted = persistAdaptation(row, result)

  if (input.action === 'pain') {
    recordSessionExercisePreference(
      row,
      input.cursor.blockIndex,
      input.cursor.exerciseIndex,
      'removed',
      'pain',
      {
        source: 'session_edit',
        sourceKey: `autoregulation:${persisted.adaptation.id}`,
      },
    )
  }

  return {
    ...persisted,
    checkIn: findSessionCheckIn(row.id) ?? null,
    safetyNotice: result.trace.safetyNotice,
  }
}
