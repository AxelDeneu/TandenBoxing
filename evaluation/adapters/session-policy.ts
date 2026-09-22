import { SESSION_POLICY_VERSION, validateSessionPolicy } from '../../shared/session-policy'
import { createPolicyAdapter } from '../policy-adapter'

/** Adaptateur direct de la politique active ; aucune règle métier n'est dupliquée ici. */
export const policyAdapter = createPolicyAdapter({
  id: 'session-policy',
  version: SESSION_POLICY_VERSION,
  validate: ({ evaluationCase, session }) => {
    const request = evaluationCase.context.request
    return validateSessionPolicy(session, {
      targetDurationMin: evaluationCase.context.targetDurationMin,
      requestedCategory: request?.category,
      requestedFocus: request?.focus,
      hasCustomFocus: Boolean(request?.customFocus),
    }).violations.map((violation) => ({ ...violation, message: violation.code }))
  },
  isBlocking: () => true,
})

export default policyAdapter
