import { z } from 'zod'

/**
 * Contrat de sortie de l'IA (et de rendu côté client).
 *
 * Une séance = une suite de blocs (échauffement → technique → cardio → retour au calme).
 * Chaque bloc contient des exercices, chaque exercice définit ses propres intervalles
 * (effort / repos / rounds) que le timer enchaîne automatiquement.
 *
 * Ce schéma est la source de vérité : il sert à la fois à
 *  - forcer la sortie structurée d'Anthropic (converti en JSON Schema),
 *  - valider la réponse du modèle avant persistance,
 *  - typer la séance côté client (timer + affichage).
 */

/** Intervalle d'un exercice, en secondes. */
export const intervalSchema = z.object({
  /** Durée d'un round d'effort (secondes). */
  work: z.number().int().min(5).max(900),
  /** Repos entre deux rounds du même exercice (secondes, 0 = enchaîné). */
  rest: z.number().int().min(0).max(600),
  /** Nombre de rounds de cet exercice. */
  rounds: z.number().int().min(1).max(30),
})

export const exerciseCategory = z.enum([
  'cardio',
  'technique',
  'renforcement',
  'mobilite',
  'recuperation',
])

export const exerciseSchema = z.object({
  /** Nom court de l'exercice (ex: « Jab-Cross au sac », « Montées de genoux »). */
  name: z.string().min(1),
  /** Catégorie, pour le style d'affichage et les stats. */
  category: exerciseCategory,
  /** Explication détaillée, étape par étape (posture, exécution). */
  explanation: z.string().min(1),
  /** Conseils d'exécution (2-4 puces). */
  tips: z.array(z.string()).default([]),
  /** Erreurs fréquentes à éviter. */
  commonMistakes: z.array(z.string()).default([]),
  /** Combo en notation numérotée boxe anglaise, ex: "1-2", "1-1-2", "1-2-3-2". Null si N/A. */
  combo: z.string().nullable().default(null),
  /** Décodage du combo (ex: "1 = jab, 2 = cross direct arrière"). Null si pas de combo. */
  comboExplanation: z.string().nullable().default(null),
  /** Intervalles effort/repos/rounds pour le timer. */
  intervals: intervalSchema,
  /** Repos après cet exercice avant le suivant (secondes). */
  restAfterSec: z.number().int().min(0).max(300).default(30),
})

export const blockType = z.enum([
  'echauffement',
  'technique',
  'cardio',
  'renforcement',
  'retour_au_calme',
])

export const blockSchema = z.object({
  type: blockType,
  /** Titre du bloc affiché à l'utilisateur. */
  title: z.string().min(1),
  /** Objectif du bloc en une phrase. */
  description: z.string().min(1),
  exercises: z.array(exerciseSchema).min(1),
})

export const workoutFocus = z.enum(['cardio', 'technique', 'mixte', 'recuperation'])

export const workoutSessionSchema = z.object({
  /** Titre accrocheur de la séance du jour. */
  title: z.string().min(1),
  /** Dominante de la séance. */
  focus: workoutFocus,
  /** Résumé en 1-2 phrases de ce qui attend l'utilisateur. */
  summary: z.string().min(1),
  /**
   * Mot du coach : pourquoi CETTE séance aujourd'hui, en lien avec l'historique,
   * les feedbacks récents et la progression. Ton motivant et personnalisé.
   */
  coachNote: z.string().min(1),
  /** Durée totale estimée de la séance (minutes). */
  estimatedDurationMin: z.number().int().min(10).max(90),
  blocks: z.array(blockSchema).min(1),
})

export type Interval = z.infer<typeof intervalSchema>
export type Exercise = z.infer<typeof exerciseSchema>
export type ExerciseCategory = z.infer<typeof exerciseCategory>
export type WorkoutBlock = z.infer<typeof blockSchema>
export type BlockType = z.infer<typeof blockType>
export type WorkoutFocus = z.infer<typeof workoutFocus>
export type WorkoutSession = z.infer<typeof workoutSessionSchema>

/** Libellés FR pour l'affichage des types de bloc. */
export const BLOCK_LABELS: Record<BlockType, string> = {
  echauffement: 'Échauffement',
  technique: 'Technique',
  cardio: 'Cardio',
  renforcement: 'Renforcement',
  retour_au_calme: 'Retour au calme',
}

/** Notation numérotée standard de la boxe anglaise (pour l'aide à l'affichage). */
export const PUNCH_NOTATION: Record<string, string> = {
  '1': 'Jab (bras avant)',
  '2': 'Cross / direct arrière',
  '3': 'Crochet avant',
  '4': 'Crochet arrière',
  '5': 'Uppercut avant',
  '6': 'Uppercut arrière',
}

const PUNCH_SHORT: Record<string, string> = {
  '1': 'jab',
  '2': 'cross',
  '3': 'crochet avant',
  '4': 'crochet arrière',
  '5': 'uppercut avant',
  '6': 'uppercut arrière',
}

/** Traduit un combo « 1-2-3 » en « jab → cross → crochet avant ». */
export function comboToText(combo: string): string {
  return combo
    .split('-')
    .map((n) => PUNCH_SHORT[n.trim()] ?? n.trim())
    .join(' → ')
}

/** Durée totale d'un exercice en secondes (rounds d'effort + repos inter-rounds + repos après). */
export function estimateExerciseSeconds(exercise: Exercise): number {
  const { work, rest, rounds } = exercise.intervals
  return rounds * work + Math.max(0, rounds - 1) * rest + (exercise.restAfterSec ?? 0)
}

/** Durée totale estimée d'une séance en secondes. */
export function estimateSessionSeconds(session: WorkoutSession): number {
  let total = 0
  for (const block of session.blocks) {
    for (const exercise of block.exercises) {
      total += estimateExerciseSeconds(exercise)
    }
  }
  return total
}
