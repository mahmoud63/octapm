import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const read = (path) => readFileSync(resolve(root, path), 'utf8')

const hooks = read('src/features/projects/hooks/use-projects.ts')
const detail = read('src/features/projects/components/project-detail.tsx')
const wizard = read(
  'src/features/projects/components/project-setup-wizard.tsx'
)
const reviewPanel = read(
  'src/features/schedule/components/schedule-review-panel.tsx'
)
const progressTab = read('src/features/schedule/components/progress-tab.tsx')

assert.match(
  hooks,
  /\/projects\/\$\{projectId\}\/setup-readiness/,
  'project setup readiness hook calls backend endpoint'
)
assert.ok(
  detail.includes('ProjectSetupWizard'),
  'project detail renders setup wizard'
)
assert.ok(
  detail.includes('handleSetupNavigate'),
  'project detail links setup steps into module navigation'
)

;[
  'Setup Readiness',
  'Ready for progress',
  'Official reporting ready',
  'Reporting gated',
  'Baseline ready',
  'Gate:',
  'ProjectSetupReadiness',
].forEach((copy) => {
  assert.ok(wizard.includes(copy), `setup wizard includes ${copy}`)
})

// PC-4: per-item detail with links, the controls strip, the Overview landing.
;['ItemLink', 'IssueDetail', 'uat-setup-item-', 'item.href', 'and {more} more'].forEach(
  (copy) => {
    assert.ok(wizard.includes(copy), `setup wizard lists issue items: ${copy}`)
  }
)
const strip = read('src/features/projects/components/controls-strip.tsx')
;[
  'uat-controls-readiness-pct',
  'uat-controls-boq-revision',
  'uat-controls-coverage-pct',
  'uat-controls-na-amount',
  'uat-controls-schedule',
  'uat-controls-progress-method',
  'readiness.steps',
].forEach((copy) => {
  assert.ok(strip.includes(copy), `controls strip shows ${copy}`)
})
// The strip shows what the services already computed: readiness, the cost
// summary and the forecast through their hooks — never its own request,
// never its own arithmetic on a money figure.
assert.ok(
  !/apiClient|useQuery\(/.test(strip),
  'controls strip talks to no endpoint of its own — no second computation of a figure'
)
;['useCostSummary(', 'useForecast(', "useCanPerform('cost', 'read')", "useCanPerform('schedule', 'read')"].forEach(
  (copy) => {
    assert.ok(strip.includes(copy), `controls strip reads the existing services, gated by permission: ${copy}`)
  }
)
// §20: the figures row, each labelled with its truth; the forecast is a projection.
;[
  'uat-controls-figures',
  'uat-controls-figure-budget',
  'uat-controls-figure-actual',
  'uat-controls-figure-forecast',
  'uat-controls-figure-progress',
  'uat-controls-figure-critical',
  'uat-controls-figure-unmapped',
  'uat-controls-figure-exceptions',
  'uat-controls-figure-data-quality',
  "truth='projection'",
  'criticalUnmappedActivities',
  'dataQuality',
].forEach((copy) => {
  assert.ok(strip.includes(copy), `controls strip figure: ${copy}`)
})
assert.ok(
  detail.includes('<ControlsStrip') && detail.includes("visibleModule === 'overview'"),
  'project detail renders the controls strip on the Overview'
)
// §33 headline, §21 guides and §22 the revision's record on the wizard.
;[
  'uat-setup-headline',
  'summary.headline',
  'uat-setup-guides',
  'uat-setup-guide-',
  'guide.href',
  'uat-setup-boq-revision-changes',
  'uat-setup-boq-revision-validation',
  'uat-setup-boq-revision-history',
  "step.key === 'boq_approval'",
].forEach((copy) => {
  assert.ok(wizard.includes(copy), `setup wizard shows ${copy}`)
})
// §19: one Project Controls group inside the project, built from the
// sidebar's group data, with the entries that open other modules carrying
// their target; the module bar keeps it beside the schedule.
const sidebar = read('src/components/layout/data/sidebar-data.ts')
assert.match(sidebar, /export const projectControlsGroup/, 'sidebar data exports the Project Controls group')
;['Overview', 'Structure', 'Schedule', 'BOQ', 'Mapping', 'Progress', 'Cost', 'Forecast', 'Resources', 'Risks', 'Baselines / Revisions'].forEach(
  (title) => {
    assert.ok(sidebar.includes(`title: '${title}'`), `Project Controls group lists ${title}`)
  }
)
assert.ok(detail.includes('projectControlsGroup.items'), 'project detail builds the controls menu from the group')
assert.ok(detail.includes('children: controlsChildren'), 'the controls module carries the group')
assert.match(detail, /if \(entry\?\.target\) \{\s*goTo\(entry\.target\.module, entry\.target\.child \?\? null\)/, 'a group entry opens the module that owns the page')
const bar = read('src/features/projects/components/project-module-bar.tsx')
assert.match(bar, /'schedule',[\s\S]*?'controls',\s*'siteReporting'/, 'Project Controls sits beside the schedule in the module bar')
const landing = read(
  'src/routes/_authenticated/o/$orgSlug/projects/$projectId/index.tsx'
)
const detailPage = read('src/features/projects/components/project-detail-page.tsx')
assert.ok(
  landing.includes('ProjectOverviewPage') &&
    !landing.includes('redirect(') &&
    detailPage.includes("module='overview'"),
  '/o/:workspace/projects/:id lands on the Overview instead of redirecting to the Gantt'
)

assert.ok(
  reviewPanel.includes('setupBaselineBlocked'),
  'baseline action consumes project setup gate'
)
assert.ok(
  reviewPanel.includes('Baseline setup blockers'),
  'baseline blockers are visible'
)
assert.ok(
  progressTab.includes('Progress setup warnings'),
  'progress setup warnings are visible'
)
assert.ok(
  progressTab.includes('Official approved progress') &&
    progressTab.includes('Pending progress review'),
  'progress tab separates official approved progress from pending review'
)
assert.ok(
  progressTab.includes('projectSetupReadinessKey'),
  'progress updates refresh setup readiness'
)

console.log('Project setup readiness UI assertions passed')
