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
const projectDetail = read('src/features/projects/components/project-detail.tsx')
const workspaceService = read('../backend/src/services/workspace-dashboard.service.js')

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
  'Overdue NCR/RFI',
  'Workflow Queues',
  'Health Dimensions',
  'Project Health Watchlist',
].forEach((label) => {
  assert.ok(dashboard.includes(label), `dashboard includes ${label}`)
})

;[
  'Schedule approvals',
  'Progress approvals',
  'IPC actions',
  'Procurement risks',
  'Overdue NCRs',
  'Overdue RFIs',
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
  dashboard.includes('search={{ module: item.target.module') &&
    workspaceService.includes("module: 'schedule'") &&
    workspaceService.includes("child: 'revisions'") &&
    workspaceService.includes("child: 'progress'") &&
    workspaceService.includes("module: 'commercial'") &&
    workspaceService.includes("module: 'quality'") &&
    workspaceService.includes("module: 'docControl'"),
  'dashboard queue links target construction modules'
)

console.log('Dashboard construction assertions passed')
