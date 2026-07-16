import { comboToText, type WorkoutSession } from './session-schema'

export type PhaseKind = 'prepare' | 'work' | 'rest'

export interface TimerPhase {
  kind: PhaseKind
  seconds: number
  label: string
  sublabel?: string
  blockTitle: string
  category?: string
  round?: number
  totalRounds?: number
  /** Index du bloc source dans la séance (pour retrouver l'exercice et son guide). */
  blockIndex: number
  /** Index de l'exercice source dans le bloc (pour retrouver son guide). */
  exerciseIndex: number
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
