import { describe, expect, it } from 'vitest'
import type { SkillId } from '../shared/curriculum'
import {
  applySkillGuidanceToPrescription,
  buildSkillGuidanceForFocus,
  buildSkillPrescriptionGuidance,
  buildSkillProgression,
  type SkillExposure,
} from '../shared/skill-mastery'

const TODAY = '2026-07-16'

function exposure(
  skillId: SkillId,
  date: string,
  extra: Partial<SkillExposure> = {},
): SkillExposure {
  return {
    sessionKey: `${skillId}:${date}`,
    date,
    skillId,
    completed: true,
    difficulty: 2,
    energy: 4,
    source: 'declared',
    ...extra,
  }
}

function threePositive(skillId: SkillId): SkillExposure[] {
  return ['2026-07-01', '2026-07-05', '2026-07-10'].map((date) => exposure(skillId, date))
}

describe('calcul de maîtrise', () => {
  it('passe de nouveau à en_consolidation puis acquis avec trois réussites renseignées', () => {
    expect(buildSkillProgression(TODAY, []).mastery.posture_garde.state).toBe('nouveau')
    expect(
      buildSkillProgression(TODAY, [exposure('posture_garde', '2026-07-01')]).mastery.posture_garde
        .state,
    ).toBe('en_consolidation')
    expect(
      buildSkillProgression(TODAY, threePositive('posture_garde')).mastery.posture_garde.state,
    ).toBe('acquis')
  })

  it("n'assimile jamais trois occurrences sans feedback à un acquis", () => {
    const neutral = threePositive('posture_garde').map((item) => ({
      ...item,
      difficulty: null,
      energy: null,
    }))
    const mastery = buildSkillProgression(TODAY, neutral).mastery.posture_garde
    expect(mastery.state).toBe('en_consolidation')
    expect(mastery.neutralExposures).toBe(3)
    expect(mastery.positiveExposures).toBe(0)
  })

  it('ignore totalement une séance sautée ou non terminée', () => {
    const skipped = exposure('posture_garde', '2026-07-01', { completed: false, difficulty: 1 })
    const mastery = buildSkillProgression(TODAY, [skipped]).mastery.posture_garde
    expect(mastery.state).toBe('nouveau')
    expect(mastery.exposures).toBe(0)
  })

  it('rétrograde un acquis après deux difficultés élevées consécutives', () => {
    const evidence = [
      ...threePositive('posture_garde'),
      exposure('posture_garde', '2026-07-12', { difficulty: 4 }),
      exposure('posture_garde', '2026-07-15', { difficulty: 5 }),
    ]
    const mastery = buildSkillProgression(TODAY, evidence).mastery.posture_garde
    expect(mastery.state).toBe('en_consolidation')
    expect(mastery.reasons).toContain('difficulte_elevee_repetee')
  })

  it('considère aussi une énergie basse répétée comme un signal difficile', () => {
    const evidence = [
      ...threePositive('posture_garde'),
      exposure('posture_garde', '2026-07-12', { difficulty: 2, energy: 2 }),
      exposure('posture_garde', '2026-07-15', { difficulty: 2, energy: 1 }),
    ]
    expect(buildSkillProgression(TODAY, evidence).mastery.posture_garde.state).toBe(
      'en_consolidation',
    )
  })

  it('repasse en consolidation après une interruption de plus de 42 jours', () => {
    const old = ['2026-04-01', '2026-04-05', '2026-04-10'].map((date) =>
      exposure('posture_garde', date),
    )
    const mastery = buildSkillProgression(TODAY, old).mastery.posture_garde
    expect(mastery.state).toBe('en_consolidation')
    expect(mastery.reasons).toContain('interruption_longue')
  })

  it("empêche l'acquisition et la nouveauté automatique sans prérequis acquis", () => {
    const progression = buildSkillProgression(TODAY, threePositive('combinaisons_base'))
    expect(progression.mastery.combinaisons_base.state).toBe('en_consolidation')
    expect(progression.mastery.combinaisons_base.missingPrerequisiteIds).toEqual([
      'un_deux',
      'crochets',
      'sorties_angle',
    ])
    expect(progression.eligibleNewSkillIds).not.toContain('combinaisons_base')
  })
})

describe("interface d'intégration du planner", () => {
  it('sélectionne au plus une nouveauté et identifie les consolidations', () => {
    const evidence = [...threePositive('posture_garde'), exposure('jab', '2026-07-11')]
    const progression = buildSkillProgression(TODAY, evidence)
    const guidance = buildSkillPrescriptionGuidance(progression)

    expect(guidance.newSkillId).toBe('appuis')
    expect(guidance.consolidatedSkillIds).toContain('jab')
    expect(Array.isArray(guidance.newSkillId)).toBe(false)
  })

  it('limite la nouveauté et les consolidations au focus déjà choisi par le planner', () => {
    const progression = buildSkillProgression(TODAY, threePositive('posture_garde'))
    const guidance = buildSkillGuidanceForFocus(progression, 'fondations')

    expect(['appuis', 'jab']).toContain(guidance.newSkillId)
    expect(guidance.newSkillId).not.toBe('crochets')
  })

  it('autorise une cible explicite bloquée avec intensité et pédagogie adaptées', () => {
    const progression = buildSkillProgression(TODAY, [])
    const guidance = buildSkillPrescriptionGuidance(progression, {
      requestedSkillId: 'combinaisons_base',
    })

    expect(guidance.mode).toBe('explicit_adapted')
    expect(guidance.newSkillId).toBe('combinaisons_base')
    expect(guidance.intensityCap).toBe(2)
    expect(guidance.pedagogy).toBe('decomposition_fondamentaux')
    expect(guidance.missingPrerequisiteIds).toEqual(['un_deux', 'crochets', 'sorties_angle'])
    expect(guidance.coachNoteFacts.join(' ')).toContain('Prérequis')

    const prescription = applySkillGuidanceToPrescription(
      { intensity: 5, maxNewTechniques: 2, focus: 'combinaisons' },
      guidance,
    )
    expect(prescription.intensity).toBe(2)
    expect(prescription.maxNewTechniques).toBe(1)
    expect(prescription.skillSelection.newSkillId).toBe('combinaisons_base')
    expect(prescription.skillSelection.consolidatedSkillIds).toEqual([])
  })

  it('ajoute les consolidations au contrat du planner et interdit une nouveauté implicite', () => {
    const progression = buildSkillProgression(TODAY, [
      ...threePositive('posture_garde'),
      exposure('jab', '2026-07-11'),
    ])
    const guidance = buildSkillPrescriptionGuidance(progression, { maxConsolidatedSkills: 1 })
    const prescription = applySkillGuidanceToPrescription(
      { intensity: 3, maxNewTechniques: 2 },
      { ...guidance, newSkillId: null },
    )

    expect(prescription.maxNewTechniques).toBe(0)
    expect(prescription.skillSelection.consolidatedSkillIds).toEqual(['jab'])
  })
})
