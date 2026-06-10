import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const read = (path) => readFileSync(resolve(root, path), 'utf8')

const assertions = [
  {
    file: 'src/features/site-reporting/components/site-reporting-dashboard.tsx',
    checks: [
      'Offline draft mode',
      'clientMetadata',
      'clientRequestId',
      'pmc-site-reporting-device-id',
      'writeSiteDraft',
      'readSiteDraft',
      'PM approval required',
      '<Dialog',
      'Reject Site Record',
      "setRejectTarget({ kind: 'report'",
      "setRejectTarget({ kind: 'diary'",
      "runDailyAction('draft')",
      "runDiaryAction('draft')",
      'handleServerError(error)',
    ],
  },
  {
    file: 'src/features/site-reporting/hooks/use-site-reporting.ts',
    checks: [
      'SiteWeather',
      'SiteIssue',
      'SiteLineSummary',
      'clientRequestId',
      'clientCreatedAt',
      'deviceId',
      'lineSummary',
      'weatherDetails',
      'issueItems',
    ],
  },
]

for (const assertion of assertions) {
  const source = read(assertion.file)
  for (const check of assertion.checks) {
    if (!source.includes(check)) {
      throw new Error(`${assertion.file} is missing ${check}`)
    }
  }
}

console.log('Site reporting mobile UI assertions passed')
