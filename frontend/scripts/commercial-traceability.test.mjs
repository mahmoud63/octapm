import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')

const read = (path) => readFileSync(resolve(root, path), 'utf8')

const assertions = [
  {
    file: 'src/features/commercial/components/change-order-form.tsx',
    checks: [
      'activityLinks',
      "type='checkbox'",
      'Affected Activities',
      'Activity Impact Analysis',
      'supportingDocumentIds',
      'costImpact',
    ],
  },
  {
    file: 'src/features/commercial/components/change-order-register.tsx',
    checks: [
      'traceSummary',
      'allocationCount',
      'approvalHistory',
      'approvalReady',
      'Needs proof',
      'criticalPathImpactDays',
    ],
  },
  {
    file: 'src/features/commercial/components/ipc-workbook.tsx',
    checks: [
      'Approved Progress',
      'progressLinks',
      'approvedPctComplete',
      'invoiceStatus',
      'paymentStatus',
      'retentionReleased',
      'useRecordIpcPayment',
      'useReleaseIpcRetention',
    ],
  },
  {
    file: 'src/features/commercial/components/sub-valuations-panel.tsx',
    checks: ['activityLinks', 'allocationLinks', 'correspondenceLinks'],
  },
  {
    file: 'src/features/commercial/components/eot-panel.tsx',
    checks: [
      'activityLinks',
      'criticalPathImpactDays',
      'affectedActivityIds',
      'supportingDocumentIds',
      'claimProofReady',
      'Submit',
    ],
  },
  {
    file: 'src/features/commercial/components/weather-delays-panel.tsx',
    checks: ['activityLinks', 'affectedActivityIds', 'ScheduleActivity'],
  },
  {
    file: 'src/features/commercial/hooks/use-commercial.ts',
    checks: [
      'ActivityTraceLink',
      'AllocationTraceLink',
      'CommercialAttachmentRef',
      'CommercialCorrespondenceLink',
      'documentId',
      'useUpdateEotClaim',
      'IpcInvoice',
      'IpcPayment',
      'IpcRetentionRelease',
    ],
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

console.log('Commercial traceability UI assertions passed')
