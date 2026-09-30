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

// Owner decision R5-2 (2026-09-30): the cost records' own projection is never
// called the EAC (the EAC is the earned-value revised budget ÷ CPI), and a
// cost record's default forecast carries a marker — never read as entered.
const failR52 = (message) => {
  console.error(`R5-2: ${message}`)
  process.exit(1)
}
const costDashboard = readFileSync(join(root, 'features', 'cost', 'components', 'cost-dashboard.tsx'), 'utf8')
for (const label of ["'Forecast (EAC)'", "label='Optimistic EAC'", "label='Most likely EAC'", "label='Pessimistic EAC'"]) {
  if (costDashboard.includes(label) || terms.includes(label)) failR52(`the cost records' projection is still labelled ${label}`)
}
for (const needle of ['costRecordsFinalCost', "'Projected final cost (cost records)'", 'defaultForecastMarker', 'not the earned-value EAC']) {
  if (!terms.includes(needle)) failR52(`financial-terms.ts is missing ${needle}`)
}
for (const needle of [
  'FINANCIAL_TERMS.costRecordsFinalCost.label',
  "row.forecastSource === 'default'",
  'FINANCIAL_TERMS.defaultForecastMarker.label',
  "data-testid='cost-record-forecast-default'",
  'title={row.forecastBasis}',
  "data-testid='cost-record-forecast-withheld'",
  "data-testid='cost-forecast-sources'",
]) {
  if (!costDashboard.includes(needle)) failR52(`cost-dashboard.tsx is missing ${needle}`)
}
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
console.log(`financial terms: ${files.length} feature files carry no bare Committed label; vocabulary names executed commitments and PO value apart; the cost records' projection is not called the EAC and a default forecast is marked (R5-2)`)
