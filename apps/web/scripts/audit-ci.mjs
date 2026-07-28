import { spawnSync } from 'node:child_process'

const AUDIT_LEVEL = 'high'
const SEVERITY_RANK = {
  info: 0,
  low: 1,
  moderate: 2,
  high: 3,
  critical: 4,
}

// BillManager is a client-rendered BrowserRouter SPA and does not use React
// Router's unstable RSC APIs. Remove this exception when react-router >= 8.3.0
// is available and adopted.
const ALLOWED_ADVISORIES = new Map([
  [
    'GHSA-QWWW-VCR4-C8H2',
    'RSC-only CSRF path is unreachable in BillManager; no patched release is currently available',
  ],
])

const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const audit = spawnSync(npmCommand, ['audit', '--json', `--audit-level=${AUDIT_LEVEL}`], {
  encoding: 'utf8',
  maxBuffer: 10 * 1024 * 1024,
})

if (audit.error) {
  console.error(`Unable to run npm audit: ${audit.error.message}`)
  process.exit(1)
}

let report
try {
  report = JSON.parse(audit.stdout)
} catch {
  console.error('npm audit did not return a valid JSON report')
  if (audit.stderr) console.error(audit.stderr.trim())
  process.exit(1)
}

if (report.error || !report.vulnerabilities || !report.metadata?.vulnerabilities) {
  console.error('npm audit returned an error instead of a vulnerability report')
  console.error(JSON.stringify(report.error ?? report, null, 2))
  process.exit(1)
}

const advisoryId = (url) => url.match(/GHSA-[a-z0-9-]+/i)?.[0]?.toUpperCase()
const advisoryCache = new Map()

function advisoriesFor(packageName, visiting = new Set()) {
  if (advisoryCache.has(packageName)) return advisoryCache.get(packageName)
  if (visiting.has(packageName)) return new Set()

  const vulnerability = report.vulnerabilities[packageName]
  if (!vulnerability) return new Set()

  const nextVisiting = new Set(visiting).add(packageName)
  const ids = new Set()

  for (const cause of vulnerability.via ?? []) {
    if (typeof cause === 'string') {
      for (const id of advisoriesFor(cause, nextVisiting)) ids.add(id)
      continue
    }

    const id = advisoryId(cause.url ?? '')
    if (id) ids.add(id)
  }

  advisoryCache.set(packageName, ids)
  return ids
}

const minimumRank = SEVERITY_RANK[AUDIT_LEVEL]
const failures = []
const allowed = []

for (const [packageName, vulnerability] of Object.entries(report.vulnerabilities)) {
  if ((SEVERITY_RANK[vulnerability.severity] ?? Number.POSITIVE_INFINITY) < minimumRank) continue

  const ids = [...advisoriesFor(packageName)]
  const isAllowed = ids.length > 0 && ids.every((id) => ALLOWED_ADVISORIES.has(id))
  ;(isAllowed ? allowed : failures).push({ packageName, severity: vulnerability.severity, ids })
}

for (const item of allowed) {
  const reasons = item.ids.map((id) => `${id}: ${ALLOWED_ADVISORIES.get(id)}`).join('; ')
  console.warn(`Allowed ${item.severity} advisory for ${item.packageName} (${reasons})`)
}

if (failures.length > 0) {
  console.error(`npm audit found ${failures.length} unapproved ${AUDIT_LEVEL}-or-higher vulnerability entries:`)
  for (const item of failures) {
    console.error(`- ${item.packageName} (${item.severity}): ${item.ids.join(', ') || 'unknown advisory'}`)
  }
  process.exit(1)
}

console.log(`npm audit passed with ${allowed.length} explicitly allowed vulnerability entries`)
