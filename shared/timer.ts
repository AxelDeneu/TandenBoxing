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
}

export const PREPARE_SECONDS = 10

/**
 * Aplatit une séance en une suite linéaire de phases (préparation / effort / repos)
 * que le timer enchaîne. Fonction pure, testable indépendamment de Vue.
 */
export function buildTimerPhases(session: WorkoutSession): TimerPhase[] {
  const phases: TimerPhase[] = []

  for (const block of session.blocks) {
    block.exercises.forEach((ex) => {
      phases.push({
        kind: 'prepare',
        seconds: PREPARE_SECONDS,
        label: ex.name,
        sublabel: ex.combo ? `${ex.combo} — ${comboToText(ex.combo)}` : block.title,
        blockTitle: block.title,
        category: ex.category,
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
        })

        if (r < ex.intervals.rounds && ex.intervals.rest > 0) {
          phases.push({
            kind: 'rest',
            seconds: ex.intervals.rest,
            label: 'Repos',
            sublabel: `${ex.name} — round ${r + 1}/${ex.intervals.rounds}`,
            blockTitle: block.title,
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
        })
      }
    })
  }

  // Pas de repos traînant en fin de séance.
  while (phases.length && phases[phases.length - 1]!.kind === 'rest') phases.pop()
  return phases
}
