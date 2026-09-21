import { describe, expect, it } from 'vitest'
import {
  BEGINNER_CURRICULUM,
  SKILL_IDS,
  skillIdsForFocus,
  validateCurriculum,
  type BeginnerCurriculum,
} from '../shared/curriculum'

describe('curriculum débutant', () => {
  it('est versionné et couvre exactement les identifiants stables déclarés', () => {
    expect(BEGINNER_CURRICULUM.version).toBe(1)
    expect(BEGINNER_CURRICULUM.skills.map((skill) => skill.id)).toEqual(SKILL_IDS)
  })

  it('référence uniquement des prérequis valides et ne contient aucun cycle', () => {
    expect(validateCurriculum()).toEqual([])
  })

  it('détecte effectivement un cycle introduit dans le graphe', () => {
    const cyclic: BeginnerCurriculum = {
      ...BEGINNER_CURRICULUM,
      skills: BEGINNER_CURRICULUM.skills.map((skill) =>
        skill.id === 'posture_garde' ? { ...skill, prerequisites: ['combinaisons_base'] } : skill,
      ),
    }
    expect(validateCurriculum(cyclic).some((error) => error.includes('Cycle détecté'))).toBe(true)
  })

  it('couvre les composantes techniques des focus de planification', () => {
    expect(skillIdsForFocus('fondations')).toEqual(
      expect.arrayContaining(['posture_garde', 'appuis', 'jab', 'cross', 'un_deux']),
    )
    expect(skillIdsForFocus('combinaisons')).toContain('combinaisons_base')
    expect(skillIdsForFocus('cardio')).toEqual([])
  })
})
