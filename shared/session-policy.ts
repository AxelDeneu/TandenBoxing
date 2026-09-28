import {
  estimateExerciseSeconds,
  estimateSessionSeconds,
  type SessionCategory,
  type WorkoutFocus,
  type WorkoutSession,
} from './session-schema'
import { matchingStrictExclusion, type ExercisePreferenceConstraints } from './exercise-preferences'
import { assessExerciseEquipment, type TrainingEquipment } from './profile-personalization'
import type { BlockBudgets } from './workout-prescription'

export const SESSION_POLICY_VERSION = 'session-policy/v3'

/** Une séance générée doit remplir au moins 90 % de la durée demandée. */
export const MIN_TARGET_DURATION_RATIO = 0.9

export type SessionPolicyViolationCode =
  | 'FIRST_BLOCK_MUST_BE_WARMUP'
  | 'LAST_BLOCK_MUST_BE_COOLDOWN'
  | 'DURATION_BELOW_MINIMUM'
  | 'DURATION_EXCEEDS_TARGET'
  | 'CATEGORY_MISMATCH'
  | 'FOCUS_MISMATCH'
  | 'INVALID_COMBO_NOTATION'
  | 'STRICT_EXERCISE_EXCLUSION'
  | 'RECOVERY_HIGH_INTENSITY'
  | 'CATEGORY_PROFILE_MISMATCH'
  | 'BLOCK_BUDGET_MISMATCH'
  | 'UNAVAILABLE_EQUIPMENT'
  | 'UNSUPPORTED_EQUIPMENT'
  | 'UNSAFE_EQUIPMENT_USE'

export interface SessionPolicyViolation {
  code: SessionPolicyViolationCode
  path: string
  /** Données bornées (enum/nombres), sûres à journaliser sans texte libre utilisateur. */
  details?: Record<string, string | number | boolean>
}

export interface SessionPolicyRequest {
  targetDurationMin: number
  requestedCategory?: SessionCategory | null
  requestedFocus?: WorkoutFocus | null
  /** Un thème libre doit être mappé par l'IA vers l'enum, pas comparé à requestedFocus. */
  hasCustomFocus?: boolean
  /** Seules les exclusions strictes sont bloquantes ; les scores pondérés restent consultatifs. */
  exercisePreferences?: ExercisePreferenceConstraints
  /** Inventaire fermé et autoritaire issu du profil. Le poids du corps reste toujours disponible. */
  availableEquipment?: readonly TrainingEquipment[]
  /** Budgets du planner, y compris l'accent mesurable choisi par l'objectif. */
  prescribedBlockBudgets?: BlockBudgets
}

export interface SessionPolicyResult {
  valid: boolean
  durationSeconds: number
  minimumDurationSeconds: number
  targetDurationSeconds: number
  violations: SessionPolicyViolation[]
}

/**
 * Profils minimaux calculés sur le cœur de séance (hors échauffement et retour au calme).
 * Ils traduisent les intentions produit en seuils vérifiables, sans imposer un plan unique :
 * - apprentissage : au moins 50 % de technique ;
 * - renforcement : au moins 35 % de renforcement ;
 * - enchaînement : au moins 25 % de technique et 25 % de cardio ;
 * - cardio : au moins 50 % de cardio ;
 * - récupération : un cœur non vide, sans segment structurellement haute intensité.
 */
export const CATEGORY_PROFILE_MINIMUMS = {
  apprentissage: { technique: 0.5 },
  renforcement: { renforcement: 0.35 },
  enchainement: { technique: 0.25, cardio: 0.25 },
  cardio: { cardio: 0.5 },
  recuperation: {},
} as const satisfies Record<SessionCategory, Partial<Record<string, number>>>

const COMBO_PATTERN = /^[1-6](?:-[1-6])*$/
/** Proxy vérifiable de haute intensité, appliqué au cœur de séance (pas aux blocs de bord). */
const HIGH_INTENSITY_CATEGORIES = new Set(['cardio', 'renforcement'])

function blockSeconds(session: WorkoutSession, blockIndex: number): number {
  return session.blocks[blockIndex]!.exercises.reduce(
    (total, exercise) => total + estimateExerciseSeconds(exercise),
    0,
  )
}

function validateCategoryProfile(
  session: WorkoutSession,
  violations: SessionPolicyViolation[],
): void {
  const coreBlocks = session.blocks.slice(1, -1)
  const coreDuration = coreBlocks.reduce(
    (total, _block, index) => total + blockSeconds(session, index + 1),
    0,
  )

  if (session.category === 'recuperation') {
    for (let blockIndex = 0; blockIndex < session.blocks.length; blockIndex += 1) {
      const block = session.blocks[blockIndex]!
      const isBoundaryBlock = block.type === 'echauffement' || block.type === 'retour_au_calme'
      if (HIGH_INTENSITY_CATEGORIES.has(block.type)) {
        violations.push({
          code: 'RECOVERY_HIGH_INTENSITY',
          path: `blocks.${blockIndex}.type`,
          details: { segmentCategory: block.type },
        })
      }
      block.exercises.forEach((exercise, exerciseIndex) => {
        if (!isBoundaryBlock && HIGH_INTENSITY_CATEGORIES.has(exercise.category)) {
          violations.push({
            code: 'RECOVERY_HIGH_INTENSITY',
            path: `blocks.${blockIndex}.exercises.${exerciseIndex}.category`,
            details: { segmentCategory: exercise.category },
          })
        }
      })
    }
    if (coreDuration <= 0) {
      violations.push({
        code: 'CATEGORY_PROFILE_MISMATCH',
        path: 'blocks',
        details: { category: session.category, reason: 'empty_core' },
      })
    }
    return
  }

  if (coreDuration <= 0) {
    violations.push({
      code: 'CATEGORY_PROFILE_MISMATCH',
      path: 'blocks',
      details: { category: session.category, reason: 'empty_core' },
    })
    return
  }

  const minimums = CATEGORY_PROFILE_MINIMUMS[session.category]
  for (const [blockType, minimumShare] of Object.entries(minimums)) {
    const matchingDuration = coreBlocks.reduce((total, block, index) => {
      return block.type === blockType ? total + blockSeconds(session, index + 1) : total
    }, 0)
    const actualShare = matchingDuration / coreDuration
    if (actualShare < minimumShare) {
      violations.push({
        code: 'CATEGORY_PROFILE_MISMATCH',
        path: 'blocks',
        details: {
          category: session.category,
          requiredBlockType: blockType,
          minimumPercent: Math.round(minimumShare * 100),
          actualPercent: Math.round(actualShare * 100),
        },
      })
    }
  }
}

function validateBlockBudgets(
  session: WorkoutSession,
  budgets: BlockBudgets | undefined,
  violations: SessionPolicyViolation[],
): void {
  if (!budgets) return
  const actual = Object.fromEntries(Object.keys(budgets).map((type) => [type, 0])) as Record<
    keyof BlockBudgets,
    number
  >
  session.blocks.forEach((block, index) => {
    actual[block.type] += blockSeconds(session, index)
  })
  for (const [type, expectedSeconds] of Object.entries(budgets) as Array<
    [keyof BlockBudgets, number]
  >) {
    const actualSeconds = actual[type]
    const minimumSeconds = expectedSeconds ? Math.floor(expectedSeconds * 0.9) : 0
    if (
      (expectedSeconds === 0 && actualSeconds > 0) ||
      actualSeconds < minimumSeconds ||
      actualSeconds > expectedSeconds
    ) {
      violations.push({
        code: 'BLOCK_BUDGET_MISMATCH',
        path: 'blocks',
        details: { blockType: type, expectedSeconds, minimumSeconds, actualSeconds },
      })
    }
  }
}

function validateEquipment(
  session: WorkoutSession,
  availableEquipment: readonly TrainingEquipment[] | undefined,
  violations: SessionPolicyViolation[],
): void {
  if (!availableEquipment) return
  const available = new Set(availableEquipment)
  session.blocks.forEach((block, blockIndex) => {
    block.exercises.forEach((exercise, exerciseIndex) => {
      const compatibility = assessExerciseEquipment(exercise, block.type, [...available])
      for (const missing of compatibility.missing) {
        violations.push({
          code: 'UNAVAILABLE_EQUIPMENT',
          path: `blocks.${blockIndex}.exercises.${exerciseIndex}`,
          details: { equipment: missing },
        })
      }
      for (const unsupported of compatibility.unsupported) {
        violations.push({
          code: 'UNSUPPORTED_EQUIPMENT',
          path: `blocks.${blockIndex}.exercises.${exerciseIndex}`,
          details: { equipment: unsupported },
        })
      }

      if (compatibility.unsafe.length) {
        violations.push({
          code: 'UNSAFE_EQUIPMENT_USE',
          path: `blocks.${blockIndex}.exercises.${exerciseIndex}`,
          details: { blockType: block.type, equipment: compatibility.unsafe[0]! },
        })
      }
    })
  })
}

/** Valide les invariants métier appliqués uniquement aux nouvelles sorties de génération. */
export function validateSessionPolicy(
  session: WorkoutSession,
  request: SessionPolicyRequest,
): SessionPolicyResult {
  const violations: SessionPolicyViolation[] = []
  const durationSeconds = estimateSessionSeconds(session)
  const targetDurationSeconds = request.targetDurationMin * 60
  const minimumDurationSeconds = Math.ceil(targetDurationSeconds * MIN_TARGET_DURATION_RATIO)

  if (session.blocks[0]?.type !== 'echauffement') {
    violations.push({
      code: 'FIRST_BLOCK_MUST_BE_WARMUP',
      path: 'blocks.0.type',
      details: { expected: 'echauffement', actual: session.blocks[0]?.type ?? 'missing' },
    })
  }

  const lastBlockIndex = session.blocks.length - 1
  if (session.blocks[lastBlockIndex]?.type !== 'retour_au_calme') {
    violations.push({
      code: 'LAST_BLOCK_MUST_BE_COOLDOWN',
      path: `blocks.${Math.max(0, lastBlockIndex)}.type`,
      details: {
        expected: 'retour_au_calme',
        actual: session.blocks[lastBlockIndex]?.type ?? 'missing',
      },
    })
  }

  if (durationSeconds < minimumDurationSeconds) {
    violations.push({
      code: 'DURATION_BELOW_MINIMUM',
      path: 'blocks',
      details: { durationSeconds, minimumDurationSeconds, targetDurationSeconds },
    })
  }
  if (durationSeconds > targetDurationSeconds) {
    violations.push({
      code: 'DURATION_EXCEEDS_TARGET',
      path: 'blocks',
      details: { durationSeconds, targetDurationSeconds },
    })
  }

  if (request.requestedCategory && session.category !== request.requestedCategory) {
    violations.push({
      code: 'CATEGORY_MISMATCH',
      path: 'category',
      details: { expected: request.requestedCategory, actual: session.category },
    })
  }
  if (
    request.requestedFocus &&
    !request.hasCustomFocus &&
    session.focus !== request.requestedFocus
  ) {
    violations.push({
      code: 'FOCUS_MISMATCH',
      path: 'focus',
      details: { expected: request.requestedFocus, actual: session.focus },
    })
  }

  session.blocks.forEach((block, blockIndex) => {
    block.exercises.forEach((exercise, exerciseIndex) => {
      const strictExclusion = matchingStrictExclusion(
        exercise,
        block.type,
        request.exercisePreferences,
      )
      if (strictExclusion) {
        violations.push({
          code: 'STRICT_EXERCISE_EXCLUSION',
          path: `blocks.${blockIndex}.exercises.${exerciseIndex}`,
          // La portée suffit au diagnostic ; aucun motif de santé ou nom libre n'est journalisé.
          details: { scope: strictExclusion.scope },
        })
      }
      if (exercise.combo !== null && !COMBO_PATTERN.test(exercise.combo)) {
        violations.push({
          code: 'INVALID_COMBO_NOTATION',
          path: `blocks.${blockIndex}.exercises.${exerciseIndex}.combo`,
          details: { expectedPattern: '^[1-6](?:-[1-6])*$' },
        })
      }
    })
  })

  validateBlockBudgets(session, request.prescribedBlockBudgets, violations)
  validateEquipment(session, request.availableEquipment, violations)
  validateCategoryProfile(session, violations)

  return {
    valid: violations.length === 0,
    durationSeconds,
    minimumDurationSeconds,
    targetDurationSeconds,
    violations,
  }
}
