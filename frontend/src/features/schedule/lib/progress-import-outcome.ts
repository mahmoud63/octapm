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
  | 'skipped'
  | 'refused'

/** An older pending submission (an import's or anyone's manual one) at another figure, left in the queue. */
export type ProgressImportSuperseded = {
  submissionId: string
  pctComplete: number
}

export type ProgressImportSupersededSubmission = ProgressImportSuperseded & {
  activityId: string
  p6ActivityId: string
  name: string
  importedPctComplete: number
}

export type ProgressImportRow = {
  activityId: string
  p6ActivityId: string
  name: string
  /** Null for a skipped row: the file names the activity without one. */
  pctComplete: number | null
  officialPctComplete: number | null
  activityMethod: string
  status: ProgressImportRowStatus
  submissionId: string | null
  progressId: string | null
  /** For already_pending (and approvesPending): where the open submission waits. */
  waitingStatus?: 'draft' | 'submitted' | null
  /**
   * An approver's import found this figure already submitted and approved
   * (or would approve) that submission itself — submissionId is its id.
   */
  approvesPending?: boolean
  /**
   * Every older pending import submission at another figure this row leaves
   * in the queue (newest first; there may be several) — also on a row that
   * approved an already-pending submission. Empty when none.
   */
  superseded?: ProgressImportSuperseded[]
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
  /** Rows the file names without a percentage; nothing written. */
  skipped: number
  refused: number
  /** Older pending import submissions at another figure left in the queue (submissions, not rows). */
  supersededPending: number
  supersededPendingSubmissions: ProgressImportSupersededSubmission[]
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
  skipped: 'Skipped (no percentage)',
  refused: 'Refused',
}

/**
 * The row's label: the status's, except that a figure already waiting as a
 * draft is said to await evidence — it is not in the approval queue — and
 * a row an approver's import approved as it already stood in the queue
 * says so.
 */
export function progressImportRowLabel(row: ProgressImportRow): string {
  if (row.status === 'already_pending' && row.waitingStatus === 'draft') {
    return 'Already a draft (awaiting evidence)'
  }
  if (row.approvesPending && row.status === 'approved') {
    return 'Approved (was already pending)'
  }
  if (row.approvesPending && row.status === 'approve') {
    return 'Will be approved (already pending)'
  }
  return PROGRESS_IMPORT_ROW_LABEL[row.status]
}

/**
 * The figure a row shows: the file's, or "no %" for a skipped row.
 */
export function progressImportRowFigure(row: ProgressImportRow): string {
  return row.pctComplete === null ? 'no %' : `${row.pctComplete}%`
}

/**
 * The line under the headline about older pending submissions this import
 * left in the queue at another figure — the import never rejects them, so
 * the approver is told where they are. Empty when there are none.
 */
export function progressImportSupersededNote(
  result: ProgressImportResult
): string {
  const count = result.supersededPending ?? 0
  if (!count) return ''
  const names = (result.supersededPendingSubmissions ?? [])
    .map((row) => `${row.p6ActivityId} at ${row.pctComplete}%`)
    .join(', ')
  return (
    `${count} older pending ${count === 1 ? 'submission' : 'submissions'} at another figure ${count === 1 ? 'is' : 'are'} still in the approval queue` +
    (names ? ` (${names})` : '') +
    ' — reject there if no longer wanted.'
  )
}

/**
 * What a row says about the older pending import submissions it left in
 * the queue at other figures — every one of them, since an activity may
 * leave several (a site engineer's 30 then 32). Empty when none.
 */
export function progressImportRowSupersededNote(row: ProgressImportRow): string {
  const older = row.superseded ?? []
  if (!older.length) return ''
  const figures = older.map((entry) => `${entry.pctComplete}%`).join(', ')
  return older.length === 1
    ? `An older pending submission at ${figures} is still in the approval queue; reject it there if no longer wanted.`
    : `${older.length} older pending submissions (at ${figures}) are still in the approval queue; reject them there if no longer wanted.`
}

// The gates' refusal codes, in words (the row keeps the server's message).
const REASON_LABEL: Record<string, string> = {
  PROGRESS_EVIDENCE_REQUIRED: 'evidence required',
  ITP_HOLD_POINT_OPEN: 'ITP hold point open',
  ACTIVITY_PROGRESS_ASSIGNMENT_REQUIRED: 'not assigned to the activity',
  PROGRESS_METHOD_MISMATCH: 'measured by another method',
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
 * A row without a percentage was skipped and is said so; a row already at
 * the official figure is not news and stays in the counts below.
 */
export function progressImportHeadline(result: ProgressImportResult): string {
  const held = (statuses: ProgressImportRowStatus[]) =>
    result.rows.filter((row) => statuses.includes(row.status))
  const skipped = clause(result.skipped ?? 0, 'skipped (no percentage)')
  if (result.dryRun) {
    const wouldHold = result.wouldHold ?? 0
    const wouldRefuse = result.wouldRefuse ?? 0
    return result.authority.canApprove
      ? `${result.wouldApprove ?? 0} rows will be approved for you through the progress approval gates` +
          clause(
            wouldHold,
            `will be left pending (${reasonsOf(held(['hold']))})`
          ) +
          clause(wouldRefuse, 'will be refused') +
          skipped
      : `${result.wouldSubmit ?? 0} rows will be submitted for approval — not official until approved` +
          clause(wouldHold, 'will be kept as draft (evidence required)') +
          clause(wouldRefuse, 'will be refused') +
          skipped
  }
  if (result.authority.canApprove) {
    const pending = result.pending + result.draft
    return (
      `${result.approved} approved` +
      (pending
        ? `, ${pending} left pending (${reasonsOf(held(['pending', 'draft']))})`
        : '') +
      clause(result.refused, 'refused') +
      skipped
    )
  }
  return (
    `${result.submitted} rows submitted for approval — not official until approved` +
    clause(result.draft, 'kept as draft (evidence required)') +
    clause(result.refused, 'refused') +
    skipped
  )
}
