import type { WorkoutSession } from '../../shared/session-schema'
import type { PolicyAdapter, PolicyEvaluation } from '../types'

interface Issue1PolicyViolation {
  code: string
  path: string
  details?: Record<string, string | number | boolean>
}

interface Issue1PolicyModule {
  validateSessionPolicy(
    session: WorkoutSession,
    request: {
      targetDurationMin: number
      requestedCategory?: string | null
      requestedFocus?: string | null
      hasCustomFocus?: boolean
    },
  ): { violations: readonly Issue1PolicyViolation[] }
}

// Import volontairement dynamique : la branche #5 reste isolée tant que #1 n'est pas
// fusionnée. Après rebase sur #1, ce même adaptateur se raccorde sans recopier ses règles.
const ISSUE_1_POLICY_MODULE = '../../shared/session-policy.ts'
let modulePromise: Promise<Issue1PolicyModule | null> | undefined

function loadIssue1Policy(): Promise<Issue1PolicyModule | null> {
  modulePromise ??= import(ISSUE_1_POLICY_MODULE)
    .then((loaded: Record<string, unknown>) => {
      if (typeof loaded.validateSessionPolicy !== 'function') return null
      return loaded as unknown as Issue1PolicyModule
    })
    .catch(() => null)
  return modulePromise
}

/** Adaptateur aligné sur l'API publiée par la branche #1, commit d045301. */
export const policyAdapter: PolicyAdapter = {
  id: 'issue-1-session-policy',
  version: 'session-policy/v1',
  async evaluate({ evaluationCase, session }): Promise<PolicyEvaluation> {
    const policy = await loadIssue1Policy()
    if (!policy) {
      return {
        status: 'unavailable',
        reason: "Le module shared/session-policy.ts de l'issue #1 n'est pas encore intégré.",
        violations: [],
      }
    }

    const request = evaluationCase.context.request
    const result = policy.validateSessionPolicy(session, {
      targetDurationMin: evaluationCase.context.targetDurationMin,
      requestedCategory: request?.category,
      requestedFocus: request?.focus,
      hasCustomFocus: Boolean(request?.customFocus),
    })

    return {
      status: 'evaluated',
      violations: result.violations.map((violation) => ({
        code: violation.code,
        message: violation.code,
        blocking: true,
        path: violation.path,
        ...(violation.details ? { details: violation.details } : {}),
      })),
    }
  },
}

export default policyAdapter
