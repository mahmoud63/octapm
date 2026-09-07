import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (path) =>
  readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

const gantt = read('src/features/schedule/components/gantt-chart.tsx')
const dashboard = read(
  'src/features/schedule/components/schedule-dashboard.tsx'
)
const schema = read('src/features/schedule/data/schema.ts')

;[
  'Activity ID',
  'Activity Name',
  'Original Duration',
  'Start',
  'Finish',
  'Total Float',
  'BL Project Start',
  'BL Project Finish',
].forEach((label) => {
  assert.ok(gantt.includes(label), `Primavera grid renders ${label}`)
})
;[
  'function ScheduleGrid',
  'function TimelineHeader',
  'function GanttCanvas',
  'function DependencyLayer',
  'function SelectionLayer',
].forEach((component) => {
  assert.ok(gantt.includes(component), `${component} is present`)
})

assert.match(gantt, /collapsedRows/, 'WBS rows keep expand/collapse state')
assert.match(gantt, /visibleRows/, 'schedule rows are virtualized')
assert.match(gantt, /monthTicks/, 'timeline uses real month ticks')
assert.match(gantt, /weekTicks/, 'timeline uses real week ticks')
assert.match(gantt, /dayTicks/, 'timeline uses real day ticks')
assert.match(gantt, /SCALE_SETTINGS/, 'Gantt exposes explicit scale settings')
assert.match(gantt, /quarter/, 'quarter scale mode is available')
assert.match(gantt, /Data Date/, 'data-date line is rendered')
assert.match(gantt, /dataDate: '#0284c7'/, 'data-date line uses blue styling')
assert.match(gantt, /baselineStartDate/, 'baseline layer uses baseline dates')
assert.match(gantt, /pctComplete/, 'progress overlay uses activity progress')
assert.match(gantt, /buildConnectors/, 'dependency connector layer is built')
assert.doesNotMatch(gantt, /Month \{i \+ 1\}/, 'fake month labels are removed')
assert.doesNotMatch(gantt, /W\{Math\.floor/, 'fake week labels are removed')

// The working-area controls a planner coming from P6 expects to find.
assert.match(
  gantt,
  /primavera-gantt-fullscreen/,
  'the Gantt can be opened full screen'
)
assert.match(
  gantt,
  /primavera-gantt-splitter/,
  'the grid and the bars are separated by a draggable splitter'
)
assert.match(
  gantt,
  /primavera-gantt-fit/,
  'the timeline can be fitted to the window'
)
assert.match(
  gantt,
  /event\.key === 'Escape'/,
  'Escape leaves full screen'
)

// The export menu carries every export, the PDF report included.
const exportButton = read('src/features/schedule/components/export-button.tsx')
assert.match(
  exportButton,
  /uat-schedule-export-pdf/,
  'Export PDF is an item in the Export menu'
)
assert.doesNotMatch(
  dashboard,
  /PrintReportButton/,
  'the standalone Export PDF button is gone'
)

// The printed report brings its own repeating band rather than relying on the
// fixed one, which Chrome places against the document and not each page.
const printReport = read('src/features/schedule/components/print-report.tsx')
assert.match(printReport, /createPortal/, 'the report is portalled to <body>')
assert.match(printReport, /sheet-band/, 'the report carries its own brand band')
assert.match(
  printReport,
  /data-print-mode/,
  'the report marks the document so the app can be hidden beside it'
)
assert.doesNotMatch(
  printReport,
  /#print-report\s*\{[^}]*position:\s*fixed/,
  'the report no longer pins itself over the page header'
)
assert.doesNotMatch(
  printReport,
  /body \* \{ visibility: hidden/,
  'the report hides the app by display, not by a visibility trick'
)

assert.match(
  schema,
  /activityCode:\s*z\.string\(\)/,
  'activityCode alias is typed'
)
assert.match(
  dashboard,
  /projectStartDate=/,
  'schedule dashboard passes project start date to Gantt'
)
assert.match(
  dashboard,
  /projectEndDate=/,
  'schedule dashboard passes project end date to Gantt'
)
assert.match(
  dashboard,
  /dataDate=\{scheduleDataDate\}/,
  'schedule dashboard passes backend data date to Gantt'
)

console.log('Primavera Gantt UI assertions passed')
