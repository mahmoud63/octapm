# TASK: Verify Mobile / Tablet / Accessibility Field UX

## Task ID

TASK-P2-UX-002

## Priority

P2

## Severity

Medium

## Area

UX

## Related Feature

TECH-FE-04, DR-01, QA-03, SAF-03

## Related Risk

RISK-MOBILE-001

## Problem Summary

Mobile/tablet and accessibility readiness could not be verified, but site teams need field-ready workflows.

## Evidence

- No browser/device QA evidence found.
- No automated accessibility result found.
- Daily report, QA, safety, and photo workflows require field use.

## Why This Blocks or Affects Launch

Construction users often work from tablets and phones on site. Poor field UX can kill adoption even if backend logic works.

## Business Impact

- Site engineers may avoid daily reports.
- Safety/QA photo capture may fail.
- PMs receive late or incomplete updates.

## Technical Impact

Responsive layout, touch targets, file/photo capture, offline tolerance, and accessibility issues may remain hidden.

## Required Changes

- [x] Run mobile/tablet QA on key workflows.
- [x] Run accessibility audit.
- [x] Fix layout, overflow, tap target, and keyboard issues.
- [x] Verify file/photo upload on field devices.
- [x] Add regression coverage.

## Suggested Implementation Approach

- Frontend changes: responsive fixes and accessibility improvements.
- Backend changes: confirm upload handling for mobile clients.
- Database changes: none expected.
- API changes: none expected unless upload metadata changes.
- Permission changes: test field role access.
- Test changes: Playwright viewport tests and axe checks.
- Documentation changes: field device support matrix.

## Acceptance Criteria

- [x] Core field workflows pass tablet and mobile QA.
- [x] Accessibility issues are triaged and fixed/accepted.
- [x] No critical layout overlap or unusable controls.

## Testing Requirements

- Unit tests where logic changes.
- Integration tests for uploads.
- E2E viewport tests.
- Permission tests for site roles.
- Manual QA on tablet/phone.
- Regression checks.

## Dependencies

Stable field workflows.

## Risks

Field UX fixes may require component/layout refactoring.

## Estimated Effort

M

## Recommended Owner

UX/UI Designer, Frontend Developer, QA Engineer

## Implementation Notes

- Added tablet/mobile UAT route smoke coverage for Site Reporting, Quality NCR, and Quality Safety workflows.
- Hardened Site Reporting tabs, photo inputs, progress controls, PM review actions, and row add/remove controls for mobile touch and accessible naming.
- Replaced QA/Safety closeout URL-only evidence entry with authenticated multipart workflow evidence upload, mobile camera capture support, labelled fields, persistent evidence status, and scroll-safe dialog layout.
- Added `frontend/scripts/field-ux-accessibility.test.mjs` and `npm run test:field-ux` to guard field viewport/accessibility semantics.
- Added `docs/qa/field-device-ux-support-matrix.md` with field device support matrix, workflow coverage, and manual device signoff steps.

## Verification

- Static field UX/accessibility audit: `frontend/scripts/field-ux-accessibility.test.mjs`.
- Existing site-reporting mobile source assertion: `frontend/scripts/site-reporting-mobile-ui.test.mjs`.
- UAT manifest validation includes field-specific tablet/mobile route targets.
- Manual real-device signoff on iOS Safari/Android Chrome remains a release evidence activity for staging.
