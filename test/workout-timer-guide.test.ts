import { createSSRApp, defineComponent } from 'vue'
import { renderToString } from '@vue/server-renderer'
import { describe, expect, it } from 'vitest'
import { useWorkoutTimer } from '../app/composables/useWorkoutTimer'
import { adaptWorkoutSession, type SessionAdaptationCause } from '../shared/session-autoregulation'
import type { Exercise, WorkoutSession } from '../shared/session-schema'

function exercise(name: string, overrides: Partial<Exercise> = {}): Exercise {
  return {
    name,
    category: 'technique',
    explanation: `Explication ${name}`,
    tips: [],
    commonMistakes: [],
    skillIds: [],
    combo: '1-2-3-2',
    comboExplanation: `Combo ${name}`,
    intervals: { work: 60, rest: 20, rounds: 3 },
    restAfterSec: 30,
    ...overrides,
  }
}

function session(): WorkoutSession {
  return {
    title: 'Adaptation du guide',
    curriculumVersion: 'beginner-curriculum/v1',
    category: 'enchainement',
    focus: 'combinaisons',
    summary: 'Test',
    coachNote: 'Test',
    estimatedDurationMin: 10,
    blocks: [
      {
        type: 'technique',
        title: 'Technique',
        description: 'Test',
        exercises: [exercise('Exercice courant'), exercise('Combo futur', { restAfterSec: 0 })],
      },
    ],
  }
}

async function mountedTimer(workout: WorkoutSession): Promise<ReturnType<typeof useWorkoutTimer>> {
  let timer: ReturnType<typeof useWorkoutTimer> | undefined
  const app = createSSRApp(
    defineComponent({
      setup() {
        timer = useWorkoutTimer(workout)
        return () => null
      },
    }),
  )
  await renderToString(app)
  if (!timer) throw new Error("Le timer n'a pas été initialisé")
  return timer
}

describe('useWorkoutTimer — guide après adaptation', () => {
  it.each<SessionAdaptationCause>(['too_hard', 'too_easy', 'pain'])(
    'utilise la suite active après une adaptation %s',
    async (cause) => {
      const workout = session()
      const timer = await mountedTimer(workout)
      const transitionIndex = timer.phases.findIndex(
        (phase) => phase.restKind === 'between-exercises',
      )
      expect(transitionIndex).toBeGreaterThanOrEqual(0)
      timer.index.value = transitionIndex

      const adapted = adaptWorkoutSession(workout, {
        cause,
        cursor: { blockIndex: 0, exerciseIndex: 0 },
        painLocations: cause === 'pain' ? ['wrist_hand'] : [],
      }).session
      timer.applyAdaptedSession(adapted, cause === 'pain')

      const expected = adapted.blocks[0]!.exercises[1]!
      expect(timer.guideExercise.value).toMatchObject({
        name: expected.name,
        explanation: expected.explanation,
        combo: expected.combo,
        intervals: expected.intervals,
      })
    },
  )
})
