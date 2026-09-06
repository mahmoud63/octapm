# Schedule export and lookaheads (OCTA-SCH-LOOKAHEAD-041)

Two things planners and site teams asked for: the schedule **back out in
the planning software's own format** (Primavera P6 XER / XML, Microsoft
Project XML) and **lookaheads** — 2–6 week short-interval plans seeded
from the master schedule, with tasks added by hand, constraints to clear,
and weekly percent-plan-complete (PPC).

## Schedule export

**Where:** Schedule › *Export* menu — *Excel workbook* (existing) and, under
*Planning software*, *Primavera P6 (XER)*, *Primavera P6 (XML)*,
*Microsoft Project (XML)*. Permission `schedule.export`.

What goes out (`schedule-export.service.js`, one model for all writers):

- **Calendars** — the project's and every activity's calendar (five / six /
  seven-day) with 08:00–12:00 and 13:00–17:00 shifts.
- **WBS** — a project node (contract number or project name) and one node
  per distinct WBS code, parents inferred from the code (`1.2.3` → `1.2`),
  names from the revision snapshot when it has them.
- **Activities** — active ones only: id (activity code / P6 id), name,
  WBS, calendar, task or finish milestone, original / remaining duration,
  physical % complete (latest approved progress), status (not started / in
  progress / completed), early / late dates from the CPM working-day
  offsets (planned dates as fallback), actual start / finish, total float,
  critical flag.
- **Relationships** — every dependency between two exported activities
  (FS / SS / FF / SF with lag); dangling ones are dropped.

Units: P6 durations, floats and lags are **hours** (8 per working day).
MSPDI durations are ISO 8601 (`PT40H0M0S`); **slack and link lag are tenths
of a minute** (4800 per working day) — the MSP *importer* was corrected to
the same rule (it used to read them as minutes). Dates carry 08:00 (starts)
or 17:00 (finishes).

Every writer is tested by **reading the file back through our own
parsers** (`xer-parser`, `p6xml-parser`, `msp-parser`).

| Endpoint | Permission |
| --- | --- |
| `GET /projects/{id}/export/schedule/{xer\|p6xml\|mspxml}` | `schedule.export` |

Errors: 400 `EXPORT_FORMAT_INVALID`, 400 `SCHEDULE_EMPTY`.

## Lookaheads

**Where:** Schedule › **Lookahead** (deep link
`/projects/{id}/schedule/lookahead?source=lookahead&recordId=`).

- **List**: tiles (plans, the current one, open / overdue constraints,
  PPC), *New lookahead* (start date — moved to the week boundary —, 2–6
  weeks, week starts on, title, filter: WBS prefixes, phases, critical
  only), the register with status, window, task counts and PPC, and the
  **make-ready log** (open constraints across live plans).
- **Board**: the week / day grid — one column per day, working days from
  the project calendar, today marked — with each task's planned bar
  shaded by status, a drift badge when the planned finish differs from
  the schedule's, crew / location, constraint flag; row click opens the
  task; header actions *Refresh from schedule*, *Publish*, *Roll forward*,
  *Archive*, *Export XLSX*, *Add task*; PPC card per week with variance
  reasons; history.
- **Task dialog**: name, activity (optional), planned start / finish,
  crew, location, assignee, quantity + unit, status (not done needs a
  reason), % complete, constraint (text, owner, due date, open / cleared),
  notes, *Remove*.

Rules (`lookahead.service.js`):

- Refs `LA-001`; `startDate` snaps back to the week start (`weekStartDay`,
  default Monday); the window is `weeks × 7` days.
- **Seeding**: active, unfinished activities whose window (actual start /
  early dates / planned dates) touches the lookahead window, filtered by
  WBS prefix, phase, critical-only or explicit ids; % complete from the
  approved progress (> 0 → in progress). Items keep `scheduleStart /
  scheduleFinish` next to `plannedStart / plannedFinish`.
- **Refresh**: newly due activities are added; items whose dates were not
  edited follow the schedule; edited ones stay (drift shown); approved
  progress lifts % complete; a finished activity completes its item;
  removed schedule items stay removed.
- **Status**: planned → in_progress → done; `not_done` needs a variance
  reason (design, material, labour, equipment, weather, prerequisite,
  permit, space, other); % complete 100 → done.
- **Constraints**: text + owner + due date; `open` → `cleared` (cleared
  time stored); overdue when open past the due date. The make-ready log
  lists open constraints across live lookaheads.
- **PPC** per week = done ÷ tasks due in that week (planned finish inside
  the week); the overall figure covers closed weeks only.
- **Publish** (draft → published, at least one task): PMs, planners, site
  engineers plus assignees, crew foremen and constraint owners are
  notified; **archive** locks the plan; only drafts can be deleted.
- **Roll forward**: a new draft one week later (same length and filter)
  carrying planned / in-progress tasks still due and not-done tasks
  re-planned from the new start (reason noted, open constraints kept),
  then seeded with newly due activities; activities the previous plan
  settled are not re-seeded; `archiveSource` archives the old plan.
- **Party users** (owner / consultant / subcontractor) see published and
  archived plans plus their own drafts; subcontractors edit only their
  company's tasks (crew company or task company) — their added tasks are
  stamped with their company.
- New `lookahead` permission module (`lookahead.publish`,
  `lookahead.archive`, `lookahead.item_status`) with party templates;
  report source *Lookahead items*; attachments, history and record link on
  `lookahead`.

| Endpoint | Permission |
| --- | --- |
| `GET /projects/{id}/lookaheads?status`, `POST /` | `lookahead.read` / `create` |
| `GET /constraints` | `lookahead.read` |
| `GET /{lookaheadId}`, `PATCH`, `DELETE` | `read` / `update` / `delete` |
| `POST /{lookaheadId}/refresh` | `lookahead.update` |
| `POST /{lookaheadId}/publish` | `lookahead.publish` |
| `POST /{lookaheadId}/archive` | `lookahead.archive` |
| `POST /{lookaheadId}/roll-forward { startDate?, weeks?, title?, archiveSource? }` | `lookahead.create` |
| `GET /{lookaheadId}/export.xlsx` | `lookahead.export` |
| `POST /{lookaheadId}/items`, `PATCH …/items/{itemId}`, `DELETE …/items/{itemId}` | `lookahead.update` |
| `POST …/items/{itemId}/status { status, varianceReason?, pctComplete? }` | `lookahead.item_status` |

## Test

```bash
cd backend && npx jest src/services/__tests__/schedule-export.service.test.js src/services/__tests__/lookahead.service.test.js src/parsers/__tests__/schedule-relationship-mapping.test.js
cd frontend && node scripts/schedule-export-lookahead-ui.test.mjs
```

Manual: Schedule › Export › Primavera P6 (XER) → open in P6 (or re-import
it here through *Import Schedule*) — activities, WBS and relationships
match. Schedule › Lookahead › New (Monday, 3 weeks) → the activities due
in the window appear on the grid → add a task with a constraint → Publish
→ mark one done and one not done (reason) → next week: PPC shows the
closed week → Roll forward carries the not-done task with its reason.
