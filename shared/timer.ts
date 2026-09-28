import { comboToText, type Exercise, type WorkoutSession } from './session-schema'

export type PhaseKind = 'prepare' | 'work' | 'rest'
export type RestKind = 'between-rounds' | 'between-exercises'

export interface TimerPhase {
  kind: PhaseKind
  seconds: number
  label: string
  sublabel?: string
  blockTitle: string
  category?: string
  round?: number
  totalRounds?: number
  /** Nature du repos, afin de sélectionner le guide sans déduire l'intention du libellé. */
  restKind?: RestKind
  /** Index du bloc source dans la séance (pour retrouver l'exercice et son guide). */
  blockIndex: number
  /** Index de l'exercice source dans le bloc (pour retrouver son guide). */
  exerciseIndex: number
}

export interface TimerGuideResolution {
  /** Exercice dont le contenu pédagogique doit être affiché pour la phase courante. */
  exercise: Exercise | null
  /** Premier exercice futur différent de celui auquel la phase courante est rattachée. */
  upcomingExercise: Exercise | null
}

export const PREPARE_SECONDS = 10

/**
 * Aplatit une séance en une suite linéaire de phases (préparation / effort / repos)
 * que le timer enchaîne. Fonction pure, testable indépendamment de Vue.
 */
export function buildTimerPhases(session: WorkoutSession): TimerPhase[] {
  const phases: TimerPhase[] = []

  session.blocks.forEach((block, blockIndex) => {
    block.exercises.forEach((ex, exerciseIndex) => {
      phases.push({
        kind: 'prepare',
        seconds: PREPARE_SECONDS,
        label: ex.name,
        sublabel: ex.combo ? `${ex.combo} — ${comboToText(ex.combo)}` : block.title,
        blockTitle: block.title,
        category: ex.category,
        blockIndex,
        exerciseIndex,
      })

      for (let r = 1; r <= ex.intervals.rounds; r++) {
        phases.push({
          kind: 'work',
          seconds: ex.intervals.work,
          label: ex.name,
          sublabel: ex.combo ? `${ex.combo} — ${comboToText(ex.combo)}` : undefined,
          blockTitle: block.title,
          category: ex.category,
          round: r,
          totalRounds: ex.intervals.rounds,
          blockIndex,
          exerciseIndex,
        })

        if (r < ex.intervals.rounds && ex.intervals.rest > 0) {
          phases.push({
            kind: 'rest',
            restKind: 'between-rounds',
            seconds: ex.intervals.rest,
            label: 'Repos',
            sublabel: `${ex.name} — round ${r + 1}/${ex.intervals.rounds}`,
            blockTitle: block.title,
            blockIndex,
            exerciseIndex,
          })
        }
      }

      if (ex.restAfterSec > 0) {
        phases.push({
          kind: 'rest',
          restKind: 'between-exercises',
          seconds: ex.restAfterSec,
          label: 'Repos',
          sublabel: 'Exercice suivant',
          blockTitle: block.title,
          blockIndex,
          exerciseIndex,
        })
      }
    })
  })

  // Pas de repos traînant en fin de séance.
  while (phases.length && phases[phases.length - 1]!.kind === 'rest') phases.pop()
  return phases
}

function sameExercise(left: TimerPhase, right: TimerPhase): boolean {
  return left.blockIndex === right.blockIndex && left.exerciseIndex === right.exerciseIndex
}

function exerciseOf(session: WorkoutSession, phase: TimerPhase | null): Exercise | null {
  if (!phase) return null
  return session.blocks[phase.blockIndex]?.exercises[phase.exerciseIndex] ?? null
}

/**
 * Résout le guide depuis la suite réellement active du timer.
 *
 * Un repos inter-round reste rattaché à l'exercice courant. Un repos inter-exercices anticipe
 * le premier exercice futur, y compris lorsqu'il appartient au bloc suivant. Le prochain
 * `prepare` pointe déjà vers ce même exercice, ce qui évite tout retour visuel à l'ancien guide.
 */
export function resolveTimerGuide(
  session: WorkoutSession,
  phases: readonly TimerPhase[],
  phaseIndex: number,
): TimerGuideResolution {
  const current = phases[phaseIndex] ?? null
  if (!current) return { exercise: null, upcomingExercise: null }

  const upcomingPhase =
    phases.slice(phaseIndex + 1).find((phase) => !sameExercise(current, phase)) ?? null
  const upcomingExercise = exerciseOf(session, upcomingPhase)
  const previewsUpcoming = current.kind === 'rest' && current.restKind === 'between-exercises'

  return {
    exercise: previewsUpcoming ? upcomingExercise : exerciseOf(session, current),
    upcomingExercise,
  }
}
