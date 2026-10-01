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
      'scheduleImpactSummary',
      'costImpactSummary',
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
      'PM Approval Panel',
      'useSubmitChangeOrder',
      'useApproveChangeOrder',
      'useRejectChangeOrder',
      'useReopenChangeOrder',
      'WorkflowDecisionDialog',
      'BOQ:',
      'Locked',
      // R5-5 (PC-7b): the server's related records, linked to the PC-5 drawers.
      'relatedRecords',
      'RelatedActivitiesCell',
      'RelatedBoqItemsCell',
      'RecordLink',
      'via allocation',
      'boqWithheld',
    ],
    // Never "No activity" when the server says the order reaches one indirectly.
    forbidden: ["'No activity'"],
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
      'certificationReview',
      'Earned Value Basis',
      'Payment History',
      'Retention Release History',
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
      'useSubmitEotClaim',
      'revisedCompletionRecommendation',
      'approvalHistory',
      'Evidence',
      'useApproveEotClaim',
      'useRejectEotClaim',
      'WorkflowDecisionDialog',
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
      'useSubmitChangeOrder',
      'useUpdateEotClaim',
      'useSubmitEotClaim',
      'useApproveChangeOrder',
      'useRejectChangeOrder',
      'useReopenChangeOrder',
      'useApproveEotClaim',
      'useRejectEotClaim',
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
  for (const banned of assertion.forbidden || []) {
    if (source.includes(banned)) {
      throw new Error(`${assertion.file} still contains ${banned}`)
    }
  }
}

console.log('Commercial traceability UI assertions passed')
