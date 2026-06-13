import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const read = (path) => readFileSync(resolve(root, path), 'utf8')

const assertions = [
  {
    file: 'src/features/audit/hooks/use-audit-events.ts',
    checks: [
      'AuditHistorySource',
      "'activity_boq_allocation'",
      "'boq_revision'",
      "'boq_item'",
      "'cost_record'",
      "'burn_rate_entry'",
      "'rfi'",
      "'submittal'",
      "'ncr'",
      "'safety_incident'",
    ],
  },
  {
    file: 'src/features/audit/components/audit-history-panel.tsx',
    checks: [
      'export function HistoryPanel',
      'source',
      'decision',
      'Export history',
      'summary.actual',
      'summary.committed',
      'summary.forecast',
    ],
  },
  {
    file: 'src/features/workflows/components/workflow-record-list.tsx',
    checks: ['HistoryPanel', 'recordType', 'entityId={row.id}'],
  },
  {
    file: 'src/features/doc-control/components/doc-control-dashboard.tsx',
    checks: [
      'RFI Audit History',
      'Submittal Audit History',
      "recordType='rfi'",
      "recordType='submittal'",
    ],
  },
  {
    file: 'src/features/boq/components/boq-page.tsx',
    checks: ['BOQ Revision History', 'BOQ Row History', "entityType='boq_item'"],
  },
  {
    file: 'src/features/boq/components/boq-allocation-panel.tsx',
    checks: ['HistoryPanel', "entityType='activity_boq_allocation'"],
  },
  {
    file: 'src/features/cost/components/cost-dashboard.tsx',
    checks: ['Cost Record History', 'Burn Rate History', "entityType='cost_record'"],
  },
  {
    file: 'src/features/commercial/components/change-order-register.tsx',
    checks: ['HistoryPanel', "entityType='change_order'", 'History'],
  },
  {
    file: 'src/features/commercial/components/ipc-workbook.tsx',
    checks: ["entityType='ipc_certificate'", 'Status History'],
  },
  {
    file: 'src/features/commercial/components/eot-panel.tsx',
    checks: ['HistoryPanel', "entityType='eot_claim'", 'History'],
  },
  {
    file: 'src/features/site-reporting/components/site-reporting-dashboard.tsx',
    checks: ['HistoryPanel', "'daily_report'", "'site_diary'"],
  },
  {
    file: 'src/features/quality/components/quality-dashboard.tsx',
    checks: ["recordType='ncr'", "recordType='safety_incident'"],
  },
  {
    file: 'src/features/schedule/components/revision-history-panel.tsx',
    checks: ['HistoryPanel', "entityType='schedule_revision'"],
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
