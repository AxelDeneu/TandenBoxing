export type { Exercise, WorkoutBlock, WorkoutSession } from '~~/shared/session-schema'
import type { WorkoutSession } from '~~/shared/session-schema'

export type SessionStatus = 'planned' | 'generated' | 'in_progress' | 'completed' | 'skipped'

export interface ApiSession {
  id: number
  date: string
  status: SessionStatus
  title: string
  focus: string
  summary: string
  coachNote: string
  targetDurationMin: number
  estimatedDurationMin: number
  structure: WorkoutSession
  aiModel: string
  generatedAt: number | null
  startedAt: number | null
  completedAt: number | null
  actualDurationSec: number | null
}

export interface TodayResponse {
  date: string
  isTrainingDay: boolean
  hasApiKey: boolean
  onboardingCompleted: boolean
  session: ApiSession | null
  generating: boolean
}

interface IntervalLike {
  intervals: { work: number; rest: number; rounds: number }
  restAfterSec?: number
}

/** Durée d'un exercice en secondes (rounds + repos inter-rounds + repos après). */
export function estimateExerciseSeconds(exercise: IntervalLike): number {
  const { work, rest, rounds } = exercise.intervals
  return rounds * work + Math.max(0, rounds - 1) * rest + (exercise.restAfterSec ?? 0)
}

/** Durée totale estimée d'une séance en secondes. */
export function estimateSessionSeconds(session: WorkoutSession): number {
  let total = 0
  for (const block of session.blocks) {
    for (const exercise of block.exercises) total += estimateExerciseSeconds(exercise)
  }
  return total
}

export const CATEGORY_META = {
  cardio: { label: 'Cardio', icon: 'i-lucide-heart-pulse', iconClass: 'text-rose-400' },
  technique: { label: 'Technique', icon: 'i-lucide-target', iconClass: 'text-red-400' },
  renforcement: { label: 'Renforcement', icon: 'i-lucide-dumbbell', iconClass: 'text-amber-400' },
  mobilite: { label: 'Mobilité', icon: 'i-lucide-move', iconClass: 'text-sky-400' },
  recuperation: { label: 'Récupération', icon: 'i-lucide-leaf', iconClass: 'text-emerald-400' },
} as const

export const BLOCK_META: Record<string, { label: string; icon: string }> = {
  echauffement: { label: 'Échauffement', icon: 'i-lucide-flame' },
  technique: { label: 'Technique', icon: 'i-lucide-target' },
  cardio: { label: 'Cardio', icon: 'i-lucide-heart-pulse' },
  renforcement: { label: 'Renforcement', icon: 'i-lucide-dumbbell' },
  retour_au_calme: { label: 'Retour au calme', icon: 'i-lucide-leaf' },
}

export const FOCUS_META: Record<string, { label: string; icon: string }> = {
  cardio: { label: 'Cardio', icon: 'i-lucide-heart-pulse' },
  technique: { label: 'Technique', icon: 'i-lucide-target' },
  mixte: { label: 'Mixte', icon: 'i-lucide-layers' },
  recuperation: { label: 'Récupération', icon: 'i-lucide-leaf' },
}

const PUNCH: Record<string, string> = {
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
    .map((n) => PUNCH[n.trim()] ?? n.trim())
    .join(' → ')
}
