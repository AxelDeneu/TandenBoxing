// @vitest-environment happy-dom

import { mount } from '@vue/test-utils'
import { defineComponent, h } from 'vue'
import { afterEach, describe, expect, it } from 'vitest'
import TimerControls from '../app/components/timer/TimerControls.vue'
import type { Exercise, WorkoutSession } from '../shared/session-schema'

function exercise(name: string): Exercise {
  return {
    name,
    category: 'technique',
    explanation: `Explication ${name}`,
    tips: [],
    commonMistakes: [],
    skillIds: [],
    combo: '1-2',
    comboExplanation: null,
    intervals: { work: 30, rest: 10, rounds: 2 },
    restAfterSec: 15,
  }
}

const firstExercise = exercise('Jab-cross')
const session: WorkoutSession = {
  title: 'Contrôles',
  curriculumVersion: 'beginner-curriculum/v1',
  category: 'apprentissage',
  focus: 'combinaisons',
  summary: 'Test',
  coachNote: 'Test',
  estimatedDurationMin: 10,
  blocks: [
    {
      type: 'technique',
      title: 'Technique',
      description: 'Test',
      exercises: [firstExercise, exercise('Crochet')],
    },
  ],
}

const ButtonStub = defineComponent({
  inheritAttrs: false,
  props: {
    label: { type: String, default: '' },
    disabled: { type: Boolean, default: false },
  },
  emits: ['click'],
  setup(props, { attrs, emit, slots }) {
    return () =>
      h(
        'button',
        {
          ...attrs,
          disabled: props.disabled,
          onClick: () => emit('click'),
        },
        slots.default?.() ?? props.label,
      )
  },
})

const SlideoverStub = defineComponent({
  props: {
    open: { type: Boolean, default: false },
    title: { type: String, default: '' },
    description: { type: String, default: '' },
  },
  emits: ['update:open'],
  setup(props, { emit, slots }) {
    return () =>
      props.open
        ? h('section', { role: 'dialog', 'aria-label': props.title }, [
            h('h2', props.title),
            h('p', props.description),
            h('div', { onClick: () => emit('update:open', false) }, slots.close?.()),
            slots.body?.(),
          ])
        : null
  },
})

afterEach(() => {
  document.body.replaceChildren()
})

function mountControls(overrides: Record<string, unknown> = {}) {
  return mount(TimerControls, {
    attachTo: document.body,
    props: {
      running: true,
      replayMode: false,
      adaptingAction: null,
      session,
      guideExercise: firstExercise,
      nextExercise: session.blocks[0]!.exercises[1]!,
      currentBlockIndex: 0,
      currentExerciseIndex: 0,
      ...overrides,
    },
    global: {
      stubs: {
        UButton: ButtonStub,
        USlideover: SlideoverStub,
        ExerciseGuidePanel: defineComponent({
          props: { exercise: { type: Object, default: null } },
          setup(props) {
            return () => h('div', { 'data-guide': '' }, (props.exercise as Exercise)?.name)
          },
        }),
        TimerSessionOverview: defineComponent({
          setup() {
            return () => h('div', { 'data-session-overview': '' }, 'Séance complète')
          },
        }),
      },
    },
  })
}

describe('TimerControls', () => {
  it("ouvre et ferme Détails sans modifier l'état de lecture ni émettre une commande timer", async () => {
    const wrapper = mountControls()

    expect(wrapper.get('[aria-label="Pause"]')).toBeTruthy()
    await wrapper.get('[aria-label="Ouvrir les détails de la séance"]').trigger('click')
    expect(wrapper.get('[role="dialog"]').attributes('aria-label')).toBe('Détails de la séance')
    expect(wrapper.get('[data-guide]').text()).toBe('Jab-cross')

    await wrapper.get('[aria-label="Fermer les détails"]').trigger('click')
    expect(wrapper.find('[role="dialog"]').exists()).toBe(false)
    expect(wrapper.get('[aria-label="Pause"]')).toBeTruthy()
    expect(wrapper.emitted('toggle')).toBeUndefined()
    expect(wrapper.emitted('previous')).toBeUndefined()
    expect(wrapper.emitted('next')).toBeUndefined()
    expect(wrapper.emitted('adapt')).toBeUndefined()
    expect(wrapper.emitted('pain')).toBeUndefined()
  })

  it('réunit le guide et la séance complète dans la même surface Détails', async () => {
    const wrapper = mountControls()

    await wrapper.get('[aria-label="Ouvrir les détails de la séance"]').trigger('click')
    const tabs = wrapper.findAll('[role="tab"]')
    expect(tabs.map((tab) => tab.text())).toEqual(['Exercice', 'Séance complète'])
    expect(tabs[0]!.attributes('aria-selected')).toBe('true')
    expect(tabs[0]!.attributes('tabindex')).toBe('0')
    expect(tabs[1]!.attributes('tabindex')).toBe('-1')

    await tabs[0]!.trigger('keydown', { key: 'ArrowRight' })
    expect(wrapper.get('[data-session-overview]').text()).toBe('Séance complète')
    expect(tabs[1]!.attributes('aria-selected')).toBe('true')
    expect(tabs[1]!.attributes('tabindex')).toBe('0')
    expect(document.activeElement).toBe(tabs[1]!.element)
    expect(wrapper.findAll('[role="dialog"]')).toHaveLength(1)
  })

  it('regroupe les adaptations et conserve un accès douleur en un geste', async () => {
    const wrapper = mountControls()

    await wrapper.get('[aria-label="Adapter la difficulté"]').trigger('click')
    expect(wrapper.get('[role="dialog"]').attributes('aria-label')).toBe('Adapter la séance')
    const hardButton = wrapper
      .findAll('button')
      .find((button) => button.text() === 'Trop difficile')
    expect(hardButton).toBeDefined()
    await hardButton!.trigger('click')
    expect(wrapper.emitted('adapt')).toEqual([['too_hard']])
    expect(wrapper.find('[role="dialog"]').exists()).toBe(false)

    await wrapper.get('[aria-label="Adapter la difficulté"]').trigger('click')
    const easyButton = wrapper.findAll('button').find((button) => button.text() === 'Trop facile')
    expect(easyButton).toBeDefined()
    await easyButton!.trigger('click')
    expect(wrapper.emitted('adapt')).toEqual([['too_hard'], ['too_easy']])

    await wrapper.get('[aria-label="Signaler une douleur"]').trigger('click')
    expect(wrapper.emitted('pain')).toHaveLength(1)
  })

  it('expose les trois transports avec des noms accessibles et leurs contrats existants', async () => {
    const wrapper = mountControls({ running: false })

    await wrapper.get('[aria-label="Précédent"]').trigger('click')
    await wrapper.get('[aria-label="Démarrer"]').trigger('click')
    await wrapper.get('[aria-label="Suivant"]').trigger('click')

    expect(wrapper.emitted('previous')).toHaveLength(1)
    expect(wrapper.emitted('toggle')).toHaveLength(1)
    expect(wrapper.emitted('next')).toHaveLength(1)
  })
})
