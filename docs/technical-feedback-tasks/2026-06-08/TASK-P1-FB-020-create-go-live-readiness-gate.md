# TASK FB-020: Create Go-Live Readiness Gate

## Priority
P1

## Related Feedback

- Feedback ID: FB-020
- Original feedback summary: Keep the product classified as demo/pilot until data model, approval, audit, permissions, EV basis, and security readiness are hardened.

## Current Project Status

The application has many MVP modules and prototype workflows, but no visible go-live acceptance criteria or release readiness gate was found.

## Evidence

- Feedback states the system is promising for demos/pilots but not ready as the official source of truth.
- `backend/src/services/schedule.service.js`, lines 852-868: schedule generation can delete linked project records.
- `notes.txt`, line 3: UI smoke testing was flagged as incomplete.
- No repository file was found defining go-live criteria, pilot restrictions, or release gates.

## Gap Analysis

Production readiness cannot be verified from code alone. Critical gaps in schedule preservation, allocation spine, EV basis, permissions, audit, and security must be closed or risk-accepted before rollout.

## Required Changes

- [x] Define go-live acceptance criteria by module and workflow.
- [x] List pilot-only restrictions and production-blocking tasks.
- [x] Create QA scenarios for BOQ -> Activity -> Progress -> EV -> Commercial -> Dashboard.
- [x] Require signoff from Product, QA, Security, Backend, Frontend, and Business owners.
- [x] Connect release checklist to CI/smoke testing.

## Suggested Technical Approach

Create a readiness matrix that maps workflow, blocker, task file, owner, validation evidence, status, and signoff. Use this review package as the initial blocker source.

## Acceptance Criteria

- [x] A go-live readiness document exists with owners and gates.
- [x] P0 blockers are linked and cannot be ignored without formal risk acceptance.
- [x] QA has executable end-to-end scenarios.
- [x] Pilot/demo limitations are documented.
- [x] Production rollout requires recorded signoff.

## Testing Requirements

Execute QA scenarios, deployment smoke tests, security checklist review, and stakeholder signoff review.

## Risks

Without business ownership, readiness criteria can stay vague. Treat unresolved P0 items as blockers.

## Dependencies

Depends on completion or risk acceptance of FB-001, FB-006, and FB-019. Also depends on FB-018 for automated gates.

## Estimated Effort
S

## Notes

Status is `Cannot verify` because live readiness needs acceptance evidence, not only code inspection.

## Implementation Status - 2026-06-09

- Added `docs/qa/go-live-readiness-gate.md` with the go-live rule, readiness matrix, module acceptance criteria, pilot restrictions, production-blocking conditions, executable QA scenarios, required evidence commands, signoff record, and risk acceptance record.
- Updated `docs/release-checklist.md` so production source-of-truth rollout depends on the go-live readiness gate in addition to CI and deployment smoke checks.
- Live readiness still requires actual evidence, stakeholder signoff, and any required risk acceptance for the target release.
