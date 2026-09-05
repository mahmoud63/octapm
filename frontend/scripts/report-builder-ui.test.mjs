import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/** OCTA-RPT-BUILDER-023 — report builder, portfolio and export-view wiring. */
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (rel) => readFileSync(path.join(root, rel), 'utf8')

const hooks = read('src/features/reports/hooks/use-report-builder.ts')
const editor = read('src/features/reports/components/report-editor.tsx')
const chart = read('src/features/reports/components/report-chart.tsx')
const schedules = read('src/features/reports/components/report-schedules-dialog.tsx')
const runs = read('src/features/reports/components/report-runs.tsx')
const page = read('src/features/reports/report-builder-page.tsx')
const portfolio = read('src/features/reports/portfolio-page.tsx')
const csv = read('src/lib/export-csv.ts')
const toolbar = read('src/components/data-table/toolbar.tsx')
const recordList = read('src/features/workflows/components/workflow-record-list.tsx')
const sidebar = read('src/components/layout/data/sidebar-data.ts')
const permissions = read('src/lib/permissions.ts')
const policy = JSON.parse(readFileSync(path.join(root, '..', 'shared', 'permissions.json'), 'utf8'))

// hooks
for (const name of ['useReportSources', 'useReports', 'useReport', 'useCreateReport', 'useUpdateReport', 'useDeleteReport', 'usePreviewReport', 'useRunReport', 'useReportRuns', 'useCreateReportRun', 'useReportSchedules', 'useSaveReportSchedule', 'useDeleteReportSchedule', 'downloadReportExport', 'downloadDefinitionExport', 'downloadRunFile', 'usePortfolio', 'useRefreshPortfolio', 'downloadPortfolioXlsx']) {
  assert.match(hooks, new RegExp(`export const ${name}`), `${name} exported`)
}
assert.match(hooks, /'\/reports\/preview'/, 'preview endpoint')
assert.match(hooks, /'\/reports\/export'/, 'ad-hoc export endpoint')
assert.match(hooks, /\/reports\/runs\/\$\{runId\}\/download/, 'run download')
assert.match(hooks, /'\/portfolio\/refresh'/, 'portfolio refresh')
assert.match(hooks, /OPERATORS_BY_TYPE: Record<ReportColumnType, ReportOperator\[\]>/, 'operators per column type')

// editor: the builder surface
assert.match(editor, /data-testid='uat-report-source'/, 'source picker')
assert.match(editor, /data-testid='uat-report-scope'/, 'project scope')
assert.match(editor, /data-testid='uat-report-visibility'/, 'sharing')
assert.match(editor, /data-testid='uat-report-columns'/, 'column checklist')
assert.match(editor, /data-testid='uat-report-add-filter'/, 'filters')
assert.match(editor, /data-testid='uat-report-groupby'/, 'grouping')
assert.match(editor, /AGGREGATE_FNS\.map/, 'aggregates')
assert.match(editor, /data-testid='uat-report-chart-type'/, 'chart type')
assert.match(editor, /data-testid='uat-report-preview'/, 'preview')
assert.match(editor, /data-testid='uat-report-save'/, 'save')
assert.match(editor, /data-testid='uat-report-export-xlsx'/, 'xlsx export')
assert.match(editor, /data-testid='uat-report-export-pdf'/, 'pdf export')
assert.match(editor, /data-testid='uat-report-run-deliver'/, 'run & deliver')
assert.match(editor, /data-testid='uat-report-schedules-open'/, 'schedules')
assert.match(editor, /skipped \(no permission there\)/, 'denied projects surfaced')
assert.match(editor, /useCanPerform\(\s*'report',\s*'update',\s*'report\.schedule'\s*\)/, 'schedule permission')
assert.match(chart, /<PieChart>|<BarChart|<LineChart/, 'chart renders groups')
assert.match(schedules, /data-testid='uat-report-schedule-form'/, 'schedule form')
assert.match(schedules, /SelectItem value='weekly'/, 'weekly frequency')
assert.match(schedules, /External addresses/, 'external emails')
assert.match(runs, /downloadRunFile\(runId, format\)/, 'run files downloadable')
assert.match(page, /data-testid='uat-report-new'/, 'new report')
assert.match(page, /data-testid='uat-report-list'/, 'saved list')

// portfolio
assert.match(portfolio, /data-testid='uat-portfolio-table'/, 'portfolio table')
assert.match(portfolio, /data-testid='uat-portfolio-refresh'/, 'refresh')
assert.match(portfolio, /data-testid='uat-portfolio-export'/, 'xlsx export')
assert.match(portfolio, /header\('spi', 'SPI', 'right'\)/, 'SPI column')
assert.match(portfolio, /header\('cash', 'Cash net 90d', 'right'\)/, 'cash column')
assert.match(hooks, /refetchInterval: \(query\) =>/, 'polls while refreshing')

// export current view on every register
assert.match(csv, /export const downloadCsv/, 'csv helper')
assert.match(toolbar, /export function exportTableView/, 'table export')
assert.match(toolbar, /data-testid='uat-export-view'/, 'table export button')
assert.match(recordList, /data-testid='uat-export-view'/, 'record list export button')
for (const file of ['src/features/doc-control/components/doc-control-dashboard.tsx', 'src/features/quality/components/quality-dashboard.tsx']) {
  const text = read(file)
  const lists = (text.match(/<WorkflowRecordList/g) || []).length
  const exports = (text.match(/exportName='/g) || []).length
  assert.ok(lists > 0 && exports === lists, `${file}: every record list exports its view (${exports}/${lists})`)
}
assert.match(read('src/features/tasks/components/tasks-table.tsx'), /exportName='tasks'/, 'tasks table export')
assert.match(read('src/features/users/components/users-table.tsx'), /exportName='users'/, 'users table export')

// navigation & permissions
assert.match(sidebar, /url: '\/portfolio'/, 'portfolio in nav')
assert.match(sidebar, /url: '\/reports'/, 'reports in nav')
assert.match(permissions, /\| 'report'/, 'report permission module')
assert.match(permissions, /\| 'portfolio'/, 'portfolio permission module')
assert.ok(policy.modules.report && policy.modules.portfolio, 'policy modules')
assert.deepEqual(policy.modules.report.transitions['report.schedule'], ['pm', 'planning_eng', 'qs', 'cost_controller', 'procurement', 'finance'])
for (const template of ['owner', 'consultant', 'contractor', 'subcontractor']) {
  assert.ok(policy.partyPermissions[template].modules.report.actions.includes('read'), `${template} party can run reports on what it can see`)
  assert.ok(!policy.partyPermissions[template].modules.portfolio, `${template} party has no portfolio`)
}

// eslint-disable-next-line no-console
console.log('report-builder-ui checks passed')
