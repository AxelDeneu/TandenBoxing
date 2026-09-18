import { describe, expect, it } from 'vitest'
import {
  calculateBlockDiversity,
  calculateDurationMetric,
  calculateExerciseOverlap,
  calculateFidelityMetric,
  calculateProgressionMetric,
} from '../evaluation/metrics'
import type { EvaluationCase } from '../evaluation/types'
import type {
  BlockType,
  ExerciseCategory,
  WorkoutBlock,
  WorkoutSession,
} from '../shared/session-schema'

function block(
  type: BlockType,
  name: string,
  seconds: number,
  category: ExerciseCategory,
  combo: string | null = null,
): WorkoutBlock {
  return {
    type,
    title: type,
    description: type,
    exercises: [
      {
        name,
        category,
        explanation: name,
        tips: [],
        commonMistakes: [],
        combo,
        comboExplanation: combo,
        intervals: { work: seconds, rest: 0, rounds: 1 },
        restAfterSec: 0,
      },
    ],
  }
}

function session(blocks: WorkoutBlock[]): WorkoutSession {
  return {
    title: 'Séance connue',
    category: 'apprentissage',
    focus: 'fondations',
    summary: 'Résumé',
    coachNote: 'Note',
    estimatedDurationMin: 10,
    blocks,
  }
}

const evaluationCase: EvaluationCase = {
  id: 'known-case',
  title: 'Cas connu',
  description: 'Cas entièrement contrôlé pour tester les métriques déterministes.',
  tags: ['progression'],
  context: {
    date: '2027-01-01',
    targetDurationMin: 10,
    profile: {
      level: 'debutant',
      fitnessLevel: 'actif',
      equipment: ['sac'],
      constraints: [],
    },
    history: [],
    skippedSessions: [],
  },
  expected: {
    category: 'apprentissage',
    focus: 'fondations',
    progression: { requiredPreviousCombos: ['1'], maxComboLength: 2 },
  },
  sequence: { id: 'known', position: 2 },
}

describe('métriques déterministes du générateur', () => {
  it('calcule erreur, valeur absolue et dépassement de durée', () => {
    const known = session([
      block('echauffement', 'Mobilité', 100, 'mobilite'),
      block('technique', 'Jab-cross', 420, 'technique', '1-2'),
      block('retour_au_calme', 'Respiration', 100, 'recuperation'),
    ])
    expect(calculateDurationMetric(known, 10)).toEqual({
      targetSeconds: 600,
      actualSeconds: 620,
      errorSeconds: 20,
      absoluteErrorSeconds: 20,
      overrunSeconds: 20,
    })
  })

  it('mesure séparément les répétitions principales et périphériques', () => {
    const previous = session([
      block('echauffement', 'Mobilité générale', 100, 'mobilite'),
      block('technique', 'Jab', 200, 'technique', '1'),
      block('renforcement', 'Squats', 200, 'renforcement'),
      block('retour_au_calme', 'Respiration', 100, 'recuperation'),
    ])
    const current = session([
      block('echauffement', 'Mobilité générale', 100, 'mobilite'),
      block('technique', 'Jab', 200, 'technique', '1-2'),
      block('cardio', 'Burpees', 200, 'cardio'),
      block('retour_au_calme', 'Respiration', 100, 'recuperation'),
    ])

    expect(calculateExerciseOverlap(current, { caseId: 'previous', session: previous })).toEqual({
      comparedWithCaseId: 'previous',
      main: 0.3333,
      warmupCooldown: 1,
    })
  })

  it('calcule fidélité et diversité des types de bloc', () => {
    const known = session([
      block('echauffement', 'Mobilité', 100, 'mobilite'),
      block('technique', 'Jab', 200, 'technique', '1'),
      block('technique', 'Cross', 200, 'technique', '1-2'),
      block('retour_au_calme', 'Respiration', 100, 'recuperation'),
    ])
    expect(calculateFidelityMetric(known, evaluationCase)).toEqual({
      category: true,
      focus: true,
    })
    expect(calculateBlockDiversity(known)).toEqual({
      distinctBlockTypes: 3,
      totalBlocks: 4,
      distinctBlockTypeRatio: 0.75,
      pattern: 'echauffement>technique>technique>retour_au_calme',
    })
  })

  it('vérifie les prérequis et la complexité d’une progression', () => {
    const previous = session([
      block('echauffement', 'Mobilité', 100, 'mobilite'),
      block('technique', 'Jab', 400, 'technique', '1'),
      block('retour_au_calme', 'Respiration', 100, 'recuperation'),
    ])
    const current = session([
      block('echauffement', 'Mobilité', 100, 'mobilite'),
      block('technique', 'Jab-cross', 400, 'technique', '1-2'),
      block('retour_au_calme', 'Respiration', 100, 'recuperation'),
    ])

    expect(calculateProgressionMetric(evaluationCase, current, [previous])).toMatchObject({
      applicable: true,
      passed: true,
    })
    expect(calculateProgressionMetric(evaluationCase, current, [])).toMatchObject({
      applicable: true,
      passed: false,
    })
  })
})
