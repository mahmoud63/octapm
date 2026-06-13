import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const read = (path) => readFileSync(resolve(root, path), 'utf8')

const dashboard = read('src/features/dashboard/index.tsx')
const projectRoute = read('src/routes/_authenticated/projects/$projectId.tsx')
const projectPage = read(
  'src/features/projects/components/project-detail-page.tsx'
)
const projectDetail = read(
  'src/features/projects/components/project-detail.tsx'
)
const workspaceService = read(
  '../backend/src/services/workspace-dashboard.service.js'
)

assert.match(
  dashboard,
  /\/projects\/workspace-dashboard/,
  'dashboard loads the workspace aggregate endpoint'
)
;[
  'Portfolio Health',
  'Active Projects',
  'Critical Activities',
  'Approval Queue',
  'Procurement Risks',
  'Overdue QA/Safety/Docs',
  'Workflow Queues',
  'Health Dimensions',
  'Project Health Watchlist',
  'Official KPIs',
  'Pending Review',
  'Source:',
  'Cutoff:',
].forEach((label) => {
  assert.ok(dashboard.includes(label), `dashboard includes ${label}`)
})
;[
  'Schedule approvals',
  'Progress approvals',
  'IPC actions',
  'Change order review',
  'Risk closeout review',
  'QA/Safety closeout review',
  'Procurement risks',
  'Overdue Risk Mitigations',
  'Overdue NCRs',
  'Overdue Safety Actions',
  'Overdue RFIs',
  'Overdue Submittals',
].forEach((label) => {
  assert.ok(
    workspaceService.includes(label),
    `workspace endpoint includes queue ${label}`
  )
})
;[
  ['Total', 'Revenue'].join(' '),
  ['Sub', 'scriptions'].join(''),
  ['Recent', 'Sales'].join(' '),
  ['Traffic', ['Over', 'view'].join('')].join(' '),
  ['Unique', 'Visitors'].join(' '),
  ['Bounce', 'Rate'].join(' '),
].forEach((placeholder) => {
  assert.ok(
    !dashboard.includes(placeholder),
    `dashboard omits generic placeholder ${placeholder}`
  )
})

assert.match(
  projectRoute,
  /validateSearch/,
  'project detail route validates module search params'
)
assert.match(
  projectPage,
  /useSearch\(\{ from: '\/_authenticated\/projects\/\$projectId' \}\)/,
  'project detail page consumes module search params'
)
assert.ok(
  projectDetail.includes('initialTarget'),
  'project detail applies dashboard module targets'
)
assert.ok(
  dashboard.includes('targetSearch(target)') &&
    dashboard.includes('recordId: target.recordId') &&
    workspaceService.includes('module: "schedule"') &&
    workspaceService.includes('child: "revisions"') &&
    workspaceService.includes('child: "progress"') &&
    workspaceService.includes('module: "commercial"') &&
    workspaceService.includes('child: "change-orders"') &&
    workspaceService.includes('source: "cost_record.actual_through_date"') &&
    workspaceService.includes('module: "quality"') &&
    workspaceService.includes('module: "docControl"') &&
    workspaceService.includes('child: "risks"') &&
    workspaceService.includes('source: "risk"'),
  'dashboard queue links target construction modules'
)
assert.ok(
  workspaceService.includes('officialKpis') &&
    workspaceService.includes('pendingReview') &&
    workspaceService.includes('kpiSourceRules') &&
    workspaceService.includes('cutoffDate'),
  'workspace endpoint exposes official KPI source rules and cutoff freshness'
)
assert.ok(
  dashboard.includes('data.pendingReview?.metrics') &&
    dashboard.includes("sourceStatus === 'pending-review'") &&
    dashboard.includes('formatCutoff'),
  'dashboard visually separates pending-review metrics from official KPIs'
)

console.log('Dashboard construction assertions passed')
