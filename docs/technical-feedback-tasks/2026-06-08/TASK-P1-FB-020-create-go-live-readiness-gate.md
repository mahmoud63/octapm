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

- [ ] Define go-live acceptance criteria by module and workflow.
- [ ] List pilot-only restrictions and production-blocking tasks.
- [ ] Create QA scenarios for BOQ -> Activity -> Progress -> EV -> Commercial -> Dashboard.
- [ ] Require signoff from Product, QA, Security, Backend, Frontend, and Business owners.
- [ ] Connect release checklist to CI/smoke testing.

## Suggested Technical Approach

Create a readiness matrix that maps workflow, blocker, task file, owner, validation evidence, status, and signoff. Use this review package as the initial blocker source.

## Acceptance Criteria

- [ ] A go-live readiness document exists with owners and gates.
- [ ] P0 blockers are linked and cannot be ignored without formal risk acceptance.
- [ ] QA has executable end-to-end scenarios.
- [ ] Pilot/demo limitations are documented.
- [ ] Production rollout requires recorded signoff.

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
