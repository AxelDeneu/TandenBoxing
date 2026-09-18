import { estimateSessionSeconds, type WorkoutSession } from '../shared/session-schema'
import type {
  BlockDiversityMetric,
  DurationMetric,
  EvaluationCase,
  ExerciseOverlapMetric,
  FidelityMetric,
  ProgressionCheck,
  ProgressionMetric,
} from './types'

const WARMUP_COOLDOWN_TYPES = new Set(['echauffement', 'retour_au_calme'])

function round(value: number): number {
  return Math.round(value * 10_000) / 10_000
}

function normalizeExerciseName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('fr')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function exerciseNames(session: WorkoutSession, scope: 'main' | 'warmup-cooldown'): Set<string> {
  return new Set(
    session.blocks
      .filter((block) =>
        scope === 'warmup-cooldown'
          ? WARMUP_COOLDOWN_TYPES.has(block.type)
          : !WARMUP_COOLDOWN_TYPES.has(block.type),
      )
      .flatMap((block) => block.exercises)
      .map((exercise) => normalizeExerciseName(exercise.name)),
  )
}

function jaccard(left: Set<string>, right: Set<string>): number {
  const union = new Set([...left, ...right])
  if (union.size === 0) return 0
  let intersection = 0
  for (const item of left) {
    if (right.has(item)) intersection += 1
  }
  return round(intersection / union.size)
}

function sessionCombos(session: WorkoutSession): string[] {
  return session.blocks
    .flatMap((block) => block.exercises)
    .map((exercise) => exercise.combo)
    .filter((combo): combo is string => Boolean(combo))
}

export function calculateDurationMetric(
  session: WorkoutSession,
  targetDurationMin: number,
): DurationMetric {
  const targetSeconds = targetDurationMin * 60
  const actualSeconds = estimateSessionSeconds(session)
  const errorSeconds = actualSeconds - targetSeconds
  return {
    targetSeconds,
    actualSeconds,
    errorSeconds,
    absoluteErrorSeconds: Math.abs(errorSeconds),
    overrunSeconds: Math.max(0, errorSeconds),
  }
}

export function calculateFidelityMetric(
  session: WorkoutSession,
  evaluationCase: EvaluationCase,
): FidelityMetric {
  return {
    category: session.category === evaluationCase.expected.category,
    focus: session.focus === evaluationCase.expected.focus,
  }
}

export function calculateExerciseOverlap(
  session: WorkoutSession,
  previous: { caseId: string; session: WorkoutSession } | null,
): ExerciseOverlapMetric {
  if (!previous) {
    return { comparedWithCaseId: null, main: null, warmupCooldown: null }
  }
  return {
    comparedWithCaseId: previous.caseId,
    main: jaccard(exerciseNames(session, 'main'), exerciseNames(previous.session, 'main')),
    warmupCooldown: jaccard(
      exerciseNames(session, 'warmup-cooldown'),
      exerciseNames(previous.session, 'warmup-cooldown'),
    ),
  }
}

export function calculateBlockDiversity(session: WorkoutSession): BlockDiversityMetric {
  const distinctBlockTypes = new Set(session.blocks.map((block) => block.type)).size
  const totalBlocks = session.blocks.length
  return {
    distinctBlockTypes,
    totalBlocks,
    distinctBlockTypeRatio: round(distinctBlockTypes / totalBlocks),
    pattern: session.blocks.map((block) => block.type).join('>'),
  }
}

export function calculateProgressionMetric(
  evaluationCase: EvaluationCase,
  session: WorkoutSession,
  previousSessions: readonly WorkoutSession[],
): ProgressionMetric {
  const expectation = evaluationCase.expected.progression
  if (!expectation) return { applicable: false, passed: null, checks: [] }

  const checks: ProgressionCheck[] = []
  const combos = sessionCombos(session)

  if (expectation.requiredPreviousCombos) {
    const previousCombos = new Set(previousSessions.flatMap(sessionCombos))
    const missing = expectation.requiredPreviousCombos.filter((combo) => !previousCombos.has(combo))
    checks.push({
      name: 'prerequisites',
      passed: missing.length === 0,
      expected: expectation.requiredPreviousCombos.join(', '),
      actual: missing.length === 0 ? 'tous présents' : `manquants: ${missing.join(', ')}`,
    })
  }

  if (expectation.maxComboLength != null) {
    const actual = combos.reduce((max, combo) => Math.max(max, combo.split('-').length), 0)
    checks.push({
      name: 'combo-complexity',
      passed: actual <= expectation.maxComboLength,
      expected: `≤ ${expectation.maxComboLength} coups`,
      actual: `${actual} coups`,
    })
  }

  if (expectation.maxWorkIntervalSec != null) {
    const actual = Math.max(
      ...session.blocks.flatMap((block) =>
        block.exercises.map((exercise) => exercise.intervals.work),
      ),
    )
    checks.push({
      name: 'fatigue-work-interval',
      passed: actual <= expectation.maxWorkIntervalSec,
      expected: `≤ ${expectation.maxWorkIntervalSec} s`,
      actual: `${actual} s`,
    })
  }

  if (expectation.allowedCategories) {
    checks.push({
      name: 'fatigue-category',
      passed: expectation.allowedCategories.includes(session.category),
      expected: expectation.allowedCategories.join(', '),
      actual: session.category,
    })
  }

  return {
    applicable: true,
    passed: checks.every((check) => check.passed),
    checks,
  }
}
