import { describe, expect, it } from 'vitest'
import { buildTimerPhases } from '../shared/timer'
import type { WorkoutSession } from '../shared/session-schema'

const session = {
  title: 't',
  focus: 'cardio',
  summary: 's',
  coachNote: 'c',
  estimatedDurationMin: 5,
  blocks: [
    {
      type: 'cardio',
      title: 'Cardio',
      description: 'd',
      exercises: [
        {
          name: 'A',
          category: 'cardio',
          explanation: 'x',
          tips: [],
          commonMistakes: [],
          combo: '1-2',
          comboExplanation: null,
          intervals: { work: 20, rest: 10, rounds: 3 },
          restAfterSec: 30,
        },
      ],
    },
  ],
} as unknown as WorkoutSession

describe('buildTimerPhases', () => {
  const phases = buildTimerPhases(session)

  it('commence par une phase de préparation de 10 s', () => {
    expect(phases[0]!.kind).toBe('prepare')
    expect(phases[0]!.seconds).toBe(10)
  })

  it('génère rounds phases d’effort et (rounds - 1) phases de repos', () => {
    expect(phases.filter((p) => p.kind === 'work').length).toBe(3)
    expect(phases.filter((p) => p.kind === 'rest').length).toBe(2)
  })

  it('numérote les rounds', () => {
    const work = phases.filter((p) => p.kind === 'work')
    expect(work.map((p) => p.round)).toEqual([1, 2, 3])
    expect(work[0]!.totalRounds).toBe(3)
  })

  it('ne laisse pas de repos traînant en fin de séance', () => {
    expect(phases[phases.length - 1]!.kind).not.toBe('rest')
  })

  it('inclut le combo décodé dans le sous-titre', () => {
    const work = phases.find((p) => p.kind === 'work')!
    expect(work.sublabel).toContain('jab → cross')
  })
})
