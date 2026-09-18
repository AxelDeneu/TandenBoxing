import { describe, expect, it } from 'vitest'
import { buildSessionPrompt } from '../shared/generation-prompt'
import {
  DEFAULT_VARIETY_POLICY,
  SAFE_COOLDOWN_VARIANTS,
  SAFE_WARMUP_VARIANTS,
  assessSessionVariety,
  buildVarietyMemory,
  buildWorkoutVarietyConstraints,
  compareExercises,
  computeSessionOverlap,
  createExerciseSignature,
  normalizeCombo,
  normalizeExerciseText,
  selectExerciseCandidates,
  type ExerciseLike,
  type WorkoutStructureLike,
} from '../shared/session-variety'
import { planWorkoutPrescription } from '../shared/workout-prescription'

const DEFAULT_INTERVALS = { work: 30, rest: 20, rounds: 3 }

function exercise(name: string, options: Partial<ExerciseLike> = {}): ExerciseLike {
  return {
    name,
    category: 'technique',
    combo: null,
    intervals: DEFAULT_INTERVALS,
    restAfterSec: 20,
    ...options,
  }
}

function session(options: {
  warmup?: ExerciseLike[]
  main?: ExerciseLike[]
  cooldown?: ExerciseLike[]
  mainType?: string
}): WorkoutStructureLike {
  return {
    blocks: [
      {
        type: 'echauffement',
        exercises: options.warmup ?? [
          exercise('Rotations articulaires douces', { category: 'mobilite', combo: null }),
        ],
      },
      {
        type: options.mainType ?? 'technique',
        exercises: options.main ?? [exercise('Jab au sac', { combo: '1' })],
      },
      {
        type: 'retour_au_calme',
        exercises: options.cooldown ?? [
          exercise('Respiration diaphragmatique', {
            category: 'recuperation',
            combo: null,
            intervals: { work: 60, rest: 0, rounds: 2 },
          }),
        ],
      },
    ],
  }
}

describe('normalisation et signatures', () => {
  it('normalise accents, ponctuation et notation de combo', () => {
    expect(normalizeExerciseText('  Direct ARRIÈRE — au sac ! ')).toBe('direct arriere au sac')
    expect(normalizeCombo('1 → 1 / 2')).toBe('1-1-2')
  })

  it('reconnaît des noms synonymes dans la même famille de mouvement', () => {
    const directAvant = createExerciseSignature(
      exercise('Direct avant dans le vide', { combo: '1' }),
      'technique',
    )
    const jab = createExerciseSignature(exercise('Jab en shadow', { combo: '1' }), 'technique')

    expect(directAvant.movementFamily).toBe('jab')
    expect(jab.movementFamily).toBe('jab')
    expect(directAvant.modality).toBe('shadow')
    expect(jab.modality).toBe('shadow')
  })

  it('mesure séparément mouvement, combo proche et format d’intervalles', () => {
    const similarity = compareExercises(
      exercise('Jab-cross au sac', { combo: '1-2' }),
      'technique',
      exercise('Double jab-cross au sac', {
        combo: '1-1-2',
        intervals: { work: 75, rest: 15, rounds: 6 },
      }),
      'technique',
    )

    expect(similarity.movement).toBe(1)
    expect(similarity.combo).toBeGreaterThan(0.8)
    expect(similarity.combo).toBeLessThan(1)
    expect(similarity.intervals).toBeLessThan(1)
  })
})

describe('chevauchement et consolidation', () => {
  it('sépare le corps principal de l’échauffement et du retour au calme', () => {
    const previous = session({})
    const proposed = session({
      mainType: 'renforcement',
      main: [
        exercise('Squats contrôlés', { category: 'renforcement' }),
        exercise('Pompes inclinées au mur', { category: 'renforcement' }),
      ],
      cooldown: [
        exercise('Étirement doux des mollets', {
          category: 'recuperation',
          intervals: { work: 45, rest: 0, rounds: 1 },
        }),
      ],
    })

    const metrics = computeSessionOverlap(proposed, previous)

    expect(metrics.warmup.overlap).toBeGreaterThan(0.9)
    expect(metrics.main.overlap).toBe(0)
    expect(metrics.cooldown.overlap).toBe(0)
    expect(metrics.overall.overlap).toBeGreaterThan(0)
    expect(metrics.noveltyScore).toBe(1)
  })

  it('applique le budget principal documenté de 30 %', () => {
    expect(DEFAULT_VARIETY_POLICY.maxMainOverlap).toBe(0.3)
    const repeated = session({})
    const assessment = assessSessionVariety(repeated, [repeated])

    expect(assessment.previousMainOverlap).toBe(1)
    expect(assessment.accepted).toBe(false)
    expect(assessment.status).toBe('overlap_exceeded')
  })

  it('autorise un dépassement pour une consolidation intentionnelle et conserve son motif', () => {
    const repeated = session({})
    const assessment = assessSessionVariety(repeated, [repeated], {
      consolidation: {
        intentional: true,
        reason: 'Consolider le retour en garde après le jab avant de complexifier.',
      },
    })

    expect(assessment.accepted).toBe(true)
    expect(assessment.status).toBe('consolidation_allowed')
    expect(assessment.consolidationReason).toContain('retour en garde')
    expect(assessment.reason).toBe(assessment.consolidationReason)
  })
})

describe('mémoire de variété et routines sûres', () => {
  it('résume au maximum les cinq séances les plus récentes et leurs fréquences', () => {
    const history = Array.from({ length: 6 }, (_, index) => ({
      date: `2026-09-${String(10 + index).padStart(2, '0')}`,
      structure: session({}),
    }))
    const memory = buildVarietyMemory(history)

    expect(memory.sessions).toHaveLength(5)
    expect(memory.sessions[0]?.date).toBe('2026-09-15')
    expect(memory.sessions.at(-1)?.date).toBe('2026-09-11')
    expect(memory.frequenciesBySegment.main.movementFamily.jab).toBe(5)
  })

  it('expose plusieurs variantes sûres et des préférences prêtes pour le planner', () => {
    const memory = buildVarietyMemory([{ date: '2026-09-17', structure: session({}) }])
    const constraints = buildWorkoutVarietyConstraints(memory)

    expect(SAFE_WARMUP_VARIANTS.length).toBeGreaterThanOrEqual(4)
    expect(SAFE_COOLDOWN_VARIANTS.length).toBeGreaterThanOrEqual(4)
    expect(constraints.preferredWarmupVariantIds).toHaveLength(SAFE_WARMUP_VARIANTS.length)
    expect(constraints.preferredCooldownVariantIds).toHaveLength(SAFE_COOLDOWN_VARIANTS.length)
    expect(constraints.repetitionBudget.main).toBe(0.3)
  })

  it('produit des pénalités pour les signatures principales répétées', () => {
    const memory = buildVarietyMemory([
      { date: '2026-09-17', structure: session({}) },
      { date: '2026-09-15', structure: session({}) },
      { date: '2026-09-13', structure: session({}) },
    ])
    const constraints = buildWorkoutVarietyConstraints(memory)

    expect(constraints.repeatPenalties).toHaveLength(1)
    expect(constraints.repeatPenalties[0]?.frequency).toBe(3)
    expect(constraints.repeatPenalties[0]?.penalty).toBe(1)
  })

  it('se raccorde à la prescription #2 et rend les contraintes explicites dans le prompt', () => {
    const memory = buildVarietyMemory([
      { date: '2026-09-17', structure: session({}) },
      { date: '2026-09-15', structure: session({}) },
    ])
    const variety = buildWorkoutVarietyConstraints(memory, {
      intentional: true,
      reason: 'Consolider la garde après chaque direct.',
    })
    const prescription = {
      ...planWorkoutPrescription({
        today: '2026-09-18',
        targetDurationMin: 30,
        history: [],
        request: { category: 'renforcement', focus: 'fondations' },
      }),
      variety,
    }
    const prompt = buildSessionPrompt({
      dateLabel: 'vendredi 18 septembre 2026',
      context: { dureeCibleMin: 30, prescription },
    })

    expect(prompt).toContain('Chevauchement maximal du corps principal')
    expect(prompt).toContain('30 %')
    expect(prompt).toContain('Consolidation intentionnelle autorisée')
    expect(prompt).toContain('Consolider la garde après chaque direct.')
  })
})

describe('sélection d’exercices', () => {
  it('combine pertinence, prérequis, maîtrise et récence sans favoriser le plus récent', () => {
    const candidates = [
      {
        id: 'recent',
        exercise: 'Jab au sac',
        focusRelevance: 0.95,
        prerequisitesMet: true,
        masteryFit: 0.9,
        lastPerformedDate: '2026-09-17',
        recentUseCount: 3,
      },
      {
        id: 'ancien',
        exercise: 'Directs en déplacement',
        focusRelevance: 0.86,
        prerequisitesMet: true,
        masteryFit: 0.9,
        lastPerformedDate: '2026-07-01',
        recentUseCount: 0,
      },
      {
        id: 'prerequis-manquant',
        exercise: 'Combo avancé',
        focusRelevance: 1,
        prerequisitesMet: false,
        masteryFit: 1,
        lastPerformedDate: null,
      },
    ]

    const selected = selectExerciseCandidates(candidates, {
      today: '2026-09-18',
      limit: 2,
    })

    expect(selected.map(({ id }) => id)).toEqual(['ancien', 'recent'])
    expect(selected[0]!.recencyNoveltyScore).toBeGreaterThan(selected[1]!.recencyNoveltyScore)
    expect(selected.some(({ id }) => id === 'prerequis-manquant')).toBe(false)
  })
})

describe('compatibilité des anciennes séances', () => {
  it('calcule une signature après désérialisation sans exiger de nouveaux champs ni muter le JSON', () => {
    const legacyJson = JSON.stringify({
      title: 'Ancienne séance',
      focus: 'technique',
      blocks: [
        {
          type: 'technique',
          exercises: [
            {
              name: 'Direct avant',
              combo: '1',
              intervals: { work: 30, rest: 20, rounds: 3 },
            },
          ],
        },
      ],
    })
    const parsed = JSON.parse(legacyJson) as WorkoutStructureLike
    const before = JSON.stringify(parsed)
    const memory = buildVarietyMemory([{ date: '2024-01-01', structure: parsed }])

    expect(memory.sessions[0]?.segments.main[0]?.signature.movementFamily).toBe('jab')
    expect(JSON.stringify(parsed)).toBe(before)
  })
})
