# Field Device UX Support Matrix

Task: `TASK-P2-UX-002`

Date: 2026-06-12

Scope: tablet/mobile readiness, accessibility triage, and field evidence upload behavior for daily reports, site diaries, NCR closeout, safety closeout, and PM review actions.

## Supported Field Viewports

| Device class     | Reference viewport | Automated route coverage                                                  | Required manual signoff              |
| ---------------- | -----------------: | ------------------------------------------------------------------------- | ------------------------------------ |
| Tablet landscape |         1024 x 768 | Project list, project detail, Site Reporting, Quality NCR, Quality Safety | iPad Safari or Android tablet Chrome |
| Phone portrait   |          390 x 844 | Project list, project detail, Site Reporting, Quality NCR, Quality Safety | iPhone Safari or Android Chrome      |

## Workflow Matrix

| Workflow              | Mobile/tablet UX requirement                                                                                                                   | Automated regression                                                                                                                                                                   | Manual QA notes                                                                                            |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Daily activity report | Activity/date/shift/progress/weather fields wrap without horizontal overflow; save and submit actions remain full-width on phone.              | `e2e/uat/manifest.json` opens `?module=siteReporting`; `frontend/scripts/field-ux-accessibility.test.mjs` checks labels, status text, touch-target classes, and progress input labels. | Submit as Site Engineer with one assigned activity and confirm keyboard does not cover submit controls.    |
| Site diary            | Weather/workers/visitors/photos/work done/issues/instructions remain usable on phone; offline draft status remains visible.                    | Same Site Reporting route plus persistent diary photo status and offline draft source checks.                                                                                          | Switch browser offline, save draft, reload, reconnect, re-select photos, and submit.                       |
| Site photos           | Camera picker supports image capture plus HEIC/HEIF; selected-file count is announced through a stable status element.                         | Source checks for `accept='image/*,.heic,.heif'`, `capture='environment'`, labelled file inputs, and `aria-describedby` status IDs.                                                    | Test camera capture on iOS Safari and Android Chrome; verify upload limit messaging for unsupported files. |
| NCR closeout          | Closeout dialog scrolls within `90dvh`, labels all required fields, uploads evidence files before submit, and keeps footer buttons touch-safe. | Source checks for workflow upload hook, labelled closeout fields, evidence status, and mobile dialog overflow.                                                                         | Create NCR, attach a photo/PDF, submit closeout, and confirm attachment appears in record history.         |
| Safety closeout       | Same evidence upload and mobile dialog behavior as NCR; safety create/closeout actions stack on phones.                                        | Source checks for Safety tab route, incident input label, touch-target action classes, and workflow upload endpoint.                                                                   | Create safety incident from phone, attach photo evidence, submit closeout, then approve as PM on tablet.   |
| PM review             | Approve/reject buttons remain touch-sized and wrap in cards.                                                                                   | Source checks for shared `min-h-10 w-full sm:w-auto` field action buttons; UAT route smoke checks horizontal overflow.                                                                 | PM approves one submitted report and rejects one diary with a reason on tablet.                            |

## Accessibility Triage

- Field file inputs have visible labels and persistent status text referenced by `aria-describedby`.
- Progress slider and numeric progress input have explicit accessible names.
- Quality/Safety quick-create inputs have explicit accessible names.
- Dialog content is constrained to `90dvh` with vertical scrolling for mobile keyboards.
- Remaining release signoff: run the full browser UAT smoke with Playwright screenshots and attach manual axe or equivalent results from staging.

## Commands

```bash
npm run test:e2e:uat:validate
cd frontend && npm run test:field-ux
cd frontend && npm run test:site-reporting-mobile
```
