import { describe, expect, it } from 'vitest'
import {
  PAIN_SAFETY_NOTICE,
  SESSION_AUTOREGULATION_VERSION,
  adaptWorkoutSession,
  estimateRunnableSessionSeconds,
  inSessionAdaptationSchema,
  sessionCheckInSchema,
} from '../shared/session-autoregulation'
import type { Exercise, WorkoutBlock, WorkoutSession } from '../shared/session-schema'

function exercise(name: string, overrides: Partial<Exercise> = {}): Exercise {
  return {
    name,
    category: 'technique',
    explanation: 'Exécution contrôlée.',
    tips: [],
    commonMistakes: [],
    skillIds: [],
    combo: '1-2-3-2',
    comboExplanation: 'jab, cross, crochet, cross',
    intervals: { work: 60, rest: 20, rounds: 4 },
    restAfterSec: 30,
    ...overrides,
  }
}

function block(type: WorkoutBlock['type'], exercises: Exercise[]): WorkoutBlock {
  return { type, title: type, description: type, exercises }
}

function session(): WorkoutSession {
  return {
    title: 'Séance test',
    curriculumVersion: 'beginner-curriculum/v1',
    category: 'enchainement',
    focus: 'combinaisons',
    summary: 'Test',
    coachNote: 'Test',
    estimatedDurationMin: 30,
    blocks: [
      block('echauffement', [
        exercise('Mobilité générale', {
          category: 'mobilite',
          combo: null,
          comboExplanation: null,
        }),
      ]),
      block('technique', [exercise('Jab-cross au sac'), exercise('Jab en shadow')]),
      block('renforcement', [
        exercise('Squats contrôlés', {
          category: 'renforcement',
          combo: null,
          comboExplanation: null,
        }),
      ]),
      block('retour_au_calme', [
        exercise('Respiration lente', {
          category: 'recuperation',
          combo: null,
          comboExplanation: null,
        }),
      ]),
    ],
  }
}

describe('autorégulation avant séance', () => {
  it('applique des valeurs par défaut cohérentes et un contrat strict', () => {
    expect(sessionCheckInSchema.parse({})).toEqual({
      availableTimeMin: null,
      energy: 3,
      sorenessLevel: 0,
      sorenessLocations: [],
      painLocations: [],
      intention: 'maintain',
    })
    expect(sessionCheckInSchema.safeParse({ energy: 0 }).success).toBe(false)
    expect(sessionCheckInSchema.safeParse({ availableTimeMin: 91 }).success).toBe(false)
    expect(sessionCheckInSchema.safeParse({ unknown: true }).success).toBe(false)
  })

  it.each([10, 15, 20])('fait tenir la séance dans %s minutes annoncées', (minutes) => {
    const result = adaptWorkoutSession(session(), {
      cause: 'check_in',
      checkIn: sessionCheckInSchema.parse({ availableTimeMin: minutes }),
    })

    expect(estimateRunnableSessionSeconds(result.session)).toBeLessThanOrEqual(minutes * 60)
    expect(result.session.blocks[0]?.type).toBe('echauffement')
    expect(result.session.blocks.at(-1)?.type).toBe('retour_au_calme')
    expect(result.trace.constraints.targetSeconds).toBe(minutes * 60)
  })

  it('diminue la charge et augmente le repos pour énergie basse et courbatures', () => {
    const result = adaptWorkoutSession(session(), {
      cause: 'check_in',
      checkIn: sessionCheckInSchema.parse({ energy: 1, sorenessLevel: 3 }),
    })
    const before = session().blocks[1]!.exercises[0]!
    const after = result.session.blocks[1]!.exercises[0]!

    expect(result.trace.afterIntensity).toBe(2)
    expect(after.intervals.work).toBeLessThan(before.intervals.work)
    expect(after.intervals.rest).toBeGreaterThan(before.intervals.rest)
    expect(after.intervals.rounds).toBeLessThan(before.intervals.rounds)
  })

  it('donne la priorité à la sécurité sur une intention de challenge', () => {
    const result = adaptWorkoutSession(session(), {
      cause: 'check_in',
      checkIn: sessionCheckInSchema.parse({
        energy: 1,
        sorenessLevel: 3,
        painLocations: ['wrist_hand'],
        intention: 'challenge',
      }),
    })

    expect(result.trace.constraints.safetyPrecedence).toBe(true)
    expect(result.trace.afterIntensity).toBeLessThan(result.trace.beforeIntensity)
    expect(result.trace.constraints.prohibitedMovementFamilies).toContain('directs')
    expect(result.trace.constraints.allowedMovementFamilies).not.toContain('directs')
    expect(result.session.blocks[1]!.exercises[0]!.category).toBe('recuperation')
    expect(result.trace.safetyNotice).toBe(PAIN_SAFETY_NOTICE)
    expect(result.trace.safetyNotice).toContain('ne constitue pas un diagnostic médical')
  })

  it('est strictement déterministe à entrée identique', () => {
    const input = {
      cause: 'check_in' as const,
      checkIn: sessionCheckInSchema.parse({
        availableTimeMin: 15,
        energy: 2,
        sorenessLevel: 2,
        intention: 'technique',
      }),
    }
    expect(adaptWorkoutSession(session(), input)).toEqual(adaptWorkoutSession(session(), input))
  })
})

describe('autorégulation pendant la séance', () => {
  it('ne modifie jamais le préfixe terminé ni l’exercice courant', () => {
    const original = session()
    const prefix = structuredClone(original.blocks.slice(0, 2))
    const current = structuredClone(original.blocks[2]!.exercises[0])
    const result = adaptWorkoutSession(original, {
      cause: 'too_hard',
      cursor: { blockIndex: 2, exerciseIndex: 0 },
    })

    expect(result.session.blocks.slice(0, 2)).toEqual(prefix)
    expect(result.session.blocks[2]!.exercises[0]).toEqual(current)
    expect(result.session.blocks[3]!.exercises[0]!.intervals.work).toBeLessThan(60)
    expect(
      result.trace.changes.every(
        (change) =>
          change.path === 'intensity' ||
          change.path === 'estimatedDurationMin' ||
          change.path.startsWith('blocks.3.'),
      ),
    ).toBe(true)
  })

  it('retire immédiatement de la suite la famille du mouvement douloureux', () => {
    const original = session()
    const result = adaptWorkoutSession(original, {
      cause: 'pain',
      cursor: { blockIndex: 1, exerciseIndex: 0 },
      painLocations: ['wrist_hand'],
      currentMovementFamily: 'directs',
    })

    expect(result.session.blocks[1]!.exercises[0]).toEqual(original.blocks[1]!.exercises[0])
    expect(result.session.blocks[1]!.exercises[1]!.category).toBe('recuperation')
    expect(result.session.blocks[1]!.exercises[1]!.combo).toBeNull()
    expect(result.trace.changes).toContainEqual(
      expect.objectContaining({ kind: 'substitution', before: 'jab', after: 'respiration' }),
    )
    expect(result.trace.ruleVersion).toBe(SESSION_AUTOREGULATION_VERSION)
  })

  it('simplifie la complexité et respecte les bornes minimales en mode trop difficile', () => {
    const original = session()
    original.blocks[3]!.exercises[0] = exercise('Combo final', {
      intervals: { work: 5, rest: 600, rounds: 1 },
      restAfterSec: 300,
    })
    const result = adaptWorkoutSession(original, {
      cause: 'too_hard',
      cursor: { blockIndex: 2, exerciseIndex: 0 },
    })
    const adapted = result.session.blocks[3]!.exercises[0]!

    expect(adapted.intervals).toEqual({ work: 5, rest: 600, rounds: 1 })
    expect(adapted.restAfterSec).toBe(300)
    expect(adapted.combo).toBe('1-2')
  })

  it('respecte les bornes maximales en mode trop facile', () => {
    const original = session()
    original.blocks[3]!.exercises[0] = exercise('Effort maximal', {
      intervals: { work: 900, rest: 0, rounds: 30 },
      restAfterSec: 0,
    })
    const result = adaptWorkoutSession(original, {
      cause: 'too_easy',
      cursor: { blockIndex: 2, exerciseIndex: 0 },
    })
    expect(result.session.blocks[3]!.exercises[0]!.intervals).toEqual({
      work: 900,
      rest: 0,
      rounds: 30,
    })
    expect(result.trace.afterIntensity).toBe(5)
  })

  it('exige une localisation pour une action douleur', () => {
    expect(
      inSessionAdaptationSchema.safeParse({
        action: 'pain',
        cursor: { blockIndex: 0, exerciseIndex: 0 },
        painLocations: [],
      }).success,
    ).toBe(false)
  })
})
