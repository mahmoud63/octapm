import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const read = (path) => readFileSync(resolve(root, path), 'utf8')

const assertions = [
  {
    file: 'src/features/doc-control/components/doc-control-dashboard.tsx',
    checks: [
      "TabsTrigger value='register'",
      'Latest Approved',
      'Superseded Rev',
      'Missing Revision',
      'Folders',
      'Preview unavailable',
      'useDocumentRegister',
      'useUploadDocumentRevisionFile',
      'useSubmitDocumentRevisionForReview',
      'useApproveDocumentRevision',
      'useSupersedeDocumentRevision',
      "'document_control'",
      'document.revision.upload',
      'document.revision.submit_review',
      'document.revision.approve',
      'document.revision.supersede',
      'Download',
      'Preview',
      'Upload revision',
      'Supersede',
      'Submit',
      'Answer',
      'Reopen',
      'Review',
      'Resubmit',
    ],
  },
  {
    file: 'src/features/doc-control/hooks/use-doc-control.ts',
    checks: [
      'DocumentRegisterRow',
      'useDocumentRegister',
      '/doc-control/register',
      'useUploadDocumentRevision',
      '/doc-control/${recordType}/${recordId}/revisions',
      'useUploadDocumentRevisionFile',
      '/doc-control/${recordType}/${recordId}/revisions/upload',
      'useSubmitDocumentRevisionForReview',
      '/doc-control/revisions/${revisionId}/submit-review',
      'useApproveDocumentRevision',
      '/doc-control/revisions/${revisionId}/approve',
      'useSupersedeDocumentRevision',
      '/doc-control/revisions/${revisionId}/supersede',
      'useSubmitRfi',
      '/rfi/${rfiId}/submit',
      'useAnswerRfi',
      '/rfi/${rfiId}/answer',
      'useCloseRfi',
      '/rfi/${rfiId}/close',
      'useReopenRfi',
      '/rfi/${rfiId}/reopen',
      'useSubmitSubmittal',
      '/submittals/${submittalId}/submit',
      'useReviewSubmittal',
      '/submittals/${submittalId}/review',
      'useResubmitSubmittal',
      '/submittals/${submittalId}/resubmit',
    ],
  },
  {
    file: 'src/features/workflows/components/workflow-record-list.tsx',
    checks: ['downloadUrl', 'isLatest', 'Read-only', 'Download'],
  },
  {
    file: '../shared/permissions.json',
    checks: [
      '"document_control"',
      '"document.revision.upload"',
      '"document.revision.submit_review"',
      '"rfi.answer"',
      '"submittal.review"',
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

console.log('Document control register UI assertions passed')
