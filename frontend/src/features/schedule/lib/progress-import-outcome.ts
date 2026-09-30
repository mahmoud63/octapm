// What POST /projects/:id/import/progress answers (backend/src/openapi/spec.js
// ProgressImportResponse), and the one line the dialog says about it.
//
// A progress import happens in the importer's own authority (PC-6): the
// server says whether this person's rows are submitted for approval or
// approved through the progress approval gates, and the UI repeats the
// server's answer — it never guesses from the role.

export type ProgressImportRowStatus =
  | 'submit'
  | 'approve'
  | 'submitted'
  | 'draft'
  | 'approved'
  | 'pending'
  | 'unchanged'
  | 'already_pending'
  | 'refused'

export type ProgressImportRow = {
  activityId: string
  p6ActivityId: string
  name: string
  pctComplete: number
  officialPctComplete: number | null
  activityMethod: string
  methodMismatch: boolean
  status: ProgressImportRowStatus
  submissionId: string | null
  progressId: string | null
  reason: { code: string; message: string } | null
}

export type ProgressImportResult = {
  dryRun: boolean
  authority: { canApprove: boolean; outcome: 'submitted' | 'approved' }
  matched: number
  notMatched: number
  submitted: number
  draft: number
  approved: number
  pending: number
  unchanged: number
  alreadyPending: number
  refused: number
  wouldSubmit?: number
  wouldApprove?: number
  rows: ProgressImportRow[]
  message: string
}

export const PROGRESS_IMPORT_ROW_LABEL: Record<
  ProgressImportRowStatus,
  string
> = {
  submit: 'Will be submitted for approval',
  approve: 'Will be approved',
  submitted: 'Submitted for approval',
  draft: 'Kept as draft',
  approved: 'Approved',
  pending: 'Left pending',
  unchanged: 'Already official',
  already_pending: 'Already pending',
  refused: 'Refused',
}

// The gates' refusal codes, in words (the row keeps the server's message).
const REASON_LABEL: Record<string, string> = {
  PROGRESS_EVIDENCE_REQUIRED: 'evidence required',
  ITP_HOLD_POINT_OPEN: 'ITP hold point open',
  ACTIVITY_PROGRESS_ASSIGNMENT_REQUIRED: 'not assigned to the activity',
}

const reasonsOf = (rows: ProgressImportRow[]) =>
  [
    ...new Set(
      rows
        .map((row) => row.reason?.code)
        .filter((code): code is string => Boolean(code))
        .map((code) => REASON_LABEL[code] ?? code)
    ),
  ].join(', ')

/** The one-line outcome, in the server's terms. */
export function progressImportHeadline(result: ProgressImportResult): string {
  if (result.dryRun) {
    return result.authority.canApprove
      ? `${result.wouldApprove ?? 0} rows will be approved for you through the progress approval gates`
      : `${result.wouldSubmit ?? 0} rows will be submitted for approval — not official until approved`
  }
  if (result.authority.canApprove) {
    const held = result.rows.filter(
      (row) => row.status === 'pending' || row.status === 'draft'
    )
    const pending = result.pending + result.draft
    return `${result.approved} approved${
      pending ? `, ${pending} left pending (${reasonsOf(held)})` : ''
    }`
  }
  return `${result.submitted + result.draft} rows submitted for approval — not official until approved`
}
