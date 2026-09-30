// One vocabulary for money on screen (Phase 22B): no component may put its own
// bare "Committed" / "Budget" / "Forecast" label on a figure. Labels come from
// src/lib/financial-terms.ts, so the same number always carries the same name
// and two different numbers never share one.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../src/', import.meta.url))
const files = []
const walk = (dir) => {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walk(full)
    else if (/\.tsx?$/.test(entry) && !/\.test\./.test(entry)) files.push(full)
  }
}
walk(join(root, 'features'))

// A bare label on a card, column, stat or select item. Prose ("committed cost
// moves with the order") and identifiers (`committed:`) are not labels.
const BARE = [
  /label=['"]Committed['"]/,
  /\[['"]Committed['"],/,
  />\s*Committed\s*</,
  /label=['"]Committed \(executed\)['"]/,
  /\[['"]Committed \(executed\)['"],/,
  // Any literal label that opens with "Committed" ("Committed on this row"):
  // the only committed labels are FINANCIAL_TERMS entries (R5-3).
  /label=\{?['"`]Committed\b/,
  />\s*Committed on this row\s*</,
]
const offenders = []
for (const file of files) {
  const text = readFileSync(file, 'utf8')
  for (const pattern of BARE) if (pattern.test(text)) offenders.push(`${relative(root, file)} :: ${pattern}`)
}
if (offenders.length) {
  console.error('bare financial labels found (use FINANCIAL_TERMS):\n  ' + offenders.join('\n  '))
  process.exit(1)
}

// Owner decision R5-2 (2026-09-30): the cost records' own projection is never
// called the EAC (the EAC is the earned-value revised budget ÷ CPI), and a
// cost record's default forecast carries a marker — never read as entered.
// (Kept here, above the vocabulary check, and printing its own line: the end
// of this file is where the other checks append.)
{
  const failR52 = (message) => {
    console.error(`R5-2: ${message}`)
    process.exit(1)
  }
  const vocabulary = readFileSync(join(root, 'lib', 'financial-terms.ts'), 'utf8')
  const costDashboard = readFileSync(join(root, 'features', 'cost', 'components', 'cost-dashboard.tsx'), 'utf8')
  for (const label of ["'Forecast (EAC)'", "label='Optimistic EAC'", "label='Most likely EAC'", "label='Pessimistic EAC'"]) {
    if (costDashboard.includes(label) || vocabulary.includes(label)) failR52(`the cost records' projection is still labelled ${label}`)
  }
  for (const needle of ['costRecordsFinalCost', "'Projected final cost (cost records)'", 'defaultForecastMarker', 'not the earned-value EAC', 'it does not follow them afterwards', 'an entered forecast counts as entered (0 included)']) {
    if (!vocabulary.includes(needle)) failR52(`financial-terms.ts is missing ${needle}`)
  }
  for (const needle of [
    'FINANCIAL_TERMS.costRecordsFinalCost.label',
    "row.forecastSource === 'default'",
    'FINANCIAL_TERMS.defaultForecastMarker.label',
    "data-testid='cost-record-forecast-default'",
    'title={row.forecastBasis}',
    "data-testid='cost-record-forecast-withheld'",
    "data-testid='cost-forecast-sources'",
    // The forecast field holds the text typed; an empty one is not sent.
    "data-testid='cost-record-forecast-input'",
    'setForecastDraft(e.target.value)',
    "field !== 'forecast' &&",
    // The server's reason when Forecast order is withheld from this member.
    "data-testid='cost-sort-withheld'",
    'costPage.sortWithheld.reason',
    // By Phase names the summary's projection, not "Forecast".
    "data-testid='cost-phase-projected-header'",
  ]) {
    if (!costDashboard.includes(needle)) failR52(`cost-dashboard.tsx is missing ${needle}`)
  }
  // The editing branch of the forecast cell comes before the withheld dash: a
  // member who may update cost can replace a default they are not shown.
  const editingAt = costDashboard.indexOf("field === 'forecast' && isEditing ?")
  const withheldAt = costDashboard.indexOf("field === 'forecast' && forecastWithheld ?")
  if (editingAt < 0 || withheldAt < 0 || editingAt > withheldAt) failR52('cost-dashboard.tsx shows the withheld dash before the forecast input while editing')
  if (/>\s*Forecast\s*<\/th>/.test(costDashboard)) failR52('cost-dashboard.tsx still has a column named bare "Forecast"')
  // A client never sends forecastSource: the server alone sets it.
  for (const file of files) {
    if (/forecastSource\s*:/.test(readFileSync(file, 'utf8')) && !/use-cost\.ts$|schema\.ts$/.test(file)) {
      failR52(`${relative(root, file)} builds a payload or object with forecastSource — the server sets it`)
    }
  }
  const detailParts = readFileSync(join(root, 'features', 'controls', 'components', 'detail-parts.tsx'), 'utf8')
  for (const needle of ["figure.forecastSource === 'default'", "data-forecast-source='default'", 'figure.withheld']) {
    if (!detailParts.includes(needle)) failR52(`detail-parts.tsx is missing ${needle}`)
  }
  console.log("financial terms (R5-2): the cost records' projection is not called the EAC; a default forecast is marked; an empty forecast field is not sent")
}

// And the vocabulary itself names the two "committed" figures apart.
const terms = readFileSync(join(root, 'lib', 'financial-terms.ts'), 'utf8')
for (const needle of ["executedCommitments", "poValue", "actualCost", "certifiedCost", "'Executed commitments'", "'PO value'"]) {
  if (!terms.includes(needle)) {
    console.error(`financial-terms.ts is missing ${needle}`)
    process.exit(1)
  }
}
// R5-3: the BOQ item's base-only commitment figure (executed/closed SOV lines
// naming the row, no approved commitment change orders) is never called
// "Committed". The vocabulary names it, the BOQ drawer shows it by that name
// from the renamed key, the server's basis and the API document say the same.
const BASE_LABEL = 'Base commitment value (excluding approved variations)'
const failR53 = (message) => {
  console.error(`R5-3 base commitment value: ${message}`)
  process.exit(1)
}
if (!terms.includes('baseCommitmentValue') || !terms.includes(`'${BASE_LABEL}'`)) failR53(`financial-terms.ts has no baseCommitmentValue entry labelled '${BASE_LABEL}'`)
const drawerPath = join(root, 'features', 'boq', 'components', 'boq-detail-drawer.tsx')
const drawer = readFileSync(drawerPath, 'utf8')
const commitmentsSection = drawer.slice(drawer.indexOf("testId='boq-detail-commitments'"), drawer.indexOf("testId='boq-detail-commitments-withheld'"))
if (!commitmentsSection) failR53('boq-detail-drawer.tsx has no commitments section')
if (!/label=\{FINANCIAL_TERMS\.baseCommitmentValue\.label\}/.test(commitmentsSection)) failR53('the BOQ drawer does not label the figure with FINANCIAL_TERMS.baseCommitmentValue')
if (!/figure=\{sections\.commitments\.baseCommitmentValue\}/.test(commitmentsSection)) failR53('the BOQ drawer does not read sections.commitments.baseCommitmentValue')
if (/Committed/.test(commitmentsSection.replace(/FINANCIAL_TERMS\.\w+/g, ''))) failR53('the BOQ drawer\'s commitments section still carries a "Committed" label')
if (/commitments\.committed\b/.test(drawer)) failR53('the BOQ drawer still reads commitments.committed')
const schema = readFileSync(join(root, 'features', 'boq', 'data', 'schema.ts'), 'utf8')
const schemaCommitments = schema.slice(schema.indexOf('commitments: z.union'), schema.indexOf('changes: z.union'))
if (!/baseCommitmentValue: ControlsFigureSchema/.test(schemaCommitments) || /\bcommitted:/.test(schemaCommitments)) failR53('schema.ts commitments section is not { baseCommitmentValue }')
const service = readFileSync(join(root, '..', '..', 'backend', 'src', 'services', 'controls-detail.service.js'), 'utf8')
const serviceStart = service.indexOf('sections.commitments = {')
const serviceSection = serviceStart < 0 ? '' : service.slice(serviceStart, service.indexOf('lines: capped(', serviceStart))
if (!/baseCommitmentValue: fig\(/.test(serviceSection) || /\bcommitted:/.test(serviceSection)) failR53('the server does not send the BOQ item figure as baseCommitmentValue')
if (!serviceSection.includes(`"${BASE_LABEL}:`)) failR53(`the server's basis does not open with "${BASE_LABEL}"`)
const spec = readFileSync(join(root, '..', '..', 'backend', 'src', 'openapi', 'spec.js'), 'utf8')
if (!spec.includes(`baseCommitmentValue, the \\"${BASE_LABEL}\\"`)) failR53('the OpenAPI BOQ item detail does not name baseCommitmentValue')
// ... and the design document that describes the BOQ Detail payload: the
// figure is described by its name there too, never as a plain "committed"
// (R5-3: the name goes wherever the figure is shown or described).
const designDoc = readFileSync(join(root, '..', '..', 'docs', 'project-controls', 'OCTAPM_BOQ_SCHEDULE_INTEGRATION.md'), 'utf8')
const boqDetailStart = designDoc.indexOf('**BOQ Detail** (`GET ')
const boqDetailTable = boqDetailStart < 0 ? '' : designDoc.slice(boqDetailStart, designDoc.indexOf('**Activity Detail** (`GET ', boqDetailStart))
if (!boqDetailTable) failR53('OCTAPM_BOQ_SCHEDULE_INTEGRATION.md has no BOQ Detail table')
if (!boqDetailTable.includes(`"${BASE_LABEL}"`)) failR53(`the design document's BOQ Detail table does not name the figure "${BASE_LABEL}"`)
if (!boqDetailTable.includes('executed/closed commitments') || !boqDetailTable.includes('not the committed cost')) failR53('the design document does not say what the base commitment value counts and that it is not the committed cost')
if (/\bcommitted \(SOV lines/i.test(boqDetailTable)) failR53('the design document still describes the BOQ item figure as "committed (SOV lines …)"')

console.log(`financial terms: ${files.length} feature files carry no bare Committed label; vocabulary names executed commitments and PO value apart; the BOQ item's base commitment value is named as such, in the design document too (R5-3)`)
