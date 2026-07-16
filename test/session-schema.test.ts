import { describe, expect, it } from 'vitest'
import {
  categoryLabel,
  comboToText,
  estimateExerciseSeconds,
  estimateSessionSeconds,
  focusLabel,
  sessionCategory,
  workoutFocus,
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
    category: 'apprentissage',
    focus: 'uppercuts',
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

  it('exige une catégorie de séance', () => {
    const { category: _omit, ...sansCategorie } = valid
    expect(workoutSessionSchema.safeParse(sansCategorie).success).toBe(false)
  })

  it('rejette une catégorie invalide', () => {
    expect(workoutSessionSchema.safeParse({ ...valid, category: 'xxx' }).success).toBe(false)
  })

  it('accepte les cinq catégories', () => {
    for (const category of sessionCategory.options) {
      expect(workoutSessionSchema.safeParse({ ...valid, category }).success).toBe(true)
    }
  })

  it('accepte les nouveaux thèmes de focus', () => {
    for (const focus of workoutFocus.options) {
      expect(workoutSessionSchema.safeParse({ ...valid, focus }).success).toBe(true)
    }
  })

  it('rejette les focus hérités qui ne sont plus générés (mixte, technique)', () => {
    expect(workoutSessionSchema.safeParse({ ...valid, focus: 'mixte' }).success).toBe(false)
    expect(workoutSessionSchema.safeParse({ ...valid, focus: 'technique' }).success).toBe(false)
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

describe('focusLabel / categoryLabel', () => {
  it('libelle les nouveaux focus', () => {
    expect(focusLabel('jeu_de_jambes')).toBe('Jeu de jambes')
    expect(focusLabel('uppercuts')).toBe('Uppercuts')
  })

  // Rétro-compat : les séances générées avant l'élargissement de l'enum doivent rester lisibles.
  it('libelle encore les focus hérités', () => {
    expect(focusLabel('mixte')).toBe('Mixte')
    expect(focusLabel('technique')).toBe('Technique')
  })

  it('retombe sur la valeur brute pour un focus inconnu', () => {
    expect(focusLabel('inconnu')).toBe('inconnu')
  })

  it('libelle les catégories et tolère null (anciennes séances)', () => {
    expect(categoryLabel('enchainement')).toBe('Enchaînement')
    expect(categoryLabel(null)).toBeNull()
    expect(categoryLabel(undefined)).toBeNull()
  })
})
