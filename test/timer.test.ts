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

  it('rattache chaque phase à son exercice source', () => {
    expect(phases.every((p) => p.blockIndex === 0 && p.exerciseIndex === 0)).toBe(true)
  })
})

// Le guide affiché pendant la séance retrouve l'exercice via blockIndex/exerciseIndex :
// ces index doivent rester exacts sur une séance à plusieurs blocs/exercices.
describe('buildTimerPhases — index de bloc/exercice', () => {
  const multi = {
    title: 't',
    category: 'apprentissage',
    focus: 'uppercuts',
    summary: 's',
    coachNote: 'c',
    estimatedDurationMin: 10,
    blocks: [
      {
        type: 'echauffement',
        title: 'Échauffement',
        description: 'd',
        exercises: [
          {
            name: 'Mobilité',
            category: 'mobilite',
            explanation: 'x',
            tips: [],
            commonMistakes: [],
            combo: null,
            comboExplanation: null,
            intervals: { work: 30, rest: 0, rounds: 1 },
            restAfterSec: 10,
          },
        ],
      },
      {
        type: 'technique',
        title: 'Technique',
        description: 'd',
        exercises: [
          {
            name: 'Uppercut avant',
            category: 'technique',
            explanation: 'x',
            tips: [],
            commonMistakes: [],
            combo: '5',
            comboExplanation: null,
            intervals: { work: 20, rest: 10, rounds: 2 },
            restAfterSec: 10,
          },
          {
            name: 'Uppercut arrière',
            category: 'technique',
            explanation: 'x',
            tips: [],
            commonMistakes: [],
            combo: '6',
            comboExplanation: null,
            intervals: { work: 20, rest: 0, rounds: 1 },
            restAfterSec: 0,
          },
        ],
      },
    ],
  } as unknown as WorkoutSession

  const phases = buildTimerPhases(multi)

  it('permet de retrouver l’exercice source de chaque phase', () => {
    for (const p of phases) {
      const exercise = multi.blocks[p.blockIndex]?.exercises[p.exerciseIndex]
      expect(exercise).toBeDefined()
    }
  })

  it('pointe vers le bon exercice (nom cohérent avec le label des phases d’effort)', () => {
    const work = phases.filter((p) => p.kind === 'work')
    for (const p of work) {
      expect(multi.blocks[p.blockIndex]!.exercises[p.exerciseIndex]!.name).toBe(p.label)
    }
  })

  it('indexe correctement le second exercice du second bloc', () => {
    const last = phases[phases.length - 1]!
    expect(last.blockIndex).toBe(1)
    expect(last.exerciseIndex).toBe(1)
    expect(multi.blocks[1]!.exercises[1]!.name).toBe('Uppercut arrière')
  })
})
