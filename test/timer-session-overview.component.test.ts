// @vitest-environment happy-dom

import { mount } from '@vue/test-utils'
import { defineComponent, h } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import TimerSessionOverview from '../app/components/timer/TimerSessionOverview.vue'
import type { Exercise, WorkoutSession } from '../shared/session-schema'

function exercise(name: string): Exercise {
  return {
    name,
    category: 'technique',
    explanation: `Explication ${name}`,
    tips: [],
    commonMistakes: [],
    skillIds: [],
    combo: null,
    comboExplanation: null,
    intervals: { work: 30, rest: 10, rounds: 2 },
    restAfterSec: 15,
  }
}

const session: WorkoutSession = {
  title: 'Programme',
  curriculumVersion: 'beginner-curriculum/v1',
  category: 'apprentissage',
  focus: 'fondations',
  summary: 'Test',
  coachNote: 'Test',
  estimatedDurationMin: 10,
  blocks: [
    {
      type: 'echauffement',
      title: 'Échauffement',
      description: 'Préparer le corps',
      exercises: [exercise('Mobilité')],
    },
    {
      type: 'technique',
      title: 'Technique',
      description: 'Travailler les directs',
      exercises: [exercise('Jab'), exercise('Cross')],
    },
  ],
}

const IconStub = defineComponent({ render: () => h('span', { 'aria-hidden': 'true' }) })
const IntervalStub = defineComponent({ render: () => h('span', '2 rounds') })

describe('TimerSessionOverview', () => {
  it('distingue les exercices terminés, en cours et à venir', () => {
    const wrapper = mount(TimerSessionOverview, {
      props: { session, currentBlockIndex: 1, currentExerciseIndex: 0 },
      global: { stubs: { UIcon: IconStub, IntervalBadge: IntervalStub } },
    })

    expect(wrapper.get('#timer-exercise-0-0').attributes('data-timer-state')).toBe('completed')
    expect(wrapper.get('#timer-exercise-0-0').text()).toContain('Terminé')

    const current = wrapper.get('#timer-exercise-1-0')
    expect(current.attributes('data-timer-state')).toBe('current')
    expect(current.attributes('aria-current')).toBe('step')
    expect(current.text()).toContain('En cours')

    expect(wrapper.get('#timer-exercise-1-1').attributes('data-timer-state')).toBe('upcoming')
    expect(wrapper.get('#timer-exercise-1-1').text()).toContain('À venir')
  })

  it("amène automatiquement l'exercice courant dans la zone visible", async () => {
    const scrollIntoView = vi.fn()
    HTMLElement.prototype.scrollIntoView = scrollIntoView
    const wrapper = mount(TimerSessionOverview, {
      props: { session, currentBlockIndex: 0, currentExerciseIndex: 0 },
      global: { stubs: { UIcon: IconStub, IntervalBadge: IntervalStub } },
    })

    await wrapper.vm.$nextTick()
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'center' })
  })
})
