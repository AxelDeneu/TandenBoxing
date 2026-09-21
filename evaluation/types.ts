import type { SessionCategory, WorkoutFocus, WorkoutSession } from '../shared/session-schema'
import type { GeneratorVersions } from '../shared/generator-version'

export type EvaluationTag =
  | 'beginner'
  | 'fatigue'
  | 'skipped-session'
  | 'physical-constraint'
  | 'neglected-focus'
  | 'explicit-request'
  | 'progression'

export interface SyntheticHistoryEntry {
  date: string
  category: SessionCategory
  focus: WorkoutFocus
  completed: boolean
  difficulty?: number
  energy?: number
  combos?: string[]
}

export interface EvaluationContext {
  date: string
  targetDurationMin: number
  profile: {
    level: 'debutant'
    fitnessLevel: 'sedentaire' | 'actif' | 'sportif'
    equipment: readonly string[]
    constraints: readonly string[]
  }
  request?: {
    category: SessionCategory | null
    focus: WorkoutFocus | null
    customFocus: string | null
    note: string | null
  }
  history: readonly SyntheticHistoryEntry[]
  skippedSessions: readonly {
    date: string
    reason: string
  }[]
  neglectedFocus?: WorkoutFocus
  fatigueSignal?: 'training-load' | 'difficulty' | 'low-energy' | 'skipped-for-fatigue'
}

export interface ProgressionExpectation {
  /** Combos qui doivent avoir été vus dans une étape antérieure de la même séquence. */
  requiredPreviousCombos?: readonly string[]
  /** Borne de complexité pour le cas courant (nombre de coups). */
  maxComboLength?: number
  /** Borne d'effort continu imposée par un signal de fatigue. */
  maxWorkIntervalSec?: number
  allowedCategories?: readonly SessionCategory[]
}

export interface EvaluationCase {
  id: string
  title: string
  description: string
  tags: readonly EvaluationTag[]
  context: EvaluationContext
  expected: {
    category: SessionCategory
    focus: WorkoutFocus
    progression?: ProgressionExpectation
  }
  sequence?: {
    id: string
    position: number
  }
}

export interface EvaluationCorpus {
  id: string
  description: string
  cases: readonly EvaluationCase[]
}

export interface CandidateRun {
  id: string
  description: string
  corpusId: string
  versions: GeneratorVersions
  /** Une sortie figée par identifiant de cas. Aucun appel réseau n'est effectué par le runner. */
  outputs: Readonly<Record<string, WorkoutSession>>
}

export interface PolicyAdapterInput {
  evaluationCase: EvaluationCase
  session: WorkoutSession
}

export interface PolicyViolation {
  code: string
  message: string
  blocking: boolean
  path?: string
  details?: Readonly<Record<string, unknown>>
}

export type PolicyEvaluation =
  | {
      status: 'evaluated'
      violations: readonly PolicyViolation[]
    }
  | {
      status: 'unavailable'
      reason: string
      violations: readonly []
    }

export interface PolicyAdapter {
  id: string
  version: string
  evaluate(input: PolicyAdapterInput): PolicyEvaluation | Promise<PolicyEvaluation>
}

export interface AiEvaluationResult {
  adapterId: string
  budgetUsd: number
  costUsd: number
  summary: string
  scores: Readonly<Record<string, number>>
}

export interface AiEvaluationAdapter {
  id: string
  evaluate(input: {
    corpus: EvaluationCorpus
    candidate: CandidateRun
    budgetUsd: number
  }): Promise<AiEvaluationResult>
}

export interface DurationMetric {
  targetSeconds: number
  actualSeconds: number
  errorSeconds: number
  absoluteErrorSeconds: number
  overrunSeconds: number
}

export interface FidelityMetric {
  category: boolean
  focus: boolean
}

export interface ExerciseOverlapMetric {
  comparedWithCaseId: string | null
  main: number | null
  warmupCooldown: number | null
}

export interface BlockDiversityMetric {
  distinctBlockTypes: number
  totalBlocks: number
  distinctBlockTypeRatio: number
  pattern: string
}

export interface ProgressionCheck {
  name: 'prerequisites' | 'combo-complexity' | 'fatigue-work-interval' | 'fatigue-category'
  passed: boolean
  expected: string
  actual: string
}

export interface ProgressionMetric {
  applicable: boolean
  passed: boolean | null
  checks: readonly ProgressionCheck[]
}

export interface CaseEvaluation {
  caseId: string
  title: string
  tags: readonly EvaluationTag[]
  policy: PolicyEvaluation
  duration: DurationMetric
  fidelity: FidelityMetric
  exerciseOverlap: ExerciseOverlapMetric
  blockDiversity: BlockDiversityMetric
  progression: ProgressionMetric
}

export interface BlockingThresholdResult {
  id: 'mandatory-policy-compliance' | 'duration-overrun'
  target: string
  actual: string
  passed: boolean
}

export interface GlobalMetrics {
  cases: number
  policy: {
    evaluatedCases: number
    unavailableCases: number
    compliantCases: number
    mandatoryComplianceRate: number | null
    blockingViolationCount: number
  }
  duration: {
    meanAbsoluteErrorSeconds: number
    maxAbsoluteErrorSeconds: number
    overrunCases: number
    totalOverrunSeconds: number
  }
  fidelity: {
    categoryRate: number
    focusRate: number
  }
  exerciseOverlap: {
    comparedCases: number
    meanMain: number | null
    meanWarmupCooldown: number | null
  }
  blockDiversity: {
    meanDistinctBlockTypeRatio: number
    distinctPatterns: number
  }
  progression: {
    evaluatedCases: number
    coherentCases: number
    coherenceRate: number | null
  }
}

export interface ReportComparison {
  baselineCandidateId: string
  deltas: {
    mandatoryComplianceRate: number | null
    meanAbsoluteDurationErrorSeconds: number
    categoryFidelityRate: number
    focusFidelityRate: number
    mainExerciseOverlap: number | null
    warmupCooldownExerciseOverlap: number | null
    blockDiversityRatio: number
    progressionCoherenceRate: number | null
  }
}

export interface EvaluationReport {
  reportVersion: 'generator-evaluation-report/v1'
  corpus: {
    id: string
    caseCount: number
  }
  candidate: {
    id: string
    description: string
    versions: GeneratorVersions
  }
  policyAdapter: {
    id: string
    version: string
  }
  cases: readonly CaseEvaluation[]
  global: GlobalMetrics
  thresholds: readonly BlockingThresholdResult[]
  passed: boolean
  comparison?: ReportComparison
  aiEvaluation?: AiEvaluationResult
}
