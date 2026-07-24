// Helpers de séance partagés (validés/testés dans shared/), ré-exportés pour l'auto-import client.
import type { WorkoutSession } from '~~/shared/session-schema'

export type {
  Exercise,
  WorkoutBlock,
  WorkoutSession,
  SessionCategory,
  WorkoutFocus,
} from '~~/shared/session-schema'
export {
  comboToText,
  estimateExerciseSeconds,
  estimateSessionSeconds,
  SESSION_CATEGORY_META,
  FOCUS_META,
  focusLabel,
  categoryLabel,
} from '~~/shared/session-schema'
export type { FocusRecommendation } from '~~/shared/recommendations'

export type SessionStatus = 'planned' | 'generated' | 'in_progress' | 'completed' | 'skipped'

export interface ApiSession {
  id: number
  date: string
  status: SessionStatus
  title: string
  /** Catégorie (type) de la séance ; null pour les séances antérieures au champ. */
  category: string | null
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
  /** La séance du jour a été volontairement supprimée/déplacée : pas de régénération auto. */
  dismissed: boolean
  generating: boolean
}

/** Intention de planification (séance pas forcément encore générée). */
export interface ApiSessionPlan {
  date: string
  /** Null = catégorie laissée au choix de l'IA. */
  category: string | null
  focus: string | null
  /** Thème libre d'une séance sur mesure (ex : « pectoraux ») ; prime sur `focus`. */
  customFocus: string | null
  /** Durée voulue pour cette séance (minutes) ; null = durée cible des réglages. */
  durationMin: number | null
  note: string | null
}

/** Résumé léger d'une séance pour le calendrier. */
export interface CalendarSession {
  date: string
  status: SessionStatus
  title: string
  category: string | null
  focus: string
  estimatedDurationMin: number
  completedAt: number | null
}

/** Une case du calendrier : jour d'entraînement ou non, séance et/ou intention. */
export interface CalendarDay {
  date: string
  isTrainingDay: boolean
  session: CalendarSession | null
  plan: ApiSessionPlan | null
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

// FOCUS_META / SESSION_CATEGORY_META sont désormais ré-exportés depuis ~~/shared/session-schema.
