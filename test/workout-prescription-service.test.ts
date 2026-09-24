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
  vi.stubGlobal('listSessionAdaptationsBefore', () => [])
  vi.stubGlobal('getExercisePreferenceConstraints', (asOfDate: string) => ({
    version: 'exercise-preferences/v1',
    asOfDate,
    signalCount: 0,
    strictExclusions: [],
    weightedPreferences: [],
  }))
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

  it('transforme une cible bloquée en prochaine étape sûre et l’explique', () => {
    const progression = buildSkillProgression(DATE, [])

    const prescription = buildWorkoutPrescription(
      DATE,
      { category: 'apprentissage', requestedSkillId: 'combinaisons_base' },
      progression,
    )

    expect(prescription.focus).toBe('fondations')
    expect(prescription.intensity).toBe(2)
    expect(prescription.skillSelection).toMatchObject({
      requestedSkillId: 'combinaisons_base',
      targetDecision: 'adapted',
      newSkillId: 'posture_garde',
      pedagogy: 'decomposition_fondamentaux',
    })
    expect(prescription.skillSelection.coachNoteFacts.join(' ')).toContain('jamais forcée')
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

  it('ajoute les préférences sans modifier la sélection pédagogique ni les budgets', () => {
    vi.stubGlobal('getExercisePreferenceConstraints', () => ({
      version: 'exercise-preferences/v1',
      asOfDate: DATE,
      signalCount: 2,
      strictExclusions: [
        {
          exerciseKey: 'burpees:poids_du_corps',
          exerciseName: 'Burpees',
          scope: 'movement',
          scopeKey: 'burpees',
          reasonCodes: ['pain'],
        },
      ],
      weightedPreferences: [
        {
          exerciseKey: 'jab:sac',
          exerciseName: 'Jab au sac',
          direction: 'prefer',
          score: 0.7,
          recency: 0.9,
          frequency: 0.8,
          confidence: 0.7,
          eventCount: 3,
          lastEventOn: '2026-09-21',
          reasonCodes: ['liked'],
        },
      ],
    }))
    const progression = buildSkillProgression(DATE, [])

    const prescription = buildWorkoutPrescription(DATE, {}, progression)
    const prompt = buildSessionPrompt({
      dateLabel: 'mardi 22 septembre 2026',
      context: { dureeCibleMin: 30, prescription, progressionCompetences: progression },
    })

    expect(prescription.exercisePreferences.signalCount).toBe(2)
    expect(prescription.skillSelection.newSkillId).toBe('posture_garde')
    expect(Object.values(prescription.blockBudgets).reduce((sum, value) => sum + value, 0)).toBe(
      1_800,
    )
    expect(prompt).toContain("Exclusions strictes d'exercices : 1")
    expect(prompt).toContain('exercices également sûrs, compatibles avec le focus, les prérequis')
  })
})
