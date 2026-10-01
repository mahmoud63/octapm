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
  assert.ok(!source.includes('useCanPerform'), `${name}: exception actions never use a client permission check`)
  assert.ok(!/role\s*===/.test(source), `${name}: exception actions never read a role`)
}

// ── 3. The withheld note ─────────────────────────────────────────────────
assert.match(parts, /export function WithheldNote/, 'one withheld note')
assert.match(parts, /data-reason=\{withheld\.reason\}/, 'the note carries the server reason')
const page = all['exceptions-page.tsx']
assert.match(page, /<WithheldNote/, 'the Exceptions screen draws the withheld note')
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
assert.match(raise, /withoutAmounts\(prefill\.payload\)/, 'no amount is carried into the create')
assert.match(raise, /data-amount-blank='true'/, 'the amount is shown blank, left to the QS')
assert.ok(!/romAmount|unitCost/.test(raise), 'the raise form has no amount field')
assert.ok(!/change-orders|\/convert/.test(raise), 'raising never creates or converts to a change order')
const api = all['api.ts']
assert.match(api, /AMOUNT_FIELDS = \['romAmount', 'unitCost', 'amount', 'quotedAmount'\]/, 'every amount field is stripped')
assert.match(api, /`\/projects\/\$\{projectId\}\/change-events`/, 'saving posts a change event')

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
assert.match(section, /<WithheldNote/, 'the drawer section says what the server withheld')
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

// ── Counts: the Overview strip and the workspace tile ───────────────────
const strip = read('src/features/projects/components/controls-strip.tsx')
assert.match(strip, /useExceptionsSummary\(projectId/, 'the strip reads the server summary')
assert.match(strip, /enabled: exceptionsOffered && !permissionsSettling/, 'asked only when the Exceptions page is offered and permissions settled')
assert.match(strip, /summary\.total == null \? '—' : summary\.total\.toLocaleString\(\)/, "the strip's total is the server's, never summed here")
assert.match(strip, /severityCountsText\(summary\.bySeverity\)/, 'per-severity counts as the server sent them')
assert.match(strip, /some withheld: \$\{summary\.withheld\.reason\}/, 'withheld exceptions are said with the reason on the strip')
assert.match(strip, /testId='uat-controls-figure-open-exceptions'/, 'the strip has the open-exceptions figure')
const stripFigure = strip.slice(strip.indexOf('function openExceptionsFigure'), strip.indexOf('* Which of the three truths'))
assert.ok(!/bySeverity\.(critical|warning|info)[^\n]*\+/.test(stripFigure), 'the strip never adds the severity counts')
const tile = all['exceptions-dashboard-card.tsx']
assert.match(tile, /data\.total == null \? '—' : data\.total\.toLocaleString\(\)/, "the tile's total is the server's")
assert.match(tile, /<SeverityCountChips counts=\{data\.bySeverity/, 'the tile draws the per-severity counts as sent')
assert.match(tile, /<WithheldNote withheld=\{data\.withheld\}/, 'the tile says what was withheld')
assert.match(tile, /project\.withheld \?/, "a project's withheld exceptions are said with the reason, never as 0")
const dashboard = read('src/features/dashboard/index.tsx')
assert.match(dashboard, /data\.openExceptions && <OpenExceptionsCard data=\{data\.openExceptions\} \/>/, 'the workspace dashboard draws the tile the server sends')

console.log('exceptions-ui: ok')
