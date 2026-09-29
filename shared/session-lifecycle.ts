export const SESSION_STATUSES = [
  'planned',
  'generated',
  'in_progress',
  'completed',
  'skipped',
] as const

export type SessionStatus = (typeof SESSION_STATUSES)[number]
export type SessionLifecycleEvent = 'start' | 'finish' | 'skip'

export type SessionTransitionOutcome =
  | { kind: 'transition'; status: SessionStatus }
  | { kind: 'idempotent'; status: SessionStatus }
  | { kind: 'rejected'; status: SessionStatus }

export function isTerminalSessionStatus(status: string): status is 'completed' | 'skipped' {
  return status === 'completed' || status === 'skipped'
}

/**
 * Source de vérité pure du cycle d'exécution. Les répétitions du même événement sont des no-op ;
 * aucun événement ne permet de sortir d'un état terminal.
 */
export function resolveSessionTransition(
  status: SessionStatus,
  event: SessionLifecycleEvent,
): SessionTransitionOutcome {
  if (event === 'start') {
    if (status === 'generated') return { kind: 'transition', status: 'in_progress' }
    if (status === 'in_progress' || status === 'completed') {
      return { kind: 'idempotent', status }
    }
    return { kind: 'rejected', status }
  }

  if (event === 'finish') {
    if (status === 'in_progress') return { kind: 'transition', status: 'completed' }
    if (status === 'completed') return { kind: 'idempotent', status }
    return { kind: 'rejected', status }
  }

  if (status === 'generated' || status === 'in_progress') {
    return { kind: 'transition', status: 'skipped' }
  }
  if (status === 'skipped') return { kind: 'idempotent', status }
  return { kind: 'rejected', status }
}

export function canRewriteGeneratedSession(status: string): boolean {
  return status === 'generated'
}
