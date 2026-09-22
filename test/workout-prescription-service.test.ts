import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildSessionPrompt } from '../shared/generation-prompt'
import { buildSkillProgression, type SkillExposure } from '../shared/skill-mastery'
import { buildWorkoutPrescription } from '../server/services/workout-prescription.service'

const DATE = '2026-09-22'

function exposure(
  skillId: SkillExposure['skillId'],
  date: string,
  sessionKey = `${skillId}:${date}`,
): SkillExposure {
  return {
    sessionKey,
    date,
    skillId,
    completed: true,
    difficulty: 2,
    energy: 4,
    source: 'declared',
  }
}

beforeEach(() => {
  vi.stubGlobal('getSettings', () => ({ targetDurationMin: 30 }))
  vi.stubGlobal('getProfile', () => ({ constraints: null }))
  vi.stubGlobal('getPlan', () => undefined)
  vi.stubGlobal('listCompletedSessions', () => [])
  vi.stubGlobal('listRecentSessions', () => [])
  vi.stubGlobal('listSessionFeedbackByIds', () => [])
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('buildWorkoutPrescription — intégration de la maîtrise', () => {
  it('applique et expose la nouveauté éligible dans la prescription de production', () => {
    const progression = buildSkillProgression(DATE, [])

    const prescription = buildWorkoutPrescription(DATE, {}, progression)

    expect(prescription.focus).toBe('fondations')
    expect(prescription.maxNewTechniques).toBe(1)
    expect(prescription.skillSelection).toMatchObject({
      curriculumVersion: progression.curriculumVersion,
      newSkillId: 'posture_garde',
      consolidatedSkillIds: [],
      missingPrerequisiteIds: [],
      pedagogy: 'standard',
    })
  })

  it('interdit une nouveauté bloquée par ses prérequis sur un focus explicite', () => {
    const progression = buildSkillProgression(DATE, [])

    const prescription = buildWorkoutPrescription(
      DATE,
      { category: 'apprentissage', focus: 'combinaisons' },
      progression,
    )

    expect(progression.blockedSkills).toContainEqual({
      skillId: 'combinaisons_base',
      missingPrerequisiteIds: ['un_deux', 'crochets', 'sorties_angle'],
    })
    expect(prescription.maxNewTechniques).toBe(0)
    expect(prescription.skillSelection.newSkillId).toBeNull()
  })

  it('sélectionne explicitement les acquis à consolider sans augmenter l’intensité adaptée', () => {
    const progression = buildSkillProgression(DATE, [
      exposure('posture_garde', '2026-09-01'),
      exposure('posture_garde', '2026-09-05'),
      exposure('posture_garde', '2026-09-10'),
      exposure('jab', '2026-09-15'),
    ])

    const prescription = buildWorkoutPrescription(
      DATE,
      { category: 'recuperation', focus: 'fondations' },
      progression,
    )

    expect(progression.mastery.posture_garde.state).toBe('acquis')
    expect(progression.mastery.jab.state).toBe('en_consolidation')
    expect(prescription.intensity).toBe(1)
    expect(prescription.maxNewTechniques).toBe(0)
    expect(prescription.skillSelection.newSkillId).toBeNull()
    expect(prescription.skillSelection.consolidatedSkillIds).toContain('jab')
  })

  it('transmet au générateur les états acquis, en consolidation et nouvellement introduits', () => {
    const progression = buildSkillProgression(DATE, [
      exposure('posture_garde', '2026-09-01'),
      exposure('posture_garde', '2026-09-05'),
      exposure('posture_garde', '2026-09-10'),
      exposure('jab', '2026-09-15'),
    ])
    const prescription = buildWorkoutPrescription(
      DATE,
      { category: 'apprentissage', focus: 'fondations' },
      progression,
    )

    const prompt = buildSessionPrompt({
      dateLabel: 'mardi 22 septembre 2026',
      context: {
        dureeCibleMin: 30,
        prescription,
        progressionCompetences: progression,
      },
    })

    expect(progression.mastery.posture_garde.state).toBe('acquis')
    expect(progression.mastery.jab.state).toBe('en_consolidation')
    expect(prescription.skillSelection.newSkillId).toBe('appuis')
    expect(prompt).toContain('"state": "acquis"')
    expect(prompt).toContain('"state": "en_consolidation"')
    expect(prompt).toContain('"newSkillId": "appuis"')
  })
})
