import { describe, expect, it } from 'vitest'
import { buildSessionPrompt } from '../shared/generation-prompt'
import type { RecoHistoryEntry } from '../shared/recommendations'
import {
  WORKOUT_PRESCRIPTION_PROFILES,
  planWorkoutPrescription,
  workoutPrescriptionSchema,
  type WorkoutPrescriptionInput,
} from '../shared/workout-prescription'
import { blockType, sessionCategory, workoutFocus } from '../shared/session-schema'

const TODAY = '2026-09-18'

function completed(
  date: string,
  focus: string,
  extra: Partial<RecoHistoryEntry> = {},
): RecoHistoryEntry {
  return { date, category: 'renforcement', focus, completed: true, ...extra }
}

function input(overrides: Partial<WorkoutPrescriptionInput> = {}): WorkoutPrescriptionInput {
  return {
    today: TODAY,
    targetDurationMin: 45,
    history: [],
    ...overrides,
  }
}

describe('planWorkoutPrescription — profils de catégorie', () => {
  const dominantBlock = {
    apprentissage: 'technique',
    renforcement: 'technique',
    enchainement: 'technique',
    cardio: 'cardio',
    recuperation: 'retour_au_calme',
  } as const

  for (const category of sessionCategory.options) {
    it(`${category} applique son profil documenté`, () => {
      const prescription = planWorkoutPrescription(
        input({ request: { category, focus: 'fondations' } }),
      )
      const profile = WORKOUT_PRESCRIPTION_PROFILES[category]
      const largestBudget = Object.entries(prescription.blockBudgets).sort(
        ([, a], [, b]) => b - a,
      )[0]![0]

      expect(prescription.category).toBe(category)
      expect(prescription.intensity).toBe(profile.intensity)
      expect(prescription.maxNewTechniques).toBe(profile.maxNewTechniques)
      expect(largestBudget).toBe(dominantBlock[category])
      expect(workoutPrescriptionSchema.safeParse(prescription).success).toBe(true)
    })
  }

  it('la récupération interdit les blocs cardio et renforcement', () => {
    const prescription = planWorkoutPrescription(
      input({ request: { category: 'recuperation', focus: 'fondations' } }),
    )
    expect(prescription.blockBudgets.cardio).toBe(0)
    expect(prescription.blockBudgets.renforcement).toBe(0)
  })
})

describe('planWorkoutPrescription — sélection', () => {
  it('sans historique, prescrit les fondations en apprentissage', () => {
    const prescription = planWorkoutPrescription(input())
    expect(prescription.category).toBe('apprentissage')
    expect(prescription.focus).toBe('fondations')
    expect(prescription.sources.category).toBe('recommendation')
    expect(prescription.sources.focus).toBe('recommendation')
  })

  it('priorise le focus le plus négligé', () => {
    const history = workoutFocus.options.map((focus, index) =>
      completed(
        focus === 'defense' ? '2026-01-01' : `2026-08-${String(index + 1).padStart(2, '0')}`,
        focus,
      ),
    )
    const prescription = planWorkoutPrescription(input({ history }))
    expect(prescription.focus).toBe('defense')
    expect(prescription.category).toBe('renforcement')
  })

  it('prescrit une récupération quand les feedbacks signalent de la fatigue', () => {
    const prescription = planWorkoutPrescription(
      input({
        history: [
          completed('2026-09-15', 'cardio', { difficulty: 5 }),
          completed('2026-09-16', 'crochets', { difficulty: 4 }),
          completed('2026-09-17', 'defense', { difficulty: 5 }),
        ],
      }),
    )
    expect(prescription.category).toBe('recuperation')
    expect(prescription.intensity).toBe(1)
    expect(prescription.signals.fatigued).toBe(true)
    expect(prescription.maxNewTechniques).toBe(0)
  })

  it("tient compte d'un niveau d'énergie récemment bas", () => {
    const prescription = planWorkoutPrescription(
      input({
        history: [
          completed('2026-09-10', 'cardio', { energy: 2, difficulty: 2 }),
          completed('2026-09-14', 'crochets', { energy: 1, difficulty: 2 }),
        ],
      }),
    )
    expect(prescription.category).toBe('recuperation')
    expect(prescription.signals.fatigued).toBe(true)
  })

  it('allège un retour après une interruption', () => {
    const prescription = planWorkoutPrescription(
      input({ history: [completed('2026-08-20', 'fondations')] }),
    )
    expect(prescription.signals.returningAfterBreak).toBe(true)
    expect(prescription.intensity).toBe(1)
    expect(prescription.maxNewTechniques).toBe(0)
  })

  it('utilise les séances sautées comme signal de reprise', () => {
    const prescription = planWorkoutPrescription(
      input({
        skipped: [{ date: '2026-09-10' }, { date: '2026-09-15', reason: 'manque de temps' }],
      }),
    )
    expect(prescription.signals.returningAfterBreak).toBe(true)
    expect(prescription.intensity).toBe(1)
  })

  it('transforme une contrainte de blessure en récupération automatique', () => {
    const prescription = planWorkoutPrescription(input({ constraints: 'Douleur au poignet' }))
    expect(prescription.category).toBe('recuperation')
    expect(prescription.signals.constrained).toBe(true)
  })

  it('réutilise les adaptations structurées dans les prescriptions futures', () => {
    const prescription = planWorkoutPrescription(
      input({
        recentAdaptations: [
          { date: '2026-09-17', cause: 'too_hard' },
          { date: '2026-09-16', cause: 'pain' },
        ],
      }),
    )
    expect(prescription.signals.recentTooHard).toBe(true)
    expect(prescription.signals.recentPain).toBe(true)
    expect(prescription.signals.constrained).toBe(true)
    expect(prescription.category).toBe('recuperation')
    expect(prescription.intensity).toBe(1)
  })

  it('augmente dans les limites après deux signaux trop facile sans conflit de sécurité', () => {
    const prescription = planWorkoutPrescription(
      input({
        request: { category: 'apprentissage' },
        recentAdaptations: [
          { date: '2026-09-17', cause: 'too_easy' },
          { date: '2026-09-15', cause: 'too_easy' },
        ],
      }),
    )
    expect(prescription.signals.repeatedTooEasy).toBe(true)
    expect(prescription.intensity).toBe(3)
  })

  it('rapproche un thème libre connu sans déléguer ce choix au modèle', () => {
    const prescription = planWorkoutPrescription(
      input({ request: { customFocus: 'explosivité et pompes' } }),
    )
    expect(prescription.focus).toBe('puissance')
    expect(prescription.sources.focus).toBe('custom-focus')
  })
})

describe('planWorkoutPrescription — choix explicites et budgets', () => {
  it('conserve catégorie, focus et durée explicites même en cas de fatigue', () => {
    const prescription = planWorkoutPrescription(
      input({
        history: [
          completed('2026-09-15', 'cardio'),
          completed('2026-09-16', 'crochets'),
          completed('2026-09-17', 'defense'),
        ],
        request: { category: 'cardio', focus: 'uppercuts', durationMin: 25 },
      }),
    )
    expect(prescription.category).toBe('cardio')
    expect(prescription.focus).toBe('uppercuts')
    expect(prescription.targetSeconds).toBe(1_500)
    expect(prescription.sources).toEqual({
      category: 'explicit',
      focus: 'explicit',
      duration: 'explicit',
    })
  })

  it.each([10, 17, 25, 45, 90])('répartit exactement les %s minutes prescrites', (minutes) => {
    for (const category of sessionCategory.options) {
      const prescription = planWorkoutPrescription(
        input({ request: { category, focus: 'fondations', durationMin: minutes } }),
      )
      expect(Object.values(prescription.blockBudgets).reduce((a, b) => a + b, 0)).toBe(minutes * 60)
      expect(Object.keys(prescription.blockBudgets)).toEqual(blockType.options)
    }
  })

  it('est strictement déterministe à entrée identique', () => {
    const sameInput = input({
      history: [completed('2026-09-01', 'fondations', { energy: 4, difficulty: 2 })],
      skipped: [{ date: '2026-09-12', reason: 'agenda' }],
      request: { durationMin: 37 },
    })
    expect(planWorkoutPrescription(sameInput)).toEqual(planWorkoutPrescription(sameInput))
  })
})

describe('buildSessionPrompt — compatibilité du contexte de génération', () => {
  it('injecte la prescription structurée tout en conservant mémoire et historique', () => {
    const prescription = planWorkoutPrescription(
      input({ request: { category: 'renforcement', focus: 'crochets', durationMin: 30 } }),
    )
    const context = {
      dureeCibleMin: 30,
      prescription,
      profil: { niveau: 'debutant' },
      memoire: { parFocus: { crochets: { nombre: 1 } } },
      historique: [{ date: '2026-09-01', focus: 'crochets' }],
      demande: { categorie: 'renforcement', focus: 'crochets', focusLibre: null, note: null },
    }
    const prompt = buildSessionPrompt({ dateLabel: 'vendredi 18 septembre 2026', context })

    expect(prompt).toContain('PRESCRIPTION DÉTERMINISTE OBLIGATOIRE')
    expect(prompt).toContain('category="renforcement"')
    expect(prompt).toContain('focus="crochets"')
    expect(prompt).toContain('"targetSeconds": 1800')
    expect(prompt).toContain('"memoire"')
    expect(prompt).toContain('"historique"')
    expect(prompt).not.toContain('à ton choix')
  })

  it('conserve la même prescription pendant un ajustement', () => {
    const prescription = planWorkoutPrescription(
      input({ request: { category: 'cardio', focus: 'cardio' } }),
    )
    const prompt = buildSessionPrompt({
      dateLabel: 'vendredi 18 septembre 2026',
      context: { dureeCibleMin: 45, prescription },
      adjustment: 'change les burpees',
      existingStructure: { title: 'Séance existante' },
    })
    expect(prompt).toContain('AJUSTEMENT DEMANDÉ')
    expect(prompt).toContain('Garde la prescription')
    expect(prompt).toContain('category="cardio"')
  })
})
