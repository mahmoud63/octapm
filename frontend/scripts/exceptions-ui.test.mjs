import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * PC-7b on the web (change intelligence §1, §2, §6): the exception surfaces
 * draw what the server sent and nothing else.
 *
 *   1. No client arithmetic on `measured` / `limit`: the gap is the server's.
 *   2. Every action is gated by the server's boolean for THIS caller
 *      (`actions.review` …), never by a role or a permission check here.
 *   3. Withheld exceptions are said with the server's reason, never as a
 *      count and never as "0 exceptions".
 *   4. Raise change event opens the server's prefill, sends no amount, and
 *      creates a draft change event — never a change order.
 */

const root = resolve(import.meta.dirname, '..')
const read = (path) => readFileSync(resolve(root, path), 'utf8')
const dir = 'src/features/controls/exceptions'
const files = readdirSync(resolve(root, dir)).filter((name) => /\.tsx?$/.test(name))
const all = Object.fromEntries(files.map((name) => [name, read(`${dir}/${name}`)]))

// ── 1. No arithmetic on the two figures ─────────────────────────────────
for (const [name, source] of Object.entries(all)) {
  assert.doesNotMatch(
    source,
    /(measured|limit)\??\.value\s*[-+*/%]/,
    `${name}: no arithmetic on measured / limit (the server states the gap)`
  )
  assert.doesNotMatch(
    source,
    /[-+*/%]\s*[\w?.!]*\b(measured|limit)\??\.value/,
    `${name}: no arithmetic on measured / limit (the server states the gap)`
  )
  assert.ok(!source.includes('Math.'), `${name}: no Math.* on exception figures`)
  // The two figures are read only through ExceptionFigureText, which formats
  // one figure at a time: no surface reaches into measured.value / limit.value.
  assert.doesNotMatch(source, /\b(measured|limit)\??\.value\b/, `${name}: measured / limit values are drawn only by ExceptionFigureText`)
  for (const line of source.split('\n').filter((entry) => /\bfigure\??\.value\b/.test(entry))) {
    assert.doesNotMatch(
      // strings and hyphenated attribute names (data-value=) are not arithmetic
      line.replace(/'[^']*'/g, "''").replace(/\w+(-\w+)+=/g, 'attr='),
      /[-+*/%]\s*[\w(]|[\w)]\s*[-+*/%]/,
      `${name}: a figure is formatted, never computed — ${line.trim()}`
    )
  }
}
const parts = all['exception-parts.tsx']
assert.match(parts, /export function MeasuredVsLimit/, 'one renderer draws measured against limit')
assert.match(parts, /figure\.basis/, 'each figure is drawn with its basis')

// ── 2. Actions gated by the server's booleans ────────────────────────────
const rowParts = all['exception-row-parts.tsx']
for (const action of ['review', 'snooze', 'dismiss', 'raiseChangeEvent', 'associateChangeEvent']) {
  assert.ok(
    rowParts.includes(`actions?.${action} === true &&`),
    `the ${action} action is drawn only when the server's boolean is true`
  )
}
for (const [name, source] of Object.entries(all)) {
  // The record screens' button (RFI, daily log …) is the one exception: those
  // records carry no actions booleans, so it follows the server's permission
  // matrix for change_event create — and the prefill call decides on press.
  if (name === 'raise-change-event-button.tsx') continue
  assert.ok(!source.includes('useCanPerform'), `${name}: exception actions never use a client permission check`)
  assert.ok(!/role\s*===/.test(source), `${name}: exception actions never read a role`)
}

// ── 3. The withheld note ─────────────────────────────────────────────────
assert.match(parts, /export function WithheldNote/, 'one withheld note')
assert.match(parts, /data-reason=\{withheld\.reason\}/, 'the note carries the server reason')
const page = all['exceptions-page.tsx']
assert.match(page, /\{withheld && \(\s*<WithheldNote withheld=\{withheld\}/, 'the Exceptions screen draws the withheld note whenever the server withheld some')
assert.match(page, /withheld\s*\?\s*'None you may see'/, 'an empty list beside a withheld marker never reads as "no exceptions"')
for (const [name, source] of Object.entries(all)) {
  assert.ok(!/['`"]0 exceptions/.test(source), `${name}: never "0 exceptions"`)
}
assert.match(page, /exceptions-not-on-server/, 'a server without the exceptions route is said as that, not as an empty list')
assert.match(page, /<SubjectLink/, 'the subject links to the PC-5 drawers')
assert.match(page, /<ChangeEventLink/, "an 'in change' row links to its change event")
assert.match(page, /ControlsDetailHost/, 'the screen hosts the PC-5 drawers')

// ── 4. Raise change event ────────────────────────────────────────────────
const raise = all['raise-change-event-dialog.tsx']
assert.match(raise, /useChangeEventPrefill\(/, 'the form opens from the server prefill')
assert.match(raise, /const proposed = prefill\.prefill\b/, "the form reads the API's `prefill` (not the answer around it)")
assert.match(raise, /base: withoutAmounts\(line\)/, 'no line amount is carried into the form')
assert.match(raise, /\.\.\.withoutAmounts\(line\.base\)/, 'no line amount is carried into the raise')
assert.ok(!/\.\.\.(prefill|proposedDraft|proposed)\b/.test(raise), 'the raise body is only what a person may set — no prefill field (amount, link, origin) is spread into it')
assert.match(raise, /raise\.mutateAsync\(\{\s*source,/, 'saving raises from the source through its handoff endpoint')
assert.match(raise, /data-amount-blank='true'/, 'the amount is shown blank, left to the QS')
assert.ok(!/romAmount|unitCost/.test(raise), 'the raise form has no amount field')
assert.ok(!/change-orders|\/convert/.test(raise), 'raising never creates or converts to a change order')
const api = all['api.ts']
assert.match(api, /AMOUNT_FIELDS = \['romAmount', 'unitCost', 'amount', 'quotedAmount'\]/, 'every amount field is stripped')
// The API's addresses (routes/exceptions.js): the exceptions router under
// /controls/exceptions, the handoff per source at its own mount.
assert.match(api, /const exceptionsBase = \(projectId: string\) => `\/projects\/\$\{projectId\}\/controls\/exceptions`/, 'the exceptions router is /projects/:id/controls/exceptions')
assert.match(api, /\$\{CHANGE_EVENT_SOURCE_MOUNTS\[source\.type\]\}\/\$\{source\.id\}\/change-event-prefill`/, "the prefill is the source's change-event-prefill")
assert.match(api, /\$\{CHANGE_EVENT_SOURCE_MOUNTS\[source\.type\]\}\/\$\{source\.id\}\/raise-change-event`/, "saving POSTs the source's raise-change-event (the typed link is the endpoint's)")
assert.ok(!/\/change-events/.test(api), 'a handoff never goes through the generic change-event create (it would drop the typed link)')
const mounts = {
  exception: 'controls/exceptions',
  rfi: 'rfi',
  daily_log: 'daily-logs',
  ncr: 'ncr',
  punch_item: 'punch',
  drawing_revision: 'drawings/sheets/revisions',
  submittal: 'submittals',
  meeting_action: 'meetings/action-items',
}
for (const [type, mount] of Object.entries(mounts)) {
  assert.ok(api.includes(`  ${type}: '${mount}',`), `the ${type} source lives at /projects/:id/${mount} (the API's SOURCE_MOUNTS)`)
}
assert.match(api, /subjectType: query\.subjectType \|\| undefined,\s*subjectId: query\.subjectId \|\| undefined,/, "the list filters by the API's subjectType / subjectId")
assert.ok(!/recordType|recordId/.test(api), 'the list sends no parameter the API ignores')
assert.match(api, /cursor: pageParam \|\| undefined/, "the list follows the API's cursor pages")
assert.match(api, /nextCursor: typeof nextCursor === 'string'/, "the list keeps the API's nextCursor")
assert.match(api, /body\.error\?\.code === 'NOT_FOUND' && \/\^Route not found\//, "only the API's own route-not-found reads as 'not on this server'")
assert.match(api, /if \(isRouteMissing\(error\)\) \{\s*return \{ state: 'not-on-server'/, 'the list treats only a missing route as not on the server')
// The action bodies the API's validators take.
const actionDialog = all['exception-action-dialog.tsx']
assert.match(actionDialog, /action: 'review', exceptionId: exception\.id, body: \{ note: note\.trim\(\) \}/, 'a review sends its note')
assert.match(actionDialog, /body: \{ until, reason: note\.trim\(\) \}/, 'a snooze sends until and its reason')
assert.match(actionDialog, /action: 'dismiss', exceptionId: exception\.id, body: \{ reason: note\.trim\(\) \}/, 'a dismissal sends its reason')
assert.match(actionDialog, /mode === 'snooze'\s*\?\s*Boolean\(until\) && note\.trim\(\)\.length > 0\s*:\s*mode === 'associate'\s*\?\s*Boolean\(changeEventId\)\s*:\s*note\.trim\(\)\.length > 0/, 'review, snooze and dismiss each wait for their required note or reason')
assert.match(actionDialog, /maxLength=\{mode === 'review' \? EXCEPTION_NOTE_MAX : EXCEPTION_REASON_MAX\}/, "the text is capped at the API's limits")
assert.match(api, /EXCEPTION_REASON_MAX = 500/, 'a reason is at most 500 characters')
// Attribution: the server's names, never an id.
assert.ok(!/review\.reviewedBy\b/.test(page), 'a review is attributed by name, never by the reviewer id')
assert.match(page, /personText\(exception\.review\.reviewedByName\)/, 'a review names its reviewer')
assert.match(page, /personText\(exception\.snooze\.byName\)/, 'a snooze names who snoozed it')
assert.match(page, /personText\(exception\.dismissal\.byName\)/, 'a dismissal names who dismissed it')
assert.ok(!/snoozedUntil/.test(page), "the snooze is read from the API's `snooze`")
// Pagination: more pages are said and reachable.
assert.match(page, /shown\$\{more \? ', more available' : ''\}/, 'the count says when the server has more')
assert.match(page, /onClick=\{\(\) => fetchNextPage\(\)\}/, 'more pages can be loaded')

// ── Navigation ───────────────────────────────────────────────────────────
const sidebar = read('src/components/layout/data/sidebar-data.ts')
assert.match(sidebar, /key: 'exceptions',\s*title: 'Exceptions',\s*module: 'controls',\s*child: 'exceptions'/, 'Project Controls lists Exceptions')
const modules = read('src/features/projects/lib/project-modules.ts')
assert.ok(modules.includes("exceptions: ['boq', 'cost', 'schedule']"), 'Exceptions is offered to a holder of any subject module')
const detail = read('src/features/projects/components/project-detail.tsx')
assert.ok(detail.includes("import('@/features/controls/exceptions/exceptions-page')"), 'the Exceptions screen is lazily loaded')
assert.match(detail, /childState\.controls === 'exceptions'/, 'the controls module renders Exceptions on its sub-tab')

// ── The PC-5 drawers: one exceptions section each ───────────────────────
const section = all['record-exceptions-section.tsx']
assert.match(section, /useProjectExceptions\(projectId, \{\s*subjectType: recordType,\s*subjectId: recordId,\s*\}\)/, "the drawer asks the API for this record's exceptions only")
assert.match(section, /const data = flattenExceptionPages\(query\.data\)/, 'the drawer reads the pages as the server sent them')
assert.match(
  section,
  /\.filter\(\s*\(exception\) => exception\.status !== 'resolved' && exception\.status !== 'dismissed'\s*\)/,
  'the drawer shows current exceptions only, never a resolved or dismissed one'
)
assert.match(section, /\{withheld && \(\s*<WithheldNote/, 'the drawer section says what the server withheld')
assert.match(section, /withheld \? null : \(\s*<Empty>No open exception on this record\.<\/Empty>/, 'a drawer never says "none" beside a withheld marker')
assert.match(section, /<ChangeEventLink/, 'an exception in change links to its event from the drawer')
assert.match(section, /<MeasuredVsLimit/, 'the drawer draws measured vs limit with their bases')
for (const [file, kind, testId] of [
  ['src/features/boq/components/boq-detail-drawer.tsx', 'boq_item', 'boq-detail-exceptions'],
  ['src/features/schedule/components/activity-detail-drawer.tsx', 'activity', 'activity-detail-exceptions'],
]) {
  const drawer = read(file)
  assert.equal((drawer.match(/<RecordExceptionsSection/g) ?? []).length, 1, `${file}: one exceptions section`)
  assert.ok(drawer.includes(`recordType='${kind}'`), `${file}: the section reads the ${kind}'s exceptions`)
  assert.ok(drawer.includes(`testId='${testId}'`), `${file}: the section is ${testId}`)
}

// PC-7b integration T: a drawer's links stay inside the open workspace
// (/o/{segment}/projects/…, spec 50) — never a legacy /projects/… path.
const drawerSection = all['record-exceptions-section.tsx']
assert.ok(!/to='\/projects\//.test(drawerSection), 'the drawer section links through ProjectPageLink, never a legacy /projects/ route')
assert.match(drawerSection, /<ProjectPageLink[\s\S]*?child='exceptions'/, 'the drawer opens the Exceptions screen through ProjectPageLink')
const rowLinks = all['exception-row-parts.tsx']
const pageLink = rowLinks.slice(rowLinks.indexOf('export function ProjectPageLink'), rowLinks.indexOf('export function ChangeEventLink'))
assert.match(pageLink, /if \(orgSlug\) \{\s*return \(\s*<Link\s+to='\/o\/\$orgSlug\/projects\/\$projectId\/\$module\/\$child'/, 'with a workspace open, the workspace route')
const changeEventLink = rowLinks.slice(rowLinks.indexOf('export function ChangeEventLink'))
assert.match(changeEventLink, /<ProjectPageLink/, 'the change-event link stays inside the workspace')
assert.ok(!/to='\/projects\//.test(changeEventLink.slice(0, changeEventLink.indexOf('\n}\n'))), 'the change-event link names no legacy route')

// ── Counts: the Overview strip and the workspace tile ───────────────────
const strip = read('src/features/projects/components/controls-strip.tsx')
assert.match(strip, /useExceptionsSummary\(projectId/, 'the strip reads the server summary')
assert.match(strip, /enabled: exceptionsOffered && !permissionsSettling/, 'asked only when the Exceptions page is offered and permissions settled')
assert.match(
  strip,
  /summary\.total == null \|\| \(summary\.withheld && summary\.total === 0\)\s*\?\s*'—'\s*:\s*summary\.total\.toLocaleString\(\)/,
  "the strip's total is the server's, never summed here, and never a 0 beside withheld exceptions"
)
assert.match(strip, /severityCountsText\(summary\.bySeverity\)/, 'per-severity counts as the server sent them')
assert.match(strip, /testId='uat-controls-figure-open-exceptions'/, 'the strip has the open-exceptions figure')
const stripFigure = strip.slice(strip.indexOf('function openExceptionsFigure'), strip.indexOf('* Which of the three truths'))
assert.ok(!/bySeverity\.(critical|warning|info)[^\n]*\+/.test(stripFigure), 'the strip never adds the severity counts')
// PC-7b integration N: the summary route is on the API (GET …/controls/exceptions/summary,
// declared before /:exceptionId). The withheld marker is "—" with the server's reason —
// it says nothing about whether anything was left out ("some withheld" would), and
// what is in change is the server's own count beside the total.
assert.match(stripFigure, /`— \$\{summary\.withheld\.reason\}`/, 'the withheld marker reads "—" with the reason on the strip')
assert.ok(!/some withheld/i.test(stripFigure), 'the strip never says that some were withheld — the marker comes from access alone')
assert.match(stripFigure, /summary\.inChange\b/, 'the strip says how many are in change, as the server counted them')
assert.match(stripFigure, /title: summary\.basis/, "the server's basis is the figure's title")
const exceptionsApi = all['api.ts']
const summaryHook = exceptionsApi.slice(exceptionsApi.indexOf('export const useExceptionsSummary'), exceptionsApi.indexOf('/** The bodies the API'))
assert.match(summaryHook, /if \(isRouteMissing\(error\)\)/, 'only the API\'s own "route not found" reads as not on this server')
assert.ok(!/isSummaryMissing|VALIDATION_ERROR/.test(exceptionsApi), 'a refused summary request is an error, never read as "not on this server"')
const backendRoutes = readFileSync(resolve(root, '..', 'backend', 'src', 'routes', 'exceptions.js'), 'utf8')
assert.ok(
  backendRoutes.indexOf('router.get("/summary"') > 0 && backendRoutes.indexOf('router.get("/summary"') < backendRoutes.indexOf('router.get("/:exceptionId"'),
  'the API declares the summary route before /:exceptionId'
)
const tile = all['exceptions-dashboard-card.tsx']
assert.match(
  tile,
  /data\.total == null \|\| \(data\.withheld && data\.total === 0\) \? '—' : data\.total\.toLocaleString\(\)/,
  "the tile's total is the server's, never a 0 beside withheld exceptions"
)
assert.match(tile, /<SeverityCountChips counts=\{data\.bySeverity/, 'the tile draws the per-severity counts as sent')
assert.match(tile, /<WithheldNote withheld=\{data\.withheld\}/, 'the tile says what was withheld')
assert.match(tile, /const withheldProjects = data\.withheld\?\.projects \?\? \[\]/, "the projects the server withheld kinds on are the API's withheld.projects")
const projectRow = tile.slice(tile.indexOf('withheldProjects.map'), tile.indexOf('</ul>'))
assert.match(projectRow, /data-withheld='true'>\s*— \{project\.reason\}/, "a project's withheld exceptions are said with the reason")
assert.ok(!/count|SeverityCountChips|total/i.test(projectRow), 'a withheld project is never given a count')
assert.ok(!/\+/.test(tile.slice(tile.indexOf('const others'), tile.indexOf('].filter(Boolean)'))), 'the tile never adds the counts')
const dashboard = read('src/features/dashboard/index.tsx')
assert.match(dashboard, /data\.openExceptions && <OpenExceptionsCard data=\{data\.openExceptions\} \/>/, 'the workspace dashboard draws the tile the server sends')

// ── Raise change event on the source records ────────────────────────────
const button = all['raise-change-event-button.tsx']
assert.match(button, /const allowed = useCanPerform\('change_event', 'create'\)\s*\n\s*const \[open, setOpen\] = useState\(false\)\s*\n\s*if \(!allowed\) return null/, 'the record button is drawn only where the server grants change_event create')
assert.match(button, /<RaiseChangeEventDialog/, 'the record button opens the prefilled form')
assert.ok(!rowParts.includes('RaiseChangeEventButton') && !page.includes('RaiseChangeEventButton'), 'an exception row is gated by its own actions boolean, not the record button')
for (const [file, type] of [
  ['src/features/doc-control/components/rfi-detail-dialog.tsx', 'rfi'],
  ['src/features/site-reporting/components/daily-log-panel.tsx', 'daily_log'],
  ['src/features/quality/components/quality-dashboard.tsx', 'ncr'],
  ['src/features/punch/components/punch-item-detail.tsx', 'punch_item'],
  ['src/features/drawings/components/sheet-viewer.tsx', 'drawing_revision'],
  ['src/features/doc-control/components/submittal-detail-dialog.tsx', 'submittal'],
  ['src/features/meetings/components/meetings-dashboard.tsx', 'meeting_action'],
]) {
  const screen = read(file)
  assert.equal((screen.match(/<RaiseChangeEventButton/g) ?? []).length, 1, `${file}: one Raise change event button`)
  assert.ok(screen.includes(`source={{ type: '${type}', id:`), `${file}: raises with the typed ${type} source`)
}

console.log('exceptions-ui: ok')
