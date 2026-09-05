# Commitments: subcontracts and purchase orders with a schedule of values (OCTA-FIN-COMMIT-020)

A QS issues a subcontract (or a purchase-order commitment) with a
schedule of values tied to cost codes, BOQ items and activities. Once
the signed agreement is on file the commitment is executed and its value
becomes committed cost on the budget lines and the activities, so the
cost-code budget, the activity view and later sub valuations agree.

## Model

| Table / column | Purpose |
| --- | --- |
| `Commitment` | `type` subcontract (`SC-nnn`) or purchase_order (`PC-nnn`), title, vendor (`vendorCompanyId` → org vendor, `projectPartyId` resolved to the vendor's active party, optional `supplierId`), status, currency, `retentionRate` (defaults to the project's), payment terms, dates, `insuranceJson`, `executedDocumentId` (ProjectDocument), submit / approve / execute / close stamps, `voidReason`. |
| `CommitmentSovLine` | Numbered lines: description, `costCodeId`, `budgetLineId`, `boqItemId`, `activityId`, unit, qty, rate, amount (explicit or qty × rate). |
| `CommitmentChangeOrder` | `SC-001-CO01` numbering, title, value (or Σ `linesJson`), status draft → pending → approved / rejected / void, optional `primeChangeOrderId`. |
| `BudgetLine.committedFromCommitments` | Posted committed cost; the manual `committed` figure only stands while nothing is posted. |
| `ProcurementOrder.commitmentId` | A PO can draw down a purchase-order commitment (`drawnDown` on the commitment). |

Derived per commitment: `original = Σ lines`, `approvedChanges = Σ approved
change orders`, `pendingChanges`, `revised = original + approvedChanges`,
`retentionOnRevised`, `drawnDown`, `insuranceReady`.

## Lifecycle

`draft → pending → approved → executed → closed`, plus `void` from any
non-executed state and *return to draft* from pending / approved with a
reason.

* **Submit** (`commitment.submit`: QS, procurement, PM; contractor party):
  needs at least one line and a vendor. PM notified.
* **Approve** (`commitment.approve`: PM). Title, retention and currency lock;
  the schedule of values locks — changes go through change orders.
* **Execute** (`commitment.execute`: PM, finance): the signed agreement is
  attached (`file` upload or an existing `documentId`); every required
  insurance cover must have a document and not be expired
  (409 `COMMITMENT_INSURANCE_MISSING` with the list), unless the caller can
  void commitments and overrides with a reason (recorded in the audit
  trail). Vendor party members, the originator and the cost roles are
  notified. **Committed cost is posted.**
* **Close** (`commitment.close`), **Void** (`commitment.void`, reason).

## Committed cost posting (`recomputeCommitted`)

Recomputed whenever a commitment enters or leaves executed / closed and
whenever a change order is approved on an executed commitment:

* each SOV line posts its amount to `budgetLineId` when set, else to the
  active budget line for its cost code and the commitment's cost type
  (subcontract → `subcontract`, purchase order → `material`);
* approved change-order lines post the same way; a change order without
  lines counts in the commitment's revised value only;
* per activity, Σ amounts land on `CostRecord.committed` (created when
  missing), so the activity cost view and EV inputs see the commitment.

`BudgetLine.committed` in the API becomes the posted value when it is
non-zero (`committedManual` and `committedFromCommitments` are both
returned).

## Change orders

* Created on a commitment directly, or spawned from a prime change order
  (`POST …/change-orders/from-prime { primeChangeOrderId, items[] }`) with
  the link kept on `primeChangeOrderId`.
* `commitment_co.submit` (QS, procurement, PM; contractor party) and
  `commitment_co.approve` (PM); rejection and void need a reason. Approval
  on an executed commitment reposts committed cost.

## Visibility

Subcontractor party users (`isPartyScopedAccess`) see only commitments
where the vendor is one of their companies (or that they created),
including the executed document and attachments (`attachment` record type
`commitment` maps to the `commitment` module). Their party template grants
`commitment: read, export`; contractor parties can create, update and
submit; owner and consultant parties read.

## Endpoints (`/api/v1/projects/{projectId}/commitments`)

`GET /` (type, status, vendorCompanyId, search, includeVoid + summary),
`POST /`, `GET/PATCH/DELETE /{commitmentId}`, `PUT …/lines`,
`PUT …/insurance`, `POST …/submit|approve|return|execute|close`,
`GET/POST …/change-orders`, `PATCH /change-orders/{id}`,
`POST /change-orders/{id}/submit|approve|reject|void`,
`POST /change-orders/from-prime`, `GET …/export.pdf` (statement with
values, schedule of values, change orders and insurance). Purchase orders
accept `commitmentId`. OpenAPI tag "Commercial" (400 documented paths).

## Frontend

Commercial › **Commitments**: summary cards (count, original, approved
changes, revised, committed from executed), filters (type, status,
search), a register with **Open**, and:

* **New commitment** — type, title, vendor (company list), retention,
  dates, terms, scope and an inline schedule-of-values editor (cost code,
  activity, qty, unit, rate, amount);
* **Commitment workspace** — status and type badges, an *Insurance
  outstanding* flag, value tiles, the actions the caller may take (submit,
  approve, return, execute with file + optional override, close, void,
  statement PDF), the schedule of values (editable until approved), change
  orders (new, submit, approve, reject, void), linked purchase orders,
  insurance requirements editor, notes, attachments, internal notes and
  history.

## Tests

* `backend/src/services/__tests__/commitment.service.test.js` — line
  validation, totals and insurance status, numbered creation with the
  vendor's party, party visibility, the lifecycle with the insurance gate
  and committed-cost posting, locked lines after approval, change orders
  spawned from a prime order and posting on approval, statement PDF.
* `frontend/scripts/commitments-ui.test.mjs` — hooks, panel, dialogs, tab
  wiring, permissions and the backend contract.
