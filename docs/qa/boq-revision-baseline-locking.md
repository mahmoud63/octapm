# BOQ Revision And Baseline Locking QA

## Scope
Verify that BOQ re-upload creates revision history and never deletes existing BOQ rows, allocations, progress basis, IPC links, or reporting traceability.

## Automated Checks
- `backend/src/services/__tests__/boq.service.test.js`
  - revised upload updates/creates rows without `deleteMany`
  - locked baseline upload saves comparison-only revision
  - duplicate manual code protection remains active

## Manual Scenario
1. Create a project and upload an initial BOQ with at least two measured rows.
2. Map at least one BOQ row to an active schedule activity and approve the allocation.
3. Upload a revised BOQ where one existing code changes quantity/rate, one code is omitted, and one new code is added.
4. Confirm the current BOQ keeps omitted historical rows intact, creates a BOQ revision, and preserves allocation/progress/IPC links.
5. Approve and lock the schedule baseline.
6. Upload another revised BOQ with changed and new codes.
7. Confirm the API returns `mode: "comparison_only"`, current BOQ rows are unchanged, and the UI shows the baseline locked state with editing disabled.

## Expected Evidence
- BOQ upload response includes `jobId`, `revisionId`, `mode`, `baselineLocked`, and comparison counts.
- `BoqRevision` records exist for each upload.
- No BOQ import path issues `deleteMany` for existing uploaded BOQ rows.
- Active allocation, EV, IPC, and setup-readiness summaries only count `BoqItem.isActive = true` rows.
