import type { RealMetricId } from './types'

export const REAL_EVALUATION_THRESHOLDS_VERSION = 'real-evaluation-thresholds/v1'

export interface RealNonRegressionRule {
  id: string
  metric: RealMetricId
  direction: 'higher-is-better' | 'lower-is-better'
  /** Régression absolue tolérée sur la moyenne, dans l'unité native de la métrique. */
  allowedRegression: number
}

/**
 * Alertes du banc réel. Elles ne sont jamais importées par le runner déterministe de CI.
 * Les taux sont exprimés sur [0, 1], les durées en ms/s et les coûts en USD.
 */
export const REAL_NON_REGRESSION_RULES: readonly RealNonRegressionRule[] = [
  {
    id: 'structural-validity',
    metric: 'structuralValidity',
    direction: 'higher-is-better',
    allowedRegression: 0,
  },
  {
    id: 'policy-compliance',
    metric: 'policyCompliance',
    direction: 'higher-is-better',
    allowedRegression: 0.02,
  },
  {
    id: 'duration-absolute-error',
    metric: 'durationAbsoluteErrorSeconds',
    direction: 'lower-is-better',
    allowedRegression: 30,
  },
  {
    id: 'category-fidelity',
    metric: 'categoryFidelity',
    direction: 'higher-is-better',
    allowedRegression: 0.05,
  },
  {
    id: 'focus-fidelity',
    metric: 'focusFidelity',
    direction: 'higher-is-better',
    allowedRegression: 0.05,
  },
  {
    id: 'progression-coherence',
    metric: 'progressionCoherence',
    direction: 'higher-is-better',
    allowedRegression: 0.05,
  },
  {
    id: 'provider-latency',
    metric: 'latencyMs',
    direction: 'lower-is-better',
    allowedRegression: 1_000,
  },
  {
    id: 'cost-per-generation',
    metric: 'costUsd',
    direction: 'lower-is-better',
    allowedRegression: 0.01,
  },
]
