import type { PolicyAdapter, PolicyAdapterInput, PolicyEvaluation, PolicyViolation } from './types'

export interface SourcePolicyViolation {
  code: string
  message: string
  path?: string
  details?: Readonly<Record<string, unknown>>
}

/**
 * Adapte le validateur livré par #1 sans recopier aucune règle métier dans le banc.
 * Le petit module de raccord doit seulement fournir la fonction `validate` et la
 * classification des violations bloquantes exposées par #1.
 */
export function createPolicyAdapter<TViolation extends SourcePolicyViolation>(options: {
  id: string
  version: string
  validate(
    input: PolicyAdapterInput,
  ): readonly TViolation[] | Promise<readonly TViolation[]>
  isBlocking(violation: TViolation): boolean
}): PolicyAdapter {
  return {
    id: options.id,
    version: options.version,
    async evaluate(input): Promise<PolicyEvaluation> {
      const sourceViolations = await options.validate(input)
      const violations: PolicyViolation[] = sourceViolations.map((violation) => ({
        code: violation.code,
        message: violation.message,
        blocking: options.isBlocking(violation),
        ...(violation.path ? { path: violation.path } : {}),
        ...(violation.details ? { details: violation.details } : {}),
      }))
      return { status: 'evaluated', violations }
    },
  }
}

/** Politique explicite d'attente : une absence d'oracle fait échouer le seuil de conformité. */
export function createUnavailablePolicyAdapter(reason: string): PolicyAdapter {
  return {
    id: 'issue-1-policy-adapter/pending',
    version: 'issue-1/pending',
    evaluate(): PolicyEvaluation {
      return { status: 'unavailable', reason, violations: [] }
    },
  }
}

export const unavailablePolicyAdapter = createUnavailablePolicyAdapter(
  "Le validateur de l'issue #1 n'est pas encore disponible sur la branche de base.",
)
