import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/** OCTA-FLD-DAILY-022 — project daily log wiring. */
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (rel) => readFileSync(path.join(root, rel), 'utf8')

const hooks = read('src/features/site-reporting/hooks/use-daily-log.ts')
const panel = read('src/features/site-reporting/components/daily-log-panel.tsx')
const sections = read('src/features/site-reporting/components/daily-log-sections.tsx')
const settings = read('src/features/site-reporting/components/daily-log-settings-dialog.tsx')
const report = read('src/features/site-reporting/components/manpower-report.tsx')
const dashboard = read('src/features/site-reporting/components/site-reporting-dashboard.tsx')
const attachments = read('src/features/attachments/components/attachment-panel.tsx')
const permissions = read('src/lib/permissions.ts')
const policy = JSON.parse(readFileSync(path.join(root, '..', 'shared', 'permissions.json'), 'utf8'))

// hooks: every server capability has a hook, entries go through the outbox
for (const name of ['useDailyLog', 'useDailyLogs', 'useDailyLogSettings', 'useUpdateDailyLogSettings', 'useManpowerReport', 'useAddDailyLogEntry', 'useUpdateDailyLogEntry', 'useDeleteDailyLogEntry', 'useReviewDailyLogEntry', 'useUpdateDailyLog', 'useRefreshDailyLogWeather', 'useCopyPreviousDay', 'useDailyLogAction', 'useDistributeDailyLog', 'useLogWeatherDelay', 'downloadDailyLogPdf']) {
  assert.match(hooks, new RegExp(`export const ${name}`), `${name} exported`)
}
assert.match(hooks, /\/projects\/\$\{projectId\}\/daily-logs/, 'daily-log API base')
assert.match(hooks, /sendOrQueue<DailyLog>\(/, 'entries are sent through the offline outbox')
assert.match(hooks, /newClientRequestId\(`daily-log-\$\{section\}`\)/, 'client request id per entry')
assert.match(hooks, /'manpower',\s*'equipment',\s*'deliveries',\s*'visitors',\s*'delays',\s*'notes'/, 'six typed sections')

// panel: day navigation, weather, actions, sections, record panels
assert.match(panel, /data-testid='uat-dailylog-panel'/)
assert.match(panel, /data-testid='uat-dailylog-date'/, 'day picker')
assert.match(panel, /data-testid='uat-dailylog-strip'/, 'two-week strip')
const can = (action, transition) => new RegExp(`useCanPerform\\(\\s*'progress',\\s*'${action}',\\s*'${transition.replace('.', '\\.')}'\\s*\\)`)
assert.match(panel, can('submit', 'daily_log.submit'), 'write permission')
assert.match(panel, can('approve', 'daily_log.entry_review'), 'review permission')
assert.match(panel, can('approve', 'daily_log.approve'), 'approve permission')
assert.match(panel, can('submit', 'daily_log.distribute'), 'distribute permission')
assert.match(panel, can('approve', 'daily_log.configure'), 'configure permission')
assert.match(panel, /useProjectPartyAccess\(\)/, 'party users detected for ownership rules')
assert.match(panel, /data-testid='uat-dailylog-copy'/, 'copy previous day')
assert.match(panel, /data-testid='uat-dailylog-submit'/)
assert.match(panel, /data-testid='uat-dailylog-approve'/)
assert.match(panel, /data-testid='uat-dailylog-distribute-open'/, 'send PDF')
assert.match(panel, /data-testid='uat-dailylog-pdf'/, 'PDF download')
assert.match(panel, /data-testid='uat-dailylog-weather-refresh'/, 'weather fetch from feed')
assert.match(panel, /data-testid='uat-dailylog-weather-alert'/, 'weather alerts shown')
assert.match(panel, /DAILY_LOG_SECTIONS\.map\(\(section\) =>/, 'a card per section')
assert.match(panel, /recordType='daily_log'/, 'attachments and comments on the day')
assert.match(panel, /entityType='daily_log'/, 'history on the day')
assert.match(panel, /<ManpowerReport projectId=\{projectId\} \/>/, 'manpower report view')

// sections: typed forms, review controls, weather register
assert.match(sections, /const SECTION_FIELDS: Record<DailyLogSection, FieldDef\[\]>/, 'typed fields per section')
assert.match(sections, /key: 'trade', label: 'Trade', type: 'text', required: true/, 'manpower needs a trade')
assert.match(sections, /type: 'company'/, 'company picker on manpower')
assert.match(sections, /type: 'equipment'/, 'equipment register picker')
assert.match(sections, /options: DELAY_TYPES/, 'delay types')
assert.match(sections, /options: NOTE_KINDS/, 'note kinds')
assert.match(sections, /isQueued\(result\)/, 'offline save acknowledged')
assert.match(sections, /decision: 'approve'/, 'entries can be accepted')
assert.match(sections, /decision: 'reject',\s*reason/, 'returning an entry needs a reason')
assert.match(sections, /data-testid='uat-dailylog-weather-register'/, 'weather delay goes to the register')
assert.match(sections, /entry\.suggested/, 'weather-feed suggestions are marked')

// settings & report
assert.match(settings, /Latitude/, 'coordinates')
assert.match(settings, /distributionRoles: roles/, 'distribution roles')
assert.match(settings, /distributionEmails: emails/, 'external addresses')
assert.match(settings, /autoDistributeAt: autoAt \|\| null/, 'evening send time')
assert.match(settings, /\['rainMm', 'Rain ≥ mm'\]/, 'rain threshold')
assert.match(report, /data-testid='uat-manpower-groupby'/, 'group by company/trade')
assert.match(report, /value: 'company_trade'/, 'company × trade grouping')
assert.match(report, /<BarChart/, 'per-day chart')

// wiring
assert.match(dashboard, /TabsTrigger[\s\S]*?value='log'/, 'Daily Log tab')
assert.match(dashboard, /<DailyLogPanel[\s\S]*?initialDate=\{initialDate\}/, 'deep link to a day')
assert.match(attachments, /daily_log: 'progress'/, 'record type module')
assert.match(permissions, /export const useProjectPartyAccess/, 'party access hook')
assert.deepEqual(policy.modules.progress.transitions['daily_log.approve'], ['pm'], 'PM approves the day')
assert.deepEqual(policy.modules.progress.transitions['daily_log.entry_review'], ['pm', 'planning_eng', 'site_engineer', 'quality_engineer'], 'site team reviews collaborator entries')
for (const template of ['contractor', 'subcontractor']) {
  assert.ok(policy.partyPermissions[template].modules.progress.transitions.includes('daily_log.submit'), `${template} party can log entries`)
}
for (const template of ['owner', 'consultant']) {
  assert.ok(!policy.partyPermissions[template].modules.progress.transitions.includes('daily_log.submit'), `${template} party reads only`)
}

// eslint-disable-next-line no-console
console.log('daily-log-ui checks passed')
