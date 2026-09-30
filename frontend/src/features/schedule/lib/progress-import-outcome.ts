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
  | 'hold'
  | 'refuse'
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
  /** For already_pending: where the open submission waits. */
  waitingStatus?: 'draft' | 'submitted' | null
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
  wouldHold?: number
  wouldRefuse?: number
  rows: ProgressImportRow[]
  message: string
}

export const PROGRESS_IMPORT_ROW_LABEL: Record<
  ProgressImportRowStatus,
  string
> = {
  submit: 'Will be submitted for approval',
  approve: 'Will be approved',
  hold: 'Will be held',
  refuse: 'Will be refused',
  submitted: 'Submitted for approval',
  draft: 'Kept as draft',
  approved: 'Approved',
  pending: 'Left pending',
  unchanged: 'Already official',
  already_pending: 'Already pending',
  refused: 'Refused',
}

/**
 * The row's label: the status's, except that a figure already waiting as a
 * draft is said to await evidence — it is not in the approval queue.
 */
export function progressImportRowLabel(row: ProgressImportRow): string {
  if (row.status === 'already_pending' && row.waitingStatus === 'draft') {
    return 'Already a draft (awaiting evidence)'
  }
  return PROGRESS_IMPORT_ROW_LABEL[row.status]
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

const clause = (count: number, text: string) =>
  count > 0 ? `; ${count} ${text}` : ''

/**
 * The one-line outcome, in the server's terms. Only what is in an
 * approver's queue counts as "submitted for approval": a draft waits for
 * evidence and a refused row was not written, and each is said separately.
 */
export function progressImportHeadline(result: ProgressImportResult): string {
  const held = (statuses: ProgressImportRowStatus[]) =>
    result.rows.filter((row) => statuses.includes(row.status))
  if (result.dryRun) {
    const wouldHold = result.wouldHold ?? 0
    const wouldRefuse = result.wouldRefuse ?? 0
    return result.authority.canApprove
      ? `${result.wouldApprove ?? 0} rows will be approved for you through the progress approval gates` +
          clause(
            wouldHold,
            `will be left pending (${reasonsOf(held(['hold']))})`
          ) +
          clause(wouldRefuse, 'will be refused')
      : `${result.wouldSubmit ?? 0} rows will be submitted for approval — not official until approved` +
          clause(wouldHold, 'will be kept as draft (evidence required)') +
          clause(wouldRefuse, 'will be refused')
  }
  if (result.authority.canApprove) {
    const pending = result.pending + result.draft
    return (
      `${result.approved} approved` +
      (pending
        ? `, ${pending} left pending (${reasonsOf(held(['pending', 'draft']))})`
        : '') +
      clause(result.refused, 'refused')
    )
  }
  return (
    `${result.submitted} rows submitted for approval — not official until approved` +
    clause(result.draft, 'kept as draft (evidence required)') +
    clause(result.refused, 'refused')
  )
}
