import type { EvaluationReport } from './types'

function percent(value: number | null): string {
  return value == null ? 'n/d' : `${Math.round(value * 10_000) / 100} %`
}

function signed(value: number | null, suffix = ''): string {
  if (value == null) return 'n/d'
  const prefix = value > 0 ? '+' : ''
  return `${prefix}${value}${suffix}`
}

/** Le rapport omet volontairement tout horodatage afin d'être stable à entrée identique. */
export function formatReportJson(report: EvaluationReport): string {
  return `${JSON.stringify(report, null, 2)}\n`
}

export function formatReadableReport(report: EvaluationReport): string {
  const lines = [
    `Banc générateur — ${report.candidate.id}`,
    `Corpus: ${report.corpus.id} (${report.corpus.caseCount} cas)`,
    `Résultat: ${report.passed ? 'PASS' : 'FAIL'}`,
    '',
    'Seuils bloquants:',
    ...report.thresholds.map(
      (threshold) =>
        `- ${threshold.passed ? 'PASS' : 'FAIL'} ${threshold.id}: ${threshold.actual} (cible: ${threshold.target})`,
    ),
    '',
    'Métriques globales:',
    `- Conformité obligatoire: ${percent(report.global.policy.mandatoryComplianceRate)} (${report.global.policy.blockingViolationCount} violation(s) bloquante(s))`,
    `- Erreur de durée absolue moyenne: ${report.global.duration.meanAbsoluteErrorSeconds} s`,
    `- Fidélité catégorie / focus: ${percent(report.global.fidelity.categoryRate)} / ${percent(report.global.fidelity.focusRate)}`,
    `- Répétition corps principal / échauffement-retour: ${percent(report.global.exerciseOverlap.meanMain)} / ${percent(report.global.exerciseOverlap.meanWarmupCooldown)}`,
    `- Diversité moyenne des types de bloc: ${percent(report.global.blockDiversity.meanDistinctBlockTypeRatio)} (${report.global.blockDiversity.distinctPatterns} patron(s))`,
    `- Cohérence de progression: ${percent(report.global.progression.coherenceRate)}`,
  ]

  if (report.comparison) {
    const deltas = report.comparison.deltas
    lines.push(
      '',
      `Comparaison avec ${report.comparison.baselineCandidateId} (delta candidat - référence):`,
      `- Conformité: ${signed(deltas.mandatoryComplianceRate)}`,
      `- Erreur de durée moyenne: ${signed(deltas.meanAbsoluteDurationErrorSeconds, ' s')}`,
      `- Fidélité catégorie / focus: ${signed(deltas.categoryFidelityRate)} / ${signed(deltas.focusFidelityRate)}`,
      `- Répétition principal / périphérique: ${signed(deltas.mainExerciseOverlap)} / ${signed(deltas.warmupCooldownExerciseOverlap)}`,
      `- Diversité des blocs: ${signed(deltas.blockDiversityRatio)}`,
      `- Progression: ${signed(deltas.progressionCoherenceRate)}`,
    )
  }

  if (report.aiEvaluation) {
    lines.push(
      '',
      `Évaluation IA optionnelle: ${report.aiEvaluation.adapterId}`,
      `- Budget / coût: $${report.aiEvaluation.budgetUsd} / $${report.aiEvaluation.costUsd}`,
      `- ${report.aiEvaluation.summary}`,
    )
  }

  return `${lines.join('\n')}\n`
}
