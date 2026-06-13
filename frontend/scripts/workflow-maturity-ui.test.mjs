import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const read = (path) => readFileSync(resolve(root, path), 'utf8')

const assertions = [
  {
    file: 'src/features/workflows/components/workflow-record-list.tsx',
    checks: [
      'WorkflowRecordList',
      'AssignmentGrid',
      'AttachmentList',
      'RevisionList',
      'HistoryList',
      'ApprovalList',
      'activityLinks',
      'approvalHistory',
      'dueAlert',
      'renderActions',
    ],
  },
  {
    file: 'src/features/workflows/components/workflow-decision-dialog.tsx',
    checks: ['WorkflowDecisionDialog', 'Reason', 'Disapprove', 'onConfirm'],
  },
  {
    file: 'src/features/quality/components/quality-dashboard.tsx',
    checks: [
      'WorkflowRecordList',
      'Due Alerts',
      "emptyText='No NCR records'",
      "useCanPerform('ncr', 'create')",
      "useCanPerform('safety', 'create')",
      "useCanPerform('ncr', 'submit', 'ncr.close')",
      "useCanPerform('safety', 'submit', 'safety.close')",
      "useCanPerform('ncr', 'approve', 'ncr.approve')",
      "useCanPerform('safety', 'approve', 'safety.reject')",
      'useCloseNcr',
      'useCloseSafetyIncident',
      'Submit closeout',
      'closureComment',
      'WorkflowDecisionDialog',
      'handleServerError(error)',
    ],
  },
  {
    file: 'src/features/doc-control/components/doc-control-dashboard.tsx',
    checks: [
      'WorkflowRecordList',
      'Rev {row.revision}',
      "TabsTrigger value='register'",
      'Latest Approved',
      'useDocumentRegister',
      'useUploadDocumentRevisionFile',
      'Preview unavailable',
      'Due Alerts',
      "useCanPerform('rfi', 'create')",
      "useCanPerform('submittal', 'create')",
      "useCanPerform('rfi', 'approve', 'rfi.approve')",
      'submittal.reject',
      'WorkflowDecisionDialog',
      'handleServerError(error)',
    ],
  },
  {
    file: 'src/features/quality/hooks/use-quality.ts',
    checks: ['WorkflowRecordMeta', 'dueAlerts', 'overdue'],
  },
  {
    file: 'src/features/doc-control/hooks/use-doc-control.ts',
    checks: ['WorkflowRecordMeta', 'revision', 'dueAlerts', 'overdue'],
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

console.log('Workflow maturity UI assertions passed')
