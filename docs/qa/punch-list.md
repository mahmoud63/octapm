# Punch list (OCTA-FLD-PUNCH-013)

A punch item is one thing a subcontractor has to fix before handover. The
list replaces the flat defect register: items carry a responsible company,
an assignee, a manager and a final approver; move through a fixed state
machine with a ledger; are visible to subcontractors only for their own
company; and go out by email and PDF per company.

## Model

| Table | Purpose |
| --- | --- |
| `PunchItem` | `number` / `ref` (PL-001…, per project), `title`, `description`, `status`, `priority` (low / normal / high / urgent), `trade`, `activityId`, `locationId` + `locationText` (exact spot), `sheetId` (drawing it was raised on), `assigneeCompanyId`, `assigneeUserId`, `managerUserId`, `finalApproverUserId`, `ballInCourtUserId` (derived), `dueDate`, `openedAt` / `readyAt` / `closedAt` / `closedBy`, `reopenCount`, `disputeReason`, `distributedAt`, `legacyDefectId`. |
| `PunchItemEvent` | Append-only ledger: `action` (created, opened, ready_for_review, closed, reopened, disputed, dispute_resolved, voided, updated, distributed…), `fromStatus` → `toStatus`, `reason`, `actorId` / `actorRole`, `metadataJson`. |

The migration copies every `DefectRecord` into a `PunchItem`
(`legacyDefectId` set; severity → priority; open / closed status), moves
its attachments, pins, comments, subscriptions and activity links over to
`punch_item`, so the day-one list is the old register. The legacy defect
tab stays reachable under **Legacy defect register** in the module.

## State machine

```
draft ──open──▶ open ──ready_for_review──▶ ready_for_review ──close──▶ closed
                 │  ▲                          │      ▲                   │
                 │  └────────reopen────────────┘      └──────reopen───────┘
                 │  (reason)                                  (reason, reopenCount++)
                 ├──dispute (reason)──▶ in_dispute ──resolve_dispute──▶ open
                 └──close (no approver set, or by the approver)──▶ closed
any but closed ──void (reason)──▶ void
```

* Ball in court: draft → creator; open → assignee (else manager); ready →
  final approver (else manager); in dispute → manager (else creator);
  closed / void → nobody.
* When a final approver is set, only that user can close (409
  `PUNCH_FINAL_APPROVER_ONLY` otherwise). Reopen, dispute and void need a
  reason (`PUNCH_REASON_REQUIRED`). Illegal moves are
  `PUNCH_TRANSITION_INVALID`.
* Closed and void items are read-only (`PUNCH_ITEM_LOCKED`); drafts can be
  deleted, anything that was opened must be voided.
* Every transition writes a ledger row and an audit event, and notifies:
  opening → assignee, manager and every active project member of the
  responsible company (`assignment`); ready → final approver, manager,
  creator (`approval`); close / reopen / dispute / void → the people on
  the item (`quality`).

## Permissions (`shared/permissions.json` › `punch`)

| Action / transition | Base roles | Party roles |
| --- | --- | --- |
| read | all | owner, consultant, contractor, subcontractor (scoped) |
| create | pm, planning_eng, site_engineer, qs | consultant, contractor |
| update | pm, planning_eng, site_engineer | contractor, subcontractor |
| delete (drafts) | pm | — |
| submit (`punch.open`, `punch.ready_for_review`, `punch.reopen`, `punch.dispute`, `punch.distribute`) | pm, planning_eng, site_engineer | consultant: open / close / reopen; contractor: open / ready / dispute / distribute; subcontractor: ready / dispute |
| approve (`punch.close`, `punch.void`) | pm | consultant: `punch.close` |
| export | pm, planning_eng, site_engineer, qs, cost_controller | owner, consultant, contractor, subcontractor |

Users who join through a project party (`req.projectAccess.scope ===
"party"`) only see items where `assigneeCompanyId` is one of their
companies, or that they raised, or that are assigned to them
(`visibilityWhere`). The PM and internal roles see everything.

## API (`/api/v1/projects/{id}/punch`, OpenAPI tag "Punch List")

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/punch` | Filters: `status` (value, comma list, `all`; default hides void), `assigneeCompanyId`, `assigneeUserId`, `managerUserId`, `finalApproverUserId`, `ballInCourtUserId` (id or `me`), `locationId` (subtree), `sheetId`, `trade`, `priority`, `overdue`, `search`, `limit`. Returns `items` + `summary` (`total`, `open`, `overdue`, `byStatus`, `byCompany`, `byTrade`). |
| POST | `/punch` | Create; `status: "open"` opens immediately. |
| POST | `/punch/bulk` | Up to 100 `items` with shared `defaults`. |
| GET | `/punch/{itemId}` | Item with `events` ledger, attachments, activity links, history. |
| PATCH | `/punch/{itemId}` | Edit (not when closed / void); assignment changes re-notify and move the ball. |
| POST | `/punch/{itemId}/transition` | `{ action, reason }` — see the state machine. |
| DELETE | `/punch/{itemId}` | Drafts only. |
| POST | `/punch/distribute` | `{ itemIds?, companyIds?, userIds?, message? }` → emails each recipient their items (company members get every open item for their company when `itemIds` is empty), in-app notifications, `distributedAt`, ledger `distributed`. |
| GET | `/punch/export.pdf` | Same filters + `groupBy` (company / location / none) + `includePhotos` (JPEG evidence, ≤ 2 per item, ≤ 40 total). Landscape A4, one section per group, repeated table header, page numbers. Rendered by `backend/src/utils/pdf-writer.js` (no dependencies). |
| GET | `/punch/export.csv` | Same filters. |
| GET | `/drawings/sheets/{sheetId}/qr.svg` | QR label (`backend/src/utils/qr.js`, byte mode, EC-M, v1–10) encoding `${WEB_APP_URL}/projects/{id}/quality/defects?source=sheet_qr&recordId={sheetId}`. |

Punch items also take part in comments / mentions / subscriptions
(`punch_item`), attachments and photos, drawing pins (`PIN_TARGETS.punch_item`
— a pin can raise an item on the spot), due-date reminders
(`notification.service.DUE_RECORDS.punch_item`) and audit history.

## UI

* **Quality › Punch list** (`/projects/{id}/quality/defects`): summary
  cards (items, open, ready for review, overdue, in dispute) and per-company
  chips; filters for text, status, company, location, priority, *waiting on
  me*, *overdue*; group by company / location / none; row checkboxes; **Send
  list** (selected items or every open item for the chosen companies, with
  a message), **Export** (PDF per company, by location, with photos; CSV),
  **New item** (one item, or *many at once* — one title per line with shared
  defaults; open now or save as draft).
* **Item dialog**: fields, the next steps the status allows and the caller
  may take (close is disabled for anyone but the final approver), reason
  prompt for reopen / dispute / void, edit, delete draft, *what happened*
  ledger, pins on drawings, evidence, discussion, history.
* **Drawings**: each sheet card has a **QR label** (print / copy link);
  scanning it opens the punch list filtered to that sheet with quick-create
  pre-filled. The pin dialog offers *Raise a punch item here* and *Link a
  punch item*.
* Deep links: `?recordId=<itemId>` opens the item; `?source=sheet_qr&recordId=<sheetId>`
  opens quick-create for the sheet. Notifications and comment links use
  `/quality/defects?recordId=`.

## Set-up

* Run the migration (`npx prisma migrate deploy`).
* Set `WEB_APP_URL` (or `FRONTEND_URL`) so QR codes and distribution emails
  point at the right host.
* Email delivery uses the existing `email.service` configuration; without it
  recipients are recorded with `delivered: false` and the reason.

## UAT

1. As a site engineer create an item with a responsible company, assignee
   and final approver, *open now*. The assignee and the company's project
   members get an assignment notification; the ball is with the assignee.
2. Sign in as a subcontractor member of that company: only that company's
   items are listed; **Ready for review** works, **Close** is not offered.
3. As the PM (not the final approver) try to close: the button is disabled
   with the approver's name; the API returns 403 `PUNCH_FINAL_APPROVER_ONLY`.
   As the final approver, close it — ledger shows ready_for_review → closed.
4. Reopen with a reason: `reopenCount` becomes 1, status open, assignee
   notified.
5. Create 5 items with *many at once* for one company; **Send list** with
   the company ticked: each member receives one email listing the items;
   `distributedAt` set, ledger `distributed`.
6. Export PDF per company: one section per subcontractor, header repeated
   across pages; with photos, JPEG evidence appears under the rows.
7. Print a sheet QR, scan it on a phone: the punch list opens with the sheet
   filter and quick-create pre-filled; the created item shows the drawing.
8. Drop a pin on the sheet › *Raise a punch item here*: the item is created
   open with the sheet set and appears under *On drawings*.
