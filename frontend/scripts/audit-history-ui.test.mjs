import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const read = (path) => readFileSync(resolve(root, path), 'utf8')

const assertions = [
  {
    file: 'src/features/audit/hooks/use-audit-events.ts',
    checks: [
      "'boq_revision'",
      "'boq_item'",
      "'cost_record'",
      "'burn_rate_entry'",
      "'rfi'",
      "'submittal'",
    ],
  },
  {
    file: 'src/features/audit/components/audit-history-panel.tsx',
    checks: ['imported', 'summary.actual', 'summary.committed', 'summary.forecast'],
  },
  {
    file: 'src/features/doc-control/components/doc-control-dashboard.tsx',
    checks: ['RFI Audit History', 'Submittal Audit History', "entityType='rfi'"],
  },
  {
    file: 'src/features/boq/components/boq-page.tsx',
    checks: ['BOQ Revision History', 'BOQ Row History', "entityType='boq_item'"],
  },
  {
    file: 'src/features/cost/components/cost-dashboard.tsx',
    checks: ['Cost Record History', 'Burn Rate History', "entityType='cost_record'"],
  },
  {
    file: 'src/features/doc-control/hooks/use-doc-control.ts',
    checks: ["['audit-events', projectId]"],
  },
  {
    file: 'src/features/boq/hooks/use-boq.ts',
    checks: ["['audit-events', projectId]"],
  },
  {
    file: 'src/features/cost/hooks/use-cost.ts',
    checks: ["['audit-events', projectId]"],
  },
]

for (const assertion of assertions) {
  const source = read(assertion.file)
  for (const check of assertion.checks) {
    if (!source.includes(check)) {
      throw new Error(`${assertion.file} is missing ${check}`)
    }
  }
}

console.log('Audit history UI assertions passed')
