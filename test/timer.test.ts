import { describe, expect, it } from 'vitest'
import { buildTimerPhases, resolveTimerGuide } from '../shared/timer'
import type { Exercise, WorkoutSession } from '../shared/session-schema'

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

function guideExercise(name: string, overrides: Partial<Exercise> = {}): Exercise {
  return {
    name,
    category: 'technique',
    explanation: `Explication ${name}`,
    tips: [`Conseil ${name}`],
    commonMistakes: [`Erreur ${name}`],
    skillIds: [],
    combo: '1-2',
    comboExplanation: `Combo ${name}`,
    intervals: { work: 20, rest: 5, rounds: 2 },
    restAfterSec: 10,
    ...overrides,
  }
}

const guideSession: WorkoutSession = {
  title: 'Guides',
  curriculumVersion: 'beginner-curriculum/v1',
  category: 'apprentissage',
  focus: 'combinaisons',
  summary: 'Test des guides',
  coachNote: 'Test',
  estimatedDurationMin: 10,
  blocks: [
    {
      type: 'technique',
      title: 'Technique',
      description: 'Premier bloc',
      exercises: [
        guideExercise('A'),
        guideExercise('B', { intervals: { work: 20, rest: 0, rounds: 1 } }),
      ],
    },
    {
      type: 'cardio',
      title: 'Cardio',
      description: 'Deuxième bloc',
      exercises: [
        guideExercise('C', {
          category: 'cardio',
          intervals: { work: 20, rest: 0, rounds: 1 },
          restAfterSec: 10,
        }),
      ],
    },
  ],
}

describe('resolveTimerGuide', () => {
  const phases = buildTimerPhases(guideSession)

  function phaseIndex(
    predicate: (phase: (typeof phases)[number], index: number) => boolean,
  ): number {
    const index = phases.findIndex(predicate)
    expect(index).toBeGreaterThanOrEqual(0)
    return index
  }

  it.each([
    ['prepare', phaseIndex((phase) => phase.kind === 'prepare' && phase.exerciseIndex === 0)],
    ['work', phaseIndex((phase) => phase.kind === 'work' && phase.exerciseIndex === 0)],
    [
      'repos inter-round',
      phaseIndex((phase) => phase.restKind === 'between-rounds' && phase.exerciseIndex === 0),
    ],
  ])('conserve le guide courant pendant %s', (_label, index) => {
    const result = resolveTimerGuide(guideSession, phases, index)

    expect(result.exercise?.name).toBe('A')
    expect(result.upcomingExercise?.name).toBe('B')
  })

  it('affiche le prochain exercice pendant un repos de transition du même bloc', () => {
    const index = phaseIndex(
      (phase) => phase.restKind === 'between-exercises' && phase.exerciseIndex === 0,
    )

    expect(resolveTimerGuide(guideSession, phases, index).exercise?.name).toBe('B')
    expect(phases[index + 1]).toMatchObject({ kind: 'prepare', exerciseIndex: 1 })
    expect(resolveTimerGuide(guideSession, phases, index + 1).exercise?.name).toBe('B')
  })

  it('affiche le prochain exercice pendant une transition entre deux blocs', () => {
    const index = phaseIndex(
      (phase) =>
        phase.restKind === 'between-exercises' &&
        phase.blockIndex === 0 &&
        phase.exerciseIndex === 1,
    )

    expect(resolveTimerGuide(guideSession, phases, index).exercise?.name).toBe('C')
  })

  it('reste sur le dernier exercice sans accéder à un index futur invalide', () => {
    const index = phaseIndex(
      (phase) => phase.kind === 'work' && phase.blockIndex === 1 && phase.exerciseIndex === 0,
    )

    expect(resolveTimerGuide(guideSession, phases, index)).toEqual({
      exercise: guideSession.blocks[1]!.exercises[0],
      upcomingExercise: null,
    })
    expect(resolveTimerGuide(guideSession, phases, phases.length)).toEqual({
      exercise: null,
      upcomingExercise: null,
    })
  })
})
