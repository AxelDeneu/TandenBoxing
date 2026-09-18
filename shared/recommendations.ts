import { daysBetween } from './dates'
import { getCurriculumSkill, skillIdsForFocus, type SkillId } from './curriculum'
import {
  buildSkillProgression,
  type SkillExposure,
  type SkillProgressionSnapshot,
} from './skill-mastery'
import {
  sessionCategory,
  workoutFocus,
  type SessionCategory,
  type WorkoutFocus,
} from './session-schema'

/**
 * Recommandation de focus/catégorie — cœur pur et testable.
 *
 * À partir de l'historique (couples catégorie+focus datés, faits ou non), propose les
 * prochains couples (catégorie, focus) les plus pertinents. Sert de base au service IA
 * ET de repli hors-ligne (pas de clé API). Aucune dépendance Vue/serveur.
 */

export interface RecoHistoryEntry {
  date: string
  category: string | null
  focus: string
  /** true si la séance a été effectivement complétée (sinon : planifiée non faite / skippée). */
  completed: boolean
  difficulty?: number | null
  energy?: number | null
}

export interface FocusRecommendation {
  category: SessionCategory
  focus: WorkoutFocus
  reason: string
  /** Score de priorité (plus haut = plus recommandé) — surtout utile pour les tests. */
  score: number
}

export interface RecommendationInput {
  today: string
  history: RecoHistoryEntry[]
  /** État calculé par #4. Sans valeur, l'historique de focus est inféré (jamais un compteur seul). */
  skillProgression?: SkillProgressionSnapshot
  /** Focus candidats (défaut : tous). */
  focuses?: WorkoutFocus[]
  /** Nombre de recommandations (défaut : 4). */
  limit?: number
}

interface FocusStat {
  count: number
  lastDate: string | null
  daysSince: number | null
}

/** Repli compatible avec les appelants historiques qui ne disposent que d'un focus par séance. */
function progressionFromHistory(
  today: string,
  history: RecoHistoryEntry[],
): SkillProgressionSnapshot {
  const exposures: SkillExposure[] = history.flatMap((entry, index) =>
    skillIdsForFocus(entry.focus).map((skillId) => ({
      sessionKey: `${entry.date}:${entry.focus}:${index}`,
      date: entry.date,
      skillId,
      completed: entry.completed,
      difficulty: entry.difficulty ?? null,
      energy: entry.energy ?? null,
      source: 'inferred_focus',
    })),
  )
  return buildSkillProgression(today, exposures)
}

const RECOVERY_FOCUS: WorkoutFocus = 'fondations'

/** Détecte un besoin de récupération à partir des séances récentes. */
export function detectFatigue(
  today: string,
  completed: RecoHistoryEntry[],
): { fatigued: boolean; reason: string } {
  const recent = completed
    .filter((e) => daysBetween(e.date, today) <= 10)
    .sort((a, b) => (a.date < b.date ? 1 : -1))

  const last3d = recent.filter((e) => daysBetween(e.date, today) <= 3).length
  if (last3d >= 3) {
    return {
      fatigued: true,
      reason: `${last3d} séances en 3 jours — accorde-toi une récupération.`,
    }
  }

  const window = recent.slice(0, 4)
  const diffs = window.map((e) => e.difficulty).filter((v): v is number => v != null)
  const energies = window.map((e) => e.energy).filter((v): v is number => v != null)
  const avg = (arr: number[]) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null)
  const avgDiff = avg(diffs)
  const avgEnergy = avg(energies)

  if (avgDiff != null && avgDiff >= 4) {
    return {
      fatigued: true,
      reason: 'Séances récentes éprouvantes — allège avec de la récupération.',
    }
  }
  if (avgEnergy != null && avgEnergy <= 2) {
    return {
      fatigued: true,
      reason: 'Énergie basse ces derniers temps — une séance de récupération aiderait.',
    }
  }
  return { fatigued: false, reason: '' }
}

function categoryForProgression(
  focus: WorkoutFocus,
  progression: SkillProgressionSnapshot,
): SessionCategory | null {
  if (focus === 'cardio') return 'cardio'
  if (focus === 'gainage') return 'renforcement'

  const skillIds = skillIdsForFocus(focus)
  if (!skillIds.length) return null
  if (skillIds.some((id) => progression.eligibleNewSkillIds.includes(id))) return 'apprentissage'
  if (skillIds.some((id) => progression.mastery[id].state === 'en_consolidation')) {
    return 'renforcement'
  }
  if (skillIds.some((id) => progression.mastery[id].state === 'acquis')) return 'enchainement'
  // Toutes les compétences de ce focus sont nouvelles mais leurs prérequis manquent.
  return null
}

function labels(ids: SkillId[]): string {
  return ids.map((id) => getCurriculumSkill(id).label).join(', ')
}

function reasonForFocus(
  focus: WorkoutFocus,
  stat: FocusStat,
  category: SessionCategory,
  progression: SkillProgressionSnapshot,
): string {
  const skillIds = skillIdsForFocus(focus)
  if (category === 'apprentissage') {
    const eligible = skillIds.filter((id) => progression.eligibleNewSkillIds.includes(id))
    return `Nouveauté éligible : ${labels(eligible.slice(0, 1))}.`
  }
  if (category === 'renforcement' && skillIds.length) {
    const review = skillIds.filter((id) => progression.mastery[id].state === 'en_consolidation')
    const exposureCount = review.reduce((total, id) => total + progression.mastery[id].exposures, 0)
    return `${labels(review.slice(0, 2))} à consolider (${exposureCount} exposition(s)).`
  }
  if (category === 'enchainement' && skillIds.length) {
    const acquired = skillIds.filter((id) => progression.mastery[id].state === 'acquis')
    return `Acquis à relier : ${labels(acquired.slice(0, 2))}.`
  }
  if (stat.count === 0) return 'Complément physique jamais travaillé.'
  const since =
    stat.daysSince != null && stat.daysSince > 0
      ? `Pas retravaillé depuis ${stat.daysSince} j`
      : 'Travaillé récemment'
  return `${since} (${stat.count}×).`
}

/**
 * Classe les prochains couples (catégorie, focus) à travailler.
 * Priorise les focus négligés (jamais faits d'abord, puis les plus anciens), et insère une
 * recommandation de récupération en tête si des signaux de fatigue sont détectés.
 */
export function recommendFocuses(input: RecommendationInput): FocusRecommendation[] {
  const { today, history } = input
  const progression = input.skillProgression ?? progressionFromHistory(today, history)
  const focuses = input.focuses ?? (workoutFocus.options as WorkoutFocus[])
  const limit = input.limit ?? 4
  const completed = history.filter((e) => e.completed)

  const stats = new Map<WorkoutFocus, FocusStat>()
  focuses.forEach((f) => stats.set(f, { count: 0, lastDate: null, daysSince: null }))
  for (const e of completed) {
    const s = stats.get(e.focus as WorkoutFocus)
    if (!s) continue
    s.count += 1
    if (!s.lastDate || e.date > s.lastDate) {
      s.lastDate = e.date
      s.daysSince = daysBetween(e.date, today)
    }
  }

  // Score de négligence : jamais fait = très prioritaire ; sinon d'autant plus que c'est ancien.
  const NEVER = 9999
  const ordered = [...focuses].sort((a, b) => {
    const sa = stats.get(a)!
    const sb = stats.get(b)!
    const na = sa.daysSince ?? NEVER
    const nb = sb.daysSince ?? NEVER
    if (na !== nb) return nb - na // plus grand daysSince d'abord
    // Départage : ordre pédagogique de l'enum (fondations en premier).
    return focuses.indexOf(a) - focuses.indexOf(b)
  })

  const recos: FocusRecommendation[] = []

  const fatigue = detectFatigue(today, completed)
  if (fatigue.fatigued) {
    recos.push({
      category: 'recuperation',
      focus: RECOVERY_FOCUS,
      reason: fatigue.reason,
      score: 1000,
    })
  }

  for (const focus of ordered) {
    if (recos.length >= limit) break
    if (recos.some((r) => r.focus === focus)) continue
    const stat = stats.get(focus)!
    const category = categoryForProgression(focus, progression)
    if (!category) continue
    const score = (stat.daysSince ?? NEVER) + (stat.count === 0 ? 100 : 0)
    recos.push({
      category,
      focus,
      reason: reasonForFocus(focus, stat, category, progression),
      score,
    })
  }

  return recos.slice(0, limit)
}

/** Liste des catégories valides (pour l'UI/validation). */
export const CATEGORY_OPTIONS = sessionCategory.options as SessionCategory[]
/** Liste des focus valides (pour l'UI/validation). */
export const FOCUS_OPTIONS = workoutFocus.options as WorkoutFocus[]
