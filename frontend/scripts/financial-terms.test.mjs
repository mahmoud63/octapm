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
console.log(`financial terms: ${files.length} feature files carry no bare Committed label; vocabulary names executed commitments and PO value apart`)
