# TASK FB-011: Build Mobile-Ready Site Reporting Flow

## Priority
P2

## Related Feedback

- Feedback ID: FB-011
- Original feedback summary: Add a mobile-first daily activity workflow with photos, manpower, equipment, materials, and notes.

## Current Project Status

The schema includes `DailyReport` and `SiteDiary`, but no backend routes or frontend screens were found for those models.

## Evidence

- `backend/prisma/schema.prisma`, lines 888-906: `DailyReport` has activity, date, progress percent, manpower/equipment/materials JSON, photos JSON, notes, and engineer.
- `backend/prisma/schema.prisma`, lines 911-922: `SiteDiary` has project-level date, weather, manpower/equipment/materials JSON, and notes.
- Search found no route/UI references for `dailyReport`, `DailyReport`, `siteDiary`, or `SiteDiary` outside the schema.

## Gap Analysis

Site engineers cannot submit daily activity updates with evidence, and the mobile team does not have documented APIs for this workflow.

## Required Changes

- [ ] Add daily report and site diary services with org/project/activity scoping.
- [ ] Add create, list, detail, update, submit, approve, and reject APIs.
- [ ] Integrate photo/file upload storage and attachment metadata.
- [ ] Add responsive web screens for site entry and review.
- [ ] Document endpoints for mobile API consumers.

## Suggested Technical Approach

Expose the existing schema through service-layer APIs first, then add workflow states and photo handling. Align approved daily reports with FB-008 progress approval.

## Acceptance Criteria

- [ ] A site engineer can submit a daily report for an activity.
- [ ] Reports can include photos, manpower, equipment, materials, and notes.
- [ ] PM/planning users can approve or reject reports.
- [ ] Approved reports can feed official progress according to method rules.
- [ ] Mobile API documentation includes request/response schemas.

## Testing Requirements

Add backend API tests, upload/storage tests, responsive frontend QA, and manual mobile API smoke tests.

## Risks

Photo uploads introduce storage, security, and retention concerns. Offline mobile behavior may need separate design.

## Dependencies

Depends on FB-008 for progress approval and FB-017 for API documentation.

## Estimated Effort
L

## Notes

This task provides APIs and web support; it does not require building the separate mobile app UI.
