import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const blockedSeverities = new Set(['high', 'critical'])
const exceptionPath = resolve('security/audit-exceptions.json')
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm'

const audit = spawnSync(npmCommand, ['audit', '--package-lock-only', '--omit=dev', '--json'], {
  encoding: 'utf8',
})

if (audit.error) {
  console.error(`Production dependency audit could not start: ${audit.error.message}`)
  process.exit(1)
}

let report
try {
  report = JSON.parse(audit.stdout)
} catch {
  console.error('Production dependency audit did not return valid JSON.')
  if (audit.stderr) console.error(audit.stderr.trim())
  process.exit(1)
}

if (!report.metadata?.vulnerabilities || !report.vulnerabilities) {
  console.error('Production dependency audit did not return a vulnerability report.')
  if (report.error?.summary) console.error(report.error.summary)
  process.exit(1)
}

const findings = new Map()

for (const [packageName, vulnerability] of Object.entries(report.vulnerabilities)) {
  for (const advisory of vulnerability.via ?? []) {
    if (
      typeof advisory !== 'object' ||
      advisory === null ||
      !blockedSeverities.has(advisory.severity)
    ) {
      continue
    }

    const advisoryId =
      advisory.url?.match(/\/advisories\/(GHSA-[\w-]+)$/)?.[1] ?? `npm:${advisory.source}`
    const key = `${packageName}:${advisoryId}`

    findings.set(key, {
      advisory: advisoryId,
      package: packageName,
      severity: advisory.severity,
      title: advisory.title,
      url: advisory.url,
    })
  }
}

let exceptionFile
try {
  exceptionFile = JSON.parse(readFileSync(exceptionPath, 'utf8'))
} catch (error) {
  console.error(`Cannot read ${exceptionPath}: ${error.message}`)
  process.exit(1)
}

if (!Array.isArray(exceptionFile.exceptions)) {
  console.error(`${exceptionPath} must contain an "exceptions" array.`)
  process.exit(1)
}

const now = new Date()
const today = now.toISOString().slice(0, 10)
const maximumExpiryDate = new Date(now)
maximumExpiryDate.setUTCDate(maximumExpiryDate.getUTCDate() + 30)
const maximumExpiry = maximumExpiryDate.toISOString().slice(0, 10)
const exceptionKeys = new Set()
const policyErrors = []

for (const [index, exception] of exceptionFile.exceptions.entries()) {
  const label = `exceptions[${index}]`

  if (!exception || typeof exception !== 'object' || Array.isArray(exception)) {
    policyErrors.push(`${label} must be an object.`)
    continue
  }

  for (const field of ['advisory', 'package', 'justification', 'owner', 'expires']) {
    if (typeof exception[field] !== 'string' || exception[field].trim() === '') {
      policyErrors.push(`${label}.${field} must be a non-empty string.`)
    }
  }

  if (
    typeof exception.advisory === 'string' &&
    !/^(GHSA-[\w-]+|npm:\d+)$/.test(exception.advisory)
  ) {
    policyErrors.push(`${label}.advisory must be a GHSA identifier.`)
  }

  if (typeof exception.owner === 'string' && !/^@[A-Za-z0-9-]+$/.test(exception.owner)) {
    policyErrors.push(`${label}.owner must be a GitHub handle starting with @.`)
  }

  if (typeof exception.expires === 'string') {
    const expiryDate = new Date(`${exception.expires}T00:00:00.000Z`)
    const isValidDate =
      /^\d{4}-\d{2}-\d{2}$/.test(exception.expires) &&
      !Number.isNaN(expiryDate.valueOf()) &&
      expiryDate.toISOString().slice(0, 10) === exception.expires

    if (!isValidDate) {
      policyErrors.push(`${label}.expires must be a valid YYYY-MM-DD date.`)
    } else if (exception.expires < today) {
      policyErrors.push(`${label} expired on ${exception.expires}.`)
    } else if (exception.expires > maximumExpiry) {
      policyErrors.push(`${label}.expires cannot be more than 30 days away.`)
    }
  }

  const key = `${exception.package}:${exception.advisory}`
  if (exceptionKeys.has(key)) policyErrors.push(`${label} duplicates ${key}.`)
  exceptionKeys.add(key)
}

for (const key of exceptionKeys) {
  if (!findings.has(key)) policyErrors.push(`Remove stale exception ${key}.`)
}

const unaccepted = [...findings.entries()].filter(([key]) => !exceptionKeys.has(key))
const accepted = findings.size - unaccepted.length
const summary = report.metadata.vulnerabilities

if (summary.high + summary.critical > 0 && findings.size === 0) {
  policyErrors.push('The audit reported blocked vulnerabilities without advisory details.')
}

console.log(
  `Production audit: ${summary.total} total, ${summary.high} high, ${summary.critical} critical; ${accepted} temporarily accepted.`,
)

for (const error of policyErrors) console.error(`Policy error: ${error}`)

for (const [, finding] of unaccepted) {
  console.error(
    `${finding.severity.toUpperCase()} ${finding.package} ${finding.advisory}: ${finding.title}`,
  )
  if (finding.url) console.error(`  ${finding.url}`)
}

if (policyErrors.length > 0 || unaccepted.length > 0) process.exit(1)
