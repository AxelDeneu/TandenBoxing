import { describe, expect, it } from 'vitest'
import {
  buildExercisePreferenceConstraints,
  exercisePreferenceIdentity,
  matchingStrictExclusion,
  normalizePreferenceReason,
  preferenceScoreForExercise,
  preferenceTarget,
  scoreExercisePreferences,
  tracePreferenceInfluence,
  type ExercisePreferenceEvent,
  type PreferenceAction,
  type PreferenceReasonCode,
} from '../shared/exercise-preferences'
import type { ExerciseLike } from '../shared/session-variety'
import type { WorkoutSession } from '../shared/session-schema'

const TODAY = '2026-09-22'

function event(options: {
  date: string
  action?: PreferenceAction
  reason?: PreferenceReasonCode
  name?: string
  blockType?: string
  sourceId?: number
}): ExercisePreferenceEvent {
  const exercise: ExerciseLike = {
    name: options.name ?? 'Burpees contrôlés',
    category: 'cardio',
    intervals: { work: 30, rest: 20, rounds: 3 },
  }
  const action = options.action ?? 'disliked'
  const reasonCode = normalizePreferenceReason(action, options.reason)
  const identity = exercisePreferenceIdentity(exercise, options.blockType ?? 'cardio')
  const target = preferenceTarget(identity, reasonCode)
  return {
    id: options.sourceId,
    ...identity,
    exerciseName: exercise.name,
    action,
    reasonCode,
    signalKind: target.kind,
    scope: target.scope,
    scopeKey: target.scopeKey,
    occurredOn: options.date,
    source: 'feedback',
  }
}

describe('scoreExercisePreferences', () => {
  it.each([
    ['liked', 1],
    ['disliked', -1],
    ['replaced', -1],
    ['removed', -1],
  ] as const)('transforme l’action %s en signal pondéré persistant', (action, direction) => {
    const summary = scoreExercisePreferences([event({ date: '2026-09-21', action })], TODAY)[0]!
    expect(Math.sign(summary.score)).toBe(direction)
  })

  it('donne plus de poids à un signal récent qu’au même signal ancien', () => {
    const recent = scoreExercisePreferences([event({ date: '2026-09-21' })], TODAY)[0]!
    const old = scoreExercisePreferences([event({ date: '2025-09-22' })], TODAY)[0]!

    expect(Math.abs(recent.score)).toBeGreaterThan(Math.abs(old.score))
    expect(recent.recency).toBeGreaterThan(old.recency)
    expect(recent.confidence).toBeGreaterThan(old.confidence)
  })

  it('renforce la confiance et le score quand un signal récent se répète', () => {
    const isolated = scoreExercisePreferences([event({ date: '2026-09-21' })], TODAY)[0]!
    const repeated = scoreExercisePreferences(
      [
        event({ date: '2026-09-18', sourceId: 1 }),
        event({ date: '2026-09-20', sourceId: 2 }),
        event({ date: '2026-09-21', sourceId: 3 }),
      ],
      TODAY,
    )[0]!

    expect(repeated.eventCount).toBe(3)
    expect(repeated.frequency).toBeGreaterThan(isolated.frequency)
    expect(repeated.confidence).toBeGreaterThan(isolated.confidence)
    expect(Math.abs(repeated.score)).toBeGreaterThan(Math.abs(isolated.score))
  })

  it('laisse un signal récent corriger progressivement un ancien avis contraire', () => {
    const summary = scoreExercisePreferences(
      [
        event({ date: '2025-09-22', action: 'disliked' }),
        event({ date: '2026-09-21', action: 'liked', sourceId: 2 }),
      ],
      TODAY,
    )[0]!

    expect(summary.score).toBeGreaterThan(0)
    expect(summary.strictExclusion).toBe(false)
  })

  it('retourne une prescription vide en absence de signal', () => {
    expect(buildExercisePreferenceConstraints([], TODAY)).toEqual({
      version: 'exercise-preferences/v1',
      asOfDate: TODAY,
      signalCount: 0,
      strictExclusions: [],
      weightedPreferences: [],
    })
  })
})

describe('exclusions strictes adaptées', () => {
  it('étend une douleur à la famille de mouvement, sans décroissance temporelle', () => {
    const constraints = buildExercisePreferenceConstraints(
      [event({ date: '2024-01-01', reason: 'pain' })],
      TODAY,
    )

    expect(constraints.strictExclusions[0]).toMatchObject({
      scope: 'movement',
      scopeKey: 'burpees',
    })
    expect(
      matchingStrictExclusion({ name: 'Burpees lents' }, 'renforcement', constraints),
    ).not.toBeNull()
  })

  it('étend un matériel indisponible à la modalité concernée', () => {
    const constraints = buildExercisePreferenceConstraints(
      [
        event({
          date: '2026-09-21',
          name: 'Jab au sac',
          blockType: 'technique',
          reason: 'equipment_unavailable',
        }),
      ],
      TODAY,
    )

    expect(constraints.strictExclusions[0]).toMatchObject({ scope: 'modality', scopeKey: 'sac' })
    expect(
      matchingStrictExclusion({ name: 'Crochets au sac' }, 'technique', constraints),
    ).not.toBeNull()
    expect(
      matchingStrictExclusion({ name: 'Crochets en shadow' }, 'technique', constraints),
    ).toBeNull()
  })

  it("n'exclut pas tout le poids du corps quand aucun matériel précis n'est identifiable", () => {
    const constraints = buildExercisePreferenceConstraints(
      [event({ date: '2026-09-21', reason: 'equipment_unavailable' })],
      TODAY,
    )

    expect(constraints.strictExclusions[0]).toMatchObject({
      scope: 'exercise',
      scopeKey: 'burpees:poids_du_corps',
    })
    expect(
      matchingStrictExclusion({ name: 'Squats contrôlés' }, 'renforcement', constraints),
    ).toBeNull()
  })

  it('conserve la lassitude comme préférence pondérée', () => {
    const constraints = buildExercisePreferenceConstraints(
      [event({ date: '2026-09-21', reason: 'boredom' })],
      TODAY,
    )

    expect(constraints.strictExclusions).toHaveLength(0)
    expect(constraints.weightedPreferences[0]).toMatchObject({ direction: 'avoid' })
    expect(
      preferenceScoreForExercise({ name: 'Burpees contrôlés' }, 'cardio', constraints),
    ).toBeLessThan(0)
  })
})

describe('traçabilité bornée', () => {
  it('indique les préférences appliquées sans recopier de commentaire libre', () => {
    const constraints = buildExercisePreferenceConstraints(
      [event({ date: '2026-09-21', action: 'liked', name: 'Jab au sac' })],
      TODAY,
    )
    const session = {
      title: 'Séance',
      curriculumVersion: 1,
      category: 'apprentissage',
      focus: 'fondations',
      summary: 'Résumé',
      coachNote: 'Note',
      estimatedDurationMin: 10,
      blocks: [
        {
          type: 'technique',
          title: 'Technique',
          description: 'Description',
          exercises: [
            {
              name: 'Jab au sac',
              category: 'technique',
              explanation: 'Consigne',
              tips: [],
              commonMistakes: [],
              skillIds: [],
              combo: '1',
              comboExplanation: 'Jab',
              intervals: { work: 30, rest: 20, rounds: 3 },
              restAfterSec: 0,
            },
          ],
        },
      ],
    } satisfies WorkoutSession

    expect(tracePreferenceInfluence(session, constraints)).toEqual({
      applied: true,
      signalCount: 1,
      strictExclusionCount: 0,
      weightedPreferenceCount: 1,
      matchedPreferredExerciseKeys: ['jab:sac'],
      matchedAvoidedExerciseKeys: [],
      strictExclusionsHonored: true,
      safetyAndProgressionPrecedence: true,
    })
  })
})
