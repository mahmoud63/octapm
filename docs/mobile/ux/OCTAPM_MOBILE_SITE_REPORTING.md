# OctaPM Mobile — Site Reporting

**Audience:** whoever implements UX2-D, and the PM who will read the output every evening.
**Date:** 2026-09-19. **Status:** design, grounded in the daily-log API as it stands.

## 1. What exists, measured

`GET /projects/:id/daily-logs/:date` returns, for any date, whether or not a log has been started:

```
{ id, exists, projectId, date, status, weather, weatherSource, weatherFetchedAt, summary,
  submittedAt, submittedBy, approvedAt, approvedBy, distributedAt, distribution,
  pdfDocumentId, sections, totals, path, createdAt, updatedAt }
```

`sections` has six keys — **manpower, equipment, deliveries, visitors, delays, notes** — and `totals` is computed by the server:

```
workers · manHours · companies · equipmentCount · equipmentHours · idleHours ·
deliveries · visitors · hoursLost · notes · entries · awaitingReview · suggestedDelays
```

That is a genuinely strong foundation: a submit/approve/distribute lifecycle, a generated PDF (`pdfDocumentId`), a weather feed with provenance (`weatherSource`, `weatherFetchedAt`), server-computed totals including **idle equipment hours** and **hours lost**, and a `suggestedDelays` count the server derives. The web platform already has a full editor for it (`frontend/src/features/site-reporting/`).

The mobile screen (`app/(app)/site/index.tsx`, 249 lines) shows a date stepper, weather, a free-text summary and the six sections as flat add/remove lists. It does not show the totals the server computes, carries no photographs, and stops at six of the brief's eleven sections.

## 2. The eleven sections against reality

§14 asks for eleven. Here is where each one actually comes from — this is the §63 test, section by section.

| § | Section | Source | Verdict |
|---|---|---|---|
| 1 | Work completed — activities, locations, progress, quantity, notes, photos | **Not a daily-log section.** Progress lives in `progress_submission` records against activities. The log's `notes` section is free text | **Derive.** Render today's progress submissions for the project as a read-only "Work completed" block, each row linking to its activity, with a capture affordance. Do not invent a new section on the log |
| 2 | Manpower — company, trade, workers, hours, location, activity | `sections.manpower`, totals `workers`/`manHours`/`companies`; and `GET /projects/:id/daily-logs/manpower-report` → `{from, to, groupBy, items, byDate, totals}`, groupable by company, trade, company_trade or activity | **Native**, with a weekly manpower report the app has never shown |
| 3 | Equipment — equipment, owner, hours, idle hours, location, activity | `sections.equipment`, totals `equipmentCount`/`equipmentHours`/`idleHours`; `/projects/:id/equipment` for the register | **Native** |
| 4 | Deliveries — supplier, PO, material, quantity, accepted, rejected, photo, delivery note | `sections.deliveries`, total `deliveries`; PO context from `/purchase-orders`; evidence via the `delivery_receipt` attachment type | **Native**, and the photo has a home |
| 5 | Visitors — name, company, purpose, time in/out | `sections.visitors`, total `visitors` | **Native** |
| 6 | Safety — observations, incidents, toolbox talks, photos, actions | **Not a daily-log section.** `safety_incident` records exist with their own module | **Derive.** Show today's safety records for the project, read-only, with "Raise a safety observation" as the action |
| 7 | Quality — inspections, NCR, punch, material tests, observations | **Not a daily-log section.** All four are their own modules | **Derive**, same pattern |
| 8 | Delays — cause, start, duration, affected activity, responsible party, schedule impact, evidence | `sections.delays`, totals `hoursLost`/`suggestedDelays`; `/weather-delays` for the contractual picture; evidence via the `weather_delay` attachment type | **Native** |
| 9 | Constraints — design, material, labour, equipment, access, weather, client decision, other | **`GET /projects/:id/lookaheads/constraints` → `{items, summary}`**, guarded by `lookahead.read` | **Native, via the lookahead.** A constraint belongs to the lookahead, not to the day, which is the right model: a constraint blocks planned work rather than describing what happened. Render the open and overdue constraints affecting today and tomorrow, with "raise a constraint" as the action |
| 10 | Photos — all daily site photos | `GET /projects/:id/photos` filtered by `takenAt` on that date; and attachments on the log itself (`daily_log`) | **Native** |
| 11 | Tomorrow — planned work, material, equipment, inspections, deliveries, risks | **Nothing serves this on the log.** But `/projects/:id/lookaheads` returns `{items, summary}` and activities carry dates | **Derive.** "Tomorrow" is the lookahead filtered to the next working day plus tomorrow's expected deliveries from open POs. Label it as derived, not as something someone typed |

**Seven native, four derived. Nothing is missing.** Every one of the eleven sections the brief asks for has a real source. That was not the first conclusion: constraints was initially written off as homeless, and the audit found `GET /projects/:id/lookaheads/constraints` serving `{items, summary}`. It is recorded here because it changes the build — a section that would have been hidden is buildable.

## 3. The screen

### Site Reporting home

The brief (§13) asks for a module home. It should open on today and answer, above the fold, what the day looked like:

```
SITE REPORT · Thursday 19 September          OPEN
Riverside Tower

142 workers    1,136 man-hours    9 companies
11 plant       78 hrs             6 idle hrs
6 deliveries   4 visitors         3.5 hrs lost
18 photos      2 delays suggested

Weather   28°C, clear — from the station feed, 06:10
```

Every one of those numbers is `totals` from the server. None is computed on the phone. Then the eleven sections as a list with counts, each opening its own editor, then Previous reports.

### The day's editor

One section per screen, not eleven stacked cards. Each section screen is a real list with an add sheet shaped to that section's fields — manpower asks company/trade/workers/hours/location/activity, deliveries asks supplier/PO/material/quantity/accepted/rejected — and each entry can carry a photo through the `daily_log` attachment type.

### Submit

The lifecycle is already there: `status`, `submittedAt/By`, `approvedAt/By`, `distributedAt`, `distribution`, `pdfDocumentId`. Mobile should show where the report stands in that lifecycle in words, offer **Submit** when the person holds `progress.submit`, and — once submitted — show who approved it and let the PDF be opened. A report that is submitted is read-only on the phone, and says so.

## 4. What the PM sees

The same data, from the other side. On PM Home, "Today on site" is the `totals` block; tapping it opens the day's report read-only with the derived quality, safety and work-completed blocks in place. That is the §69 handoff: the site engineer's evening work is the PM's morning briefing, with no copying and no second record.

## 5. What UX2-D must prove (§69)

A site engineer creates today's report, records activities worked, adds manpower, equipment, a delivery, a delay, a quality note and photos, plans tomorrow, and submits. Then, **read back from the API and seen on the web**: the report exists with that date and status; the totals match what was entered; the photos appear in the project gallery with that date; the delivery is on the PO; the delay is against its activity; and the PM can open it. Every assertion reads the server, never the app's own state.
