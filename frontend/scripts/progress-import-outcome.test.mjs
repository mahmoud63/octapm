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
  refused: 0,
  rows: [],
  message: '',
  ...overrides,
})

// A submit-only person: pending, and said to be not official.
assert.equal(
  progressImportHeadline(
    result({ submitted: 3, draft: 1, rows: [row('submitted'), row('draft')] })
  ),
  '4 rows submitted for approval — not official until approved'
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

// Every row status the API can answer has a label.
for (const status of [
  'submit',
  'approve',
  'submitted',
  'draft',
  'approved',
  'pending',
  'unchanged',
  'already_pending',
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
    dialog.includes('PROGRESS_IMPORT_ROW_LABEL[row.status]'),
  'the dialog lists each held row with the gate\'s reason'
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
