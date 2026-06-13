# TASK: Establish clean release-candidate source baseline

## Task ID
TASK-P0-REL-001

## Priority
P0

## Severity
Critical

## Area
Release Management / DevOps

## Related Feature
F-122

## Related Risk
RISK-006

## Problem Summary
The repository is heavily dirty with modified, deleted, and untracked files, so the exact release candidate cannot be certified.

## Evidence
git status before audit documentation showed many modified source/config/docs files, deleted tracked private-document files under backend/storage/private-documents, deleted frontend task files, and many untracked migrations/tests/routes/services. No source files were modified for this audit.

## Why This Blocks or Affects Launch
Executives and customer implementation teams need a reproducible release candidate with known provenance before launch.

## Business Impact
Executives and customer implementation teams need a reproducible release candidate with known provenance before launch.

## Technical Impact
Dirty state makes test results, build outputs, and deployment artifacts non-reproducible.

## Required Changes
- [ ] Create or select a clean release branch.
- [ ] Resolve tracked deletions and untracked source changes intentionally.
- [ ] Remove private runtime artifacts from tracked source history or confirm they are placeholders.
- [ ] Rerun every quality gate on the clean commit.

## Suggested Implementation Approach
Coordinate frontend, backend, database, API, permission, test, and documentation changes as applicable. Keep changes scoped, update OpenAPI or help-center docs where behavior changes, and rerun the relevant release gates before signoff.

## Acceptance Criteria
- [ ] git status is clean except generated audit docs before certification.
- [ ] Release commit SHA is recorded.
- [ ] All gate evidence maps to the certified commit.

## Testing Requirements
Git status verification; full CI quality gate; deployment smoke on certified commit.

## Dependencies
Related P0 release-gate tasks must be completed on the same clean release branch.

## Risks
Fixes may change workflow authorization behavior; run regression tests for PM, consultant, subcontractor, and field personas.

## Estimated Effort
M

## Recommended Owner
Product Manager, DevOps Engineer, QA Engineer
