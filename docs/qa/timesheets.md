# Timesheets and crews (OCTA-FLD-TIME-037)

Workers (company-level people with a trade, classification and hourly
rate), project crews, and one timesheet per crew per day with hours per
worker on a schedule activity. Approval snapshots the rates and **posts
the labour cost** to the activity's cost record and the cost code's labour
budget line; reopening reverses exactly what was posted.

## Where

- **Site Reporting › Timesheets** (deep link
  `/projects/{id}/site-reporting?source=timesheet&recordId=<timesheetId>`).
  Week navigation, six tiles (hours, overtime, labour cost, workers,
  waiting for approval, returned), *New timesheet* (date + crew, default
  hours), *XLSX* (the week).
- **Week grid**: worker × day hours (overtime in amber; click a cell to
  open that day's timesheet), totals, by activity, by crew.
- **Timesheets**: the week's timesheets with status → editor.
- **Editor**: rows per worker with activity, cost code, location, time
  type (regular / overtime / double), hours, notes; *Add a worker* (a
  worker may appear several times); *Save* while draft / returned;
  *Submit for approval*; *Approve and post cost* / *Return* (reason);
  *Reopen*; *Delete* (draft); history.
- **Crews & workers**: crews with members, company, default activity and
  cost code (pre-filled on new timesheets); workers with add / edit and a
  paste **import** (name, employee number, trade, classification, rate,
  company).
- **Productivity** (last 5 weeks): approved hours and cost per activity,
  hours per day, approved % complete, hours per %, earned labour (labour
  budget × %), burn %, *labour cost ahead of progress* warning.

## Rules

- A timesheet is draft → submitted → approved | rejected → draft; one per
  crew per day (409 `TIMESHEET_EXISTS`); `clientRequestId` replays.
- Entries: 0–24 h each and ≤ 24 h per worker per day
  (400 `TIMESHEET_HOURS_EXCEEDED`); references must belong to the project.
- **Submission requires an activity on every entry**
  (400 `TIMESHEET_ENTRY_ACTIVITY_REQUIRED`) — the activity-linked spine.
  PMs, cost controllers and the crew foreman are notified.
- **Approval** (`timesheet.approve`: PM, cost controller): rate = the
  worker's hourly rate (× overtime multiplier, × 2 for double time);
  amount added to `CostRecord.actual` of the activity (created if missing,
  `actualThroughDate` moved forward) and to the active **labour**
  `BudgetLine` of the entry's cost code; submitter notified.
- **Return** needs a reason; **reopen** (`timesheet.reopen`) decrements the
  posted amounts and returns the sheet to draft.
- Party users (contractor / subcontractor templates) see and edit their
  own company's workers, crews and timesheets; owner / consultant read.
- Report source **Timesheet entries** (submitted + approved) with worker,
  crew, activity, cost code, hours, rate, amount; attachments and history
  on `timesheet`.

## API (tag "Timesheets", `/projects/{id}/timesheets`)

| Endpoint | Permission |
| --- | --- |
| `GET /workers?q&companyId&status`, `POST /workers`, `POST /workers/import`, `PATCH /workers/{workerId}` | `timesheet.read`; writes `timesheet.worker_admin` |
| `GET /crews`, `POST /crews`, `PATCH /crews/{crewId}`, `DELETE /crews/{crewId}` | `timesheet.read / create / update / delete` |
| `GET /week?weekStart`, `GET /productivity?from&to`, `GET /export.xlsx?from&to&status` | `timesheet.read` (export: `timesheet.export`) |
| `GET /?from&to&status&crewId&companyId`, `POST /`, `GET /{timesheetId}`, `PATCH /{timesheetId}`, `DELETE /{timesheetId}` | `timesheet.read / create / update / delete` |
| `POST /{timesheetId}/submit` | `timesheet.submit` |
| `POST /{timesheetId}/approve`, `…/reject { reason }`, `…/reopen { reason? }` | `timesheet.approve / reject / reopen` |

## Test

```bash
cd backend && npx jest src/services/__tests__/timesheet.service.test.js
cd frontend && node scripts/timesheets-ui.test.mjs
```

Manual: Crews & workers → add three workers with rates → create a crew
with a default activity → New timesheet for today with the crew → the
members appear with 8 h → change one row to overtime → Submit → as PM,
Approve → Cost Control › By Activity shows the actual, Budget shows the
labour line's actual → Reopen → both revert → Productivity lists the
activity with hours per %.
