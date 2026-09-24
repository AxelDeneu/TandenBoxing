import { execFile } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import { GENERATOR_VERSIONS } from '../../shared/generator-version'
import sessionPolicyAdapter from '../adapters/session-policy'
import { SYNTHETIC_CORPUS } from '../fixtures/corpus'
import { createAnthropicRealProvider } from './anthropic-provider'
import { formatRealReportJson, formatRealReportMarkdown } from './report'
import { runRealEvaluation } from './runner'
import type { RealEvaluationBudget, RealEvaluationReport, RealGenerationProvider } from './types'

const execFileAsync = promisify(execFile)

interface CliOptions {
  candidateModel: string
  candidateId?: string
  baselineModel?: string
  baselineId?: string
  baselineReportPath?: string
  providerPath?: string
  outputDirectory?: string
  caseIds: string[]
  repetitions: number
  seed: number
  temperature: number
  budget: Partial<RealEvaluationBudget>
  failOnAlert: boolean
}

const HARD_LIMITS: RealEvaluationBudget = {
  maxCases: 100,
  maxCalls: 500,
  maxTotalTokens: 10_000_000,
  maxCostUsd: 500,
  maxDurationMs: 3_600_000,
  maxOutputTokensPerCall: 20_000,
}

function usage(): string {
  return [
    'Usage: npm run eval:generator:real -- [options obligatoires]',
    '',
    'Candidat et baseline (une baseline exactement):',
    '  --candidate-model <id>        modèle fournisseur candidat',
    '  --candidate-id <id>           identifiant lisible (défaut: candidate:<modèle>)',
    '  --baseline-model <id>         génère aussi la baseline dans le même budget',
    '  --baseline-report <fichier>   réutilise un rapport réel archivé',
    '  --baseline-id <id>            identifiant de la baseline générée',
    '',
    'Reproductibilité:',
    '  --repetitions <n>             répétitions par scénario (1-20)',
    '  --seed <entier>               seed appliquée si le fournisseur la supporte',
    '  --temperature <0..1>          température appliquée si supportée',
    '  --case <id>                   limite aux cas cités (répétable; défaut: corpus entier)',
    '',
    'Budgets obligatoires:',
    '  --max-cases <n>',
    '  --max-calls <n>',
    '  --max-total-tokens <n>',
    '  --max-cost-usd <montant>',
    '  --max-duration-ms <ms>',
    '  --max-output-tokens <n>       plafond de sortie par appel',
    '',
    'Sortie et fournisseur:',
    '  --output-dir <dossier>        archive report.json + report.md',
    '  --provider-adapter <module>   double/adaptateur exportant realGenerationProvider',
    '  --fail-on-alert               code 1 sur une alerte de non-régression',
    '  --help',
  ].join('\n')
}

function valueAfter(args: readonly string[], index: number, option: string): string {
  const value = args[index + 1]
  if (!value || value.startsWith('--')) throw new Error(`Valeur manquante pour ${option}.`)
  return value
}

function boundedNumber(
  raw: string,
  option: string,
  minimum: number,
  maximum: number,
  integer = false,
): number {
  const value = Number(raw)
  if (
    !Number.isFinite(value) ||
    value < minimum ||
    value > maximum ||
    (integer && !Number.isInteger(value))
  ) {
    throw new Error(`${option} doit être compris entre ${minimum} et ${maximum}.`)
  }
  return value
}

export function parseRealEvaluationArgs(args: readonly string[]): CliOptions {
  const options: CliOptions = {
    candidateModel: '',
    caseIds: [],
    repetitions: 0,
    seed: Number.NaN,
    temperature: Number.NaN,
    budget: {},
    failOnAlert: false,
  }
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]!
    const next = () => valueAfter(args, index, argument)
    switch (argument) {
      case '--candidate-model':
        options.candidateModel = next()
        index += 1
        break
      case '--candidate-id':
        options.candidateId = next()
        index += 1
        break
      case '--baseline-model':
        options.baselineModel = next()
        index += 1
        break
      case '--baseline-id':
        options.baselineId = next()
        index += 1
        break
      case '--baseline-report':
        options.baselineReportPath = next()
        index += 1
        break
      case '--provider-adapter':
        options.providerPath = next()
        index += 1
        break
      case '--output-dir':
        options.outputDirectory = next()
        index += 1
        break
      case '--case':
        options.caseIds.push(next())
        index += 1
        break
      case '--repetitions':
        options.repetitions = boundedNumber(next(), argument, 1, 20, true)
        index += 1
        break
      case '--seed':
        options.seed = boundedNumber(next(), argument, 0, 2_147_483_647, true)
        index += 1
        break
      case '--temperature':
        options.temperature = boundedNumber(next(), argument, 0, 1)
        index += 1
        break
      case '--max-cases':
        options.budget.maxCases = boundedNumber(next(), argument, 1, HARD_LIMITS.maxCases, true)
        index += 1
        break
      case '--max-calls':
        options.budget.maxCalls = boundedNumber(next(), argument, 1, HARD_LIMITS.maxCalls, true)
        index += 1
        break
      case '--max-total-tokens':
        options.budget.maxTotalTokens = boundedNumber(
          next(),
          argument,
          1,
          HARD_LIMITS.maxTotalTokens,
          true,
        )
        index += 1
        break
      case '--max-cost-usd':
        options.budget.maxCostUsd = boundedNumber(
          next(),
          argument,
          0.000001,
          HARD_LIMITS.maxCostUsd,
        )
        index += 1
        break
      case '--max-duration-ms':
        options.budget.maxDurationMs = boundedNumber(
          next(),
          argument,
          1,
          HARD_LIMITS.maxDurationMs,
          true,
        )
        index += 1
        break
      case '--max-output-tokens':
        options.budget.maxOutputTokensPerCall = boundedNumber(
          next(),
          argument,
          1,
          HARD_LIMITS.maxOutputTokensPerCall,
          true,
        )
        index += 1
        break
      case '--fail-on-alert':
        options.failOnAlert = true
        break
      case '--help':
        process.stdout.write(`${usage()}\n`)
        process.exit(0)
        break
      default:
        throw new Error(`Option inconnue: ${argument}\n\n${usage()}`)
    }
  }

  if (!options.candidateModel) throw new Error('--candidate-model est obligatoire.')
  if (Boolean(options.baselineModel) === Boolean(options.baselineReportPath)) {
    throw new Error('Fournis exactement un --baseline-model ou --baseline-report.')
  }
  if (
    !options.repetitions ||
    !Number.isFinite(options.seed) ||
    !Number.isFinite(options.temperature)
  ) {
    throw new Error('--repetitions, --seed et --temperature sont obligatoires.')
  }
  const missingBudgets = Object.entries(options.budget)
    .filter(([, value]) => value == null)
    .map(([key]) => key)
  const expectedBudgetKeys: Array<keyof RealEvaluationBudget> = [
    'maxCases',
    'maxCalls',
    'maxTotalTokens',
    'maxCostUsd',
    'maxDurationMs',
    'maxOutputTokensPerCall',
  ]
  const actuallyMissing = expectedBudgetKeys.filter((key) => options.budget[key] == null)
  if (actuallyMissing.length || missingBudgets.length) {
    throw new Error(`Tous les budgets sont obligatoires (${actuallyMissing.join(', ')}).`)
  }
  return options
}

async function loadProvider(path: string | undefined): Promise<RealGenerationProvider> {
  if (!path) return createAnthropicRealProvider(process.env.NUXT_ANTHROPIC_API_KEY ?? '')
  const loaded = (await import(pathToFileURL(resolve(path)).href)) as Record<string, unknown>
  const provider = loaded.realGenerationProvider ?? loaded.default
  if (!provider || typeof provider !== 'object' || !('generate' in provider)) {
    throw new Error(`${path} doit exporter realGenerationProvider (ou default).`)
  }
  return provider as RealGenerationProvider
}

async function readBaseline(path: string): Promise<RealEvaluationReport> {
  const parsed = JSON.parse(await readFile(resolve(path), 'utf8')) as RealEvaluationReport
  if (parsed.reportVersion !== 'generator-real-evaluation-report/v1') {
    throw new Error(`${path} n'est pas un rapport réel compatible.`)
  }
  return parsed
}

async function codeProvenance(): Promise<{ codeRevision: string; codeDirty: boolean }> {
  const [{ stdout: revision }, { stdout: status }] = await Promise.all([
    execFileAsync('git', ['rev-parse', 'HEAD']),
    execFileAsync('git', ['status', '--porcelain']),
  ])
  return { codeRevision: revision.trim(), codeDirty: Boolean(status.trim()) }
}

function defaultOutputDirectory(): string {
  return `evaluation/output/real/${new Date().toISOString().replace(/[:.]/g, '-')}`
}

async function main(): Promise<void> {
  const options = parseRealEvaluationArgs(process.argv.slice(2))
  const selectedCases = options.caseIds.length
    ? options.caseIds.map((id) => {
        const found = SYNTHETIC_CORPUS.cases.find((item) => item.id === id)
        if (!found) throw new Error(`Cas inconnu: ${id}`)
        return found
      })
    : SYNTHETIC_CORPUS.cases
  const provider = await loadProvider(options.providerPath)
  const baseline = options.baselineReportPath
    ? await readBaseline(options.baselineReportPath)
    : {
        id: options.baselineId ?? `baseline:${options.baselineModel}`,
        model: options.baselineModel!,
        versions: GENERATOR_VERSIONS,
      }
  const report = await runRealEvaluation({
    corpus: SYNTHETIC_CORPUS,
    cases: selectedCases,
    provider,
    policyAdapter: sessionPolicyAdapter,
    candidate: {
      id: options.candidateId ?? `candidate:${options.candidateModel}`,
      model: options.candidateModel,
      versions: GENERATOR_VERSIONS,
    },
    baseline,
    budget: options.budget as RealEvaluationBudget,
    repetitions: options.repetitions,
    seed: options.seed,
    temperature: options.temperature,
    provenance: await codeProvenance(),
  })
  const outputDirectory = resolve(options.outputDirectory ?? defaultOutputDirectory())
  await mkdir(outputDirectory, { recursive: true })
  await Promise.all([
    writeFile(resolve(outputDirectory, 'report.json'), formatRealReportJson(report), 'utf8'),
    writeFile(resolve(outputDirectory, 'report.md'), formatRealReportMarkdown(report), 'utf8'),
  ])
  process.stdout.write(formatRealReportMarkdown(report))
  process.stdout.write(`\nArchives: ${outputDirectory}\n`)
  if (options.failOnAlert && report.status === 'alert') process.exitCode = 1
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error)
  console.error(`Évaluation réelle impossible: ${message}`)
  process.exitCode = 2
})
