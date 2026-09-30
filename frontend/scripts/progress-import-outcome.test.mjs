// PC-6: the progress import dialog says plainly, in the server's own terms,
// whether this person's rows were submitted for approval or approved — and
// what held the rest. Node runs the TypeScript module directly (type
// stripping; the module has no runtime imports), and the dialog is read as
// source for what it shows.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  PROGRESS_IMPORT_ROW_LABEL,
  progressImportHeadline,
  progressImportRowFigure,
  progressImportRowLabel,
  progressImportSupersededNote,
} from '../src/features/schedule/lib/progress-import-outcome.ts'

const root = resolve(import.meta.dirname, '..')
const read = (path) => readFileSync(resolve(root, path), 'utf8')

const row = (status, reason = null, extra = {}) => ({
  activityId: `${status}-${reason || 'ok'}`,
  p6ActivityId: 'P100',
  name: 'Excavate',
  pctComplete: 10,
  officialPctComplete: null,
  activityMethod: 'percent',
  methodMismatch: false,
  status,
  submissionId: null,
  progressId: null,
  reason: reason ? { code: reason, message: reason } : null,
  ...extra,
})

const result = (overrides) => ({
  dryRun: false,
  authority: { canApprove: false, outcome: 'submitted' },
  matched: 0,
  notMatched: 0,
  submitted: 0,
  draft: 0,
  approved: 0,
  pending: 0,
  unchanged: 0,
  alreadyPending: 0,
  skipped: 0,
  refused: 0,
  supersededPending: 0,
  supersededPendingSubmissions: [],
  rows: [],
  message: '',
  ...overrides,
})

// A submit-only person: pending, and said to be not official. Only what is
// in an approver's queue is "submitted for approval": a draft waits for
// evidence and a refused row was not written, and each is said separately —
// the headline must not count them as submitted.
assert.equal(
  progressImportHeadline(
    result({
      submitted: 3,
      draft: 1,
      refused: 1,
      rows: [
        row('submitted'),
        row('draft', 'PROGRESS_EVIDENCE_REQUIRED'),
        row('refused', 'ACTIVITY_PROGRESS_ASSIGNMENT_REQUIRED'),
      ],
    })
  ),
  '3 rows submitted for approval — not official until approved; 1 kept as draft (evidence required); 1 refused'
)
assert.equal(
  progressImportHeadline(result({ submitted: 4, rows: [row('submitted')] })),
  '4 rows submitted for approval — not official until approved',
  'nothing held: no clause'
)
// The preview says what the server's reading of the writer's rules will do.
assert.equal(
  progressImportHeadline(
    result({
      dryRun: true,
      wouldSubmit: 3,
      wouldHold: 1,
      wouldRefuse: 1,
      rows: [
        row('submit'),
        row('hold', 'PROGRESS_EVIDENCE_REQUIRED'),
        row('refuse', 'ACTIVITY_PROGRESS_ASSIGNMENT_REQUIRED'),
      ],
    })
  ),
  '3 rows will be submitted for approval — not official until approved; 1 will be kept as draft (evidence required); 1 will be refused'
)
assert.equal(
  progressImportHeadline(
    result({
      dryRun: true,
      wouldSubmit: 5,
      rows: [row('submit')],
    })
  ),
  '5 rows will be submitted for approval — not official until approved'
)
assert.equal(
  progressImportHeadline(
    result({
      dryRun: true,
      authority: { canApprove: true, outcome: 'approved' },
      wouldApprove: 3,
      wouldHold: 2,
      rows: [
        row('approve'),
        row('hold', 'PROGRESS_EVIDENCE_REQUIRED'),
        row('hold', 'ITP_HOLD_POINT_OPEN'),
      ],
    })
  ),
  '3 rows will be approved for you through the progress approval gates; 2 will be left pending (evidence required, ITP hold point open)'
)

// An approver: approved, with what held the rest and why.
assert.equal(
  progressImportHeadline(
    result({
      authority: { canApprove: true, outcome: 'approved' },
      approved: 3,
      pending: 2,
      rows: [
        row('approved'),
        row('pending', 'PROGRESS_EVIDENCE_REQUIRED'),
        row('pending', 'ITP_HOLD_POINT_OPEN'),
      ],
    })
  ),
  '3 approved, 2 left pending (evidence required, ITP hold point open)'
)
assert.equal(
  progressImportHeadline(
    result({
      authority: { canApprove: true, outcome: 'approved' },
      approved: 2,
      pending: 0,
      draft: 1,
      rows: [row('approved'), row('draft', 'PROGRESS_EVIDENCE_REQUIRED')],
    })
  ),
  '2 approved, 1 left pending (evidence required)',
  'a draft an approver could not approve counts as pending'
)
assert.equal(
  progressImportHeadline(
    result({
      authority: { canApprove: true, outcome: 'approved' },
      approved: 4,
      rows: [row('approved')],
    })
  ),
  '4 approved'
)
assert.equal(
  progressImportHeadline(
    result({
      authority: { canApprove: true, outcome: 'approved' },
      approved: 4,
      refused: 1,
      rows: [row('approved'), row('refused', 'SOMETHING')],
    })
  ),
  '4 approved; 1 refused',
  'an approver is told what the writer refused'
)

// A figure already waiting as a draft is said to await evidence — it is not
// in the approval queue — where one already submitted is simply pending.
assert.equal(
  progressImportRowLabel(
    row('already_pending', 'PROGRESS_ALREADY_PENDING', {
      waitingStatus: 'draft',
    })
  ),
  'Already a draft (awaiting evidence)'
)
assert.equal(
  progressImportRowLabel(
    row('already_pending', 'PROGRESS_ALREADY_PENDING', {
      waitingStatus: 'submitted',
    })
  ),
  'Already pending'
)
assert.equal(progressImportRowLabel(row('approved')), 'Approved')
assert.equal(
  progressImportHeadline(
    result({
      dryRun: true,
      authority: { canApprove: true, outcome: 'approved' },
      wouldApprove: 5,
    })
  ),
  '5 rows will be approved for you through the progress approval gates'
)
// An unknown refusal code is still named, never dropped.
assert.equal(
  progressImportHeadline(
    result({
      authority: { canApprove: true, outcome: 'approved' },
      approved: 0,
      pending: 1,
      rows: [row('pending', 'SOMETHING_NEW')],
    })
  ),
  '0 approved, 1 left pending (SOMETHING_NEW)'
)

// A row the file named without a percentage was skipped, and the headline
// says so for either person, before and after writing; a full-programme
// export's unchanged 0% rows are counted, not announced.
assert.equal(
  progressImportHeadline(
    result({ submitted: 2, skipped: 3, unchanged: 40, rows: [row('submitted')] })
  ),
  '2 rows submitted for approval — not official until approved; 3 skipped (no percentage)'
)
assert.equal(
  progressImportHeadline(
    result({
      authority: { canApprove: true, outcome: 'approved' },
      approved: 1,
      skipped: 1,
      unchanged: 40,
    })
  ),
  '1 approved; 1 skipped (no percentage)'
)
assert.equal(
  progressImportHeadline(
    result({ dryRun: true, wouldSubmit: 2, skipped: 1, unchanged: 40 })
  ),
  '2 rows will be submitted for approval — not official until approved; 1 skipped (no percentage)'
)
assert.equal(
  progressImportHeadline(
    result({
      dryRun: true,
      authority: { canApprove: true, outcome: 'approved' },
      wouldApprove: 2,
      skipped: 1,
    })
  ),
  '2 rows will be approved for you through the progress approval gates; 1 skipped (no percentage)'
)
assert.equal(
  progressImportRowLabel(
    row('skipped', 'PROGRESS_PERCENT_MISSING', { pctComplete: null })
  ),
  'Skipped (no percentage)'
)
assert.equal(
  progressImportRowFigure(
    row('skipped', 'PROGRESS_PERCENT_MISSING', { pctComplete: null })
  ),
  'no %'
)
assert.equal(progressImportRowFigure(row('approved')), '10%')

// An approver's import of a figure already in the queue approved that
// submission as it stood; the row says so.
assert.equal(
  progressImportRowLabel(
    row('approved', null, { approvesPending: true, submissionId: 's1' })
  ),
  'Approved (was already pending)'
)
assert.equal(
  progressImportRowLabel(
    row('approve', null, { approvesPending: true, submissionId: 's1' })
  ),
  'Will be approved (already pending)'
)
assert.equal(
  progressImportRowLabel(
    row('pending', 'ITP_HOLD_POINT_OPEN', { approvesPending: true })
  ),
  'Left pending',
  'a gate that held the already-pending row reads as any held row'
)

// Older pending submissions at another figure the import left in the
// queue are named, never silently: the import does not reject them.
assert.equal(progressImportSupersededNote(result({})), '')
const superseded = (p6ActivityId, pctComplete, importedPctComplete) => ({
  activityId: p6ActivityId,
  p6ActivityId,
  name: p6ActivityId,
  submissionId: `s-${p6ActivityId}`,
  pctComplete,
  importedPctComplete,
})
assert.equal(
  progressImportSupersededNote(
    result({
      supersededPending: 1,
      supersededPendingSubmissions: [superseded('P400', 40, 70)],
    })
  ),
  '1 older pending import submission at another figure is still in the approval queue (P400 at 40%) — reject there if no longer wanted.'
)
assert.equal(
  progressImportSupersededNote(
    result({
      supersededPending: 2,
      supersededPendingSubmissions: [
        superseded('P300', 30, 35),
        superseded('P400', 40, 45),
      ],
    })
  ),
  '2 older pending import submissions at another figure are still in the approval queue (P300 at 30%, P400 at 40%) — reject there if no longer wanted.'
)

// Every row status the API can answer has a label.
for (const status of [
  'submit',
  'approve',
  'hold',
  'refuse',
  'submitted',
  'draft',
  'approved',
  'pending',
  'unchanged',
  'already_pending',
  'skipped',
  'refused',
]) {
  assert.ok(PROGRESS_IMPORT_ROW_LABEL[status], `label for ${status}`)
}

// The dialog previews first (dryRun), repeats the server's headline and the
// per-row reasons, and offers the action the server's authority names.
const dialog = read(
  'src/features/schedule/components/import-progress-dialog.tsx'
)
assert.ok(
  dialog.includes("dryRun ? '?dryRun=true' : ''"),
  'the dialog previews through the API dry run before writing'
)
assert.ok(
  dialog.includes('progressImportHeadline(shown)') &&
    dialog.includes("data-testid='progress-import-headline'"),
  'the dialog shows the headline in the server\'s terms'
)
assert.ok(
  dialog.includes('{row.reason.message}') &&
    dialog.includes('{progressImportRowLabel(row)}'),
  'the dialog lists each held row with the gate\'s reason'
)
// The counts a full-programme export produces are shown, the skipped and
// superseded ones included, and the older pending figures are named so the
// approver can reject them; a skipped row shows no figure.
assert.ok(
  dialog.includes('{shown.skipped ?? 0}') &&
    dialog.includes('{shown.supersededPending ?? 0}') &&
    dialog.includes('progressImportSupersededNote(shown)') &&
    dialog.includes("data-testid='progress-import-superseded'") &&
    dialog.includes('{progressImportRowFigure(row)}') &&
    !dialog.includes('{row.pctComplete}%'),
  'the dialog shows the skipped and superseded counts, the superseded note, and the row figure through the outcome module'
)
assert.ok(
  dialog.includes("row.status !== 'unchanged'"),
  'unchanged rows (a full-programme export has one per unstarted activity) are counted, not listed'
)
// After a real import the dialog refreshes everything an import can move —
// the same set progress-tab's refreshProgress invalidates — so an approver's
// import shows in the EV report and the audit history beside it.
const progressTab = read('src/features/schedule/components/progress-tab.tsx')
const refreshProgress = progressTab.slice(
  progressTab.indexOf('const refreshProgress = async'),
  progressTab.indexOf('const saveMethod')
)
const importSuccess = dialog.slice(
  dialog.indexOf('mutationFn: () => send(false)'),
  dialog.indexOf('toast.success(progressImportHeadline(data))')
)
const invalidated = (source) =>
  [...source.matchAll(/queryKey: (\[?'[a-z-]+'|projectSetupReadinessKey)/g)].map(
    (match) => match[1]
  )
const expectedKeys = invalidated(refreshProgress)
assert.ok(
  expectedKeys.includes("['ev-report'") &&
    expectedKeys.includes("['audit-events'") &&
    expectedKeys.includes('projectSetupReadinessKey'),
  'the reference set is read from progress-tab'
)
assert.deepEqual(
  new Set(invalidated(importSuccess)),
  new Set(expectedKeys),
  'the import dialog invalidates the same queries as refreshProgress'
)
assert.ok(
  dialog.includes("'Import and approve'") &&
    dialog.includes("'Submit for approval'") &&
    dialog.includes('shown.authority.canApprove'),
  'the action is named by the server\'s authority answer, not by the role'
)
assert.ok(
  !dialog.includes('Progress Updated') && !dialog.includes('Updated activities'),
  'the old "updated activities" wording is gone'
)

console.log('Progress import outcome assertions passed')
