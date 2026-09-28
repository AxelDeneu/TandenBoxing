import { createSSRApp, defineComponent, h } from 'vue'
import { renderToString } from '@vue/server-renderer'
import { describe, expect, it } from 'vitest'
import ExerciseGuidePanel from '../app/components/timer/ExerciseGuidePanel.vue'
import type { Exercise, WorkoutSession } from '../shared/session-schema'
import { buildTimerPhases, resolveTimerGuide } from '../shared/timer'

function exercise(name: string, overrides: Partial<Exercise> = {}): Exercise {
  return {
    name,
    category: 'technique',
    explanation: `Explication de ${name}`,
    tips: [`Conseil pour ${name}`],
    commonMistakes: [`Erreur sur ${name}`],
    skillIds: [],
    combo: '1-2',
    comboExplanation: `Combo de ${name}`,
    intervals: { work: 30, rest: 0, rounds: 1 },
    restAfterSec: 15,
    ...overrides,
  }
}

const session: WorkoutSession = {
  title: 'Transition',
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
      exercises: [
        exercise('Exercice terminé'),
        exercise('Prochain exercice', {
          explanation: 'Place ta garde avant le premier jab.',
          combo: '1-2-3',
          comboExplanation: 'Jab, cross, puis crochet avant.',
          tips: ['Pivote sur le crochet.'],
          commonMistakes: ['Ne baisse pas la main arrière.'],
          restAfterSec: 0,
        }),
      ],
    },
  ],
}

const GlossaryTextStub = defineComponent({
  name: 'GlossaryTextStub',
  props: { text: { type: String, required: true } },
  render() {
    return h('span', this.text)
  },
})

const IconStub = defineComponent({
  name: 'IconStub',
  render: () => null,
})

describe('ExerciseGuidePanel pendant un repos de transition', () => {
  it("rend l'explication et le combo complets du prochain exercice", async () => {
    const phases = buildTimerPhases(session)
    const transitionIndex = phases.findIndex((phase) => phase.restKind === 'between-exercises')
    const guide = resolveTimerGuide(session, phases, transitionIndex)
    const app = createSSRApp({
      render: () => h(ExerciseGuidePanel, { exercise: guide.exercise }),
    })
    app.component('UIcon', IconStub)
    app.component('GlossaryText', GlossaryTextStub)

    const html = await renderToString(app)

    expect(html).toContain('Prochain exercice')
    expect(html).toContain('Place ta garde avant le premier jab.')
    expect(html).toContain('1-2-3')
    expect(html).toContain('Jab, cross, puis crochet avant.')
    expect(html).toContain('Pivote sur le crochet.')
    expect(html).toContain('Ne baisse pas la main arrière.')
    expect(html).not.toContain('Explication de Exercice terminé')
  })
})
