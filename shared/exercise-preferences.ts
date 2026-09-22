import { z } from 'zod'
import { daysBetween } from './dates'
import type { WorkoutSession } from './session-schema'
import { createExerciseSignature, type ExerciseLike } from './session-variety'

export const EXERCISE_PREFERENCE_VERSION = 'exercise-preferences/v1'

export const preferenceAction = z.enum(['liked', 'disliked', 'replaced', 'removed'])
export type PreferenceAction = z.infer<typeof preferenceAction>

export const preferenceReasonCode = z.enum([
  'liked',
  'no_reason',
  'boredom',
  'format_preference',
  'too_easy',
  'too_hard',
  'pain',
  'equipment_unavailable',
  'impossible',
  'other',
])
export type PreferenceReasonCode = z.infer<typeof preferenceReasonCode>

export const preferenceEventSource = z.enum(['feedback', 'session_edit', 'settings'])
export type PreferenceEventSource = z.infer<typeof preferenceEventSource>

export type PreferenceSignalKind = 'weighted' | 'strict_exclusion'
export type PreferenceScope = 'exercise' | 'movement' | 'modality'

export const PREFERENCE_REASON_OPTIONS: ReadonlyArray<{
  value: PreferenceReasonCode
  label: string
  kind: PreferenceSignalKind
}> = [
  { value: 'no_reason', label: 'Sans motif particulier', kind: 'weighted' },
  { value: 'boredom', label: 'Lassitude / répétitif', kind: 'weighted' },
  { value: 'format_preference', label: 'Format peu apprécié', kind: 'weighted' },
  { value: 'too_easy', label: 'Trop facile', kind: 'weighted' },
  { value: 'too_hard', label: 'Trop difficile', kind: 'weighted' },
  { value: 'pain', label: 'Douleur pendant le mouvement', kind: 'strict_exclusion' },
  {
    value: 'equipment_unavailable',
    label: 'Matériel indisponible',
    kind: 'strict_exclusion',
  },
  { value: 'impossible', label: 'Mouvement impossible', kind: 'strict_exclusion' },
  { value: 'other', label: 'Autre préférence', kind: 'weighted' },
]

const STRICT_REASON_CODES = new Set<PreferenceReasonCode>([
  'pain',
  'equipment_unavailable',
  'impossible',
])

const ACTION_WEIGHTS: Record<PreferenceAction, number> = {
  liked: 1,
  disliked: -1,
  replaced: -0.75,
  removed: -1,
}

const RECENCY_HALF_LIFE_DAYS = 90

export interface ExercisePreferenceIdentity {
  exerciseKey: string
  movementFamily: string
  modality: string
}

export interface ExercisePreferenceTarget {
  kind: PreferenceSignalKind
  scope: PreferenceScope
  scopeKey: string
}

/** Contexte borné et non libre, persistable sans recopier de commentaire utilisateur. */
export interface PreferenceEventContext {
  sessionDate: string | null
  blockType: string | null
  exerciseCategory: string | null
  workoutFocus: string | null
  replacementExerciseKey?: string | null
}

export interface ExercisePreferenceEvent {
  id?: number | string
  exerciseKey: string
  exerciseName: string
  movementFamily: string
  modality: string
  action: PreferenceAction
  reasonCode: PreferenceReasonCode
  signalKind: PreferenceSignalKind
  scope: PreferenceScope
  scopeKey: string
  occurredOn: string
  source: PreferenceEventSource
}

export interface ExercisePreferenceSummary {
  exerciseKey: string
  exerciseName: string
  movementFamily: string
  modality: string
  score: number
  recency: number
  frequency: number
  confidence: number
  eventCount: number
  lastEventOn: string
  strictExclusion: boolean
  reasonCodes: PreferenceReasonCode[]
}

export interface StrictExerciseExclusion {
  exerciseKey: string
  exerciseName: string
  scope: PreferenceScope
  scopeKey: string
  reasonCodes: PreferenceReasonCode[]
}

export interface WeightedExercisePreference {
  exerciseKey: string
  exerciseName: string
  direction: 'prefer' | 'avoid'
  score: number
  recency: number
  frequency: number
  confidence: number
  eventCount: number
  lastEventOn: string
  reasonCodes: PreferenceReasonCode[]
}

export interface ExercisePreferenceConstraints {
  version: typeof EXERCISE_PREFERENCE_VERSION
  asOfDate: string
  signalCount: number
  strictExclusions: StrictExerciseExclusion[]
  weightedPreferences: WeightedExercisePreference[]
}

export interface PreferenceInfluenceTrace {
  applied: boolean
  signalCount: number
  strictExclusionCount: number
  weightedPreferenceCount: number
  matchedPreferredExerciseKeys: string[]
  matchedAvoidedExerciseKeys: string[]
  strictExclusionsHonored: boolean
  safetyAndProgressionPrecedence: true
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value))
}

function rounded(value: number): number {
  return Math.round(value * 10_000) / 10_000
}

function compareEvents(
  left: Pick<ExercisePreferenceEvent, 'occurredOn' | 'id'>,
  right: Pick<ExercisePreferenceEvent, 'occurredOn' | 'id'>,
): number {
  const dateOrder = left.occurredOn.localeCompare(right.occurredOn)
  if (dateOrder) return dateOrder
  return String(left.id ?? '').localeCompare(String(right.id ?? ''))
}

export function preferenceReasonLabel(reasonCode: PreferenceReasonCode): string {
  if (reasonCode === 'liked') return 'Exercice apprécié'
  return (
    PREFERENCE_REASON_OPTIONS.find((option) => option.value === reasonCode)?.label ??
    'Préférence utilisateur'
  )
}

export function normalizePreferenceReason(
  action: PreferenceAction,
  reasonCode?: PreferenceReasonCode | null,
): PreferenceReasonCode {
  if (action === 'liked') return 'liked'
  return reasonCode && reasonCode !== 'liked' ? reasonCode : 'no_reason'
}

export function classifyPreferenceReason(reasonCode: PreferenceReasonCode): PreferenceSignalKind {
  return STRICT_REASON_CODES.has(reasonCode) ? 'strict_exclusion' : 'weighted'
}

export function exercisePreferenceIdentity(
  exercise: ExerciseLike,
  blockType: string,
): ExercisePreferenceIdentity {
  const signature = createExerciseSignature(exercise, blockType)
  return {
    exerciseKey: `${signature.movementFamily}:${signature.modality}`,
    movementFamily: signature.movementFamily,
    modality: signature.modality,
  }
}

export function preferenceTarget(
  identity: ExercisePreferenceIdentity,
  reasonCode: PreferenceReasonCode,
): ExercisePreferenceTarget {
  const kind = classifyPreferenceReason(reasonCode)
  if (reasonCode === 'pain') {
    return { kind, scope: 'movement', scopeKey: identity.movementFamily }
  }
  if (reasonCode === 'equipment_unavailable' && identity.modality === 'sac') {
    return { kind, scope: 'modality', scopeKey: identity.modality }
  }
  return { kind, scope: 'exercise', scopeKey: identity.exerciseKey }
}

function recencyWeight(occurredOn: string, asOfDate: string): number {
  const ageDays = Math.max(0, daysBetween(occurredOn, asOfDate))
  return 2 ** (-ageDays / RECENCY_HALF_LIFE_DAYS)
}

/**
 * Agrège le journal d'événements sans état caché : le sentiment est pondéré par la récence,
 * puis ramené par une confiance qui augmente avec les signaux récents et répétés.
 * Une exclusion stricte ne décroît jamais : seul l'utilisateur peut la modifier ou l'effacer.
 */
export function scoreExercisePreferences(
  events: readonly ExercisePreferenceEvent[],
  asOfDate: string,
): ExercisePreferenceSummary[] {
  const relevant = events.filter((event) => event.occurredOn <= asOfDate)
  const byExercise = new Map<string, ExercisePreferenceEvent[]>()
  for (const event of relevant) {
    const group = byExercise.get(event.exerciseKey) ?? []
    group.push(event)
    byExercise.set(event.exerciseKey, group)
  }

  return [...byExercise.entries()]
    .map(([exerciseKey, group]) => {
      const ordered = [...group].sort(compareEvents)
      const latest = ordered.at(-1)!
      const weighted = ordered.filter((event) => event.signalKind === 'weighted')
      const strictExclusion = ordered.some((event) => event.signalKind === 'strict_exclusion')
      const recency = Math.max(...ordered.map((event) => recencyWeight(event.occurredOn, asOfDate)))
      const frequency = 1 - Math.exp(-ordered.length / 3)

      let weightedSum = 0
      let weightedMagnitude = 0
      let effectiveEvidence = 0
      for (const event of weighted) {
        const actionWeight = ACTION_WEIGHTS[event.action]
        const decay = recencyWeight(event.occurredOn, asOfDate)
        weightedSum += actionWeight * decay
        weightedMagnitude += Math.abs(actionWeight) * decay
        effectiveEvidence += Math.abs(actionWeight) * decay
      }
      const sentiment = weightedMagnitude ? weightedSum / weightedMagnitude : 0
      const confidence = strictExclusion ? 1 : 1 - Math.exp(-effectiveEvidence / 1.5)

      return {
        exerciseKey,
        exerciseName: latest.exerciseName,
        movementFamily: latest.movementFamily,
        modality: latest.modality,
        score: strictExclusion ? -1 : rounded(clamp(sentiment * confidence, -1, 1)),
        recency: rounded(recency),
        frequency: rounded(frequency),
        confidence: rounded(confidence),
        eventCount: ordered.length,
        lastEventOn: latest.occurredOn,
        strictExclusion,
        reasonCodes: [...new Set(ordered.map((event) => event.reasonCode))],
      }
    })
    .sort(
      (left, right) =>
        Number(right.strictExclusion) - Number(left.strictExclusion) ||
        Math.abs(right.score) - Math.abs(left.score) ||
        right.lastEventOn.localeCompare(left.lastEventOn) ||
        left.exerciseKey.localeCompare(right.exerciseKey),
    )
}

export function buildExercisePreferenceConstraints(
  events: readonly ExercisePreferenceEvent[],
  asOfDate: string,
): ExercisePreferenceConstraints {
  const summaries = scoreExercisePreferences(events, asOfDate)
  const strictByScope = new Map<string, StrictExerciseExclusion>()
  const strictEvents = events
    .filter(
      (candidate) =>
        candidate.occurredOn <= asOfDate && candidate.signalKind === 'strict_exclusion',
    )
    .sort(compareEvents)
  for (const event of strictEvents) {
    const key = `${event.scope}:${event.scopeKey}`
    const current = strictByScope.get(key)
    strictByScope.set(key, {
      exerciseKey: event.exerciseKey,
      exerciseName: event.exerciseName,
      scope: event.scope,
      scopeKey: event.scopeKey,
      reasonCodes: [...new Set([...(current?.reasonCodes ?? []), event.reasonCode])],
    })
  }

  const weightedPreferences = summaries
    .filter((summary) => !summary.strictExclusion && Math.abs(summary.score) >= 0.05)
    .slice(0, 20)
    .map((summary): WeightedExercisePreference => ({
      exerciseKey: summary.exerciseKey,
      exerciseName: summary.exerciseName,
      direction: summary.score > 0 ? 'prefer' : 'avoid',
      score: summary.score,
      recency: summary.recency,
      frequency: summary.frequency,
      confidence: summary.confidence,
      eventCount: summary.eventCount,
      lastEventOn: summary.lastEventOn,
      reasonCodes: summary.reasonCodes,
    }))

  return {
    version: EXERCISE_PREFERENCE_VERSION,
    asOfDate,
    signalCount: events.filter((event) => event.occurredOn <= asOfDate).length,
    strictExclusions: [...strictByScope.values()].sort(
      (left, right) =>
        left.scope.localeCompare(right.scope) || left.scopeKey.localeCompare(right.scopeKey),
    ),
    weightedPreferences,
  }
}

function identityMatchesScope(
  identity: ExercisePreferenceIdentity,
  exclusion: Pick<StrictExerciseExclusion, 'scope' | 'scopeKey'>,
): boolean {
  if (exclusion.scope === 'movement') return identity.movementFamily === exclusion.scopeKey
  if (exclusion.scope === 'modality') return identity.modality === exclusion.scopeKey
  return identity.exerciseKey === exclusion.scopeKey
}

export function matchingStrictExclusion(
  exercise: ExerciseLike,
  blockType: string,
  constraints: ExercisePreferenceConstraints | undefined,
): StrictExerciseExclusion | null {
  if (!constraints?.strictExclusions.length) return null
  const identity = exercisePreferenceIdentity(exercise, blockType)
  return (
    constraints.strictExclusions.find((exclusion) => identityMatchesScope(identity, exclusion)) ??
    null
  )
}

export function preferenceScoreForExercise(
  exercise: ExerciseLike,
  blockType: string,
  constraints: ExercisePreferenceConstraints | undefined,
): number {
  if (!constraints) return 0
  const { exerciseKey } = exercisePreferenceIdentity(exercise, blockType)
  return (
    constraints.weightedPreferences.find((preference) => preference.exerciseKey === exerciseKey)
      ?.score ?? 0
  )
}

export function tracePreferenceInfluence(
  session: WorkoutSession,
  constraints: ExercisePreferenceConstraints,
): PreferenceInfluenceTrace {
  const generated: ExercisePreferenceIdentity[] = []
  for (const block of session.blocks) {
    for (const exercise of block.exercises) {
      generated.push(exercisePreferenceIdentity(exercise, block.type))
    }
  }
  const keys = new Set(generated.map((identity) => identity.exerciseKey))
  const matchedPreferredExerciseKeys = constraints.weightedPreferences
    .filter((preference) => preference.direction === 'prefer' && keys.has(preference.exerciseKey))
    .map((preference) => preference.exerciseKey)
  const matchedAvoidedExerciseKeys = constraints.weightedPreferences
    .filter((preference) => preference.direction === 'avoid' && keys.has(preference.exerciseKey))
    .map((preference) => preference.exerciseKey)
  const strictExclusionsHonored = generated.every((identity) =>
    constraints.strictExclusions.every((exclusion) => !identityMatchesScope(identity, exclusion)),
  )

  return {
    applied: constraints.signalCount > 0,
    signalCount: constraints.signalCount,
    strictExclusionCount: constraints.strictExclusions.length,
    weightedPreferenceCount: constraints.weightedPreferences.length,
    matchedPreferredExerciseKeys,
    matchedAvoidedExerciseKeys,
    strictExclusionsHonored,
    safetyAndProgressionPrecedence: true,
  }
}
