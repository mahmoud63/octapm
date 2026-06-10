# Daily Reporting Mobile Workflow QA

Scope: daily activity reports, site diaries, photo evidence, PM review, and offline/mobile retry behavior.

## Automated Coverage

- Backend daily-report service tests cover structured manpower/material/equipment/photo persistence, linked progress approval, duplicate `clientRequestId` replay, and rejection of cross-project photo keys.
- Backend site-diary service tests cover structured diary persistence, duplicate `clientRequestId` replay, project-owned photo linking, and rejection reason metadata.
- Module/action route tests verify only PM users can final-approve daily reports and site diaries.
- OpenAPI validation must pass for the documented daily reporting/site diary contracts.
- Frontend site-reporting UI assertions cover local draft storage, offline state, idempotency metadata, PM-only review feedback, and rejection dialog behavior.

## Manual QA

1. Sign in as Site Engineer assigned to Project A.
2. Open Project A Site Reporting on a phone-sized viewport.
3. Upload one site photo through `/site-reporting/uploads`, create a daily activity report with activity, shift, progress, manpower, equipment, materials, weather, issue, notes, and the uploaded photo, then submit it.
4. Repeat the same request body with the same `clientRequestId`. Confirm the API returns the original report ID and does not create a duplicate record or duplicate progress submission.
5. Try to submit a report with a photo key uploaded to another project. Confirm the API returns `400 INVALID_SITE_PHOTO_REFERENCE`.
6. Switch the browser offline, edit a daily report draft, and click Save Draft. Reload the page while still offline and confirm the typed field data is restored. Re-select photos after reconnecting, then submit.
7. Sign in as Planning Engineer and QS. Confirm submitted daily reports/site diaries are visible but approval/rejection actions are not shown, and direct approve/reject API calls return `403 FORBIDDEN`.
8. Sign in as PM. Approve one submitted daily report and reject one site diary with a reason. Confirm the report status changes to `approved`, linked progress is approved, the diary status changes to `rejected`, and the rejection reason is visible to the Site Engineer.
9. Confirm dashboard and EV regression views still read approved progress only and do not count draft/rejected field records.
