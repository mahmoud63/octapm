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
const officialInstalled = read(
  'src/features/controls/quantities/official-installed.tsx'
)
const detailParts = read('src/features/controls/components/detail-parts.tsx')
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

// ── Bulk progress: a percentage is never offered against an activity measured
// by quantity. The server refuses such a batch whole (nothing written), so
// the screen lists the activity disabled with the reason and the way to the
// Progress tab, reads the method from the register (the schedule payload
// does not carry it), never assumes an unread method is percent, and — when
// the server still refuses — names the activity and shows nothing as saved.
const registerProgress = read('src/features/schedule/lib/register-progress.ts')
match(
  registerProgress,
  /'progressMethod',\s*'progressMethodConfig',/,
  'the register merge carries the progress method and its configuration'
)
match(
  progressTab,
  /withRegisterProgress\(scheduled, registerQuery\.data\)/,
  'the Progress tab still merges the register over the schedule rows'
)
match(
  bulkProgress,
  /get\(`\/projects\/\$\{projectId\}\/activities`\)[\s\S]{0,400}withRegisterProgress\(scheduled, registerQuery\.data\)/,
  'the bulk list reads the progress method from the register'
)
match(
  bulkProgress,
  /activity\.progressMethodConfig\?\.method \|\| activity\.progressMethod \|\| null/,
  "the effective method is the activity's configured method, else the register's"
)
match(
  bulkProgress,
  /if \(method === 'quantity'\) return QUANTITY_METHOD_REASON/,
  'an activity measured by quantity takes no percentage update'
)
match(
  bulkProgress,
  /if \(!method\) return METHOD_NOT_READ_REASON/,
  'an activity whose method has not been read is not assumed to be percent'
)
// The milestone method is respected like quantity (2026-10-01): a percentage
// is offered for percent and manual only; every other method is refused here
// with its own reason, and the refusal comes before any fall-through.
match(
  bulkProgress,
  /const PERCENTAGE_METHODS = new Set\(\['percent', 'manual'\]\)/,
  'a percentage is offered for percent and manual only'
)
{
  const body = bulkProgress.slice(
    bulkProgress.indexOf('const percentageRefusalOf'),
    bulkProgress.indexOf('const activityLabel')
  )
  match(
    body,
    /if \(PERCENTAGE_METHODS\.has\(method\)\) return null[\s\S]*if \(method === 'weighted_milestone'\) return MILESTONE_METHOD_REASON[\s\S]*if \(method === 'inspection'\) return INSPECTION_METHOD_REASON[\s\S]*return `Measured by \$\{method\} — not offered for a percentage update`\s*\}/,
    'milestone, inspection and any other method are refused a percentage, each with its reason'
  )
  doesNotMatch(
    body,
    /return null\s*\}\s*$/,
    'the refusal does not fall through to offering a percentage'
  )
}
match(
  bulkProgress,
  /'Measured by weighted milestones — mark the milestones complete in the Progress tab'/,
  'the milestone row says why, and where milestones are marked'
)
match(
  bulkProgress,
  /'Measured by quantity — record installed quantities in the daily log or the Progress tab'/,
  'the disabled row says why, and where quantities are recorded'
)
match(
  bulkProgress,
  /\.filter\(\(activity\) => percentageRefusalOf\(activity\) === null\)/,
  'the selectable set leaves out every activity a percentage is refused for'
)
match(
  bulkProgress,
  /disabled=\{notOffered !== null\}/,
  'the checkbox of an activity not offered is disabled'
)
match(
  bulkProgress,
  /checked=\{\s*notOffered === null && selectedIds\.includes\(activity\.id\)\s*\}/,
  'an activity not offered is never drawn as selected'
)
match(
  bulkProgress,
  /updates: selectedSelectableIds\.map\(/,
  'only selectable activities are sent'
)
match(
  bulkProgress,
  /workspaceLink\(\s*`\/projects\/\$\{projectId\}\/schedule\/progress`\s*\)/,
  'the disabled row links to the Progress tab'
)
match(
  bulkProgress,
  /uat-bulk-progress-disabled-\$\{activity\.id\}[\s\S]{0,900}uat-bulk-progress-open-progress-tab-\$\{activity\.id\}/,
  'the reason and the link sit on the disabled row'
)
match(
  bulkProgress,
  /\?\.response\?\.data\?\.error\?\.details\?\.batch/,
  "a refusal's details.batch is read"
)
match(
  bulkProgress,
  /activities\.find\(\s*\(activity\) => activity\.id === batch\.activityId\s*\)/,
  'the refusal names the activity the server refused'
)
match(
  bulkProgress,
  /uat-bulk-progress-refusal/,
  'the refusal stays on the screen, not only in a toast'
)
{
  const refusalPath = bulkProgress.slice(
    bulkProgress.indexOf('} catch (error) {'),
    bulkProgress.indexOf('} finally {')
  )
  assert.ok(refusalPath.length > 500, 'the refusal path of the bulk submit is found')
  match(refusalPath, /'Nothing was saved\.'/, 'a refused batch says nothing was saved')
  doesNotMatch(
    refusalPath,
    /toast\.success|setSelectedIds\(\[\]\)/,
    'a refused batch shows nothing as saved'
  )
  match(
    refusalPath,
    /invalidateQueries\(\{\s*queryKey: \['activities', projectId\],?\s*\}\)/,
    'a refusal reads the register again'
  )
}

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
  ['controls/quantities/official-installed.tsx', officialInstalled],
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

// ── The installed figure names a legacy floor: where the latest approved
// progress carries a legacy typed quantity as its floor, the server states the
// official installed figure beside Σ approved entries and says why they
// differ; the web draws that figure as sent in every place installed is
// drawn — the Progress tab, the drawer's quantities and the drawer's
// progress section — and computes nothing from the two.
match(
  boqSchema,
  /OfficialInstalledSchema = z\s*\.object\(\{\s*value: z\.number\(\)\.nullable\(\)\.optional\(\),\s*unitCode:[^}]*basis:/,
  'the official installed note is typed: value, unitCode, basis'
)
match(
  boqSchema,
  /QuantityFigureSchema = z[\s\S]{0,1400}officialInstalled: OfficialInstalledSchema\.nullable\(\)\.optional\(\)/,
  'a quantity figure may carry the official installed figure'
)
match(
  boqSchema,
  /ControlsFigureSchema = z\.object\(\{[\s\S]{0,1400}officialInstalled: OfficialInstalledSchema\.nullable\(\)\.optional\(\)/,
  "the activity detail's installed quantity may carry it (a strict schema would strip it)"
)
match(
  scheduleSchema,
  /activityInstalledQuantitySchema = z[\s\S]{0,1200}officialInstalled: OfficialInstalledSchema\.nullable\(\)\.optional\(\)/,
  "the register's installed quantity may carry it"
)
match(
  officialInstalled,
  /if \(!official \|\| official\.value == null\) return null/,
  'no official figure sent, nothing drawn'
)
match(
  officialInstalled,
  /data-official-installed=\{official\.value\}[\s\S]{0,120}data-official-unit=\{unit\}/,
  'the official figure is drawn as sent, in its unit'
)
match(
  officialInstalled,
  /earlier progress was typed, not entered/,
  'the note says why the entries add up to less'
)
match(
  progressTab,
  /<OfficialInstalledNote\s+official=\{installed\?\.officialInstalled\}\s+testId=\{`uat-progress-official-installed-\$\{activity\.id\}`\}/,
  'the Progress tab draws the official installed figure beside the lines'
)
match(
  quantitiesSection,
  /<OfficialInstalledNote\s+official=\{figure\?\.officialInstalled\}/,
  "the drawer's quantities draw it under the installed figure"
)
match(
  detailParts,
  /<OfficialInstalledNote\s+official=\{figure\?\.officialInstalled\}/,
  "the drawer's progress section draws it under the installed quantity"
)
// A typed official figure above the entries (installedBasis 'client',
// 2026-10-01) is explained as typed, never as a legacy floor.
match(
  officialInstalled,
  /official\.installedBasis === 'client'\s*\?\s*OFFICIAL_REASON_TYPED\s*:\s*OFFICIAL_REASON_LEGACY_FLOOR/,
  "the note's reason follows the server's installedBasis"
)
match(
  officialInstalled,
  /'the latest approved progress was typed rather than entered'/,
  'a typed official figure says it was typed rather than entered'
)
match(
  officialInstalled,
  /up to less because \{reason\}\./,
  'the reason drawn is the one chosen, not a fixed sentence'
)
match(
  boqSchema,
  /OfficialInstalledSchema = z[\s\S]{0,300}installedBasis: z\.string\(\)\.nullable\(\)\.optional\(\)/,
  "the official figure's installedBasis is read"
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
