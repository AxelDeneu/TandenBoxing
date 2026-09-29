import { describe, expect, it } from 'vitest'
import {
  resolveSessionTransition,
  type SessionLifecycleEvent,
  type SessionStatus,
} from '../shared/session-lifecycle'

const statuses: SessionStatus[] = ['planned', 'generated', 'in_progress', 'completed', 'skipped']
const events: SessionLifecycleEvent[] = ['start', 'finish', 'skip']

describe("machine d'état des séances", () => {
  const expected = {
    planned: ['rejected', 'rejected', 'rejected'],
    generated: ['transition', 'rejected', 'transition'],
    in_progress: ['idempotent', 'transition', 'transition'],
    completed: ['idempotent', 'idempotent', 'rejected'],
    skipped: ['rejected', 'rejected', 'idempotent'],
  } as const

  it.each(statuses)('définit toutes les opérations autorisées ou refusées depuis %s', (status) => {
    expect(events.map((event) => resolveSessionTransition(status, event).kind)).toEqual(
      expected[status],
    )
  })

  it('respecte uniquement generated → in_progress → completed et les clôtures skipped', () => {
    expect(resolveSessionTransition('generated', 'start')).toEqual({
      kind: 'transition',
      status: 'in_progress',
    })
    expect(resolveSessionTransition('in_progress', 'finish')).toEqual({
      kind: 'transition',
      status: 'completed',
    })
    expect(resolveSessionTransition('generated', 'skip')).toEqual({
      kind: 'transition',
      status: 'skipped',
    })
  })
})
