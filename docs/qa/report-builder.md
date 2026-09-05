# Report builder, scheduled reports, export-view and portfolio (OCTA-RPT-BUILDER-023)

## Where

- **Reports** (`/reports`): saved reports on the left, the builder on the right. `?reportId=` opens one, `?runId=` highlights a delivery.
- **Portfolio** (`/portfolio`): one row per project from precomputed health snapshots.
- **Export view** on registers: the CSV button on the RFI / submittal / drawing / transmittal / correspondence / NCR / ITP / defect / safety / material-test lists and on the tasks and users tables downloads exactly the rows shown, with the visible columns.

## Sources

`GET /reports/sources` lists the read model: activities, RFIs, submittals, punch list, observations, inspections, NCRs, safety incidents, change orders, commitments, subcontractor pay applications, tasks, risks, purchase orders, long-lead items, payment certificates, activity cost, budget lines, daily-log manpower and daily logs. Each column has a type (string, number, money, date, boolean, enum); italic columns are computed (overdue, days open, man-hours, variance…). Relation columns such as *Activity* and JSON columns such as *Weather* are supported.

## Permissions at query time

A report runs **as the caller**:

1. The projects in scope are the ones the caller can open (org-wide roles see all; others their assignments and parties).
2. In each project the source's permission module must be readable by the caller's project role, permission template or party template — projects that fail are skipped and counted (`projects.denied`, shown in the preview as "skipped (no permission there)").
3. Party users get the same row visibility the register applies (their company's punch items, commitments and pay applications; RFIs and submittals where their party is owner / reviewer / approver; drafts only to their author).

Scheduled runs render as the **schedule's owner**, so recipients never receive more than the owner could see. Ad-hoc exports (`POST /reports/export`) and saved-report exports follow the same path.

Roles: every role can read and export reports; PM, planning, QS, cost controller, procurement, site engineer and finance can create; owners and PMs edit / delete; `report.schedule` (PM, planning, QS, cost controller, procurement, finance) schedules. Portfolio: PM, planning, QS, cost controller, procurement, finance.

## Builder

Name, description, scope (all projects / one project), sharing (only me / project / organisation), source, columns, filters (operators depend on the column type: contains, is / is not, any of, comparisons, between, empty, yes / no, last / next N days, before / after today…), sort, group by, totals (count, sum, avg, min, max), chart (bars / line / share per group on a metric). **Preview** pages 100 rows at a time; **Save**, **Save as new**, **XLSX** (Data + Summary + About sheets), **PDF** (landscape when wide), **Run & deliver** (stores the files on a run and sends them to you), **Schedules**, **Delete**.

## Schedules

Daily / weekly (day) / monthly (day of month) at a local time in an IANA time zone; format PDF, XLSX or both; recipients by role (in-app + email through notifications) and external addresses (email with a sign-in link — files stay in OctaPM). The `report.render` job runs each due schedule (checked every five minutes), stores the files on a **run** (last 30 kept per report) and records delivery counts and failures. Paused schedules keep their settings.

## Portfolio

`portfolio.refresh` runs hourly per organisation (and on **Refresh**) and stores one `ProjectHealthSnapshot` per project: health score and seven dimensions (same formulas as the workspace dashboard), SPI / CPI / EV / PV / AC / EAC / BAC from the official EV report, cash in / out / net for the current and next two months and net to date, open and overdue RFIs, open punch items, open NCRs, pending submittals, open / overdue tasks, pending change orders, delayed / critical activities, procurement risks. The page reads snapshots only (one query), sorts client-side, flags rows older than two hours and exports XLSX.

## Walkthrough

1. Reports → New report → source *RFIs* → columns default → add filter *Overdue is yes* → group by *Discipline* → chart *Bars* → Preview.
2. Save as "Overdue RFIs by discipline", shared with the organisation → XLSX / PDF.
3. Schedules → weekly, Monday 07:00 Asia/Riyadh, PDF, roles: Project managers, plus a director's email → Add schedule. *Run & deliver* to see the run and files immediately.
4. Sign in as a warehouse user: the same report previews with the projects "skipped (no permission there)" and no RFI rows.
5. Portfolio → Refresh → sort by SPI; open a project from its name.
6. On Quality → NCRs press **Export view (CSV)**.

## Verification

- `backend`: `npx jest src/services/__tests__/report-builder.service.test.js src/services/__tests__/portfolio.service.test.js` (filter translation and in-memory filters, permission gating with templates, party visibility per project, definition validation, next-run in time zone, XLSX / PDF rendering, scheduled run execution with delivery, queueing, ownership; snapshot refresh, portfolio read, refresh job).
- `frontend`: `node scripts/report-builder-ui.test.mjs`.
- OpenAPI: `node scripts/validate-openapi.js` (21 routes under **Reports**).
