import { isSkillId, skillIdsForFocus, type SkillId } from './curriculum'
import type { SkillEvidenceSource, SkillExposure } from './skill-mastery'

export interface HistoricalExercise {
  name: string
  explanation?: string
  combo?: string | null
  skillIds?: readonly unknown[]
}

export interface SkillHistorySession {
  id: string | number
  date: string
  status: string
  focus: string
  structure?: {
    blocks?: readonly {
      exercises?: readonly HistoricalExercise[]
    }[]
  } | null
}

export interface SkillHistorySessionFeedback {
  sessionId: string | number
  completed: boolean
  overallDifficulty: number | null
  energyLevel: number | null
}

export interface SkillHistoryExerciseFeedback {
  sessionId: string | number
  blockIndex: number
  exerciseIndex: number
  difficulty: number | null
}

export interface InferredExerciseSkills {
  skillIds: SkillId[]
  source: Exclude<SkillEvidenceSource, 'inferred_focus'>
}

function unique(ids: SkillId[]): SkillId[] {
  return [...new Set(ids)]
}

function normalizedText(exercise: HistoricalExercise): string {
  return `${exercise.name} ${exercise.explanation ?? ''}`
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
}

/** Utilise d'abord les tags stables, puis une inférence conservatrice combo/texte. */
export function inferExerciseSkills(exercise: HistoricalExercise): InferredExerciseSkills {
  const declared = unique((exercise.skillIds ?? []).filter(isSkillId))
  if (declared.length) return { skillIds: declared, source: 'declared' }

  const punches = (exercise.combo?.match(/[1-6]/g) ?? []).map(Number)
  if (punches.length) {
    const ids: SkillId[] = []
    if (punches.includes(1)) ids.push('jab')
    if (punches.includes(2)) ids.push('cross')
    if (punches.includes(3) || punches.includes(4)) ids.push('crochets')
    if (punches.includes(5) || punches.includes(6)) ids.push('uppercuts')
    if (punches.includes(1) && punches.includes(2)) ids.push('un_deux')
    if (punches.length >= 3) ids.push('combinaisons_base')
    return { skillIds: unique(ids), source: 'inferred_combo' }
  }

  const text = normalizedText(exercise)
  const ids: SkillId[] = []
  if (/posture|garde|menton/.test(text)) ids.push('posture_garde')
  if (/appui|deplacement|pas chasse/.test(text)) ids.push('appuis')
  if (/\bjab\b|direct avant/.test(text)) ids.push('jab')
  if (/\bcross\b|direct arriere/.test(text)) ids.push('cross')
  if (/\b1\s*[-–]\s*2\b|un[- ]deux/.test(text)) ids.push('un_deux')
  if (/crochet/.test(text)) ids.push('crochets')
  if (/uppercut/.test(text)) ids.push('uppercuts')
  if (/defense|esquive|\bslip\b|blocage|parade/.test(text)) ids.push('defenses')
  if (/sortie.{0,12}angle|pivot/.test(text)) ids.push('sorties_angle')
  if (/combinaison|enchainement|rafale/.test(text)) ids.push('combinaisons_base')
  return { skillIds: unique(ids), source: 'inferred_text' }
}

/** Garantit des tags persistables même si une sortie générée a omis le champ optionnel. */
export function tagExerciseWithSkills<T extends HistoricalExercise>(
  exercise: T,
): T & { skillIds: SkillId[] } {
  return { ...exercise, skillIds: inferExerciseSkills(exercise).skillIds }
}

function nullableMax(a: number | null, b: number | null): number | null {
  if (a == null) return b
  if (b == null) return a
  return Math.max(a, b)
}

/**
 * Normalise les séances stockées en événements de maîtrise. Les anciennes structures sans
 * `skillIds` sont inférées ; le focus n'est utilisé qu'en dernier recours pour la séance.
 */
export function buildSkillExposures(
  sessions: readonly SkillHistorySession[],
  sessionFeedback: readonly SkillHistorySessionFeedback[],
  exerciseFeedback: readonly SkillHistoryExerciseFeedback[],
): SkillExposure[] {
  const globalFeedback = new Map(sessionFeedback.map((feedback) => [feedback.sessionId, feedback]))
  const exerciseFeedbackByKey = new Map(
    exerciseFeedback.map((feedback) => [
      `${String(feedback.sessionId)}:${feedback.blockIndex}:${feedback.exerciseIndex}`,
      feedback,
    ]),
  )
  const result: SkillExposure[] = []

  for (const session of sessions) {
    const feedback = globalFeedback.get(session.id)
    const completed = session.status === 'completed' && feedback?.completed !== false
    const bySkill = new Map<SkillId, SkillExposure>()

    for (const [blockIndex, block] of (session.structure?.blocks ?? []).entries()) {
      for (const [exerciseIndex, exercise] of (block.exercises ?? []).entries()) {
        const inferred = inferExerciseSkills(exercise)
        const exerciseDifficulty = exerciseFeedbackByKey.get(
          `${String(session.id)}:${blockIndex}:${exerciseIndex}`,
        )?.difficulty
        for (const skillId of inferred.skillIds) {
          const current = bySkill.get(skillId)
          const difficulty = exerciseDifficulty ?? feedback?.overallDifficulty ?? null
          if (current) {
            current.difficulty = nullableMax(current.difficulty, difficulty)
            if (inferred.source === 'declared') current.source = 'declared'
          } else {
            bySkill.set(skillId, {
              sessionKey: session.id,
              date: session.date,
              skillId,
              completed,
              difficulty,
              energy: feedback?.energyLevel ?? null,
              source: inferred.source,
            })
          }
        }
      }
    }

    // Backfill virtuel le plus prudent : le focus ne sert que si aucun exercice n'a pu être tagué.
    if (!bySkill.size) {
      for (const skillId of skillIdsForFocus(session.focus)) {
        bySkill.set(skillId, {
          sessionKey: session.id,
          date: session.date,
          skillId,
          completed,
          difficulty: feedback?.overallDifficulty ?? null,
          energy: feedback?.energyLevel ?? null,
          source: 'inferred_focus',
        })
      }
    }

    result.push(...bySkill.values())
  }

  return result
}
