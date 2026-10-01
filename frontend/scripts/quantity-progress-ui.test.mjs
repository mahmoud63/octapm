// PC-6 (OCTAPM_PROGRESS_MEASUREMENT §3–§6): every official and pending
// progress figure names its PROGRESS SOURCE; received, issued, installed,
// certified and paid are five figures with five truths, drawn from the
// server's payloads and never computed, merged or summed across units on
// the client; a figure the server withholds is "—" with its reason, never 0.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (path) =>
  readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

// The files are long: a failure names the rule, not the whole file.
const match = (text, pattern, message) =>
  assert.ok(pattern.test(text), `${message} (expected ${pattern})`)
const doesNotMatch = (text, pattern, message) =>
  assert.ok(!pattern.test(text), `${message} (found ${pattern})`)

const vocabulary = read('src/lib/financial-terms.ts')
const boqSchema = read('src/features/boq/data/schema.ts')
const scheduleSchema = read('src/features/schedule/data/schema.ts')
const progressTab = read('src/features/schedule/components/progress-tab.tsx')
const bulkProgress = read(
  'src/features/schedule/components/bulk-progress-update.tsx'
)
const quantitiesSection = read(
  'src/features/controls/quantities/quantities-section.tsx'
)
const quantitiesHook = read(
  'src/features/controls/quantities/use-record-quantities.ts'
)
const boqDrawer = read('src/features/boq/components/boq-detail-drawer.tsx')
const activityDrawer = read(
  'src/features/schedule/components/activity-detail-drawer.tsx'
)
const dailyLogSections = read(
  'src/features/site-reporting/components/daily-log-sections.tsx'
)
const dailyLogPanel = read(
  'src/features/site-reporting/components/daily-log-panel.tsx'
)

// ── The vocabulary: six labels, one place ──────────────────────────────
for (const [key, label] of [
  ['installed', 'Installed'],
  ['certified', 'Certified'],
  ['paidProRata', 'Paid (pro-rata)'],
  ['received', 'Received'],
  ['issued', 'Issued'],
  ['committedQuantity', 'Committed quantity (excluding variations)'],
]) {
  match(
    vocabulary,
    new RegExp(`${key}:\\s*\\{\\s*label:\\s*'${label.replace(/[()]/g, '\\$&')}'`),
    `QUANTITY_TERMS.${key} is labelled "${label}"`
  )
}
match(
  vocabulary,
  /never merged, never summed across units/,
  'the vocabulary states the five-figures rule'
)

// ── The payload shapes come from the contract, every figure with a reason ──
match(boqSchema, /QuantityFigureSchema/, 'the quantity figure is typed')
match(
  boqSchema,
  /unitMatch:\s*z\.boolean\(\)/,
  'a figure says whether its unit is the BOQ unit'
)
match(
  boqSchema,
  /notAvailable:[\s\S]*?reason:\s*z\.string\(\)/,
  'a figure not available carries the server reason'
)
match(
  scheduleSchema,
  /progressSourceSchema[\s\S]*submittedBy[\s\S]*approvedAt[\s\S]*dailyLogDate/,
  'PROGRESS SOURCE provenance is typed with the log date, who and when'
)
match(
  scheduleSchema,
  /quantityProgressEntrySchema[\s\S]*withheld:\s*withheldNote/,
  'a bundled entry can be withheld with its reason'
)

// ── The Progress tab: a PROGRESS SOURCE cell on every official and pending figure ──
match(
  progressTab,
  /function ProgressSourceCell/,
  'the progress tab has a PROGRESS SOURCE cell'
)
match(
  progressTab,
  /uat-progress-source-official-\$\{activity\.id\}/,
  "every activity row names its official figure's source"
)
match(
  progressTab,
  /uat-progress-source-pending-\$\{activity\.id\}/,
  "every activity row names its pending figure's source"
)
match(
  progressTab,
  /uat-progress-source-queue-\$\{submission\.id\}/,
  'every queued submission names its source'
)
match(
  progressTab,
  /source:\s*activity\.approvedProgressSource/,
  'the official source falls back to the approvedProgressSource string'
)
match(
  progressTab,
  /No approved progress yet/,
  'an activity without approved progress says so, not a blank'
)
match(
  progressTab,
  /function BundledEntries/,
  'the queue lists the entries a submission bundles'
)
match(
  progressTab,
  /data-withheld-reason=\{absent\}/,
  'a withheld entry quantity is "—" with the server reason'
)
match(
  progressTab,
  /function InstalledPlanned/,
  'a quantity-method row shows installed / planned'
)
match(
  progressTab,
  /plannedFromAllocations\s*\?\s*undefined/,
  'the client sends no quantityPlanned when the server derives it from allocations'
)
match(
  progressTab,
  /uat-progress-planned-readonly-/,
  'an allocation-derived planned quantity is read-only'
)
match(
  bulkProgress,
  /uat-bulk-progress-source-/,
  'the bulk list names the source beside each approved figure'
)

// ── No client-side arithmetic on figures; nothing summed across units ──
// The quantities module, the PC-6 block of the progress tab and the PC-6
// block of the daily log draw the server's figures and compute nothing from
// them: no figure operand (value, quantity, planned, installed, pctComplete)
// on either side of an arithmetic operator or a compound assignment, no
// reduce over figures, no figure added to another, no tally per unit. The
// blocks run from their banner to the older helpers that follow them (the
// daily log's block runs to the end of the file). Comments are stripped
// first so a prose "installed / planned" is not read as a formula.
const pc6Block = progressTab.slice(
  progressTab.indexOf('PC-6: PROGRESS SOURCE'),
  progressTab.indexOf('const METHOD_OPTIONS')
)
assert.ok(pc6Block.length > 1000, 'the PC-6 block of the progress tab is found')
const dailyLogPc6Block = dailyLogSections.slice(
  dailyLogSections.indexOf('PC-6: the seventh section')
)
assert.ok(
  dailyLogPc6Block.length > 1000,
  'the PC-6 block of the daily log sections is found'
)
const stripComments = (text) =>
  text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1')
// Prettier spaces every binary operator, so a figure operand next to a
// spaced operator — or a dotted operand against any operator — is a formula.
const OPERAND =
  '(value|quantity|planned|plannedQuantity|installedQuantity|installed|pctComplete|quantityComplete|quantityPlanned)'
const ARITHMETIC = [
  new RegExp(`\\.${OPERAND}\\b\\s*[-+*/%]=?\\s`),
  new RegExp(`\\b${OPERAND}\\b\\s+[-+*/%]=?\\s`),
  new RegExp(`[-+*/%]=?\\s*[\\w$?.()]*\\.${OPERAND}\\b`),
  new RegExp(`\\s[-+*/%]=?\\s+[\\w$?.()]*\\b${OPERAND}\\b`),
  /\.reduce\(/,
  /\b(installed|certified|paid|received|issued|committed)\w*\s*[-+*/]\s*(installed|certified|paid|received|issued|committed)/i,
  /\?\?\s*0\b/,
  /\|\|\s*0\b/,
  /\btally\b|\bbyUnit\b|\bsumBy|\btotalQuantity\b/,
]
for (const [name, text] of [
  ['controls/quantities/quantities-section.tsx', quantitiesSection],
  ['controls/quantities/use-record-quantities.ts', quantitiesHook],
  ['progress-tab.tsx (PC-6 block)', pc6Block],
  ['daily-log-sections.tsx (PC-6 block)', dailyLogPc6Block],
]) {
  const code = stripComments(text)
  for (const pattern of ARITHMETIC) {
    doesNotMatch(
      code,
      pattern,
      `${name} computes nothing from the server's figures (${pattern})`
    )
  }
}
// The guard has teeth: the formulas it exists to catch are caught.
for (const formula of [
  'tally.quantity += Number(entry.quantity)',
  '{Number(activity.pctComplete / 100 * Number(planned?.planned)).toLocaleString(',
  'const installed = rows.reduce((sum, row) => sum + row.quantity, 0)',
  'planned.value * (activity.pctComplete / 100)',
  'figure.value ?? 0',
  'const sum = installed + certified',
]) {
  assert.ok(
    ARITHMETIC.some((pattern) => pattern.test(formula)),
    `the arithmetic guard catches: ${formula}`
  )
}
match(
  quantitiesSection,
  /never added up across items|never added to the others/,
  'the quantities section states that figures are never summed'
)
match(
  quantitiesSection,
  /data-unit-mismatch='true'/,
  'a figure in another unit carries a warning'
)
match(
  quantitiesSection,
  /data-absent=\{absence \? 'true' : undefined\}/,
  'an absent figure is marked, with the reason beside the dash'
)
doesNotMatch(
  quantitiesSection,
  /label=\{?['"`](Installed|Certified|Paid|Received|Issued|Committed)/,
  'the quantities section takes every label from QUANTITY_TERMS'
)
match(
  quantitiesHook,
  /status === 404[\s\S]*not-on-server/,
  'a server without the views route reads as not-on-server'
)
match(
  quantitiesHook,
  /status === 403[\s\S]*withheld/,
  'a refused read is withheld with the server reason'
)

// ── The two drawers embed the block; the approved percentage stays ──
match(
  boqDrawer,
  /<RecordQuantities[\s\S]*kind='boq_item'/,
  'the BOQ item drawer draws the five quantities'
)
match(
  activityDrawer,
  /<RecordQuantities[\s\S]*kind='activity'/,
  'the activity drawer draws the five quantities'
)
match(
  activityDrawer,
  /activity-detail-pct/,
  'the activity drawer still shows the approved percentage'
)

// ── The daily log: a seventh section, unit never typed, quantity ≥ 0 ──
match(
  dailyLogSections,
  /export function QuantitiesSectionCard/,
  'the daily log has a Quantities installed section'
)
match(
  dailyLogSections,
  /activities\/\$\{activityId\}\/allocated-items/,
  'the item picker reads the activity’s allocated items'
)
match(
  dailyLogSections,
  /id='dl-quantities-unit'[\s\S]{0,200}readOnly/,
  'the unit is shown and never typed'
)
match(
  dailyLogSections,
  /id='dl-quantities-quantity'[\s\S]{0,200}min=\{0\}/,
  'the quantity is at least zero'
)
match(
  dailyLogSections,
  /uat-dailylog-quantities-items-unavailable/,
  'withheld or missing allocated items read as "—" with the reason'
)
// The day's rows are listed one by one in their item's unit and never
// added up — not per unit, not per item, not across unknown units.
doesNotMatch(
  stripComments(dailyLogPc6Block),
  /data-quantity=|byUnit|tally|\.quantity\s*\+=|\+=\s*Number\(/,
  'the daily log draws no tally of the day’s quantity rows'
)
match(
  dailyLogSections,
  /uat-dailylog-quantities-note[\s\S]{0,400}not official[\s\S]{0,200}never added up/,
  'the section says its rows are not official progress and are never added up'
)
match(
  dailyLogSections,
  /never changes official progress by itself/,
  'the section says a daily log never changes official progress by itself'
)
match(
  dailyLogPanel,
  /<QuantitiesSectionCard/,
  'the panel mounts the seventh section'
)

console.log('Quantity progress UI assertions passed')
