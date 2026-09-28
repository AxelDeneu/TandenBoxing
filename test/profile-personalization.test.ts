import { describe, expect, it } from 'vitest'
import {
  PROFILE_PERSONALIZATION_VERSION,
  assessExerciseEquipment,
  resolveProfilePersonalization,
  type TrainingEquipment,
  type TrainingGoal,
} from '../shared/profile-personalization'
import { buildSessionPrompt } from '../shared/generation-prompt'
import { validateSessionPolicy } from '../shared/session-policy'
import type { Exercise, WorkoutSession } from '../shared/session-schema'
import { planWorkoutPrescription } from '../shared/workout-prescription'
import { SYSTEM_PROMPT, type GenerationContext } from '../server/services/generation.service'
import { buildDeterministicFallbackSession } from '../server/services/session-library.service'

function prescription(goal: TrainingGoal, equipment: TrainingEquipment[] = []) {
  return planWorkoutPrescription({
    today: '2026-10-01',
    targetDurationMin: 10,
    goal,
    equipment,
    history: [],
    request: { category: 'cardio', focus: 'fondations' },
  })
}

function fallbackContext(goal: TrainingGoal, equipment: TrainingEquipment[]): GenerationContext {
  return {
    dureeCibleMin: 10,
    prescription: {
      ...prescription(goal, equipment),
      skillSelection: { newSkillId: null, consolidatedSkillIds: [] },
      exercisePreferences: {
        version: 'exercise-preferences/v1',
        asOfDate: '2026-10-01',
        signalCount: 0,
        strictExclusions: [],
        weightedPreferences: [],
      },
    },
  } as unknown as GenerationContext
}

function equipmentExercise(name: string, equipment?: TrainingEquipment[]): Exercise {
  return {
    name,
    category: 'technique',
    explanation: 'Exécution contrôlée.',
    tips: [],
    commonMistakes: [],
    skillIds: [],
    equipment,
    combo: '1-2',
    comboExplanation: 'Jab-cross.',
    intervals: { work: 300, rest: 0, rounds: 1 },
    restAfterSec: 0,
  }
}

function sessionWith(exercise: Exercise): WorkoutSession {
  return {
    title: 'Matrice matériel',
    curriculumVersion: 1,
    category: 'apprentissage',
    focus: 'fondations',
    summary: 'Test',
    coachNote: 'Test',
    estimatedDurationMin: 10,
    blocks: [
      {
        type: 'echauffement',
        title: 'Échauffement',
        description: 'Progressif',
        exercises: [
          {
            ...equipmentExercise('Mobilité sans matériel'),
            category: 'mobilite',
            equipment: [],
            combo: null,
            comboExplanation: null,
            intervals: { work: 60, rest: 0, rounds: 1 },
          },
        ],
      },
      {
        type: 'technique',
        title: 'Technique',
        description: 'Technique',
        exercises: [exercise],
      },
      {
        type: 'cardio',
        title: 'Cardio',
        description: 'Cardio',
        exercises: [
          {
            ...equipmentExercise('Shadow boxing rythmé'),
            category: 'cardio',
            equipment: [],
            combo: null,
            comboExplanation: null,
            intervals: { work: 180, rest: 0, rounds: 1 },
          },
        ],
      },
      {
        type: 'retour_au_calme',
        title: 'Retour au calme',
        description: 'Respiration',
        exercises: [
          {
            ...equipmentExercise('Respiration lente'),
            category: 'recuperation',
            equipment: [],
            combo: null,
            comboExplanation: null,
            intervals: { work: 60, rest: 0, rounds: 1 },
          },
        ],
      },
    ],
  }
}

describe('compatibilité des profils antérieurs au contrat', () => {
  it('préserve le comportement sac de l’ancien profil implicite jusqu’à une sauvegarde explicite', () => {
    expect(
      resolveProfilePersonalization({
        goal: 'cardio-perte-de-gras',
        equipment: ['gants', 'bandes'],
        personalizationVersion: null,
      }),
    ).toMatchObject({
      goal: 'cardio-perte-de-gras',
      equipment: ['sac-de-frappe'],
      migratedFromLegacy: true,
    })
  })

  it('respecte un inventaire explicitement vide dans le contrat courant', () => {
    expect(
      resolveProfilePersonalization({
        goal: 'technique',
        equipment: [],
        personalizationVersion: PROFILE_PERSONALIZATION_VERSION,
      }),
    ).toMatchObject({ goal: 'technique', equipment: [], migratedFromLegacy: false })
  })
})

describe('matrice objectif × génération', () => {
  const byGoal = Object.fromEntries(
    (['cardio-perte-de-gras', 'technique', 'forme-generale'] as TrainingGoal[]).map((goal) => [
      goal,
      prescription(goal),
    ]),
  ) as Record<TrainingGoal, ReturnType<typeof prescription>>

  it('rend chaque objectif visible dans une dimension de budget documentée', () => {
    expect(byGoal.technique.blockBudgets.technique).toBeGreaterThan(
      byGoal['cardio-perte-de-gras'].blockBudgets.technique,
    )
    expect(byGoal['cardio-perte-de-gras'].blockBudgets.cardio).toBeGreaterThan(
      byGoal.technique.blockBudgets.cardio,
    )
    expect(byGoal['forme-generale'].blockBudgets.renforcement).toBeGreaterThan(
      byGoal['cardio-perte-de-gras'].blockBudgets.renforcement,
    )
    expect(
      Object.values(byGoal).map((item) => item.personalization.goalInfluence.dimension),
    ).toEqual(['cardio', 'technique', 'renforcement'])
  })

  it('rend objectif et inventaire explicites dans le prompt fournisseur', () => {
    const value = prescription('technique', ['sac-de-frappe'])
    const prompt = buildSessionPrompt({
      dateLabel: 'jeudi 1 octobre 2026',
      context: { dureeCibleMin: 10, prescription: value },
    })
    expect(prompt).toContain('Objectif autoritaire : Technique de boxe')
    expect(prompt).toContain('Matériel autorisé : sac-de-frappe (Sac + gants + bandes)')
    expect(prompt).toContain('Tout matériel absent est interdit')
    expect(SYSTEM_PROMPT).not.toContain('Matériel disponible : un sac de frappe')
    expect(SYSTEM_PROMPT).not.toContain('Objectif principal : cardio et perte de gras')
  })

  it('rend les budgets influencés par l’objectif bloquants dans la politique', () => {
    const result = validateSessionPolicy(sessionWith(equipmentExercise('Jab-cross en shadow')), {
      targetDurationMin: 10,
      prescribedBlockBudgets: {
        echauffement: 60,
        technique: 360,
        cardio: 120,
        renforcement: 0,
        retour_au_calme: 60,
      },
    })
    expect(result.violations.map((violation) => violation.code)).toContain('BLOCK_BUDGET_MISMATCH')
  })
})

describe('matrice matériel — politique, remplacements et fallback', () => {
  it('bloque un sac absent même si le modèle omet le champ equipment', () => {
    const result = validateSessionPolicy(sessionWith(equipmentExercise('Jab-cross au sac')), {
      targetDurationMin: 10,
      availableEquipment: [],
    })
    expect(result.violations).toContainEqual(
      expect.objectContaining({
        code: 'UNAVAILABLE_EQUIPMENT',
        details: { equipment: 'sac-de-frappe' },
      }),
    )
  })

  it('applique la même compatibilité aux exercices de remplacement', () => {
    expect(
      assessExerciseEquipment(equipmentExercise('Alternative au sac'), 'technique', []).compatible,
    ).toBe(false)
    expect(
      assessExerciseEquipment(
        equipmentExercise('Alternative au sac', ['sac-de-frappe']),
        'technique',
        ['sac-de-frappe'],
      ).compatible,
    ).toBe(true)
    expect(
      assessExerciseEquipment(
        equipmentExercise('Shadow avec haltères', ['halteres-legeres']),
        'technique',
        ['halteres-legeres'],
      ).compatible,
    ).toBe(false)
  })

  it.each([
    { label: 'sans matériel', equipment: [] as TrainingEquipment[], expected: [] },
    {
      label: 'sac',
      equipment: ['sac-de-frappe'] as TrainingEquipment[],
      expected: ['sac-de-frappe'],
    },
    {
      label: 'matériel additionnel',
      equipment: ['corde-a-sauter', 'elastiques'] as TrainingEquipment[],
      expected: ['corde-a-sauter', 'elastiques'],
    },
  ])('construit un fallback conforme pour $label', ({ equipment, expected }) => {
    const context = fallbackContext('cardio-perte-de-gras', equipment)
    const session = buildDeterministicFallbackSession(context).session
    const used = new Set(
      session.blocks.flatMap((block) =>
        block.exercises.flatMap((exercise) => exercise.equipment ?? []),
      ),
    )

    expect([...used]).toEqual(expect.arrayContaining(expected))
    if (!equipment.includes('sac-de-frappe')) {
      expect(
        session.blocks
          .flatMap((block) => block.exercises)
          .some((exercise) => /\bsac\b/i.test(exercise.name)),
      ).toBe(false)
    }
    expect(
      validateSessionPolicy(session, {
        targetDurationMin: 10,
        requestedCategory: context.prescription.category,
        requestedFocus: context.prescription.focus,
        availableEquipment: equipment,
        prescribedBlockBudgets: context.prescription.blockBudgets,
      }).valid,
    ).toBe(true)
  })
})
