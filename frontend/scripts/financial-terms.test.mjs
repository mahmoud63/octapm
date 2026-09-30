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

console.log(`financial terms: ${files.length} feature files carry no bare Committed label; vocabulary names executed commitments and PO value apart; the BOQ item's base commitment value is named as such (R5-3)`)
