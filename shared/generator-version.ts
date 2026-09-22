/**
 * Versions minimales des éléments qui rendent une génération reproductible.
 *
 * Chaque constante doit être incrémentée quand l'élément correspondant change de
 * manière susceptible de modifier une séance. Ces valeurs sont persistées dans
 * `generationContext` et reprises par le banc d'évaluation.
 */
import { SESSION_POLICY_VERSION } from './session-policy'

export const GENERATOR_VERSIONS = {
  planner: 'generation-service/v2',
  policy: SESSION_POLICY_VERSION,
  prompt: 'session-system-prompt/v2',
  outputContract: 'workout-session-schema/v1',
} as const

export type GeneratorVersions = {
  readonly planner: string
  readonly policy: string
  readonly prompt: string
  readonly outputContract: string
}
