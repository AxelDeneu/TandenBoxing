/**
 * Versions minimales des éléments qui rendent une génération reproductible.
 *
 * Chaque constante doit être incrémentée quand l'élément correspondant change de
 * manière susceptible de modifier une séance. Ces valeurs sont persistées dans
 * `generationContext` et reprises par le banc d'évaluation.
 */
export const GENERATOR_VERSIONS = {
  planner: 'generation-service/v1',
  policy: 'issue-1/pending',
  prompt: 'session-system-prompt/v1',
  outputContract: 'workout-session-schema/v1',
} as const

export type GeneratorVersions = {
  readonly planner: string
  readonly policy: string
  readonly prompt: string
  readonly outputContract: string
}
