import { describe, expect, it } from 'vitest'
import {
  comboToText,
  estimateExerciseSeconds,
  estimateSessionSeconds,
  workoutSessionSchema,
  type WorkoutSession,
} from '../shared/session-schema'

const exercise = {
  name: 'Rafales',
  category: 'cardio' as const,
  explanation: 'x',
  tips: [],
  commonMistakes: [],
  combo: null,
  comboExplanation: null,
  intervals: { work: 20, rest: 10, rounds: 8 },
  restAfterSec: 60,
}

describe('estimateExerciseSeconds', () => {
  it('compte rounds*work + (rounds-1)*rest + restAfterSec', () => {
    expect(estimateExerciseSeconds(exercise)).toBe(8 * 20 + 7 * 10 + 60) // 290
  })

  it('gère un exercice sans repos', () => {
    expect(
      estimateExerciseSeconds({ intervals: { work: 60, rest: 0, rounds: 3 }, restAfterSec: 0 }),
    ).toBe(180)
  })
})

describe('estimateSessionSeconds', () => {
  it('somme tous les exercices de tous les blocs', () => {
    const session = {
      title: 't',
      focus: 'cardio',
      summary: 's',
      coachNote: 'c',
      estimatedDurationMin: 10,
      blocks: [{ type: 'cardio', title: 'b', description: 'd', exercises: [exercise, exercise] }],
    } as unknown as WorkoutSession
    expect(estimateSessionSeconds(session)).toBe(290 * 2)
  })
})

describe('comboToText', () => {
  it('traduit les combos numérotés', () => {
    expect(comboToText('1-2')).toBe('jab → cross')
    expect(comboToText('1-1-2')).toBe('jab → jab → cross')
    expect(comboToText('5-6')).toBe('uppercut avant → uppercut arrière')
  })
})

describe('workoutSessionSchema', () => {
  const valid = {
    title: 't',
    focus: 'cardio',
    summary: 's',
    coachNote: 'c',
    estimatedDurationMin: 40,
    blocks: [
      {
        type: 'cardio',
        title: 'b',
        description: 'd',
        exercises: [
          {
            name: 'e',
            category: 'cardio',
            explanation: 'x',
            intervals: { work: 20, rest: 10, rounds: 8 },
          },
        ],
      },
    ],
  }

  it('accepte une séance valide et applique les valeurs par défaut', () => {
    const r = workoutSessionSchema.safeParse(valid)
    expect(r.success).toBe(true)
    if (r.success) {
      const ex = r.data.blocks[0]!.exercises[0]!
      expect(ex.tips).toEqual([])
      expect(ex.commonMistakes).toEqual([])
      expect(ex.restAfterSec).toBe(30)
      expect(ex.combo).toBeNull()
    }
  })

  it('rejette une séance sans bloc', () => {
    expect(workoutSessionSchema.safeParse({ ...valid, blocks: [] }).success).toBe(false)
  })

  it('rejette un focus invalide', () => {
    expect(workoutSessionSchema.safeParse({ ...valid, focus: 'xxx' }).success).toBe(false)
  })

  it('rejette des intervalles hors bornes (work < 5)', () => {
    const bad = {
      ...valid,
      blocks: [
        {
          type: 'cardio',
          title: 'b',
          description: 'd',
          exercises: [
            {
              name: 'e',
              category: 'cardio',
              explanation: 'x',
              intervals: { work: 0, rest: 10, rounds: 8 },
            },
          ],
        },
      ],
    }
    expect(workoutSessionSchema.safeParse(bad).success).toBe(false)
  })
})
