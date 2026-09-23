import { describe, expect, it } from 'vitest'
import { buildSessionPedagogicalIntent } from '../server/services/session-pedagogy.service'
import type { WorkoutSession } from '../shared/session-schema'

function structure(skillIds: WorkoutSession['blocks'][number]['exercises'][number]['skillIds']) {
  return {
    title: 'Bases propres',
    curriculumVersion: 1,
    category: 'apprentissage',
    focus: 'fondations',
    summary: 'Résumé',
    coachNote: 'Note',
    estimatedDurationMin: 20,
    blocks: [
      {
        type: 'technique',
        title: 'Technique',
        description: 'Description',
        exercises: [
          {
            name: 'Garde',
            category: 'technique',
            explanation: 'Explication',
            tips: [],
            commonMistakes: [],
            skillIds,
            combo: null,
            comboExplanation: null,
            intervals: { work: 30, rest: 15, rounds: 3 },
            restAfterSec: 30,
          },
        ],
      },
    ],
  } satisfies WorkoutSession
}

describe('intention pédagogique d’une séance', () => {
  it('explique une cible bloquée adaptée vers un prérequis sûr', () => {
    const intent = buildSessionPedagogicalIntent({
      structure: structure(['posture_garde']),
      generationContext: {
        prescription: {
          skillSelection: {
            requestedSkillId: 'combinaisons_base',
            targetDecision: 'adapted',
            newSkillId: 'posture_garde',
            consolidatedSkillIds: [],
            missingPrerequisiteIds: ['un_deux', 'crochets', 'sorties_angle'],
            coachNoteFacts: ['Cible non éligible, jamais forcée.'],
          },
        },
      },
    })

    expect(intent.worked.map((skill) => skill.id)).toEqual(['posture_garde'])
    expect(intent.introduced.map((skill) => skill.id)).toEqual(['posture_garde'])
    expect(intent.target).toMatchObject({
      skill: { id: 'combinaisons_base' },
      decision: 'adapted',
    })
    expect(intent.target?.explanation).toContain('n’est pas forcée')
    expect(intent.partial).toBe(false)
  })

  it('reste utile mais signale un détail partiel pour une ancienne séance', () => {
    const intent = buildSessionPedagogicalIntent({
      structure: structure(['jab']),
      generationContext: null,
    })

    expect(intent.worked[0]?.label).toBe('Jab')
    expect(intent.partial).toBe(true)
    expect(intent.summary).toContain('effet précis n’est pas disponible')
  })
})
