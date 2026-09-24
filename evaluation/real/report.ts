import type {
  RealDistribution,
  RealEvaluationReport,
  RealMetricId,
  RealScenarioSummary,
} from './types'

const HUMAN_METRICS: ReadonlyArray<{ id: RealMetricId; label: string; unit: string }> = [
  { id: 'structuralValidity', label: 'Validité structurelle', unit: 'ratio' },
  { id: 'policyCompliance', label: 'Conformité politique', unit: 'ratio' },
  { id: 'blockingViolations', label: 'Violations bloquantes', unit: 'compte' },
  { id: 'durationAbsoluteErrorSeconds', label: 'Erreur durée', unit: 's' },
  { id: 'durationOverrunSeconds', label: 'Dépassement durée', unit: 's' },
  { id: 'categoryFidelity', label: 'Fidélité catégorie', unit: 'ratio' },
  { id: 'focusFidelity', label: 'Fidélité focus', unit: 'ratio' },
  { id: 'mainExerciseOverlap', label: 'Chevauchement principal', unit: 'ratio' },
  {
    id: 'warmupCooldownExerciseOverlap',
    label: 'Chevauchement échauffement/retour',
    unit: 'ratio',
  },
  { id: 'blockDiversityRatio', label: 'Diversité des blocs', unit: 'ratio' },
  { id: 'progressionCoherence', label: 'Cohérence progression', unit: 'ratio' },
  { id: 'latencyMs', label: 'Latence', unit: 'ms' },
  { id: 'totalTokens', label: 'Tokens', unit: 'tokens' },
  { id: 'costUsd', label: 'Coût', unit: 'USD' },
]

function number(value: number | null, digits = 4): string {
  return value == null ? 'n/d' : value.toFixed(digits).replace(/\.0+$/, '')
}

function distributionCell(value: RealDistribution, unit: string): string {
  if (value.mean == null) return 'n/d'
  const variance = value.variance == null ? 'n/d' : number(value.variance)
  return `${number(value.mean)} ${unit} (var. ${variance}, n=${value.count})`
}

function scenario(report: RealEvaluationReport, summary: RealScenarioSummary): string[] {
  const comparison = report.comparison.scenarios.find((item) => item.caseId === summary.caseId)!
  return [
    `### ${summary.caseId} — ${summary.title}`,
    '',
    '| Métrique | Baseline | Candidat | Δ moyenne |',
    '| --- | ---: | ---: | ---: |',
    ...HUMAN_METRICS.map(({ id, label, unit }) => {
      const metric = comparison.metrics[id]
      return `| ${label} | ${distributionCell(metric.baseline, unit)} | ${distributionCell(metric.candidate, unit)} | ${number(metric.deltaMean)} ${unit} |`
    }),
    '',
  ]
}

function globalComparison(report: RealEvaluationReport): string[] {
  return [
    '| Métrique | Baseline | Candidat | Δ moyenne |',
    '| --- | ---: | ---: | ---: |',
    ...HUMAN_METRICS.map(({ id, label, unit }) => {
      const metric = report.comparison.global[id]
      return `| ${label} | ${distributionCell(metric.baseline, unit)} | ${distributionCell(metric.candidate, unit)} | ${number(metric.deltaMean)} ${unit} |`
    }),
  ]
}

export function formatRealReportJson(report: RealEvaluationReport): string {
  return `${JSON.stringify(report, null, 2)}\n`
}

export function formatRealReportMarkdown(report: RealEvaluationReport): string {
  const lines = [
    `# Évaluation réelle — ${report.candidate.candidate.id}`,
    '',
    `Statut : **${report.status === 'pass' ? 'PASS' : 'ALERTE'}**`,
    '',
    `Baseline : \`${report.baseline.candidate.id}\` · candidat : \`${report.candidate.candidate.id}\``,
    `Corpus : \`${report.provenance.corpusId}\` (${report.provenance.corpusCaseIds.length} cas × ${report.reproducibility.repetitions} répétition(s))`,
    `Code : \`${report.provenance.codeRevision}\`${report.provenance.codeDirty ? ' (arbre modifié)' : ''}`,
    `Modèle demandé : \`${report.candidate.candidate.model}\``,
    `Prompt / politique / prescription : \`${report.provenance.promptVersion}\` / \`${report.provenance.policyVersion}\` / \`${report.provenance.prescriptionVersion}\``,
    `Seed : ${report.reproducibility.seed} (${report.reproducibility.seedApplied ? 'appliquée' : 'non supportée'}) · température : ${report.reproducibility.temperature} (${report.reproducibility.temperatureApplied ? 'appliquée' : 'non supportée'})`,
    '',
    '## Budget et consommation',
    '',
    `- Cas : ${report.usage.cases} / ${report.budget.maxCases}`,
    `- Appels : ${report.usage.calls} / ${report.budget.maxCalls}`,
    `- Tokens : ${report.usage.totalTokens} / ${report.budget.maxTotalTokens}`,
    `- Coût estimé : $${number(report.usage.costUsd, 6)} / $${number(report.budget.maxCostUsd, 2)}`,
    `- Durée : ${report.usage.durationMs} ms / ${report.budget.maxDurationMs} ms`,
    '',
    '## Alertes de non-régression',
    '',
    '| Seuil | Métrique | Statut | Δ observé | Tolérance |',
    '| --- | --- | --- | ---: | ---: |',
    ...report.alerts.map(
      (alert) =>
        `| ${alert.id} | ${alert.metric} | ${alert.status.toUpperCase()} | ${number(alert.observedDelta)} | ${number(alert.allowedRegression)} |`,
    ),
    '',
    '## Comparaison globale',
    '',
    ...globalComparison(report),
    '',
    '## Résultats par scénario',
    '',
    ...report.candidate.scenarios.flatMap((item) => scenario(report, item)),
    '## Empreintes archivées',
    '',
    `- Corpus : \`${report.provenance.corpusSha256}\``,
    `- Prompt : \`${report.provenance.promptSha256}\``,
    `- Prescriptions : \`${report.provenance.prescriptionSha256}\``,
    `- Seuils : \`${report.provenance.thresholdsVersion}\``,
    '',
  ]
  return lines.join('\n')
}
