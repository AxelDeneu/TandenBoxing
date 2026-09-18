import { describe, expect, it, vi } from 'vitest'
import {
  GeneratedSessionValidationError,
  resolveGeneratedSession,
  type GenerationValidationAttempt,
} from '../shared/session-generation-policy'
import {
  MIN_TARGET_DURATION_RATIO,
  validateSessionPolicy,
  type SessionPolicyRequest,
} from '../shared/session-policy'
import type {
  BlockType,
  Exercise,
  ExerciseCategory,
  SessionCategory,
  WorkoutBlock,
  WorkoutSession,
} from '../shared/session-schema'

function makeExercise(
  seconds: number,
  category: ExerciseCategory = 'mobilite',
  combo: string | null = null,
): Exercise {
  return {
    name: 'Exercice',
    category,
    explanation: 'Consigne',
    tips: [],
    commonMistakes: [],
    skillIds: [],
    combo,
    comboExplanation: combo ? 'Décodage' : null,
    intervals: { work: seconds, rest: 0, rounds: 1 },
    restAfterSec: 0,
  }
}

function makeBlock(
  type: BlockType,
  seconds: number,
  exerciseCategory: ExerciseCategory,
  combo: string | null = null,
): WorkoutBlock {
  return {
    type,
    title: type,
    description: type,
    exercises: [makeExercise(seconds, exerciseCategory, combo)],
  }
}

function makeSession(
  category: SessionCategory = 'apprentissage',
  blocks: WorkoutBlock[] = [
    makeBlock('echauffement', 60, 'mobilite'),
    makeBlock('technique', 300, 'technique', '1-2'),
    makeBlock('cardio', 180, 'cardio'),
    makeBlock('retour_au_calme', 60, 'recuperation'),
  ],
): WorkoutSession {
  return {
    title: 'Séance',
    curriculumVersion: 1,
    category,
    focus: 'uppercuts',
    summary: 'Résumé',
    coachNote: 'Note',
    estimatedDurationMin: 10,
    blocks,
  }
}

const DEFAULT_REQUEST: SessionPolicyRequest = { targetDurationMin: 10 }

function violationCodes(session: WorkoutSession, request = DEFAULT_REQUEST): string[] {
  return validateSessionPolicy(session, request).violations.map((violation) => violation.code)
}

describe('validateSessionPolicy — structure et durée', () => {
  it('accepte une séance valide qui remplit exactement la cible', () => {
    const result = validateSessionPolicy(makeSession(), DEFAULT_REQUEST)

    expect(result.valid).toBe(true)
    expect(result.durationSeconds).toBe(600)
    expect(result.minimumDurationSeconds).toBe(540)
    expect(MIN_TARGET_DURATION_RATIO).toBe(0.9)
  })

  it('exige un échauffement en premier et un retour au calme en dernier', () => {
    const session = makeSession()
    session.blocks[0] = makeBlock('technique', 60, 'technique', '1')
    session.blocks[session.blocks.length - 1] = makeBlock('cardio', 60, 'cardio')

    expect(violationCodes(session)).toEqual(
      expect.arrayContaining(['FIRST_BLOCK_MUST_BE_WARMUP', 'LAST_BLOCK_MUST_BE_COOLDOWN']),
    )
  })

  it('accepte exactement 90 % de la cible et rejette une seconde de moins', () => {
    const atMinimum = makeSession('apprentissage', [
      makeBlock('echauffement', 60, 'mobilite'),
      makeBlock('technique', 300, 'technique', '1-2'),
      makeBlock('cardio', 120, 'cardio'),
      makeBlock('retour_au_calme', 60, 'recuperation'),
    ])
    const belowMinimum = structuredClone(atMinimum)
    belowMinimum.blocks[2]!.exercises[0]!.intervals.work = 119

    expect(validateSessionPolicy(atMinimum, DEFAULT_REQUEST).valid).toBe(true)
    expect(violationCodes(belowMinimum)).toContain('DURATION_BELOW_MINIMUM')
  })

  it('accepte exactement la cible et rejette une seconde de plus', () => {
    const atTarget = makeSession()
    const aboveTarget = structuredClone(atTarget)
    aboveTarget.blocks[2]!.exercises[0]!.intervals.work = 181

    expect(validateSessionPolicy(atTarget, DEFAULT_REQUEST).valid).toBe(true)
    expect(violationCodes(aboveTarget)).toContain('DURATION_EXCEEDS_TARGET')
  })
})

describe('validateSessionPolicy — demande explicite et combos', () => {
  it('signale une catégorie et un focus imposés non respectés', () => {
    const codes = violationCodes(makeSession(), {
      targetDurationMin: 10,
      requestedCategory: 'cardio',
      requestedFocus: 'defense',
    })

    expect(codes).toEqual(expect.arrayContaining(['CATEGORY_MISMATCH', 'FOCUS_MISMATCH']))
  })

  it("conserve le mapping vers l'enum quand le focus est libre", () => {
    const codes = violationCodes(makeSession(), {
      targetDurationMin: 10,
      requestedFocus: 'defense',
      hasCustomFocus: true,
    })

    expect(codes).not.toContain('FOCUS_MISMATCH')
  })

  it('accepte uniquement les combos non nuls composés de 1 à 6 séparés par des tirets', () => {
    const valid = makeSession()
    valid.blocks[1]!.exercises[0]!.combo = '1-2-3-6'
    const invalid = structuredClone(valid)
    invalid.blocks[1]!.exercises.push(makeExercise(5, 'technique', '1 - 7'))

    expect(violationCodes(valid)).not.toContain('INVALID_COMBO_NOTATION')
    expect(violationCodes(invalid)).toContain('INVALID_COMBO_NOTATION')
  })
})

describe('validateSessionPolicy — profils de catégorie', () => {
  it.each<[SessionCategory, WorkoutBlock[]]>([
    ['apprentissage', makeSession().blocks],
    [
      'renforcement',
      [
        makeBlock('echauffement', 60, 'mobilite'),
        makeBlock('renforcement', 480, 'renforcement'),
        makeBlock('retour_au_calme', 60, 'recuperation'),
      ],
    ],
    [
      'enchainement',
      [
        makeBlock('echauffement', 60, 'mobilite'),
        makeBlock('technique', 240, 'technique', '1-2-3'),
        makeBlock('cardio', 240, 'cardio'),
        makeBlock('retour_au_calme', 60, 'recuperation'),
      ],
    ],
    [
      'cardio',
      [
        makeBlock('echauffement', 60, 'mobilite'),
        makeBlock('cardio', 480, 'cardio'),
        makeBlock('retour_au_calme', 60, 'recuperation'),
      ],
    ],
    [
      'recuperation',
      [
        // Une montée cardiaque progressive reste autorisée dans le bloc de bord.
        makeBlock('echauffement', 60, 'cardio'),
        makeBlock('technique', 480, 'mobilite'),
        makeBlock('retour_au_calme', 60, 'recuperation'),
      ],
    ],
  ])('accepte le profil minimal %s', (category, blocks) => {
    expect(validateSessionPolicy(makeSession(category, blocks), DEFAULT_REQUEST).valid).toBe(true)
  })

  it('rejette une catégorie dont le bloc dominant requis est insuffisant', () => {
    const session = makeSession('cardio', [
      makeBlock('echauffement', 60, 'mobilite'),
      makeBlock('technique', 360, 'technique', '1-2'),
      makeBlock('cardio', 120, 'cardio'),
      makeBlock('retour_au_calme', 60, 'recuperation'),
    ])

    expect(violationCodes(session)).toContain('CATEGORY_PROFILE_MISMATCH')
  })

  it('interdit les blocs et exercices cardio/renforcement en récupération', () => {
    const session = makeSession('recuperation', [
      makeBlock('echauffement', 60, 'mobilite'),
      makeBlock('cardio', 480, 'renforcement'),
      makeBlock('retour_au_calme', 60, 'recuperation'),
    ])

    const highIntensityViolations = validateSessionPolicy(
      session,
      DEFAULT_REQUEST,
    ).violations.filter((violation) => violation.code === 'RECOVERY_HIGH_INTENSITY')
    expect(highIntensityViolations).toHaveLength(2)
  })

  it('retourne plusieurs violations dans un même résultat', () => {
    const session = makeSession('cardio', [
      makeBlock('technique', 60, 'technique', 'jab-cross'),
      makeBlock('technique', 100, 'technique', '1-2'),
      makeBlock('cardio', 60, 'cardio'),
    ])

    expect(violationCodes(session)).toEqual(
      expect.arrayContaining([
        'FIRST_BLOCK_MUST_BE_WARMUP',
        'LAST_BLOCK_MUST_BE_COOLDOWN',
        'DURATION_BELOW_MINIMUM',
        'INVALID_COMBO_NOTATION',
        'CATEGORY_PROFILE_MISMATCH',
      ]),
    )
  })
})

describe('resolveGeneratedSession', () => {
  it('retourne une correction valide après une première violation', async () => {
    const invalid = makeSession()
    invalid.blocks[0]!.type = 'technique'
    const corrected = makeSession()
    const correct = vi.fn().mockResolvedValue(corrected)

    await expect(
      resolveGeneratedSession(invalid, { policy: DEFAULT_REQUEST, correct }),
    ).resolves.toEqual(corrected)
    expect(correct).toHaveBeenCalledOnce()
    expect(correct.mock.calls[0]![1]).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'FIRST_BLOCK_MUST_BE_WARMUP' })]),
    )
  })

  it('peut corriger une sortie qui échoue au schéma', async () => {
    const correct = vi.fn().mockResolvedValue(makeSession())

    await expect(
      resolveGeneratedSession({ title: 'incomplète' }, { policy: DEFAULT_REQUEST, correct }),
    ).resolves.toEqual(makeSession())
    expect(correct.mock.calls[0]![1]).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'SCHEMA_INVALID' })]),
    )
  })

  it('échoue après une seule correction invalide et ne fournit rien à persister', async () => {
    const invalid = makeSession()
    invalid.blocks[0]!.type = 'technique'
    const correct = vi.fn().mockResolvedValue(invalid)
    const persist = vi.fn()
    const attempts: GenerationValidationAttempt[] = []

    await expect(
      resolveGeneratedSession(invalid, {
        policy: DEFAULT_REQUEST,
        correct,
        onInvalid: (attempt) => attempts.push(attempt),
      }).then(persist),
    ).rejects.toBeInstanceOf(GeneratedSessionValidationError)
    expect(correct).toHaveBeenCalledOnce()
    expect(attempts).toEqual(['initial', 'corrected'])
    expect(persist).not.toHaveBeenCalled()
  })
})
