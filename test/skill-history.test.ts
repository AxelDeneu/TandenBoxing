import { describe, expect, it } from 'vitest'
import {
  buildSkillExposures,
  inferExerciseSkills,
  tagExerciseWithSkills,
} from '../shared/skill-history'

describe('tags et backfill des compétences', () => {
  it('préfère les tags stables déclarés par une nouvelle génération', () => {
    expect(
      inferExerciseSkills({ name: 'Exercice libre', combo: '1-2', skillIds: ['defenses'] }),
    ).toEqual({ skillIds: ['defenses'], source: 'declared' })
  })

  it('déduit les compétences des combos historiques', () => {
    expect(inferExerciseSkills({ name: 'Combo', combo: '1-2-3' })).toEqual({
      skillIds: ['jab', 'cross', 'crochets', 'un_deux', 'combinaisons_base'],
      source: 'inferred_combo',
    })
  })

  it("complète les tags omis d'un exercice généré avant persistance", () => {
    expect(tagExerciseWithSkills({ name: 'Jab-cross', combo: '1-2' }).skillIds).toEqual([
      'jab',
      'cross',
      'un_deux',
    ])
  })

  it('utilise le texte puis le focus historique seulement en dernier recours', () => {
    expect(inferExerciseSkills({ name: 'Pivot et sortie en angle' })).toEqual({
      skillIds: ['sorties_angle'],
      source: 'inferred_text',
    })

    const [focusExposure] = buildSkillExposures(
      [
        {
          id: 1,
          date: '2026-07-01',
          status: 'completed',
          focus: 'uppercuts',
          structure: { blocks: [{ exercises: [{ name: 'Travail technique' }] }] },
        },
      ],
      [],
      [],
    )
    expect(focusExposure).toMatchObject({ skillId: 'uppercuts', source: 'inferred_focus' })
  })

  it('rattache le feedback par exercice et conserve la difficulté la plus haute par séance', () => {
    const exposures = buildSkillExposures(
      [
        {
          id: 7,
          date: '2026-07-01',
          status: 'completed',
          focus: 'fondations',
          structure: {
            blocks: [
              {
                exercises: [
                  { name: 'Jab lent', skillIds: ['jab'] },
                  { name: 'Jab rapide', skillIds: ['jab'] },
                ],
              },
            ],
          },
        },
      ],
      [
        {
          sessionId: 7,
          completed: true,
          overallDifficulty: 2,
          energyLevel: 4,
        },
      ],
      [
        { sessionId: 7, blockIndex: 0, exerciseIndex: 0, difficulty: 2 },
        { sessionId: 7, blockIndex: 0, exerciseIndex: 1, difficulty: 5 },
      ],
    )
    expect(exposures).toHaveLength(1)
    expect(exposures[0]).toMatchObject({ skillId: 'jab', difficulty: 5, completed: true })
  })

  it('marque une séance non terminée sans lui donner de poids dans le calcul ultérieur', () => {
    const [exposure] = buildSkillExposures(
      [
        {
          id: 9,
          date: '2026-07-01',
          status: 'skipped',
          focus: 'fondations',
          structure: { blocks: [{ exercises: [{ name: 'Garde', skillIds: ['posture_garde'] }] }] },
        },
      ],
      [{ sessionId: 9, completed: false, overallDifficulty: null, energyLevel: null }],
      [],
    )
    expect(exposure?.completed).toBe(false)
  })
})
