import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const read = (path) => readFileSync(resolve(root, path), 'utf8')

const assertions = [
  {
    file: 'src/lib/money.ts',
    checks: [
      "MONEY_INPUT_STEP = '0.01'",
      'MONEY_PRECISION_MESSAGE',
      'hasMoneyPrecision',
      'toMoneyNumber',
    ],
  },
  {
    file: 'src/features/boq/data/schema.ts',
    checks: ['hasMoneyPrecision', 'MONEY_PRECISION_MESSAGE'],
  },
  {
    file: 'src/features/projects/data/schema.ts',
    checks: ['contractValue', 'ldRatePerDay', 'hasMoneyPrecision'],
  },
  {
    file: 'src/features/equipment/data/schema.ts',
    checks: ['rate', 'hasMoneyPrecision'],
  },
  {
    file: 'src/features/boq/components/boq-add-row-dialog.tsx',
    checks: ['MONEY_INPUT_STEP', 'MONEY_PRECISION_MESSAGE'],
  },
  {
    file: 'src/features/boq/components/boq-add-activity-dialog.tsx',
    checks: ['MONEY_INPUT_STEP', 'MONEY_PRECISION_MESSAGE'],
  },
  {
    file: 'src/features/boq/components/boq-allocation-panel.tsx',
    checks: ['MONEY_INPUT_STEP', 'toMoneyNumber', 'toast.error'],
  },
  {
    file: 'src/features/boq/components/boq-editable-grid.tsx',
    checks: ['moneyFields', 'MONEY_INPUT_STEP', 'MONEY_PRECISION_MESSAGE'],
  },
  {
    file: 'src/features/cost/components/cost-dashboard.tsx',
    checks: ['hasInvalidMoneyDraft', 'MONEY_INPUT_STEP', 'toMoneyNumber'],
  },
  {
    file: 'src/features/commercial/components/budget-revisions-panel.tsx',
    checks: ['MONEY_INPUT_STEP', 'hasMoneyPrecision', 'toMoneyNumber'],
  },
  {
    file: 'src/features/commercial/components/cash-flow-panel.tsx',
    checks: ['MONEY_INPUT_STEP', 'hasMoneyPrecision', 'toMoneyNumber'],
  },
  {
    // Legacy sub-valuations became read-only (a96a240): the rule is that any
    // money field it grows must carry the precision helpers, not that the
    // helpers be imported by a panel with no fields at all.
    file: 'src/features/commercial/components/sub-valuations-panel.tsx',
    checks: ['MONEY_INPUT_STEP', 'hasMoneyPrecision', 'toMoneyNumber'],
    onlyWhen: /<Input|type=["']number["']/,
  },
  {
    file: 'src/features/commercial/components/change-order-form.tsx',
    checks: ['MONEY_INPUT_STEP', 'hasMoneyPrecision', 'toMoneyNumber'],
  },
  {
    file: 'src/features/commercial/components/ipc-workbook.tsx',
    checks: ['MONEY_INPUT_STEP', 'hasMoneyPrecision', 'toMoneyNumber'],
  },
]

for (const assertion of assertions) {
  const source = read(assertion.file)
  if (assertion.onlyWhen && !assertion.onlyWhen.test(source)) continue
  for (const check of assertion.checks) {
    if (!source.includes(check)) {
      throw new Error(`${assertion.file} is missing ${check}`)
    }
  }
}

console.log('Financial precision UI assertions passed')
