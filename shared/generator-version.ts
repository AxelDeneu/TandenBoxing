/**
 * Versions minimales des éléments qui rendent une génération reproductible.
 *
 * Chaque constante doit être incrémentée quand l'élément correspondant change de
 * manière susceptible de modifier une séance. Ces valeurs sont persistées dans
 * `generationContext` et reprises par le banc d'évaluation.
 */
import { SESSION_POLICY_VERSION } from './session-policy'
import { EXERCISE_PREFERENCE_VERSION } from './exercise-preferences'
import { SESSION_AUTOREGULATION_VERSION } from './session-autoregulation'

export const GENERATOR_VERSIONS = {
  planner: 'generation-service/v4',
  policy: SESSION_POLICY_VERSION,
  prompt: 'session-system-prompt/v4',
  outputContract: 'workout-session-schema/v1',
  preferences: EXERCISE_PREFERENCE_VERSION,
  autoregulation: SESSION_AUTOREGULATION_VERSION,
} as const

export type GeneratorVersions = {
  readonly planner: string
  readonly policy: string
  readonly prompt: string
  readonly outputContract: string
  readonly preferences: string
  readonly autoregulation: string
}
