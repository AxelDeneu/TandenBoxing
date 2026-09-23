import { z } from 'zod'
import { exercisePreferenceIdentity } from './exercise-preferences'
import {
  estimateExerciseSeconds,
  type BlockType,
  type Exercise,
  type WorkoutSession,
} from './session-schema'

export const SESSION_AUTOREGULATION_VERSION = 'session-autoregulation/v1'

export const bodyArea = z.enum([
  'head_neck',
  'shoulder',
  'elbow',
  'wrist_hand',
  'back',
  'hip',
  'knee',
  'ankle_foot',
  'other',
])
export type BodyArea = z.infer<typeof bodyArea>

export const sessionIntention = z.enum(['maintain', 'technique', 'recover', 'challenge'])
export type SessionIntention = z.infer<typeof sessionIntention>

export const BODY_AREA_OPTIONS: ReadonlyArray<{ value: BodyArea; label: string }> = [
  { value: 'head_neck', label: 'Tête / nuque' },
  { value: 'shoulder', label: 'Épaule' },
  { value: 'elbow', label: 'Coude' },
  { value: 'wrist_hand', label: 'Poignet / main' },
  { value: 'back', label: 'Dos' },
  { value: 'hip', label: 'Hanche' },
  { value: 'knee', label: 'Genou' },
  { value: 'ankle_foot', label: 'Cheville / pied' },
  { value: 'other', label: 'Autre zone' },
]

export const SESSION_INTENTION_OPTIONS: ReadonlyArray<{
  value: SessionIntention
  label: string
}> = [
  { value: 'maintain', label: 'Suivre la séance' },
  { value: 'technique', label: 'Privilégier la technique' },
  { value: 'recover', label: 'Récupérer' },
  { value: 'challenge', label: 'Me challenger' },
]

export const sessionCheckInSchema = z
  .object({
    /** Null conserve la durée actuelle. */
    availableTimeMin: z.number().int().min(10).max(90).nullable().default(null),
    energy: z.number().int().min(1).max(5).default(3),
    sorenessLevel: z.number().int().min(0).max(3).default(0),
    sorenessLocations: z.array(bodyArea).max(9).default([]),
    painLocations: z.array(bodyArea).max(9).default([]),
    intention: sessionIntention.default('maintain'),
  })
  .strict()
export type SessionCheckIn = z.infer<typeof sessionCheckInSchema>

export const sessionAdaptationCause = z.enum(['check_in', 'too_hard', 'too_easy', 'pain'])
export type SessionAdaptationCause = z.infer<typeof sessionAdaptationCause>

export const sessionAdaptationCursorSchema = z
  .object({
    blockIndex: z.number().int().nonnegative(),
    exerciseIndex: z.number().int().nonnegative(),
  })
  .strict()
export type SessionAdaptationCursor = z.infer<typeof sessionAdaptationCursorSchema>

export const inSessionAdaptationSchema = z
  .object({
    action: z.enum(['too_hard', 'too_easy', 'pain']),
    cursor: sessionAdaptationCursorSchema,
    painLocations: z.array(bodyArea).max(9).default([]),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.action === 'pain' && value.painLocations.length === 0) {
      context.addIssue({
        code: 'custom',
        path: ['painLocations'],
        message: 'La zone douloureuse est requise.',
      })
    }
    if (value.action !== 'pain' && value.painLocations.length > 0) {
      context.addIssue({
        code: 'custom',
        path: ['painLocations'],
        message: "Une zone douloureuse n'est acceptée que pour l'action douleur.",
      })
    }
  })
export type InSessionAdaptation = z.infer<typeof inSessionAdaptationSchema>

export interface SessionAutoregulationConstraints {
  targetSeconds: number
  intensity: number
  workScale: number
  restScale: number
  roundDelta: number
  maxComboLength: number
  prohibitedMovementFamilies: string[]
  allowedMovementFamilies: string[]
  safetyPrecedence: boolean
}

export type SessionAdaptationChangeKind =
  'duration' | 'intensity' | 'work' | 'rest' | 'rounds' | 'complexity' | 'substitution'

export interface SessionAdaptationChange {
  kind: SessionAdaptationChangeKind
  path: string
  before: number | string | null
  after: number | string | null
}

export interface SessionAdaptationTrace {
  ruleVersion: typeof SESSION_AUTOREGULATION_VERSION
  cause: SessionAdaptationCause
  cursor: SessionAdaptationCursor | null
  beforeDurationSec: number
  afterDurationSec: number
  beforeIntensity: number
  afterIntensity: number
  constraints: SessionAutoregulationConstraints
  changes: SessionAdaptationChange[]
  safetyNotice: string | null
}

export interface SessionAdaptationResult {
  session: WorkoutSession
  trace: SessionAdaptationTrace
}

export const PAIN_SAFETY_NOTICE =
  'Arrête immédiatement tout mouvement douloureux. Reprends seulement sans douleur et à intensité confortable. Si la douleur est forte, inhabituelle ou persiste, interromps la séance et demande un avis professionnel. Cette consigne ne constitue pas un diagnostic médical.'

const BASE_INTENSITY: Record<WorkoutSession['category'], number> = {
  apprentissage: 2,
  renforcement: 3,
  enchainement: 4,
  cardio: 5,
  recuperation: 1,
}

const PAIN_MOVEMENT_FAMILIES: Record<BodyArea, readonly string[]> = {
  head_neck: ['crochets', 'uppercuts', 'combinaison_mixte', 'gainage', 'burpees'],
  shoulder: [
    'jab',
    'cross',
    'directs',
    'crochets',
    'uppercuts',
    'combinaison_mixte',
    'pompes',
    'gainage',
    'burpees',
  ],
  elbow: [
    'jab',
    'cross',
    'directs',
    'crochets',
    'uppercuts',
    'combinaison_mixte',
    'pompes',
    'burpees',
  ],
  wrist_hand: [
    'jab',
    'cross',
    'directs',
    'crochets',
    'uppercuts',
    'combinaison_mixte',
    'pompes',
    'gainage',
    'burpees',
  ],
  back: [
    'crochets',
    'uppercuts',
    'combinaison_mixte',
    'pompes',
    'gainage',
    'squats',
    'fentes',
    'burpees',
  ],
  hip: ['deplacements', 'squats', 'fentes', 'burpees', 'montee_cardiaque'],
  knee: ['deplacements', 'squats', 'fentes', 'burpees', 'montee_cardiaque'],
  ankle_foot: ['deplacements', 'squats', 'fentes', 'burpees', 'montee_cardiaque'],
  other: [],
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value))
}

function roundToFive(value: number): number {
  return Math.round(value / 5) * 5
}

function allExercises(session: WorkoutSession): Array<{
  blockIndex: number
  exerciseIndex: number
  blockType: BlockType
  exercise: Exercise
}> {
  return session.blocks.flatMap((block, blockIndex) =>
    block.exercises.map((exercise, exerciseIndex) => ({
      blockIndex,
      exerciseIndex,
      blockType: block.type,
      exercise,
    })),
  )
}

function isAfterCursor(
  blockIndex: number,
  exerciseIndex: number,
  cursor: SessionAdaptationCursor | null,
): boolean {
  if (!cursor) return true
  return (
    blockIndex > cursor.blockIndex ||
    (blockIndex === cursor.blockIndex && exerciseIndex > cursor.exerciseIndex)
  )
}

/** Durée réellement exécutée par le timer, préparations incluses et repos final exclu. */
export function estimateRunnableSessionSeconds(session: WorkoutSession): number {
  const exercises = allExercises(session)
  if (!exercises.length) return 0
  return exercises.reduce((total, entry, index) => {
    const restAfter = index === exercises.length - 1 ? entry.exercise.restAfterSec : 0
    return total + 10 + estimateExerciseSeconds(entry.exercise) - restAfter
  }, 0)
}

function movementFamilies(
  session: WorkoutSession,
  cursor: SessionAdaptationCursor | null,
): string[] {
  return [
    ...new Set(
      allExercises(session)
        .filter((entry) => isAfterCursor(entry.blockIndex, entry.exerciseIndex, cursor))
        .map(
          ({ exercise, blockType }) =>
            exercisePreferenceIdentity(exercise, blockType).movementFamily,
        ),
    ),
  ].sort()
}

function prohibitedForPain(locations: readonly BodyArea[]): string[] {
  return [...new Set(locations.flatMap((location) => PAIN_MOVEMENT_FAMILIES[location]))].sort()
}

function safeReplacement(exercise: Exercise): Exercise {
  return {
    ...exercise,
    name: 'Respiration contrôlée sans douleur',
    category: 'recuperation',
    explanation:
      'Reste dans une posture confortable et respire lentement, sans solliciter la zone sensible.',
    tips: ['Garde une amplitude confortable.', 'Arrête si la douleur apparaît ou augmente.'],
    commonMistakes: ['Forcer une position inconfortable.'],
    skillIds: [],
    combo: null,
    comboExplanation: null,
  }
}

interface RuleInput {
  cause: SessionAdaptationCause
  checkIn?: SessionCheckIn
  cursor?: SessionAdaptationCursor | null
  painLocations?: BodyArea[]
  currentMovementFamily?: string | null
  currentIntensity?: number | null
}

function deriveConstraints(
  session: WorkoutSession,
  input: RuleInput,
): SessionAutoregulationConstraints {
  const baseIntensity = input.currentIntensity ?? BASE_INTENSITY[session.category]
  let intensity = baseIntensity
  let workScale = 1
  let restScale = 1
  let roundDelta = 0
  let maxComboLength = 6
  let safetyPrecedence = false
  const checkIn = input.checkIn
  const painLocations = input.painLocations ?? checkIn?.painLocations ?? []

  if (input.cause === 'too_hard') {
    intensity -= 1
    workScale = 0.8
    restScale = 1.25
    roundDelta = -1
    maxComboLength = 2
  } else if (input.cause === 'too_easy') {
    intensity += 1
    workScale = 1.1
    restScale = 0.85
    roundDelta = 1
  } else if (input.cause === 'pain') {
    intensity -= 2
    workScale = 0.7
    restScale = 1.5
    roundDelta = -1
    maxComboLength = 1
    safetyPrecedence = true
  }

  if (checkIn) {
    const energyWork = checkIn.energy === 1 ? 0.6 : checkIn.energy === 2 ? 0.75 : 1
    const energyRest = checkIn.energy === 1 ? 1.5 : checkIn.energy === 2 ? 1.25 : 1
    const sorenessWork =
      checkIn.sorenessLevel === 3
        ? 0.6
        : checkIn.sorenessLevel === 2
          ? 0.8
          : checkIn.sorenessLevel === 1
            ? 0.9
            : 1
    const sorenessRest =
      checkIn.sorenessLevel === 3
        ? 1.5
        : checkIn.sorenessLevel === 2
          ? 1.25
          : checkIn.sorenessLevel === 1
            ? 1.1
            : 1
    const loadReduction = Math.max(
      checkIn.energy === 1 ? 2 : checkIn.energy === 2 ? 1 : 0,
      checkIn.sorenessLevel === 3 ? 2 : checkIn.sorenessLevel === 2 ? 1 : 0,
      painLocations.length ? 2 : 0,
      checkIn.intention === 'recover' ? 1 : 0,
    )
    safetyPrecedence = checkIn.energy <= 2 || checkIn.sorenessLevel >= 2 || painLocations.length > 0
    intensity -= loadReduction
    workScale = Math.min(workScale, energyWork, sorenessWork)
    restScale = Math.max(restScale, energyRest, sorenessRest)
    if (loadReduction > 0)
      roundDelta = checkIn.energy === 1 || checkIn.sorenessLevel === 3 ? -2 : -1
    if (loadReduction > 0) maxComboLength = Math.min(maxComboLength, 2)

    if (checkIn.intention === 'recover') {
      workScale = Math.min(workScale, 0.8)
      restScale = Math.max(restScale, 1.25)
      roundDelta = Math.min(roundDelta, -1)
      maxComboLength = Math.min(maxComboLength, 2)
    } else if (checkIn.intention === 'technique') {
      workScale = Math.min(workScale, 0.9)
      restScale = Math.max(restScale, 1.1)
      maxComboLength = Math.min(maxComboLength, 3)
    } else if (checkIn.intention === 'challenge' && !safetyPrecedence) {
      intensity += 1
      workScale = Math.max(workScale, 1.1)
      restScale = Math.min(restScale, 0.85)
      roundDelta = Math.max(roundDelta, 1)
    }
  }

  const knownFamilies = movementFamilies(session, input.cursor ?? null)
  const prohibitedMovementFamilies = prohibitedForPain(painLocations)
  // Une zone « autre » ne permet pas une compatibilité fiable : la suite passe en récupération.
  if (painLocations.includes('other')) prohibitedMovementFamilies.push(...knownFamilies)
  if (input.currentMovementFamily) prohibitedMovementFamilies.push(input.currentMovementFamily)
  const prohibited = [...new Set(prohibitedMovementFamilies)].sort()

  return {
    targetSeconds:
      checkIn?.availableTimeMin != null
        ? checkIn.availableTimeMin * 60
        : estimateRunnableSessionSeconds(session),
    intensity: clamp(intensity, 1, 5),
    workScale,
    restScale,
    roundDelta,
    maxComboLength,
    prohibitedMovementFamilies: prohibited,
    allowedMovementFamilies: knownFamilies.filter((family) => !prohibited.includes(family)),
    safetyPrecedence,
  }
}

function addChange(
  changes: SessionAdaptationChange[],
  kind: SessionAdaptationChangeKind,
  path: string,
  before: SessionAdaptationChange['before'],
  after: SessionAdaptationChange['after'],
): void {
  if (before === after) return
  const existing = changes.find((change) => change.kind === kind && change.path === path)
  if (existing) {
    existing.after = after
    return
  }
  changes.push({ kind, path, before, after })
}

function fitSessionToTarget(
  session: WorkoutSession,
  targetSeconds: number,
  changes: SessionAdaptationChange[],
): void {
  let guard = 0
  while (estimateRunnableSessionSeconds(session) > targetSeconds && guard < 10_000) {
    guard += 1
    const entries = allExercises(session)

    const roundCandidate = [...entries]
      .reverse()
      .find(({ exercise }) => exercise.intervals.rounds > 1)
    if (roundCandidate) {
      const before = roundCandidate.exercise.intervals.rounds
      roundCandidate.exercise.intervals.rounds -= 1
      addChange(
        changes,
        'rounds',
        `blocks.${roundCandidate.blockIndex}.exercises.${roundCandidate.exerciseIndex}.intervals.rounds`,
        before,
        roundCandidate.exercise.intervals.rounds,
      )
      continue
    }

    const restCandidate = [...entries]
      .reverse()
      .find(({ exercise }) => exercise.restAfterSec > 0 || exercise.intervals.rest > 0)
    if (restCandidate) {
      if (restCandidate.exercise.restAfterSec > 0) {
        const before = restCandidate.exercise.restAfterSec
        restCandidate.exercise.restAfterSec = Math.max(0, before - 5)
        addChange(
          changes,
          'rest',
          `blocks.${restCandidate.blockIndex}.exercises.${restCandidate.exerciseIndex}.restAfterSec`,
          before,
          restCandidate.exercise.restAfterSec,
        )
      } else {
        const before = restCandidate.exercise.intervals.rest
        restCandidate.exercise.intervals.rest = Math.max(0, before - 5)
        addChange(
          changes,
          'rest',
          `blocks.${restCandidate.blockIndex}.exercises.${restCandidate.exerciseIndex}.intervals.rest`,
          before,
          restCandidate.exercise.intervals.rest,
        )
      }
      continue
    }

    const workCandidate = [...entries].reverse().find(({ exercise }) => exercise.intervals.work > 5)
    if (workCandidate) {
      const before = workCandidate.exercise.intervals.work
      workCandidate.exercise.intervals.work = Math.max(5, before - 5)
      addChange(
        changes,
        'work',
        `blocks.${workCandidate.blockIndex}.exercises.${workCandidate.exerciseIndex}.intervals.work`,
        before,
        workCandidate.exercise.intervals.work,
      )
      continue
    }

    const removableBlockIndex = session.blocks.findIndex(
      (block, index) => index > 0 && index < session.blocks.length - 1,
    )
    if (removableBlockIndex >= 0) {
      const [removed] = session.blocks.splice(removableBlockIndex, 1)
      changes.push({
        kind: 'duration',
        path: `blocks.${removableBlockIndex}`,
        before: removed?.type ?? 'block',
        after: null,
      })
      continue
    }
    break
  }
}

/**
 * Applique les règles sans horloge, base, réseau ni aléatoire. La frontière `cursor` est stricte :
 * l'exercice courant et tout ce qui le précède restent bit pour bit inchangés.
 */
export function adaptWorkoutSession(
  session: WorkoutSession,
  input: RuleInput,
): SessionAdaptationResult {
  const original = structuredClone(session)
  const adapted = structuredClone(session)
  const cursor = input.cursor ?? null
  const beforeDurationSec = estimateRunnableSessionSeconds(original)
  const beforeIntensity = input.currentIntensity ?? BASE_INTENSITY[session.category]
  const constraints = deriveConstraints(original, input)
  const changes: SessionAdaptationChange[] = []

  adapted.blocks.forEach((block, blockIndex) => {
    block.exercises.forEach((exercise, exerciseIndex) => {
      if (!isAfterCursor(blockIndex, exerciseIndex, cursor)) return
      const basePath = `blocks.${blockIndex}.exercises.${exerciseIndex}`
      const identity = exercisePreferenceIdentity(exercise, block.type)
      if (constraints.prohibitedMovementFamilies.includes(identity.movementFamily)) {
        const replacement = safeReplacement(exercise)
        addChange(changes, 'substitution', basePath, identity.movementFamily, 'respiration')
        block.exercises[exerciseIndex] = replacement
        exercise = replacement
      }

      const beforeWork = exercise.intervals.work
      exercise.intervals.work = clamp(roundToFive(beforeWork * constraints.workScale), 5, 900)
      addChange(changes, 'work', `${basePath}.intervals.work`, beforeWork, exercise.intervals.work)

      const beforeRest = exercise.intervals.rest
      exercise.intervals.rest = clamp(roundToFive(beforeRest * constraints.restScale), 0, 600)
      addChange(changes, 'rest', `${basePath}.intervals.rest`, beforeRest, exercise.intervals.rest)

      const beforeRestAfter = exercise.restAfterSec
      exercise.restAfterSec = clamp(roundToFive(beforeRestAfter * constraints.restScale), 0, 300)
      addChange(changes, 'rest', `${basePath}.restAfterSec`, beforeRestAfter, exercise.restAfterSec)

      const beforeRounds = exercise.intervals.rounds
      exercise.intervals.rounds = clamp(beforeRounds + constraints.roundDelta, 1, 30)
      addChange(
        changes,
        'rounds',
        `${basePath}.intervals.rounds`,
        beforeRounds,
        exercise.intervals.rounds,
      )

      if (exercise.combo) {
        const punches = exercise.combo.split('-')
        if (punches.length > constraints.maxComboLength) {
          const beforeCombo = exercise.combo
          exercise.combo = punches.slice(0, constraints.maxComboLength).join('-')
          exercise.comboExplanation = `Combo simplifié : ${exercise.combo}.`
          addChange(changes, 'complexity', `${basePath}.combo`, beforeCombo, exercise.combo)
        }
      }
    })
  })

  if (!cursor && estimateRunnableSessionSeconds(adapted) > constraints.targetSeconds) {
    fitSessionToTarget(adapted, constraints.targetSeconds, changes)
  }

  const afterDurationSec = estimateRunnableSessionSeconds(adapted)
  adapted.estimatedDurationMin = clamp(Math.ceil(afterDurationSec / 60), 10, 90)
  addChange(
    changes,
    'duration',
    'estimatedDurationMin',
    original.estimatedDurationMin,
    adapted.estimatedDurationMin,
  )
  addChange(changes, 'intensity', 'intensity', beforeIntensity, constraints.intensity)

  return {
    session: adapted,
    trace: {
      ruleVersion: SESSION_AUTOREGULATION_VERSION,
      cause: input.cause,
      cursor,
      beforeDurationSec,
      afterDurationSec,
      beforeIntensity,
      afterIntensity: constraints.intensity,
      constraints,
      changes,
      safetyNotice:
        input.cause === 'pain' || (input.checkIn?.painLocations.length ?? 0) > 0
          ? PAIN_SAFETY_NOTICE
          : null,
    },
  }
}
