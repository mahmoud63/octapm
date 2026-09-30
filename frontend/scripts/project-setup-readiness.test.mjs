import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
// Node runs the TypeScript module directly (type stripping; it imports types only).
import {
  noProgressActivitiesBadge,
  scheduleTileDetail,
  stagedScheduleNote,
} from '../src/features/projects/lib/schedule-tile.ts'

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
  // The forecast's tag is derived (a34e101): a projection only when CPI
  // projects it, "fallback" when the revised budget is handed back.
  'truth={eacTruth}',
  "eacFallback ? 'fallback' : 'projection'",
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
// R5-4: the headline's three schedule states. The engine says which state
// the schedule is in and writes the entries; the screens show its words and
// never put a count beside a schedule that is not active.
const schema = read('src/features/projects/data/schema.ts')
const guideStrip = read('src/features/projects/components/setup-guide/setup-readiness-strip.tsx')
assert.ok(
  schema.includes("export type ProjectSetupScheduleState = 'none' | 'staged' | 'active'"),
  'the readiness type names the three schedule states'
)
;['scheduleState?: ProjectSetupScheduleState', 'criticalUnmappedWaiting?: boolean', 'waiting?: boolean'].forEach(
  (copy) => {
    assert.ok(schema.includes(copy), `the readiness type carries ${copy}`)
  }
)
;[
  'summary.scheduleState',
  'summary.criticalUnmappedWaiting',
  "scheduleState === 'none' || scheduleState === 'staged'",
  "value={criticalWaiting ? '—' : criticalActivities.toLocaleString()}",
  "truth={criticalWaiting ? 'none' : 'derived'}",
  "'Waiting for active schedule'",
].forEach((copy) => {
  assert.ok(strip.includes(copy), `controls strip follows the schedule state: ${copy}`)
})
assert.ok(
  !strip.includes('value={criticalActivities.toLocaleString()}'),
  'the critical figure is never shown unconditionally: no count while no schedule is active'
)
// The Schedule tile's line is the engine's state and verdict, read by one
// pure module — run here, branch by branch, so a broken condition fails this
// static check and not only the browser walk (e2e 56). The strip hands the
// line over whole: it keeps no wording and no condition of its own.
const scheduleTileSource = strip.slice(strip.indexOf("label='Schedule'"), strip.indexOf("testId='uat-controls-schedule-tile'"))
assert.ok(scheduleTileSource.length > 0, 'the controls strip has a Schedule tile')
assert.match(
  scheduleTileSource,
  /detail=\{scheduleTileDetail\(readiness\)\}/,
  'the Schedule tile shows scheduleTileDetail(readiness), whole'
)
const uncommented = (source) => source.replace(/\/\/.*$/gm, '')
assert.ok(
  !/waiting for activation/.test(uncommented(strip)) && !/scheduleState|`/.test(uncommented(scheduleTileSource)),
  'the controls strip words no schedule line and keeps no schedule-state condition of its own in the tile'
)
assert.match(
  strip,
  /methods\.total === 0\s*\?\s*noProgressActivitiesBadge\(readiness\)/,
  'the Progress method tile asks the same module what to say when nothing is active'
)
{
  const issue = (code) => ({ code, message: code, severity: 'blocking' })
  const reading = ({
    state,
    revision = null,
    blockers = [],
    counts = {},
    imported,
    alreadyLocked = false,
  }) => ({
    summary: {
      scheduleState: state,
      headline: imported === undefined ? undefined : [{ key: 'schedule_imported', label: 'Schedule imported', value: imported ? 'PASS' : 'FAIL', tone: imported ? 'info' : 'blocked', raw: imported }],
    },
    steps: [{ key: 'schedule_generation', blockers: blockers.map(issue), warnings: [], counts }],
    context: { currentRevision: revision },
    gates: { baseline: { alreadyLocked } },
  })
  const rev = (status, extra = {}) => ({ id: 'r1', label: 'XER Import', status, isActive: false, approvedAt: null, baselinedAt: null, ...extra })

  // No schedule.
  assert.equal(scheduleTileDetail(reading({ state: 'none', blockers: ['NO_SCHEDULE'], imported: false })), 'Generate or import a schedule')
  // Staged and passed by the engine — a draft, under review, approved: waiting for activation.
  for (const status of ['draft', 'under_review', 'approved']) {
    const staged = reading({ state: 'staged', revision: rev(status), counts: { revisionActivities: 2 }, imported: true })
    assert.equal(scheduleTileDetail(staged), 'Imported · XER Import · waiting for activation', `staged ${status}`)
    assert.equal(stagedScheduleNote(staged), 'waiting for activation', `staged ${status}`)
  }
  assert.equal(
    scheduleTileDetail(reading({ state: 'staged', revision: rev('draft', { label: null }), imported: true })),
    'Imported · waiting for activation',
    'a revision without a label'
  )
  // Staged and failed by the engine: never "waiting for activation".
  const rejected = reading({ state: 'staged', revision: rev('rejected'), blockers: ['SCHEDULE_REJECTED'], counts: { revisionActivities: 2 }, imported: false })
  assert.equal(scheduleTileDetail(rejected), 'Imported · XER Import · rejected — needs resubmission', 'a rejected staged revision')
  assert.equal(
    scheduleTileDetail(reading({ state: 'staged', revision: rev('rejected') })),
    'Imported · XER Import · rejected — needs resubmission',
    'a rejected revision is read off its status too, when the step lists no blocker'
  )
  const empty = reading({ state: 'staged', revision: rev('draft'), blockers: ['NO_ACTIVITIES'], counts: { revisionActivities: 0 }, imported: false })
  assert.equal(scheduleTileDetail(empty), 'Imported · XER Import · no activities in the revision', 'an empty staged revision')
  assert.equal(
    scheduleTileDetail(reading({ state: 'staged', revision: rev('rejected'), blockers: ['NO_ACTIVITIES', 'SCHEDULE_REJECTED'], imported: false })),
    'Imported · XER Import · no activities in the revision',
    'rejected and empty: the status already says rejected; the line says there is nothing in it'
  )
  assert.equal(
    scheduleTileDetail(reading({ state: 'staged', revision: rev('draft'), blockers: ['SOMETHING_NEW'], imported: false })),
    'Imported · XER Import · not ready — see Setup Readiness',
    'a blocker this module does not know is not read as waiting'
  )
  assert.equal(
    scheduleTileDetail(reading({ state: 'staged', revision: rev('draft'), imported: false })),
    'Imported · XER Import · not ready — see Setup Readiness',
    'the headline failing the import is not read as waiting'
  )
  for (const failing of [rejected, empty]) {
    assert.ok(!scheduleTileDetail(failing).includes('waiting for activation'), 'a failed staged revision is never waiting for activation')
    assert.ok(!/\d/.test(scheduleTileDetail(failing)), 'and the tile counts nothing on it')
  }
  // Active: the schedule in force is counted, as before.
  assert.equal(
    scheduleTileDetail(reading({ state: 'active', revision: rev('approved', { isActive: true }), counts: { activeActivities: 1234 }, imported: true })),
    `${(1234).toLocaleString()} activities · XER Import`
  )
  const baselinedAt = '2026-03-04T10:00:00.000Z'
  assert.equal(
    scheduleTileDetail(
      reading({ state: 'active', revision: rev('baselined', { isActive: true, baselinedAt }), counts: { activeActivities: 2 }, imported: true, alreadyLocked: true })
    ),
    `2 activities · XER Import · locked ${new Date(baselinedAt).toLocaleDateString()}`
  )
  // Activities entered with no revision are a schedule too.
  assert.equal(
    scheduleTileDetail(reading({ state: 'active', counts: { activeActivities: 3 }, imported: true })),
    'No revision — import or generate one to review and baseline'
  )
  // An answer that does not say the state (an older API) reads as it did.
  assert.equal(
    scheduleTileDetail(reading({ state: undefined, revision: rev('draft'), counts: { activeActivities: 0 } })),
    '0 activities · XER Import'
  )
  // The Progress method tile beside it.
  assert.equal(noProgressActivitiesBadge(reading({ state: 'staged', revision: rev('draft') })), 'Waiting for active schedule')
  assert.equal(noProgressActivitiesBadge(reading({ state: 'none' })), 'No activities')
  assert.equal(noProgressActivitiesBadge(reading({ state: 'active' })), 'No activities')
}
// The step cards print a step's counts as chips; the engine leaves the
// active schedule's counts out while none is active and names a staged
// revision's activities as the revision's. The wizard labels that count and
// still decides nothing from the schedule state itself.
assert.ok(
  wizard.includes("revisionActivities: 'Revision activities'"),
  "the setup wizard labels a staged revision's own activities"
)
;[
  [guideStrip, 'setup guide strip'],
  [wizard, 'setup wizard headline'],
].forEach(([source, name]) => {
  assert.ok(
    source.includes("data-waiting={entry.waiting ? 'true' : undefined}") && source.includes('data-tone={entry.tone}'),
    `${name} marks the engine's waiting entry and its tone`
  )
  // The value shown is the engine's own, whatever the state.
  assert.ok(source.includes('{entry.value}'), `${name} shows the engine's value`)
  assert.ok(
    !/criticalUnmappedActivities|scheduleState/.test(source),
    `${name} computes nothing of its own from the schedule state`
  )
  // R6 (the R5-4 family): the engine's waiting words — "No critical path
  // yet", "Waiting for the BOQ", "Imported — revision rejected, resubmit" —
  // are the engine's alone; no screen words a state of its own.
  assert.ok(
    !/No critical path yet|Waiting for the BOQ|Imported — /.test(uncommented(source).replace(/\/\*[\s\S]*?\*\//g, '')),
    `${name} words no headline state of its own`
  )
})
// A waiting mapping share is no share of the bill's value: the guide strip
// puts "(by value)" beside a share the engine gave, never beside its wait.
assert.ok(
  guideStrip.includes("entry.key === 'mapping' && !entry.withheld && !entry.waiting"),
  'the setup guide strip shows "(by value)" only beside a mapping share the engine gave'
)
// No bill (R6): the engine says the mapping waits (summary.mappingWaiting,
// mappingReason "Waiting for the BOQ"); the controls tiles read "—" with its
// words — never "0%", never "0 of 0 rows covered", never "0 unmapped".
;['mappingWaiting?: boolean', 'mappingReason?: string'].forEach((copy) => {
  assert.ok(schema.includes(copy), `the readiness type carries ${copy}`)
})
;[
  'summary.mappingWaiting',
  "summary.mappingReason ?? 'Waiting for the BOQ'",
  "value={coverageWithheld || mappingWaiting ? '—' : formatPct(coveragePct)}",
  "data-testid='uat-controls-coverage-waiting'",
  'const unmappedRows = counts && !coverageWithheld && !mappingWaiting ? counts.unmapped + counts.partial : null',
  "truth={mappingWaiting ? 'none' : 'derived'}",
].forEach((copy) => {
  assert.ok(strip.includes(copy), `controls strip follows the mapping wait: ${copy}`)
})
assert.match(
  strip,
  /coverageWithheld\s*\|\|\s*mappingWaiting\s*\|\|\s*coveragePct == null/,
  'a waiting coverage share takes the neutral tone'
)
assert.match(
  strip,
  /\?\s*'Unavailable'\s*:\s*mappingWaiting\s*\?\s*mappingWaitingText\s*:\s*counts/,
  'the coverage badge says the engine\'s wait before it counts rows'
)
// An active schedule with no critical path (R6): the engine's
// criticalUnmappedWaiting + reason already drive the critical figure; the
// figure never shows the step's criticalActivities count while waiting.
assert.ok(
  strip.includes("summary.criticalUnmappedReason ?? 'Waiting for active schedule'"),
  'the critical figure shows the engine\'s own reason for waiting (active-schedule wait or "No critical path yet")'
)
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
