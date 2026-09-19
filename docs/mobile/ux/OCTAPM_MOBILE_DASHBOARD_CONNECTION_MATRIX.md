# OctaPM Mobile — Dashboard Connection Matrix

**Audience:** the reviewer holding the §74 hard gate, and whoever implements UX2-K.
**Date:** 2026-09-19. **Status:** design plus measured baseline. Rows marked *measured* were timed live in the certification phase and are recorded in the [propagation report](../OCTAPM_MOBILE_WEB_MOBILE_PROPAGATION.md); rows marked *design* are what UX2-K must prove.

## 1. The premise

There is one record, not two. The app has no database of its own, no second permission model and no separate write path — it calls the same Express API and the same PostgreSQL rows as the web platform. So nothing is ever "synced to the dashboard": the only question is **how soon an already-open screen notices**, and whether the mobile UI ever *claims* a number it computed itself.

**§52 is therefore a rule about the UI, not the plumbing:** mobile sends events and records; the server derives every KPI; the dashboard reads the server. The app must never post a computed KPI, and must never render a figure it calculated locally as if it were project truth. The one place this was violated — an approval screen that could not show the value the server had already sent — was closed in the previous phase.

## 2. Propagation classes

| Class | Meaning |
|---|---|
| REALTIME | the open screen shows it within 5 s, no reload |
| NEAR REALTIME | within 20 s, no reload |
| REFRESH REQUIRED | after a reload, pull-to-refresh, or leaving and returning |
| IMMEDIATE (same record) | no propagation involved — the other side reads the row the writer just created |
| STALE | not shown even after a reload |

## 3. Mobile → office

| Mobile action | Backend record | Web module | Dashboard effect | Needs You | Notification | Cost | Schedule | Quality | Audit | Class |
|---|---|---|---|---|---|---|---|---|---|---|
| Progress update | `progress_submission` → activity `actual`/`pct` | Schedule | health, forecast SPI/slip, activity status | approver | assignee | via earned value | **yes** | — | yes | REALTIME *measured 869 ms* |
| Daily report submit | `daily_log` + its six sections | Site Reporting | today-on-site totals, manpower, plant, deliveries | approver | distribution list | — | — | — | yes | *design* |
| Site photo | `ProjectDocument` + `Attachment` + `Photo` | Photos / the record | project gallery; **new** latest-photos surface | — | — | — | — | — | yes | *design* |
| RFI raised | `rfi` | Doc Control / RFI | open-RFI count, health quality dimension | assignee, ball in court | assignee | — | if it blocks | — | yes | REALTIME *measured 972 ms (answer back)* |
| Inspection completed | `form_instance` | Quality | quality dimension, ITP progress | reviewer | reviewer | — | — | **yes** | yes | *design* |
| NCR raised / closed out | `ncr` | Quality | open NCRs, quality score | assignee, approver | assignee | potential | potential | **yes** | yes | REALTIME *measured 901 ms* |
| Punch item | `punch_item` | Quality | punch counts by trade | assignee | assignee | — | — | **yes** | yes | *design* |
| Safety observation | `safety_incident` | Quality/Safety | safety counts | assignee | assignee | — | — | yes | yes | *design* |
| Material receipt | goods receipt → `InventoryMovement` + PO received qty | Inventory, Procurement | stock, outstanding PO qty | — | — | — | — | — | yes | REALTIME *measured 154 ms* |
| Material issue | `InventoryMovement` → **Cost Ledger** | Inventory, Cost Control | **actual cost**, cost KPI, activity `actual` | — | — | **yes** | — | — | yes | REALTIME *measured 159 ms; web immediate* |
| Task completed | `task` | Tasks | open-task counts | assigner | assigner | — | — | — | yes | REALTIME *measured 876 ms* |
| Change event raised | `change_event` | Commercial | commercial exposure | QS, PM | QS | potential | potential | — | yes | IMMEDIATE *measured 48 ms* |
| Approval answered | workflow step → record transition | the record's module | whatever the record drives | next approver | next approver | if commercial | if schedule | if quality | yes | REALTIME *measured 724 ms to inbox* |
| Delay recorded | daily-log `delays` / `weather_delay` | Site Reporting, EOT | hours lost, EOT exposure | — | — | — | potential | — | yes | *design* |

## 4. Office → mobile

| Web action | Reaches mobile as | Class |
|---|---|---|
| Task assignment | Needs You row + push | REALTIME *measured 876 ms* |
| RFI response | the open RFI record updates | REALTIME *measured 972 ms* |
| NCR assignment | Needs You + the NCR list | REALTIME *measured 901 ms* |
| NCR edit **without** a status change | the open record | **REFRESH REQUIRED** — server publishes no event (SRV-03) |
| PO issued | the storekeeper's delivery view | *design* |
| Drawing revision | the drawing register and the "superseded" warning | *design* |
| Approval request | Needs You + push | REALTIME *measured 724 ms* |

## 5. The three server event gaps

These are why some rows above are refresh-required rather than realtime. They are **server-side and deliberately untouched** — this phase changes the UI, not the platform's event model.

| Gap | Where | Effect |
|---|---|---|
| Stock movements publish no domain event | `inventory.service.js` (`postMovement`) | receipt and issue rows met the 5 s bar because those screens refetch on mount and focus, not because an event arrived |
| A workflow step response and a step assignment publish no event; only the final decision does | `workflow-engine.service.js` | the approvals inbox is refresh-required between steps (SRV-02) |
| An NCR assignment or field edit without a status change publishes nothing | `ncr.service.js` | the open NCR record does not refetch on its own (SRV-03) |

Where a row is refresh-required, **the UI must say so** rather than look live: every list and record already carries a freshness line with the age of what is shown, and pull-to-refresh works everywhere. That honesty is a requirement of §53, not a workaround.

## 6. What UX2-K must prove — the §74 hard gate

The phase is not complete until each of these is demonstrated live against the running API, in the dedicated end-to-end organisation, reading the result back from the server and from the web surface rather than from the app's own state:

**Mobile-originated:** progress · daily report · RFI · quality (inspection, NCR, punch) · material receipt · material issue · task · photo · change event · approval.

**Web-originated reaching mobile:** task · RFI response · NCR assignment · PO/delivery · drawing revision · approval request.

And the §75 financial safety check, unchanged from the certified baseline: after a material issue and a commercial approval, reconcile expected against SQL against API against web against mobile. **Delta 0.00. No duplicate ledger entries. No duplicate stock movements.**

## 7. The web additions this permits (§51)

Only additive views of data that already exists, on the existing dashboard — no desktop redesign:

Latest site photos · Today's site summary · Latest daily report · Site manpower · Today's deliveries · Open site issues · Field progress · Mobile-originated changes · Quality activity.

Each reads an endpoint that already serves the mobile app. None introduces a new store, and none accepts a KPI computed by a phone.
