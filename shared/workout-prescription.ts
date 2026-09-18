import { z } from 'zod'
import { daysBetween } from './dates'
import { detectFatigue, recommendFocuses, type RecoHistoryEntry } from './recommendations'
import {
  blockType,
  sessionCategory,
  workoutFocus,
  type BlockType,
  type SessionCategory,
  type WorkoutFocus,
} from './session-schema'
import type { WorkoutVarietyConstraints } from './session-variety'

/** Budget en secondes pour chaque type de bloc générable. Une valeur nulle interdit le bloc. */
export const blockBudgetsSchema = z.object({
  echauffement: z.number().int().nonnegative(),
  technique: z.number().int().nonnegative(),
  cardio: z.number().int().nonnegative(),
  renforcement: z.number().int().nonnegative(),
  retour_au_calme: z.number().int().nonnegative(),
})

/**
 * Décisions produit prises avant l'appel au fournisseur IA.
 *
 * Ce contrat est aussi le point d'entrée attendu de la politique de validation : la sortie
 * du modèle devra respecter la catégorie, le focus, la durée et les budgets prescrits ici.
 */
export const workoutPrescriptionSchema = z.object({
  category: sessionCategory,
  focus: workoutFocus,
  /** Intensité globale de 1 (récupération) à 5 (très soutenue). */
  intensity: z.number().int().min(1).max(5),
  targetSeconds: z.number().int().min(600).max(5_400),
  blockBudgets: blockBudgetsSchema,
  /** Nombre maximal de techniques réellement nouvelles à introduire dans la séance. */
  maxNewTechniques: z.number().int().min(0).max(2),
  sources: z.object({
    category: z.enum(['explicit', 'recommendation']),
    focus: z.enum(['explicit', 'custom-focus', 'recommendation']),
    duration: z.enum(['explicit', 'settings']),
  }),
  signals: z.object({
    fatigued: z.boolean(),
    returningAfterBreak: z.boolean(),
    constrained: z.boolean(),
  }),
})

export type BlockBudgets = z.infer<typeof blockBudgetsSchema>
export type WorkoutPrescription = z.infer<typeof workoutPrescriptionSchema>
/** Prescription enrichie à la frontière serveur par la mémoire pure de l'issue #3. */
export type VarietyAwareWorkoutPrescription = WorkoutPrescription & {
  variety: WorkoutVarietyConstraints
}

export interface WorkoutPrescriptionRequest {
  category?: SessionCategory | null
  focus?: WorkoutFocus | null
  /** Thème libre : quelques thèmes usuels peuvent être rapprochés d'un focus de façon déterministe. */
  customFocus?: string | null
  durationMin?: number | null
  note?: string | null
}

export interface PrescriptionSkippedEntry {
  date: string
  reason?: string | null
}

export interface WorkoutPrescriptionInput {
  today: string
  targetDurationMin: number
  history: RecoHistoryEntry[]
  skipped?: PrescriptionSkippedEntry[]
  /** Contraintes connues du profil, sans interprétation par un modèle. */
  constraints?: string | null
  request?: WorkoutPrescriptionRequest
}

export interface WorkoutPrescriptionProfile {
  /** Intensité par défaut de la catégorie, sur une échelle de 1 à 5. */
  intensity: number
  /** Pourcentages entiers dont la somme vaut exactement 100. */
  blockWeights: Record<BlockType, number>
  maxNewTechniques: number
}

/**
 * Profils mesurables des cinq catégories.
 *
 * - apprentissage : la technique domine, avec peu de densité cardio ;
 * - renforcement : technique et renforcement se partagent le cœur de séance ;
 * - enchainement : volume technique soutenu et transitions cardio ;
 * - cardio : le conditionnement domine, sans nouvelle technique ;
 * - recuperation : mobilité, technique légère et retour au calme, sans bloc intense.
 */
export const WORKOUT_PRESCRIPTION_PROFILES: Record<SessionCategory, WorkoutPrescriptionProfile> = {
  apprentissage: {
    intensity: 2,
    blockWeights: {
      echauffement: 15,
      technique: 55,
      cardio: 10,
      renforcement: 5,
      retour_au_calme: 15,
    },
    maxNewTechniques: 1,
  },
  renforcement: {
    intensity: 3,
    blockWeights: {
      echauffement: 15,
      technique: 35,
      cardio: 15,
      renforcement: 20,
      retour_au_calme: 15,
    },
    maxNewTechniques: 0,
  },
  enchainement: {
    intensity: 4,
    blockWeights: {
      echauffement: 12,
      technique: 50,
      cardio: 23,
      renforcement: 5,
      retour_au_calme: 10,
    },
    maxNewTechniques: 1,
  },
  cardio: {
    intensity: 5,
    blockWeights: {
      echauffement: 12,
      technique: 15,
      cardio: 58,
      renforcement: 5,
      retour_au_calme: 10,
    },
    maxNewTechniques: 0,
  },
  recuperation: {
    intensity: 1,
    blockWeights: {
      echauffement: 30,
      technique: 25,
      cardio: 0,
      renforcement: 0,
      retour_au_calme: 45,
    },
    maxNewTechniques: 0,
  },
}

const RECOVERY_CONSTRAINT =
  /\b(fatigu|epuis|bless|douleur|courbature|malade|maladie|reprise|repos|convalesc)/i

/** Normalise uniquement pour faire des correspondances déterministes, sans modifier le texte source. */
function normalize(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
}

/** Rapproche les thèmes libres usuels d'un focus ; les thèmes inconnus restent à l'heuristique. */
function focusForCustomRequest(customFocus: string | null | undefined): WorkoutFocus | null {
  if (!customFocus?.trim()) return null
  const value = normalize(customFocus)
  const mappings: Array<[RegExp, WorkoutFocus]> = [
    [/uppercut/, 'uppercuts'],
    [/crochet/, 'crochets'],
    [/combi|enchain/, 'combinaisons'],
    [/defen|esquiv|blocage/, 'defense'],
    [/jambe|appui|deplac|pivot|distance/, 'jeu_de_jambes'],
    [/cardio|endurance|souffle|hiit/, 'cardio'],
    [/gainage|abdo|ceinture|core/, 'gainage'],
    [/puissance|explosi|force|pector|pompe|biceps|triceps/, 'puissance'],
    [/travail au corps|frappe au corps|plexus|flanc/, 'corps'],
    [/garde|posture|jab|cross|direct|fondation/, 'fondations'],
  ]
  return mappings.find(([pattern]) => pattern.test(value))?.[1] ?? null
}

/** Répartit tous les secondes par la méthode des plus grands restes, donc sans perte d'arrondi. */
function allocateBlockBudgets(
  targetSeconds: number,
  weights: Record<BlockType, number>,
): BlockBudgets {
  const orderedTypes = blockType.options as BlockType[]
  const exact = orderedTypes.map((type, index) => ({
    type,
    index,
    value: (targetSeconds * weights[type]) / 100,
  }))
  const budgets = Object.fromEntries(
    exact.map(({ type, value }) => [type, Math.floor(value)]),
  ) as BlockBudgets
  const remaining = targetSeconds - Object.values(budgets).reduce((sum, value) => sum + value, 0)

  const largestRemainders = [...exact].sort((a, b) => {
    const fractionDiff = (b.value % 1) - (a.value % 1)
    return fractionDiff || a.index - b.index
  })
  for (let i = 0; i < remaining; i += 1) {
    const type = largestRemainders[i]!.type
    budgets[type] += 1
  }
  return budgets
}

function isReturningAfterBreak(input: WorkoutPrescriptionInput): boolean {
  const pastCompleted = input.history
    .filter((entry) => entry.completed && entry.date < input.today)
    .sort((a, b) => (a.date < b.date ? 1 : -1))
  const daysSinceLastSession = pastCompleted[0]
    ? daysBetween(pastCompleted[0].date, input.today)
    : null
  const recentSkips = (input.skipped ?? []).filter((entry) => {
    const age = daysBetween(entry.date, input.today)
    return age >= 0 && age <= 21
  }).length

  return (daysSinceLastSession != null && daysSinceLastSession >= 14) || recentSkips >= 2
}

/**
 * Produit toujours la même prescription pour la même entrée. Aucun appel réseau, accès DB,
 * horloge implicite ou tirage aléatoire n'intervient dans la décision.
 */
export function planWorkoutPrescription(input: WorkoutPrescriptionInput): WorkoutPrescription {
  const request = input.request ?? {}
  const recommended = recommendFocuses({ today: input.today, history: input.history, limit: 1 })[0]!
  const completed = input.history.filter((entry) => entry.completed)
  const fatigued = detectFatigue(input.today, completed).fatigued
  const returningAfterBreak = isReturningAfterBreak(input)
  const constraintText = [
    input.constraints,
    request.note,
    ...(input.skipped ?? []).map((entry) => entry.reason),
  ]
    .filter((value): value is string => Boolean(value))
    .map(normalize)
    .join(' ')
  const constrained = RECOVERY_CONSTRAINT.test(constraintText)

  const category = request.category ?? (constrained ? 'recuperation' : recommended.category)
  const mappedCustomFocus = focusForCustomRequest(request.customFocus)
  const focus = request.focus ?? mappedCustomFocus ?? recommended.focus
  const targetDurationMin = request.durationMin ?? input.targetDurationMin
  if (!Number.isInteger(targetDurationMin) || targetDurationMin < 10 || targetDurationMin > 90) {
    throw new RangeError(
      'La durée cible doit être un nombre entier compris entre 10 et 90 minutes.',
    )
  }

  const profile = WORKOUT_PRESCRIPTION_PROFILES[category]
  const shouldReduceLoad = fatigued || constrained || returningAfterBreak
  const intensity = returningAfterBreak
    ? 1
    : shouldReduceLoad
      ? Math.max(1, profile.intensity - 1)
      : profile.intensity
  const targetSeconds = targetDurationMin * 60

  return workoutPrescriptionSchema.parse({
    category,
    focus,
    intensity,
    targetSeconds,
    blockBudgets: allocateBlockBudgets(targetSeconds, profile.blockWeights),
    maxNewTechniques: shouldReduceLoad ? 0 : profile.maxNewTechniques,
    sources: {
      category: request.category ? 'explicit' : 'recommendation',
      focus: request.focus ? 'explicit' : mappedCustomFocus ? 'custom-focus' : 'recommendation',
      duration: request.durationMin != null ? 'explicit' : 'settings',
    },
    signals: { fatigued, returningAfterBreak, constrained },
  })
}
