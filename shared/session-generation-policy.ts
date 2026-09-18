import { workoutSessionSchema, type WorkoutSession } from './session-schema'
import { validateSessionPolicy, type SessionPolicyRequest } from './session-policy'

export interface GeneratedSessionViolation {
  code: string
  path: string
  details?: Record<string, string | number | boolean>
}

export type GenerationValidationAttempt = 'initial' | 'corrected'

export interface ResolveGeneratedSessionOptions {
  policy: SessionPolicyRequest
  correct: (
    candidate: unknown,
    violations: readonly GeneratedSessionViolation[],
  ) => Promise<unknown>
  onInvalid?: (
    attempt: GenerationValidationAttempt,
    violations: readonly GeneratedSessionViolation[],
  ) => void
}

interface CandidateInspection {
  session: WorkoutSession | null
  violations: GeneratedSessionViolation[]
}

export class GeneratedSessionValidationError extends Error {
  readonly violations: readonly GeneratedSessionViolation[]

  constructor(violations: readonly GeneratedSessionViolation[]) {
    super('Generated session is still invalid after one correction attempt.')
    this.name = 'GeneratedSessionValidationError'
    this.violations = violations
  }
}

function schemaViolations(candidate: unknown): CandidateInspection {
  const parsed = workoutSessionSchema.safeParse(candidate)
  if (!parsed.success) {
    return {
      session: null,
      violations: parsed.error.issues.map((issue) => ({
        code: 'SCHEMA_INVALID',
        path: issue.path.join('.'),
        details: { schemaCode: issue.code },
      })),
    }
  }

  return { session: parsed.data, violations: [] }
}

function inspectCandidate(candidate: unknown, policy: SessionPolicyRequest): CandidateInspection {
  const schemaInspection = schemaViolations(candidate)
  if (!schemaInspection.session) return schemaInspection

  const policyResult = validateSessionPolicy(schemaInspection.session, policy)
  return {
    session: policyResult.valid ? schemaInspection.session : null,
    violations: policyResult.violations,
  }
}

/**
 * Résout une sortie modèle avec au maximum une correction. Aucune persistance n'a lieu ici :
 * l'appelant ne reçoit une séance que lorsque le schéma et toutes les règles métier passent.
 */
export async function resolveGeneratedSession(
  candidate: unknown,
  options: ResolveGeneratedSessionOptions,
): Promise<WorkoutSession> {
  const initial = inspectCandidate(candidate, options.policy)
  if (initial.session) return initial.session

  options.onInvalid?.('initial', initial.violations)
  const correctedCandidate = await options.correct(candidate, initial.violations)
  const corrected = inspectCandidate(correctedCandidate, options.policy)
  if (corrected.session) return corrected.session

  options.onInvalid?.('corrected', corrected.violations)
  throw new GeneratedSessionValidationError(corrected.violations)
}
