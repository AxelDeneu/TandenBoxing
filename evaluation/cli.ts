import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import sessionPolicyAdapter from './adapters/session-policy'
import { formatReadableReport, formatReportJson } from './report'
import { compareReports, evaluateCandidate } from './runner'
import type { AiEvaluationAdapter, CandidateRun, EvaluationReport, PolicyAdapter } from './types'
import { SYNTHETIC_CORPUS } from './fixtures/corpus'
import referenceCandidate from './fixtures/reference-candidate'

interface CliOptions {
  candidatePath?: string
  baselinePath?: string
  policyPath?: string
  outputPath: string
  aiAdapterPath?: string
  aiBudgetUsd?: number
}

function usage(): string {
  return [
    'Usage: npm run eval:generator -- [options]',
    '',
    'Options:',
    '  --candidate <module>       module exportant candidateRun (défaut: référence synthétique)',
    '  --compare <module>         candidat avant, évalué sur le même corpus',
    '  --policy <module>          module exportant un policyAdapter alternatif',
    '  --output <fichier>         rapport JSON (défaut: evaluation/output/report.json)',
    '  --ai-adapter <module>      active explicitement une évaluation IA optionnelle',
    '  --ai-budget-usd <montant>  budget maximal obligatoire avec --ai-adapter',
    '  --help                     affiche cette aide',
  ].join('\n')
}

function valueAfter(args: readonly string[], index: number, option: string): string {
  const value = args[index + 1]
  if (!value || value.startsWith('--')) throw new Error(`Valeur manquante pour ${option}.`)
  return value
}

function parseArgs(args: readonly string[]): CliOptions {
  const options: CliOptions = { outputPath: 'evaluation/output/report.json' }
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]!
    switch (argument) {
      case '--candidate':
        options.candidatePath = valueAfter(args, index, argument)
        index += 1
        break
      case '--compare':
        options.baselinePath = valueAfter(args, index, argument)
        index += 1
        break
      case '--policy':
        options.policyPath = valueAfter(args, index, argument)
        index += 1
        break
      case '--output':
        options.outputPath = valueAfter(args, index, argument)
        index += 1
        break
      case '--ai-adapter':
        options.aiAdapterPath = valueAfter(args, index, argument)
        index += 1
        break
      case '--ai-budget-usd': {
        const raw = valueAfter(args, index, argument)
        const budget = Number(raw)
        if (!Number.isFinite(budget) || budget <= 0) {
          throw new Error('--ai-budget-usd doit être un montant strictement positif.')
        }
        options.aiBudgetUsd = budget
        index += 1
        break
      }
      case '--help':
        console.log(usage())
        process.exit(0)
        break
      default:
        throw new Error(`Option inconnue: ${argument}\n\n${usage()}`)
    }
  }

  if (Boolean(options.aiAdapterPath) !== Boolean(options.aiBudgetUsd)) {
    throw new Error('--ai-adapter et --ai-budget-usd doivent être fournis ensemble.')
  }
  return options
}

async function importModule(path: string): Promise<Record<string, unknown>> {
  return (await import(pathToFileURL(resolve(path)).href)) as Record<string, unknown>
}

async function loadCandidate(path: string): Promise<CandidateRun> {
  const loaded = await importModule(path)
  const candidate = loaded.candidateRun ?? loaded.default
  if (!candidate || typeof candidate !== 'object') {
    throw new Error(`${path} doit exporter candidateRun (ou un export default).`)
  }
  return candidate as CandidateRun
}

async function loadPolicy(path: string): Promise<PolicyAdapter> {
  const loaded = await importModule(path)
  const adapter = loaded.policyAdapter ?? loaded.default
  if (!adapter || typeof adapter !== 'object' || !('evaluate' in adapter)) {
    throw new Error(`${path} doit exporter policyAdapter (ou un export default).`)
  }
  return adapter as PolicyAdapter
}

async function loadAiAdapter(path: string): Promise<AiEvaluationAdapter> {
  const loaded = await importModule(path)
  const adapter = loaded.aiEvaluationAdapter ?? loaded.default
  if (!adapter || typeof adapter !== 'object' || !('evaluate' in adapter)) {
    throw new Error(`${path} doit exporter aiEvaluationAdapter (ou un export default).`)
  }
  return adapter as AiEvaluationAdapter
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2))
  const candidate = options.candidatePath
    ? await loadCandidate(options.candidatePath)
    : referenceCandidate
  const policyAdapter = options.policyPath
    ? await loadPolicy(options.policyPath)
    : sessionPolicyAdapter

  let report: EvaluationReport = await evaluateCandidate(SYNTHETIC_CORPUS, candidate, policyAdapter)

  if (options.baselinePath) {
    const baselineCandidate = await loadCandidate(options.baselinePath)
    const baselineReport = await evaluateCandidate(
      SYNTHETIC_CORPUS,
      baselineCandidate,
      policyAdapter,
    )
    report = { ...report, comparison: compareReports(baselineReport, report) }
  }

  if (options.aiAdapterPath && options.aiBudgetUsd) {
    const aiAdapter = await loadAiAdapter(options.aiAdapterPath)
    const aiEvaluation = await aiAdapter.evaluate({
      corpus: SYNTHETIC_CORPUS,
      candidate,
      budgetUsd: options.aiBudgetUsd,
    })
    if (aiEvaluation.costUsd > options.aiBudgetUsd) {
      throw new Error(
        `L'adaptateur IA a dépassé le budget: $${aiEvaluation.costUsd} > $${options.aiBudgetUsd}.`,
      )
    }
    report = { ...report, aiEvaluation }
  }

  const outputPath = resolve(options.outputPath)
  await mkdir(dirname(outputPath), { recursive: true })
  await writeFile(outputPath, formatReportJson(report), 'utf8')
  process.stdout.write(formatReadableReport(report))
  process.stdout.write(`Rapport JSON: ${outputPath}\n`)
  process.exitCode = report.passed ? 0 : 1
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error)
  console.error(`Évaluation impossible: ${message}`)
  process.exitCode = 2
})
