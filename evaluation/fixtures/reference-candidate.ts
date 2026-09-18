import { GENERATOR_VERSIONS } from '../../shared/generator-version'
import type {
  BlockType,
  Exercise,
  ExerciseCategory,
  SessionCategory,
  WorkoutBlock,
  WorkoutFocus,
  WorkoutSession,
} from '../../shared/session-schema'
import type { CandidateRun, EvaluationCase } from '../types'
import { SYNTHETIC_CORPUS } from './corpus'

const FOCUS_COMBOS: Record<WorkoutFocus, readonly [string, string]> = {
  fondations: ['1', '1-2'],
  jeu_de_jambes: ['1-2', '1-1-2'],
  defense: ['1-2', '1-2-3'],
  crochets: ['1-2-3', '1-2-3-2'],
  uppercuts: ['1-2-5', '1-2-5-2'],
  combinaisons: ['1-2-3', '1-2-3-2'],
  puissance: ['1-2', '1-2-3-2'],
  corps: ['1-2', '1-2-5-2'],
  cardio: ['1-2', '1-1-2'],
  gainage: ['1-2', '1-2-3'],
}

const PROGRESSION_COMBO: Record<string, string> = {
  'foundation-week-1': '1',
  'foundation-week-2': '1-2',
  'foundation-week-3': '1-2-3',
  'foundation-week-4': '1-2-3-2',
}

function timedExercise(
  name: string,
  category: ExerciseCategory,
  seconds: number,
  combo: string | null,
  maxWorkSec: number,
): Exercise {
  const rounds = Math.max(1, Math.ceil(seconds / maxWorkSec))
  const work = Math.floor(seconds / rounds)
  const restAfterSec = seconds - rounds * work

  return {
    name,
    category,
    explanation: `Exécuter ${name.toLocaleLowerCase('fr')} avec une posture stable et une respiration régulière.`,
    tips: ['Garder une respiration fluide', 'Privilégier la précision'],
    commonMistakes: ['Accélérer au détriment de la posture'],
    combo,
    comboExplanation: combo ? `Combinaison numérotée ${combo}` : null,
    intervals: { work, rest: 0, rounds },
    restAfterSec,
  }
}

function block(type: BlockType, title: string, exercise: Exercise): WorkoutBlock {
  return {
    type,
    title,
    description: `Bloc synthétique ${title.toLocaleLowerCase('fr')}.`,
    exercises: [exercise],
  }
}

function mainBlockTypes(category: SessionCategory): readonly [BlockType, BlockType] {
  switch (category) {
    case 'apprentissage':
      return ['technique', 'technique']
    case 'renforcement':
      return ['technique', 'renforcement']
    case 'enchainement':
      return ['technique', 'cardio']
    case 'cardio':
      return ['cardio', 'renforcement']
    case 'recuperation':
      return ['technique', 'technique']
  }
}

function exerciseCategoryForBlock(type: BlockType): ExerciseCategory {
  switch (type) {
    case 'echauffement':
      return 'mobilite'
    case 'technique':
      return 'technique'
    case 'cardio':
      return 'cardio'
    case 'renforcement':
      return 'renforcement'
    case 'retour_au_calme':
      return 'recuperation'
  }
}

function createReferenceSession(evaluationCase: EvaluationCase): WorkoutSession {
  const { category, focus } = evaluationCase.expected
  const totalSeconds = evaluationCase.context.targetDurationMin * 60
  const warmupSeconds = Math.floor(totalSeconds * 0.15)
  const cooldownSeconds = Math.floor(totalSeconds * 0.15)
  const firstMainSeconds = Math.floor((totalSeconds - warmupSeconds - cooldownSeconds) / 2)
  const secondMainSeconds = totalSeconds - warmupSeconds - cooldownSeconds - firstMainSeconds
  const recovery = category === 'recuperation'
  const maxWorkSec = recovery ? 40 : 180
  const [firstType, secondType] = mainBlockTypes(category)
  const combo = PROGRESSION_COMBO[evaluationCase.id] ?? FOCUS_COMBOS[focus][0]
  const techniqueCombo = recovery ? null : combo
  const secondaryTechniqueCombo = recovery
    ? null
    : (PROGRESSION_COMBO[evaluationCase.id] ?? FOCUS_COMBOS[focus][1])
  const suffix = evaluationCase.sequence?.id ?? evaluationCase.id

  const firstCategory = recovery ? 'mobilite' : exerciseCategoryForBlock(firstType)
  const secondCategory = recovery ? 'recuperation' : exerciseCategoryForBlock(secondType)

  const blocks: WorkoutBlock[] = [
    block(
      'echauffement',
      'Mise en route',
      timedExercise(
        `Mobilité et shadow ${suffix}`,
        'mobilite',
        warmupSeconds,
        null,
        recovery ? 40 : 60,
      ),
    ),
    block(
      firstType,
      recovery ? 'Mobilité active' : `Travail ${focus}`,
      timedExercise(
        recovery ? `Mobilité douce ${suffix}` : `Technique ${focus} ${suffix}`,
        firstCategory,
        firstMainSeconds,
        firstCategory === 'technique' ? techniqueCombo : null,
        maxWorkSec,
      ),
    ),
    block(
      secondType,
      recovery ? 'Respiration en mouvement' : `Consolidation ${category}`,
      timedExercise(
        recovery ? `Déplacements légers ${suffix}` : `Consolidation ${focus} ${suffix}`,
        secondCategory,
        secondMainSeconds,
        secondCategory === 'technique' ? secondaryTechniqueCombo : null,
        maxWorkSec,
      ),
    ),
    block(
      'retour_au_calme',
      'Retour au calme',
      timedExercise(
        `Respiration et relâchement ${suffix}`,
        'recuperation',
        cooldownSeconds,
        null,
        recovery ? 40 : 60,
      ),
    ),
  ]

  return {
    title: evaluationCase.title,
    category,
    focus,
    summary: evaluationCase.description,
    coachNote: `Cas synthétique ${evaluationCase.id}, sans donnée utilisateur réelle.`,
    estimatedDurationMin: evaluationCase.context.targetDurationMin,
    blocks,
  }
}

const outputs = Object.fromEntries(
  SYNTHETIC_CORPUS.cases.map((evaluationCase) => [
    evaluationCase.id,
    createReferenceSession(evaluationCase),
  ]),
)

/**
 * Sorties de référence déterministes. Elles servent à exercer le banc hors ligne ;
 * elles ne prétendent pas remplacer le générateur IA de production.
 */
export const candidateRun: CandidateRun = {
  id: 'synthetic-reference/v1',
  description: 'Sorties synthétiques déterministes pour valider le banc lui-même.',
  corpusId: SYNTHETIC_CORPUS.id,
  versions: GENERATOR_VERSIONS,
  outputs,
}

export default candidateRun
