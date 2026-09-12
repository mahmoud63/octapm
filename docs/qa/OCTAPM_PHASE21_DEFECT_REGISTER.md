# Phase 21 — defect register

Findings from the greenfield simulation, 2026-09-10. Closed entries stay here.

---

## P21-001 · P1 · Schedule · **FIXED**

| | |
| --- | --- |
| **Area** | Planning / schedule, cost dashboard, site reporting |
| **Persona** | Planning engineer, cost controller, site engineer |
| **Workflow** | Plan a project one activity at a time, then open the schedule |
| **Observed** | 14 activities existed with CPM computed and stored. The Gantt, Critical Path and Activities screens all rendered the "Upload BOQ or Activity Spreadsheet" prompt. The module bar read **"Activities (0)"**, "Critical Path (0)", "Milestones (0)". The cost dashboard did not render at all and site reporting was handed an empty activity list. |
| **Expected** | A schedule that was planned in the product is visible in the product. |
| **Root cause** | **PRODUCT DEFECT.** `getProjectSchedule` returned `null` when the project had no `ScheduleRevision`. A revision is written only by a P6/MSP import (`import.service.js:277`) or an AI generation (`schedule.service.js:1943`) — never by `POST /projects/:id/activities`. `project-detail.tsx` gates the schedule module, the cost module and site reporting on that payload. |
| **Data integrity impact** | None — the activities and their CPM were correct throughout. The data was unreachable, not wrong. |
| **Financial impact** | Indirect: the cost dashboard was unavailable on any project planned this way. |
| **Security impact** | None. |
| **Fix** | The revision records where a schedule came from; the activities are what is on the programme. When there is no stored revision, the summary is derived from the activities — counts computed rather than remembered. An imported revision still reports its own recorded totals; a project with no activities still reports no schedule. |
| **Regression test** | `backend/src/services/__tests__/schedule-planned-in-product.test.js` — 7 cases. **Failed 5 of 7 before the fix**; the two that passed are the two that should (empty project → null, imported revision keeps its totals). |
| **Status** | **CLOSED** |
| **Commit** | `2176859` |
| **Evidence** | Before: schedule screen showing the upload prompt with "Activities (0)". After: **TOTAL ACTIVITIES 14 · CRITICAL PATH 12 · MILESTONES 1** — and 12 is exactly the hand-computed critical chain. |

---

## P21-002 · P2 · Environment · **FIXED**

| | |
| --- | --- |
| **Area** | Local test environment |
| **Observed** | Two Vite dev servers running: `:5173` and a leftover on `:5174`. |
| **Root cause** | **ENVIRONMENT DEFECT.** An orphaned `npm run dev` tree from an earlier session. Notably, `config/security.js` on `main` had added 5174 and 5175 to the development CORS origins — consistent with duplicates being routine. |
| **Impact** | A second instance can serve a different module graph; the Phase 21 brief requires exactly one. |
| **Fix** | The duplicate tree was killed. One Vite on `:5173`, one API (pid 20168 → restarted), one PostgreSQL cluster (postmaster 20848 with 42 worker processes, **not** 43 clusters). |
| **Status** | **CLOSED** (environment, no code change) |

---

## P21-003 · P3 · Documentation · OPEN

| | |
| --- | --- |
| **Area** | OpenAPI |
| **Observed** | `POST /projects/{projectId}/activities` documents no required fields, but the route enforces `engineerIds` with "At least one engineer required". |
| **Expected** | The document says what the API demands. |
| **Root cause** | **DOCUMENTATION DEFECT.** |
| **Impact** | A client written from the specification fails at runtime. The mobile team consumes this same document. |
| **Fix** | Not applied — recorded. |
| **Status** | OPEN |

---

## P21-004 · P3 · Documentation · OPEN

| | |
| --- | --- |
| **Area** | OpenAPI |
| **Observed** | `POST /projects/{projectId}/procurement/purchase-orders` documents `status` as `planned\|draft\|issued\|partial\|received\|closed`. The validator accepts only `planned` and `draft`; the rest are lifecycle states reached through `submit` / `approve` / `issue`. |
| **Root cause** | **DOCUMENTATION DEFECT.** |
| **Impact** | A caller following the document gets `400 VALIDATION_ERROR` with no indication which value is wrong. |
| **Status** | OPEN |

---

## P21-005 · P3 · Security posture · OPEN (observation)

| | |
| --- | --- |
| **Area** | Middleware ordering |
| **Observed** | An outsider tenant's write attempts against this project return `402 SUBSCRIPTION_REQUIRED` — the subscription gate answers before the project-access check. |
| **Investigated** | Whether this discloses anything. It does not: a **real** project and a **non-existent** one return byte-identical refusals on PATCH, POST /team and DELETE, and reads return `404 PROJECT_NOT_FOUND` for both. Nothing was disclosed and nothing was modified — the project survived the attack unchanged. |
| **Root cause** | **NOT A DEFECT.** Defence-in-depth ordering. |
| **Recommendation** | None required. Recorded so a future reader does not mistake the 402 for a hole. |
| **Status** | OPEN as an observation |

---

## P21-006 · P3 · RBAC · OPEN (business question)

| | |
| --- | --- |
| **Area** | Inventory |
| **Observed** | A **site engineer** may post `POST /inventory/stock/issue` (200), the same as a storeman. |
| **Expected** | Unclear — this is a business decision, not obviously a bug. On many sites the engineer draws material; on others only the storekeeper may. |
| **Root cause** | **EXPECTED BUSINESS RULE**, pending confirmation. |
| **Financial impact** | A material issue posts project actual cost, so whoever may issue can move the cost ledger. |
| **Status** | OPEN — needs a decision from the product owner, not a code change from me. |

---

## Test defects found in my own instruments

Recorded because Phase 20 established that a test which cannot fail is worse
than no test.

| # | what was wrong | how it was caught |
| --- | --- | --- |
| T-01 | The actual-cost helper read `recon.totals.*`, which does not exist. Every "actual cost is 0" check passed **vacuously** against an empty object. | The figure stayed 0 after a material issue that should have posted 660.00. Replaced with `readLedger`, which reads `ledger.total`, `bySource`, both projections and the service's own `balanced` flag. |
| T-02 | An authorisation probe posted a real stock issue, moving the very ledger the stage was proving (660.00 → 671.00). | The next stage's opening balance was 11.00 too high. Authorisation probes moved to stage 7, after the financial assertions, and stage 7 asserts the ledger moved by exactly `bags × 11.00`. |
| T-03 | The tenant-isolation attack used a seeded user from another organisation whose password is not the demo one. Every call returned `401`, which the check did not count as a refusal — and it reported as a **cross-tenant leak**. | Verified before reporting. The outsider is now a tenant registered through the product's own sign-up, and a `401` now throws rather than passing or failing quietly. |
| T-04 | Stages were not re-runnable: repeat runs duplicated warehouses, receipts and issues, compounding the stock figures. | 239 bags where 150 were expected. Stages now find-or-create, and the certifying figures come from a single clean run on a fresh project. |

---

# Phase 21B additions

## P21-007 · P2 · Schedule · OPEN

| | |
| --- | --- |
| **Area** | Schedule baseline |
| **Persona** | Planning engineer |
| **Workflow** | Plan in the product, then try to lock a baseline |
| **Observed** | The schedule screen reports *"Schedule Approval: No schedule revision is available"* as a baseline blocker, and the baseline cannot be locked. |
| **Expected** | A schedule planned in the product should be baselineable. |
| **Root cause** | **PRODUCT DEFECT, introduced as a consequence of the P21-001 fix.** That fix synthesises a revision for display when none is stored. Display is now correct, but there is no persisted revision to baseline, approve, or list under Revisions. |
| **Data integrity impact** | None. Nothing is wrong; a capability is absent. |
| **Financial impact** | None directly — but no baseline means no baseline variance reporting. |
| **Security impact** | None. |
| **Fix** | Not applied. The honest fix is to persist a revision the first time a project is planned in-product (source `in_product`), rather than synthesising one on read — which would also make Revisions and baseline work unchanged. That is a bigger change than Phase 21 should make without discussion. |
| **Regression test** | None yet. |
| **Status** | OPEN |
| **Evidence** | Browser, planner persona: "Baseline setup blockers — Schedule Approval: No schedule revision is available." |

## P21-008 · P3 · RBAC · OPEN (business question)

| | |
| --- | --- |
| **Area** | Commercial module visibility |
| **Observed** | A **planning engineer** can open the commercial module, see Approved VOs $250,000 and the full change-order history, and is offered an "Add Change Order" button. |
| **Expected** | Unclear. Planners legitimately need to see the schedule impact of variations; whether they should be offered to raise one is a business decision. |
| **Root cause** | **EXPECTED BUSINESS RULE**, pending confirmation. |
| **Note** | The API refuses a *site engineer* approving a change order (403), so approval is gated. This is about visibility and the create affordance, not approval. |
| **Status** | OPEN — needs a product-owner decision. |

## Verified-by-attack behaviours (positive findings)

Recorded because they were confirmed by trying to break them, not by reading code.

| behaviour | evidence |
| --- | --- |
| An approved change order is immutable | reopen / disapprove / reject all `409 APPROVAL_WORKFLOW_INVALID_TRANSITION`; edit `409 CHANGE_ORDER_APPROVED_LOCKED` |
| The same supplier invoice cannot be booked twice | `409 DIRECT_COST_DUPLICATE_INVOICE`, naming the existing record |
| A variation needs written impact, linked activities and an attachment before approval | `400 CHANGE_ORDER_IMPACT_SUMMARY_REQUIRED`, then `400 CHANGE_ORDER_IMPACT_PROOF_REQUIRED` |
| A subcontract cannot be executed without the signed agreement | `400 COMMITMENT_DOCUMENT_REQUIRED` |
| An activity cannot exist with nobody responsible | `engineerIds` — "At least one engineer required" |
| A draft BOQ allocation earns nothing | EV was 0.00 until the five allocations were submitted and approved |

## Further test defects in my own instruments

| # | what was wrong | how it was caught |
| --- | --- | --- |
| T-05 | Stages were not idempotent across change orders. A repeated run approved a **second** 125,000.00 variation, and approved variations cannot be reversed — so Revised Budget is 1,950,000.00 rather than the 1,825,000.00 the brief suggested. | The absolute assertion failed. The stage is now find-or-create, and the arithmetic is asserted as an identity rather than a fixed total, because the fixed total stopped being true. |
| T-06 | The EV movement check assumed A130 started at 0%. A prior run had already progressed it, so the check double-counted. | Expected 120,000.00, got 97,500.00. Now reads the current percentage and asserts the delta from it. |
| T-07 | **TEST DATA DEFECT.** Transactions were dated 2027 (the project's construction year) while the clock says 2026-09-10, so the EV report legitimately excluded 68,500.00 of cost from AC-to-date. | The EV report's AC (704.00) disagreed with the ledger (69,204.00). Investigated before classifying: the report documents `actualThroughDate <= cutoffDate`, and the difference is now asserted exactly rather than treated as a discrepancy. **Not a product defect.** |

---

# Phase 21C additions

Two P1s were found and fixed in this stage; both are covered by regression
tests that were shown to fail without the fix. Everything else found is P2 or
P3 and is documented, not fixed, per the brief.

## P21-009 · P1 · Cash flow · **FIXED**

| | |
| --- | --- |
| **Area** | Client billing → cash flow |
| **Persona** | Finance |
| **Workflow** | Certify IPC-01 → issue the client invoice → record the client's 80,000.00 payment → read cash flow |
| **Observed** | Cash flow showed **inflow 0.00** after the payment was recorded. Cash out from the subcontractor payment (54,000.00) was present; the receivable side was not. |
| **Expected** | A recorded client payment is an inflow. |
| **Root cause** | **PRODUCT DEFECT.** Cash flow is a materialised projection rebuilt on demand; `recordIpcPayment` wrote the payment and returned without rebuilding it, so the inflow appeared only after somebody called `POST /cash-flow/rebuild`. The subcontractor path rebuilds; the client path did not. |
| **Financial impact** | Cash-flow reporting understated inflows by every client payment until the next unrelated rebuild. No ledger or budget figure was wrong. |
| **Security impact** | None. |
| **Fix** | `backend/src/services/ipc.service.js`: after the payment transaction commits, `rebuildCashFlow({ orgId, projectId })` runs; a rebuild failure is logged and does not roll back the payment (the payment is the fact; the projection is derived). Commit `c8f0be5`. |
| **Regression test** | `backend/src/services/__tests__/ipc-payment-cash-flow.test.js` — 3 cases; 2 of 3 fail with the fix removed. |
| **Verified** | Stage 10: inflow 0.00 before, **80,000.00** after; snapshot: cash in 80,000.00 (36 / 36). |
| **Status** | FIXED |

## P21-010 · P1 · RBAC · **FIXED**

| | |
| --- | --- |
| **Area** | Authorisation on ten project routers |
| **Personas** | Storeman, finance, procurement — and anyone else on the project |
| **Workflow** | Stage 15: a storeman issued a transmittal (200); a site engineer closed a client letter (200). |
| **Observed** | `drawings`, `transmittals`, `correspondence`, `itp`, `defects`, `material-tests`, `budget-revisions`, `cash-flow`, `sub-valuations` and `weather-delays` were mounted behind project membership only. Any member of any role could create, change or delete those records. `shared/permissions.json` says which roles may; the neighbouring routers (drawing sets, sheets, NCR, budget, sub pay apps) enforce it. |
| **How it was found** | `rbac-audit.js`: every project-nested prefix, as two roles the policy denies, with a body that cannot pass validation. A present guard answers **403** before validation; a missing one answers **400** or a **404 …_NOT_FOUND** — the request got through the door. 22 of 108 probes got through; all on those ten routers. |
| **Root cause** | **PRODUCT DEFECT** — the routers were written without `requirePermission`. |
| **Data integrity impact** | Intra-tenant: a role the policy excludes could alter or delete quality and document-control records. Tenant isolation was not affected (the outsider was refused everywhere). |
| **Security impact** | Authorisation gap inside a tenant. |
| **Fix** | Each route now carries `requirePermission` with the module the policy already names for it — `document_control` (drawings, transmittals, correspondence), `inspection` (ITP, material tests), `punch` (defects), `cost` (budget revisions, cash flow), `sub_pay_app` (sub valuations), `eot` (weather delays). Delete follows the neighbouring convention: `document_control` and `eot` have no delete row, so their delete routes take `update` (as drawing sets do). 41 routes. Commit `935d500`. |
| **Regression test** | `backend/src/routes/__tests__/project-route-guards.test.js` — 87 cases through the real RBAC middleware: every route as a denied role (403 FORBIDDEN) and an allowed role (through the door), plus a coverage check that fails if a route is added to one of these routers without a case. With `itp.js` reverted to its unguarded form: **5 of 87 fail**. |
| **Verified** | `rbac-audit.js` after the fix: **2 of 108** through the door, both on `comments` — which every role may use by design (`meeting.comment`, `task.comment` list all eight roles). Stage 15 re-run: 24 / 24. Full Jest: 2,005 / 2,005. |
| **Status** | FIXED |

## P21-011 · P2 · Deep links · **FIXED**

| | |
| --- | --- |
| **Area** | Record-level deep links from the quality module |
| **Observed** | `…/quality/itp?recordId=<itp id>&source=itp` opens a dialog and fetches `GET /projects/{id}/forms/<itp id>` → **404**; `…/quality/defects?recordId=<defect id>&source=defect` opens a dialog and fetches `GET /projects/{id}/punch/<defect id>` → **404**. The link resolves to the right module and then treats the id as a different record type (form instance; punch item). |
| **Expected** | The ITP or defect the id names opens. |
| **Root cause** | **PRODUCT DEFECT.** `record-links.js` maps `itp` and `form_instance` to the same workspace (`quality/itp`) and `defect` and `punch_item` to the same (`quality/defects`); the pages open by id assuming one of the two types. |
| **Impact** | A notification or comment link to an ITP or a defect lands on an error dialog. |
| **Fix** | The branch is by `source`, which the link already carries. `?source=itp` opens the legacy ITP register on that record and fetches no instance; `?source=defect` opens the legacy defect register on that record and fetches no punch item; `punch_item`, `observation`, `sheet_qr` and instance links are untouched. `WorkflowRecordList` gained `initialSelectedId` (selects the named row on first render, scrolls it into view once the rows are in, and marks every row `data-selected`); the two modules open their legacy register when the link names a legacy record; the quality dashboard hands the id through. Four files, 50 lines. |
| **Regression test** | `frontend/e2e/33-quality-deep-links.spec.ts` — creates an ITP, a defect and a punch item on the seeded project, opens each deep link as the PM, asserts no request for the wrong record type and no 404, the named row selected, and the punch-item link still opening its dialog; retires all three and fails if it cannot. **Without the fix 2 of 3 fail** (the wrong-type fetches are observed); with it 3 / 3. The source-reading UI tests (`scripts/inspections-ui.test.mjs`, `scripts/punch-ui.test.mjs`) assert the branches. |
| **Verified** | Stage 19 regrade: `itp` and `defect` now RECORD OPENED (inline, selected row), no 404s anywhere; targeted regression (user smoke, ball-in-court UI, needs-you, spec 33) 13 / 13; typecheck green; lint 0 errors on the changed files. |
| **Status** | FIXED |

## P21-012 · P3 · Change orders · OPEN

| | |
| --- | --- |
| **Observed** | `POST` and `PATCH /change-orders` accept `budgetLineId` (validated as a UUID) and discard it. Every approved variation on the project — including VO-22, which named budget line 01-100 on create **and** on update — sits on the product-created holding line "CO / Unassigned approved changes" (254,500.00). |
| **Expected** | Either the field is honoured, or it is not offered. |
| **Root cause** | **PRODUCT DEFECT** (contract), with a working fallback: the holding line keeps the Revised Budget identity exact. |
| **Impact** | Approved changes cannot be placed on a budget line through the API; the Revised Budget total is right, its distribution is not. |
| **Status** | OPEN |

## P21-013 · P3 · Persona UX · OPEN

| | |
| --- | --- |
| **Observed** | The sidebar offers **Users** and **Company** to every role. For cost controller, procurement, storeman, site engineer and finance, `GET /users` answers **403** and the page renders *"Engineers — No engineers yet."* — a refusal shown as an empty list. |
| **Expected** | Either the link is not offered, or the page says it is not theirs. |
| **Root cause** | **PRODUCT DEFECT** (UX). |
| **Status** | OPEN |

## P21-014 · P3 · Console hygiene · OPEN

| | |
| --- | --- |
| **Observed** | Every page load, every persona: one `401 GET /auth/me` in the console before the session is established. On their own module pages, cost controller, procurement, site engineer and finance also produce `403 GET /projects/{id}/parties` — the page asks for a list the role may not read. |
| **Impact** | Console noise on every page; a console gate that forbids 4xx would fail on a healthy session. |
| **Root cause** | **PRODUCT DEFECT** (request ordering / role-unaware fetch). |
| **Evidence** | `persona-browser.json` → `ownPage.failedRequests` for all eight personas. |
| **Status** | OPEN |

## P21-015 · P3 · Deep links · OPEN

| | |
| --- | --- |
| **Observed** | 26 record deep links graded after the P21-011 fix (the 25 from before, plus the second ITP, so that one of the two cannot be the register's default first row): **12 open the record** (submittal, RFI, punch item, observation, purchase order, commitment, pay app, bid package, direct cost, timesheet, and now ITP-001 and ITP-002, each selected inline), **9 land on the register with the record's row visible but no detail opened** (transmittal, NCR, meeting, task, change order, location — and correspondence, defect and safety, whose registers on this project hold a single record, so a selected row there proves nothing about the link; the defect fix is proven by `33-quality-deep-links.spec.ts`, which selects each of two defects by id), **5 land on the module home with no sign of the record** (drawing, daily log, weather delay, procurement package, IPC), and **0 open the wrong record type**. `WorkflowRecordList` now takes the named record; the NCR, safety, transmittal and correspondence registers could pass it the same way. |
| **Expected** | A record-level deep link opens the record. A module-home URL is not a record deep link. |
| **Root cause** | **PRODUCT DEFECT** (incomplete): the `?recordId=&source=` contract exists and several modules honour it; the rest do not yet. |
| **Status** | OPEN |

## P21-016 · P3 · Procurement read model · OPEN

| | |
| --- | --- |
| **Observed** | `GET /purchase-orders/{id}` does not carry `packageId`; the register row does. A package stays `tendering` after its bid is awarded and its PO raised. |
| **Root cause** | **PRODUCT DEFECT** (read model / status). |
| **Status** | OPEN |

## P21-017 · P3 · OpenAPI · OPEN

| | |
| --- | --- |
| **Observed** | `POST /direct-costs` accepts `purchaseOrderId` and line `poLineId` and the 3-way match depends on them; OpenAPI documents neither, nor `poLineId` on the invoice read. `POST /change-orders` documents `budgetLineId`, which is discarded (P21-012). |
| **Root cause** | **DOCUMENTATION DEFECT.** |
| **Status** | OPEN |

## P21-018 · P3 · Procurement UX · OPEN

| | |
| --- | --- |
| **Observed** | Purchase-order register, procurement persona: the "Waiting on you" card says **0 to approve · 0 unconfirmed** while PO-00001's row says **Your action** (a draft awaiting the procurement manager's own submit). |
| **Root cause** | **PRODUCT DEFECT** (UX): the card counts approvals, the row counts any action. |
| **Status** | OPEN |

## P21-019 · P3 · Quality score · OPEN (business question)

| | |
| --- | --- |
| **Observed** | `qualityScore = 100 − 20·majorNCRs − 8·minorNCRs − 15·failedITPs` counts NCRs **raised**, not NCRs **open**: closing and approving NCR-001 left the score where it was. |
| **Expected** | The stated rule (CLAUDE.md) does not say; a quality score that never recovers is a product decision to confirm. |
| **Root cause** | **EXPECTED BUSINESS RULE**, pending confirmation. |
| **Status** | OPEN |

## Verified-by-attack behaviours added in 21C

- Prequalification gates the RFQ: an unqualified vendor cannot be invited (`PREQUAL_NOT_QUALIFIED`) and an ad-hoc bidder cannot be confirmed without a written override (`PREQUAL_AWARD_BLOCKED`, then `prequalOverrideReason`).
- A converted RFI cannot be converted twice (`409 RFI_ALREADY_CONVERTED`).
- NCR and safety closeouts refuse without evidence (`NCR_CLOSEOUT_EVIDENCE_REQUIRED`, `SAFETY_CLOSEOUT_EVIDENCE_REQUIRED`); the raiser cannot approve their own closeout.
- A punch item is closed by the PM alone; reopening needs a reason (`PUNCH_REASON_REQUIRED`).
- A rejected submittal cannot be approved until resubmitted and re-reviewed; a storeman cannot decide it.
- A storeman sees only the current approved drawing revision — never the one in review, never the superseded one.
- An approved daily log cannot be edited; the site engineer cannot approve their own day; the planner cannot approve it either.
- A worker cannot be timesheeted for more than 24 h in a day.
- A supplier invoice for stocked goods posts **no** second cost (delta 0.00); the price variance on PO-B is detected, not accepted (`price_variance`, blocking).

## Further test defects in my own instruments (21C)

| id | what was wrong | consequence, and what was done |
| --- | --- | --- |
| T-08 | The 21A change-order stage never verified that the instruction it uploaded was attached, and passed `budgetLineId` without checking it stuck. | The holding line's existence surprised the snapshot. Now asserted (P21-012). |
| T-09 | Stage 14's "a converted change starts as a draft" was asserted on every run, including the one where the change was already approved. | Failed on the idempotent re-run. The status at creation is recorded once and asserted from the record. |
| T-10 | Stage 16 looked NCRs up by `title` — a field the product does not store (an NCR's identity is its `description`). The second run raised **NCR-002**, closed it out and had it approved before the mistake was seen. | An approved record is not deleted to tidy a test. NCR-002 is **named** in the stage as the T-10 duplicate, a third copy fails loudly, and the quality score is asserted by the product's formula against the dashboard's own counts (45 = 100 − 2·20 − 15) rather than a typed 65. Recorded in `test-data-corrections.log`. |

## P21-020 · P3 · Inventory analytics / e2e fixtures · OPEN

| | |
| --- | --- |
| **Observed** | `GET /inventory/analytics` returns `variance` as a fixed first-25 with no ordering or paging. After several full Playwright runs the list is filled by purchase orders the lifecycle specs leave behind (`PO-xxxxxxxx` refs), the seeded cement row is no longer in it, and `11-inventory.spec.ts › the dashboard names the rows behind every number` fails — alone as well as in the suite. The seed's cleanup covers `PO-E2E-` and `PO-LC-` refs only. |
| **Root cause** | **TEST DATA / ENVIRONMENT** (fixture residue the seed does not clear), and a **P3 product observation** (an unordered capped list). Not caused by any Phase 21 change: no 21C commit touches the analytics path, and the residue predates 21C. |
| **Also in the same full run** | `11-inventory.spec.ts › a delivery against a purchase order becomes stock` failed once on a screenshot write into the OneDrive-synced `docs/design/screenshots` folder (`UNKNOWN: unknown error, open …`) and passed when the spec was re-run alone — **ENVIRONMENT**. |
| **Status** | OPEN — clear the residue (extend the seed's prefix list, or retire the specs' orders) and give the variance list an order. |
