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

## P21-015 · P3 · Deep links · **FIXED** (one landing left open, below)

| | |
| --- | --- |
| **Observed** | 26 record deep links graded after the P21-011 fix (the 25 from before, plus the second ITP, so that one of the two cannot be the register's default first row): **12 open the record** (submittal, RFI, punch item, observation, purchase order, commitment, pay app, bid package, direct cost, timesheet, and now ITP-001 and ITP-002, each selected inline), **9 land on the register with the record's row visible but no detail opened** (transmittal, NCR, meeting, task, change order, location — and correspondence, defect and safety, whose registers on this project hold a single record, so a selected row there proves nothing about the link; the defect fix is proven by `33-quality-deep-links.spec.ts`, which selects each of two defects by id), **5 land on the module home with no sign of the record** (drawing, daily log, weather delay, procurement package, IPC), and **0 open the wrong record type**. `WorkflowRecordList` now takes the named record; the NCR, safety, transmittal and correspondence registers could pass it the same way. |
| **Expected** | A record-level deep link opens the record. A module-home URL is not a record deep link. |
| **Root cause** | **PRODUCT DEFECT** (incomplete): the `?recordId=&source=` contract exists and several modules honoured it; the rest did not. |
| **Fix** | Every register now opens on the record its link names, the way P21-011 did it. The shared record list takes `initialSelectedId` from the NCR, safety, material-test, drawing, transmittal and correspondence registers (the drawings module opens its legacy register for a `drawing` link); the change-order register opens the named order's history and detail as well as narrowing to it; the weather-delay table selects and scrolls to the named delay; the meeting list marks the meeting it already selected; `/tasks?recordId=` opens the task in its drawer; the locations tree selects and scrolls to the named location; a `daily_log` link whose id is a day opens that day; the IPC workbook accepts `ipc` as well as `ipc_certificate` and says which period it shows; the long-lead table selects the item bought under a `procurement_package` or `delivery_receipt` link. Fifteen files, 187 lines. |
| **Regression test** | `frontend/e2e/34-register-deep-links.spec.ts` — creates two of each kind on the seeded project (NCR, safety incident, material test, transmittal, letter, drawing, weather delay, location, meeting, change order, task, a daily-log day) and opens the link to each of the pair: the named row is selected and its sibling is not (the change-order register, which narrows to the named record by design, shows no sibling); a task opens in its drawer; the day opens; the IPC period is the one shown; nothing 404s; everything is retired at the end and the run fails if not. **Without the fix 13 of 13 fail**; with it 13 / 13. Targeted regression (navigation, client billing, user smoke, ball-in-court UI, needs-you, schedule risk, specs 33 and 34): 48 / 48. Typecheck green; lint 0 errors on the changed files. |
| **Regrade on the Phase 21 project** | 26 links: **18 open the record**, 7 are registers holding a single record (the row is selected, which a default first-row selection would also show — the spec proves those with two), **1 lands on the module home**: `procurement_package`, because that project bought its package without a long-lead item, and the link is routed to the long-lead view (`record-links.js`), which has no row for it. Also unreached: `delivery_receipt` (no read endpoint to obtain an id) and `ipc_item` (an item id, not a period). |
| **Status** | FIXED — except the `procurement_package` landing for a package with no long-lead item, which is a routing decision (send it to the procurement packages tab) rather than a register fix; left OPEN as P21-021. |

## P21-021 · P3 · Deep links · OPEN

| | |
| --- | --- |
| **Observed** | `record-links.js` routes `procurement_package` and `delivery_receipt` to the schedule's long-lead view. A package bought without a long-lead item (as the Phase 21 project's RFQ package was) has no row there, so its link lands on an empty module home. |
| **Expected** | A package link opens the package — on the procurement Packages tab when no long-lead item carries it. |
| **Root cause** | **PRODUCT DEFECT** (routing), carried out of P21-015. |
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

# Phase 21D additions — final certification closure

Phase 21D closed the 145/147 gate, put the branch in front of an independent
reviewer (OpenAI Codex CLI 0.154.0, `codex exec --sandbox read-only`, round 1
on HEAD `11c2335`) and reproduced every finding it made before changing
anything. Seven HIGH findings reproduced live against the demo project and
were fixed; the rest are dispositioned below. Nothing new was built.

## P21-022 · P3 · Procurement / inventory read model · OPEN

| | |
| --- | --- |
| **Observed** | The goods-receipt **Match** tab lists at most 100 open orders (`goods-receipt.service.js` `listOrders`, `take: 100`, ordered by the order's `promisedDate` ascending, unpromised last) with no search or paging, and `GET /inventory/analytics` `variance` is a top-25. On a database carrying many open orders a freshly raised, unpromised order is not on the tab. |
| **How found** | `11-inventory.spec.ts › a delivery against a purchase order becomes stock` timed out looking for its order's row after the lifecycle specs left more than 100 open orders behind. |
| **Root cause** | **CONFIRMED PRODUCT LIMITATION** — a capped, unsearchable list. Not a Phase 21 regression. |
| **Test change** | The spec now gives its order a promised date the product sorts first and asserts, through `GET /inventory/purchase-orders?scope=all`, that the order is inside the 100-order window before it clicks; the analytics check compares the UI table with the API's own ranked rows instead of hunting a seeded row in a top-25. Neither change weakens what is asserted about the product. |
| **Client impact** | A storeman on a busy project may need the order's page rather than the Match tab. Workaround: receive from the purchase order itself. No financial, security or data-integrity risk. |
| **Status** | OPEN — give the tab a search box or paging (Phase 22 candidate). |

## P21-023 · P2 · Deep links · OPEN

| | |
| --- | --- |
| **Observed** | A task deep link (`/projects/:id/tasks?recordId=…`) opens the drawer only when the task is on the first 25-row page (`list-query.js` `DEFAULT_LIMIT = 25`); a notification for an older task lands on the register with nothing open. |
| **How found** | Codex round 1, CX21-009 (MEDIUM). Confirmed by reading `features/tasks/index.tsx` `OpenNamedTask`, which searches the loaded rows only. |
| **Root cause** | **CONFIRMED PRODUCT DEFECT** — the opener should fetch the task by id when it is not in the loaded page. |
| **Client impact** | Navigation only; the task is reachable by scrolling or filtering. Not fixed in 21D: the brief limits changes to P0/P1 and Critical/High. Compatible with pilot use. |
| **Status** | OPEN (P2) — fetch by id when absent from the list. |

## P21-024 · P3 · Contracts · OPEN (observation) — and a documentation correction

| | |
| --- | --- |
| **Observed** | The Phase 21 prime contract carries `retentionRate: 10` while the project's `defaultRetentionRate` is 5; the certification held 12,000.00 on 120,000.00 — 10 %. The 21A/21C reports and the reconciliation wrote "retention 5 % = 12,000.00", which is arithmetically wrong. |
| **How found** | Codex round 1, CX21-013 (LOW). Verified by reading the contract and the project. |
| **Root cause** | **DOCUMENTATION DEFECT** (corrected in the three documents in 21D) plus a **product observation**: creating a prime contract does not inherit the project's default retention rate, so the two can silently disagree. |
| **Client impact** | None on figures — the product used the contract's rate consistently. A QS should check the rate on the contract, not assume the project default. |
| **Status** | Documentation corrected. Product observation OPEN (P3). |

## P21-025 · P1 · Direct cost · **FIXED** (Codex CX21-001)

| | |
| --- | --- |
| **Observed** | An invoice line's `poLineId` was copied unchecked. A line naming a purchase-order line from **another project** (or another order than the invoice names) was accepted, and the capitalisation rule then read that foreign line's stock link and posted **no cost** on approval. |
| **Reproduced** | Live: invoice with a foreign PO line → 201, submitted, approved, ledger delta **0 c** on a 10.00 invoice. |
| **Root cause** | **CONFIRMED PRODUCT DEFECT** — missing scope check. |
| **Fix** | `direct-cost.service.js` `normalizeLines` now loads the named PO lines scoped to the project and, when the invoice names its order, to that order; a line outside that set is refused with `400 DIRECT_COST_LINE_PO_LINE`. |
| **Regression** | `direct-cost.service.test.js` "CX21-001" (two cases); fails on the unfixed service. Live re-check: `400 DIRECT_COST_LINE_PO_LINE`. |

## P21-026 · P1 · Goods receipt · **FIXED** (Codex CX21-002)

| | |
| --- | --- |
| **Observed** | The same order line reported twice on one receipt was checked twice against the same starting quantity: two rows of 60 on a line of 100 both passed; stock took **120** and the line recorded **60**. |
| **Reproduced** | Live: receipt 200, PO line `receivedQty` 60, stock on hand 120. |
| **Root cause** | **CONFIRMED PRODUCT DEFECT** — the `FOR UPDATE` lock covered the lines, not the repeated row. |
| **Fix** | `goods-receipt.service.js` refuses a repeated `poLineId` on one receipt with `400 RECEIPT_DUPLICATE_LINE` before any stock moves. |
| **Regression** | `goods-receipt.service.test.js` "CX21-002"; fails on the unfixed service. Live re-check: `400 RECEIPT_DUPLICATE_LINE`, nothing moved. |

## P21-027 · P1 · Inventory costing · **FIXED** (Codex CX21-003)

| | |
| --- | --- |
| **Observed** | The item's weighted average blended the receipt against the on-hand of the **receiving balance only**. 100 at 10.00 in one store then 100 at 20.00 in another left the item's average at **20.00** instead of 15.00, and every later issue was costed wrong. |
| **Reproduced** | Live: two receipts, `averageCost` 20 (expected 15). |
| **Root cause** | **CONFIRMED PRODUCT DEFECT** — the average is the item's; the arithmetic used one bin. |
| **Fix** | `inventory.service.js` `drawFromWarehouse` locks the item row and blends against the sum of every `StockBalance` of the item. |
| **Regression** | `inventory.service.test.js` "CX21-003"; fails on the unfixed service. Live re-check: `averageCost` 15.00. The Phase 21 project's own average is unchanged at 11.00 (snapshot 36/36). |

## P21-028 · P1 · Inventory · **FIXED** (Codex CX21-004)

| | |
| --- | --- |
| **Observed** | Stock issues read a balance and wrote absolute figures with no row lock; two concurrent issues of 60 from 100 both read 100 and both succeeded, leaving **40**. |
| **Reproduced** | Live: two parallel issues → 200/200, on hand 40. |
| **Root cause** | **CONFIRMED PRODUCT DEFECT** — lost update. |
| **Fix** | `drawFromWarehouse` takes `SELECT … FOR UPDATE` on the balance row and re-reads its figures under the lock before checking and writing. |
| **Regression** | `inventory.service.test.js` "CX21-004" (the lock statements are asserted); live re-check over six attempts: 200/**409**, on hand 40. |

## P21-029 · P1 · Payments · **FIXED** (Codex CX21-005)

| | |
| --- | --- |
| **Observed** | Direct-cost and subcontract pay-application payments checked the balance from a figure read **before** the transaction and wrote an absolute paid total. Two concurrent payments of 60 on a balance of 60 both succeeded: `paidTotal` 60, payment rows summing to **120**. |
| **Reproduced** | Live: 200/200, `paidTotal` 60, rows 120. |
| **Root cause** | **CONFIRMED PRODUCT DEFECT** — stale read, no lock. |
| **Fix** | Both services lock the parent row inside the transaction, recompute what has been paid from the payment rows, re-check, then write the recomputed total. The IPC payment path, which already computed from rows inside the transaction, now takes the same lock. |
| **Regression** | `direct-cost.service.test.js` and `sub-pay-app.service.test.js` "CX21-005"; both fail on the unfixed services. Live re-check: 200/**400**, `paidTotal` 60 = rows 60. |

## P21-030 · P1 · Cost ledger · **FIXED** (Codex CX21-006)

| | |
| --- | --- |
| **Observed** | A reopened, re-approved timesheet posted **nothing**: the second approval hit the first posting's `sourceKey`, answered `already_posted`, and the cost stayed reversed. Net after re-approve **0.00** instead of 400.00. |
| **Reproduced** | Live: first approve +40,000 c, reopen, re-approve → sheet approved, net **+0 c**. |
| **Root cause** | **CONFIRMED PRODUCT DEFECT** — idempotency key not released by a reversal. |
| **Fix** | `cost-ledger.service.js` `post`: when the existing entry under the key has a reversal, the posting takes the next free key (`…:r2`, `…:r3`, …); an un-reversed existing entry still answers `already_posted`. The history keeps the first posting, its reversal and the new posting. |
| **Regression** | New suite `cost-ledger.repost.test.js` (post → refuse → reverse → post again; twice); fails on the unfixed service. Live re-check: net **+40,000 c** after re-approve. |

## P21-031 · P1 · Budget · **FIXED** (Codex CX21-007)

| | |
| --- | --- |
| **Observed** | `POST/PATCH /budget/lines` accepted `actual` and wrote it straight onto the line — a figure the cost ledger never posted, and the reconciliation would then be arguing with an invention. |
| **Reproduced** | Live: PATCH `actual` → 200. |
| **Root cause** | **CONFIRMED PRODUCT DEFECT** — a derived projection exposed as an input (OCTA-FIN-LEDGER-059). |
| **Fix** | `budget.service.js` refuses a non-zero `actual` on create and a changed `actual` on update with `400 BUDGET_ACTUAL_IS_DERIVED`; an unchanged echo is accepted because the edit dialog sends the current figure. The dialog's Actual field is now read-only and no longer sent. |
| **Regression** | `budget.service.test.js` "CX21-007" (two cases); fails on the unfixed service. Live re-check: changed value → **400**, create with `actual` → **400**, unchanged echo → 200, figure unchanged. |

## P21-032 · Test infrastructure · **FIXED** (Codex CX21-008)

| | |
| --- | --- |
| **Observed** | `backend/scripts/phase21/run-all.js` listed seven stages, one of which (`stage6-change-progress.js`) never existed, and **skipped** any stage file it could not find — so it could exit green having driven none of stages 8–19. |
| **Root cause** | **CONFIRMED TEST-INFRASTRUCTURE DEFECT** (false-green risk). The stages themselves were always run individually and their evidence is in the reports; the manifest was stale. |
| **Fix** | The manifest names every stage (1–5, 7–19, then the snapshot) and a missing stage fails the run. |

## P21-033 · P3 · Cash flow (legacy) · OPEN

Codex CX21-010: the legacy subcontract-valuation module counts a certified valuation as a cash outflow at certification, ahead of payment. The connected program uses subcontract pay applications, whose cash-out is recorded at payment (verified, snapshot "cash out 54,000"). **ACCEPTED — LEGACY MODULE**; a pilot on the connected workflow is not affected. Retire or align the legacy module in Phase 22.

## P21-034 · P3 · Cash flow · OPEN (design)

Codex CX21-011: after a payment is recorded, a failed cash-flow projection rebuild is logged and swallowed, so the payment stands while the projection can lag. **ACCEPTED DESIGN** — the payment is the record and the projection is derived (`ipc-payment-cash-flow.test.js` asserts exactly this). Recommendation: a retry or a "projection stale" flag. No financial-record risk.

## P21-035 · P3 · Tooling · OPEN (observation)

`prisma migrate status` reports the database up to date; `prisma migrate diff --from-schema-datasource --to-schema-datamodel` reports only two **index names** differing — PostgreSQL truncates identifiers at 63 characters (`WorkflowActivityLink_recordType_recordId_activityId_relationTyp…`, `WorkflowStatusHistory_projectId_recordType_recordId_createdAt_i…`) while Prisma abbreviates them its own way. No column, table, constraint or index *definition* differs. Cosmetic; no action.

## Codex round 1 findings not carried as defects

- **CX21-012** (MEDIUM, "recorded gates are not green") — closed by Phase 21D: the two Playwright failures are fixed at the root (P21-020 / P21-022) and the full gates are re-run below.
- **CX21-009** is P21-023; **CX21-013** is folded into P21-024.

## Codex round 2 — on the first loop's fixes (HEAD `aa1972c`)

The reviewer read the first loop's diff and returned **BLOCK**: five of the
seven fixes were INCOMPLETE and two regressions were predicted. Every item was
verified against the code before anything changed; all held. Fixed in
`ffe09fc`, with nine regressions that fail on the first loop's services.

## P21-036 · P1 · Inventory costing · **FIXED** (Codex CX21-101)

| | |
| --- | --- |
| **Observed** | The first fix locked the item row but still blended with the `averageCost` loaded **before** the transaction. A receipt that waited on another receipt's lock used the price that receipt had just replaced: 200 on hand at 15.00 plus 100 at 30.00 gave 16.67 instead of 20.00. The same stale copy served two lines of one item on a single delivery. |
| **Root cause** | **CONFIRMED PRODUCT DEFECT** (introduced by the first loop's shape of fix). |
| **Fix** | The price is read from the item row under the lock. The lock is taken before the balance row is looked up or created, with `FOR NO KEY UPDATE`, so it does not conflict with the `KEY SHARE` a balance insert takes on the item — the deadlock Codex predicted between two first receipts into different stores. |
| **Regression** | `inventory.service.test.js` "CX21-101" (price under the lock; item lock before balance lock). Live: three concurrent-receipt attempts each ended at the order-independent **20.00**; two first receipts into two stores both posted (200 @ 25.00). |

## P21-037 · P1 · Budget · **FIXED** (Codex CX21-102)

| | |
| --- | --- |
| **Observed** | Creating a line whose archived twin exists reactivates the twin — and the first fix's create path wrote `actual: 0` over a projection the ledger still backed. |
| **Root cause** | **CONFIRMED PRODUCT DEFECT** (pre-existing; exposed by reviewing the touched function). |
| **Fix** | A reactivated line keeps its actual; only a genuinely new line starts at 0. |
| **Regression** | `budget.service.test.js` "CX21-102". Live: 150.00 posted, line archived, created again → same line reactivated with **150.00** kept. |

## P21-038 · P1 · Payments · **FIXED** (Codex CX21-103)

| | |
| --- | --- |
| **Observed** | The first fix locked the invoice and recomputed the paid total, but the **status** check still ran before the lock: a void that landed in between was paid back to approved/paid. The void, likewise, counted payments before its lock. The pay-application revocation and the IPC payment had the same shape. |
| **Root cause** | **CONFIRMED PRODUCT DEFECT** (race). |
| **Fix** | The payment re-reads status and total under the lock (`409 DIRECT_COST_NOT_APPROVED` / `SUB_PAY_APP_NOT_APPROVED` / `IPC_CERTIFICATE_NOT_CERTIFIED`); the void and the revocation lock the row and count payments again (`409 DIRECT_COST_HAS_PAYMENTS` / `SUB_PAY_APP_ALREADY_PAID`). |
| **Regression** | `direct-cost.service.test.js` "CX21-103" (two cases) and `sub-pay-app.service.test.js` "CX21-103" (two cases), each injecting the other write at the moment of the lock. |

## P21-039 · P1 · Direct cost · **FIXED** (Codex CX21-104)

| | |
| --- | --- |
| **Observed** | The first fix scoped lines on create and on line replacement, but a header-only edit that moved the invoice to another order kept the old order's lines — including a stocked one that suppresses the project's cost. |
| **Root cause** | **CONFIRMED PRODUCT DEFECT** (bypass of the first fix). |
| **Fix** | A header-only order change re-checks the kept lines against the new order and refuses with `400 DIRECT_COST_LINE_PO_LINE`; naming the order the lines already belong to is accepted. |
| **Regression** | `direct-cost.service.test.js` "CX21-104". Live: move to B → **400**; re-name A → 200. |

## P21-040 · P1 · Inventory · **FIXED** (Codex CX21-105)

| | |
| --- | --- |
| **Observed** | Reservations computed `reserved` from an unlocked read and wrote it absolutely; a reservation of 80 raced with an issue of 60 on 100 could leave 80 reserved against 40 on hand. The warehouse-wide issue split and the transfer landing read bins the same way. |
| **Root cause** | **CONFIRMED PRODUCT DEFECT** (same class as CX21-004, other code paths). |
| **Fix** | The warehouse's balances for the item are locked (`FOR NO KEY UPDATE`) before they are read in the reservation, the warehouse-wide issue split and the transfer landing. A concurrent draw waits and then sees what is left — which also removes the spurious `INV_INSUFFICIENT_STOCK` Codex predicted for the split. |
| **Regression** | `inventory.service.test.js` "CX21-105" and "a warehouse-wide issue locks the bins…" (lock precedes the read). Live: reserve 80 ∥ issue 60 on 100 → reserve **200**, issue **409 INV_INSUFFICIENT_AVAILABLE**. |

## P21-032, continued

Codex round 2 added that `run-all.js --only=<no match>` exited green having run nothing. It now exits 1 with "matches no stage; nothing was run" (verified by hand).

## Codex round 3 — on the second loop's fixes (HEAD `ffe09fc`)

The reviewer returned **BLOCK** again: three of the round-2 fixes were still
INCOMPLETE (each a race variant of the same defect), six new Highs, and one
deadlock the round-2 bin prelock had introduced. Every item was verified
against the code; all held. Fixed in the commit after `ffe09fc`, with eight
regressions that fail on the round-2 services.

## P21-041 · P1 · Inventory costing · **FIXED** (Codex CX21-201)

| | |
| --- | --- |
| **Observed** | An issue read the item's average before any lock. One that waited for a concurrent receipt left at the old price while the stock it left behind was valued at the new one: 100 at 10.00, receive 100 at 30.00 and issue 100 at once — consumption 1,000.00, stock 2,000.00, against 4,000.00 bought. |
| **Root cause** | **CONFIRMED PRODUCT DEFECT** — the round-2 fix locked receipts only. |
| **Fix** | Every movement takes the item row (`FOR NO KEY UPDATE`) first and prices from the row under the lock. |
| **Regression** | `inventory.service.test.js` "CX21-201". Live, three attempts with a receipt and an issue fired together: stock value plus consumption equalled the 4,000.00 bought in both orderings the race produced (150 @ 20.00 + 1,000.00; 150 @ 23.33 + 500.00). |

## P21-042 · P1 · Inventory · **FIXED** (Codex CX21-202 and the round-2 deadlock)

| | |
| --- | --- |
| **Observed** | Round 2 locked the *existing* bins of a warehouse before reading them. A bin created in between (a first receipt into a new store) was not locked, so a reservation could still be written against stock an issue had since drawn; and locking bins in query order let a two-line receipt and a reservation release wait on each other in opposite orders — a deadlock. |
| **Root cause** | **CONFIRMED PRODUCT DEFECT** (phantom rows) and a **regression of the round-2 fix** (lock order). |
| **Fix** | The bin prelocks are removed. The item lock, taken first, is the one lock every stock operation takes — reservations, the warehouse-wide split and the transfer landing included — and bins are only ever created under it, so nothing can appear between the lock and the read. Multi-item operations (a delivery, a transfer) take all their items up front in id order through an exported `lockItems`. |
| **Regression** | `inventory.service.test.js` "no path locks bins by warehouse any more…", "lockItems takes several items in id order"; `goods-receipt.service.test.js` "holds every stocked item on the order before any line moves stock". Live: a two-line receipt in one item order racing a release in the other — both **200**, stock exact. |

## P21-043 · P1 · Inventory transfers · **FIXED** (Codex CX21-206)

| | |
| --- | --- |
| **Observed** | Two concurrent dispatches, or two concurrent receipts, of one transfer both read its status before either wrote: a transfer of 10 landed 20. |
| **Root cause** | **CONFIRMED PRODUCT DEFECT** (pre-existing; found by reviewing the touched file). |
| **Fix** | The transfer row is locked before its status is read; the second caller sees `in_transit` / `received` and is refused with `409 TRANSFER_STATE`. |
| **Regression** | Live: dispatch **200 / 409**, receive **200 / 409**; 90 in the source, 10 in the destination. |

## P21-044 · P1 · Direct cost · **FIXED** (Codex CX21-203)

| | |
| --- | --- |
| **Observed** | The header-only order check (P21-039) validated against lines read before the lock; a line replacement that committed in between left an invoice naming order A with order B's stocked lines. |
| **Root cause** | **CONFIRMED PRODUCT DEFECT** (race variant of P21-039). |
| **Fix** | `updateDirectCost` does all its reading — status, lines, order check, duplicate check, totals — under the invoice's lock. |
| **Regression** | `direct-cost.service.test.js` "CX21-203" (the replacement is injected at the moment of the lock; the header change is refused). |

## P21-045 · P1 · Direct cost and pay applications · **FIXED** (Codex CX21-204)

| | |
| --- | --- |
| **Observed** | Submit, approve, return and void each decided on a status read before the write. A return that started on a pending invoice landed on it once approved **and paid**, putting a paid, posted invoice back into draft. The same shape on every pay-application transition. |
| **Root cause** | **CONFIRMED PRODUCT DEFECT** (race). |
| **Fix** | Every direct-cost transition holds the invoice and refuses if the status moved (`lockExpecting`); every pay-application transition holds the application and refuses if its status differs from the one the transition was decided on (`409 SUB_PAY_APP_TRANSITION_INVALID`). |
| **Regression** | `direct-cost.service.test.js` "CX21-204" (two cases: return, submit/approve); `sub-pay-app.service.test.js` "CX21-204". |

## P21-046 · P1 · Client billing · **FIXED** (Codex CX21-205)

| | |
| --- | --- |
| **Observed** | A retention release checked the retained balance without the certificate lock a payment takes; two releases of 80 on 100 retained could both pass. |
| **Root cause** | **CONFIRMED PRODUCT DEFECT** (same class as P21-029). |
| **Fix** | The release takes the certificate lock and re-checks its status before it reads the rows. |
| **Regression** | `ipc-allocation-impact.test.js` "limits retention releases…" now asserts the lock statement. No live race was staged: the only certificate outside the certified Phase 21 project is a draft, and the Phase 21 certificate's figures are part of what this phase certifies. |

## Lint — two errors in Phase 21-touched frontend files, cleared

`scripts/inspections-ui.test.mjs` had the P21-011 assertion block appended three times (a parse error under ESLint — the script itself still ran, because Node parsed only the first declaration before the duplicate threw at load time in ESLint's stricter pass); one copy is kept. `goods-receipt-panel.tsx` passed a `useMutation` result into an effect's dependency list (`@tanstack/query/no-unstable-deps`, written 2026-09-08, before Phase 21, in a file Phase 21A touched); the stable `mutate` is destructured instead.

## Codex round 4 — on the third loop's fixes (HEAD `6165c04`)

The reviewer confirmed the stock protocol (every round-3 item CORRECT except
two it tied to new findings) and returned **BLOCK** for four remaining
writers of the same class — a status read before the transaction, a write
after it — and one gap in the delivery prelock. All confirmed against the
code; fixed in the commit after `6165c04`, with five regressions that fail
on the round-3 services.

## P21-047 · P2 · Goods receipt · **FIXED** (Codex CX21-301)

| | |
| --- | --- |
| **Observed** | The round-3 prelock named the items on the order's lines; a line the storeman resolves to a different item (or that resolves by SKU) was locked later, in payload order — which a transfer holding the same two items in sorted order could contradict. |
| **Root cause** | **CONFIRMED** — an incomplete prelock (introduced in round 3). A deadlock costs one aborted request, not data; hence P2. |
| **Fix** | The prelock covers the items the lines resolve to (`itemsByLine`) as well as the items the order names. |
| **Regression** | `goods-receipt.service.test.js` "CX21-301". |

## P21-048 · P1 · Subcontract pay applications · **FIXED** (Codex CX21-302)

| | |
| --- | --- |
| **Observed** | An edit checked "editable" before its transaction, then wrote lines before the application — the opposite order to every transition (a deadlock), and an edit paused after its check could overwrite a certified, paid application's lines and totals. A transition, likewise, recomputed from lines read before its lock. |
| **Root cause** | **CONFIRMED PRODUCT DEFECT** (race). |
| **Fix** | The edit holds the application first and refuses if it is no longer editable (`409 SUB_PAY_APP_LOCKED`); a transition re-reads the application under its lock before it recomputes. |
| **Regression** | `sub-pay-app.service.test.js` "CX21-302" (two cases). |

## P21-049 · P1 · Direct cost · **FIXED** (Codex CX21-303)

| | |
| --- | --- |
| **Observed** | A delete that started on a draft ran after the invoice was submitted, approved and paid, removing the invoice, its lines and its payments while the posted cost stayed on the ledger without a source. |
| **Root cause** | **CONFIRMED PRODUCT DEFECT** (race). |
| **Fix** | The delete holds the invoice and refuses if it is no longer a draft. |
| **Regression** | `direct-cost.service.test.js` "CX21-303". |

## P21-050 · P1 · Client billing · **FIXED** (Codex CX21-304)

| | |
| --- | --- |
| **Observed** | IPC item edits, adjustments, submit, certify and invoice issue each decided on a status read before the transaction; a stale submit could rewrite a certified, invoiced, paid period to "submitted", and a stale adjustment could change the net payable on a paid certificate. |
| **Root cause** | **CONFIRMED PRODUCT DEFECT** (race). |
| **Fix** | Each holds the certificate and refuses if its status moved, reading the status through the lock statement itself. |
| **Regression** | `ipc-allocation-impact.test.js` "CX21-304" (submit); the other four paths take the identical guard. |

## Codex round 5 — on the fourth loop's fixes (HEAD `5345f36`)

The reviewer confirmed every round-4 item but one and returned **BLOCK** for
three more findings. All confirmed against the code; fixed in the commit
after `5345f36`, with three regressions that fail on the round-4 services.

## P21-051 · P1 · Subcontract pay applications · **FIXED** (Codex CX21-401)

| | |
| --- | --- |
| **Observed** | An edit recomputed from the copy it loaded before its lock, and the recompute rewrites every adjustment — including the ones the request never mentioned. A notes-only edit paused before its lock, another edit recording a 20,000.00 back-charge, the notes edit resumed: the back-charge went back to zero and the net payable rose. |
| **Root cause** | **CONFIRMED PRODUCT DEFECT** (lost update on an editable draft). |
| **Fix** | The edit reloads the application under the lock before it recomputes. |
| **Regression** | `sub-pay-app.service.test.js` "CX21-401". |

## P21-052 · P1 · Subcontract pay applications · **FIXED** (Codex CX21-402)

| | |
| --- | --- |
| **Observed** | A transition's guard — the final-application closeout gate on approval, the "claim something" check on submit — ran on the application before the lock; the round-4 reload under the lock could carry different claims that the guard never saw. |
| **Root cause** | **CONFIRMED PRODUCT DEFECT** (race variant of P21-048). |
| **Fix** | After the reload, the guard is asked again about the application that will actually be transitioned. |
| **Regression** | `sub-pay-app.service.test.js` "CX21-402" (submit with claims that vanish under the lock is refused `SUB_PAY_APP_EMPTY`). |

## P21-053 · P1 · Inventory costing · **FIXED** (Codex CX21-403)

| | |
| --- | --- |
| **Observed** | The weighted average counted on-hand stock only. Sequentially, with no race: 100 bought at 10.00, all dispatched to another store, 100 more bought at 30.00 while the transfer is on the road — the average became 30.00 — then the transfer lands at 30.00: 200 units valued at 6,000.00 against 4,000.00 bought, and every later issue is over-costed. |
| **Root cause** | **CONFIRMED PRODUCT DEFECT** (pre-existing valuation rule; found by reviewing the touched function). |
| **Fix** | Units in transit are still the item's units at the item's average, and blend like any other. |
| **Regression** | `inventory.service.test.js` "CX21-403". Live: 100 @ 10 → dispatched → 100 @ 30 received → transfer landed → **200 @ 20.00 = 4,000.00**. |

## Codex round 6 — on the fifth loop's fixes (HEAD `adee79d`)

Every round-5 item CORRECT, no regressions; **BLOCK** for two more findings
in the touched files, both pre-existing valuation and billing rules rather
than races. Confirmed against the code; fixed in the commit after
`adee79d`, with four regressions that fail on the round-5 services.

## P21-054 · P1 · Inventory costing · **FIXED** (Codex CX21-501)

| | |
| --- | --- |
| **Observed** | Quarantined stock was left out of the weighted average the way in-transit stock was (P21-053): 100 at 10.00 quarantined, 100 bought at 30.00 → average 30.00 → the quarantine released at 30.00: 200 valued at 6,000.00 against 4,000.00 bought. |
| **Root cause** | **CONFIRMED PRODUCT DEFECT** (valuation rule). |
| **Fix** | Quarantined stock counts in the item's quantity for blending; damaged stock, which is written off and never comes back, does not. |
| **Regression** | `inventory.service.test.js` "CX21-501" and "damaged stock is written off and does not count". |

## P21-055 · P1 · Subcontract pay applications · **FIXED** (Codex CX21-502)

| | |
| --- | --- |
| **Observed** | A line's "previous" amount was trusted from the value stored when the application was created. Application A rejected, application B (newer) approved and paid for 60,000.00 on a 100,000.00 line, A reopened and re-submitted for 60,000.00: A's previous was still 0, each application passed its own ceiling, and 120,000.00 could be certified and paid against 100,000.00. |
| **Root cause** | **CONFIRMED PRODUCT DEFECT** (billing ceiling computed from a stale, number-ordered "previous"). |
| **Fix** | Every recompute derives each line's previous amount from the other counted (approved or paid) applications on the commitment — whatever their numbers — and writes it back to the line; the ceiling check then sees the true cumulative. |
| **Regression** | `sub-pay-app.service.test.js` "CX21-502" (two cases: the re-bill is refused `SUB_PAY_APP_EXCEEDS_SCHEDULED`; with nothing certified elsewhere, previous is 0 even when the line says otherwise). |

## Codex round 7 — on the sixth loop's fixes (HEAD `66da083`)

CX21-501 CORRECT; CX21-502 INCOMPLETE for a concurrent variant; **BLOCK** for
one finding. Confirmed against the code; fixed in the commit after
`66da083`.

## P21-056 · P1 · Subcontract pay applications · **FIXED** (Codex CX21-601)

| | |
| --- | --- |
| **Observed** | Two open applications on one commitment (a rejected one reopened while a newer one was open — reopening did not apply the "one open application" rule that raising one does) could be approved at once; each read the other's claims as not yet certified, and 120,000.00 could be certified against a 100,000.00 line. |
| **Root cause** | **CONFIRMED PRODUCT DEFECT** (the ceiling read other applications without a commitment-level lock; the one-open rule had a gap). |
| **Fix** | Every transition, and raising an application, holds the commitment row before the application's, so decisions on one commitment are serialised and the second sees the first's claims as "previous". Coming back to draft is refused while another application is open (`409 SUB_PAY_APP_OPEN_EXISTS`). |
| **Regression** | `sub-pay-app.service.test.js` "CX21-601" (three cases: lock order on a transition; reopen refused while another is open; the commitment held on creation). Live: reopening A while B is open → **409 SUB_PAY_APP_OPEN_EXISTS**; A reopened after B was paid and claiming the same 60 % → **400 SUB_PAY_APP_EXCEEDS_SCHEDULED**; claiming the remaining 40 % → 200 with previous = B's certified amount. |

## Codex round 8 — on the seventh loop's fix (HEAD `f3c8591`)

CX21-601 and CX21-502 CORRECT, no regressions; **BLOCK** for two more
pre-existing rules in the touched service. Confirmed against the code;
fixed in the commit after `f3c8591`, with four regressions (three fail on
the round-7 code; the fourth guards the flow that must keep working).

## P21-057 · P1 · Subcontract pay applications · **FIXED** (Codex CX21-701)

| | |
| --- | --- |
| **Observed** | Materials stored on site were added to the gross and posted to cost after the line ceiling had been checked on work alone. A line worth 100,000.00 accepted 200,000.00 of materials with no work, and 190,000.00 (after 5 % retention) was payable, with no over-claim reported. Other applications' materials were not counted as "previous" either. |
| **Root cause** | **CONFIRMED PRODUCT DEFECT** (billing ceiling incomplete). |
| **Fix** | Work plus materials on site must fit the line's value; what other counted applications certified — work and materials — is "previous". |
| **Regression** | `sub-pay-app.service.test.js` "CX21-701" (two cases). Live, fresh commitment: 200,000.00 of materials on a 100,000.00 line → **400 SUB_PAY_APP_EXCEEDS_SCHEDULED**; 60,000.00 of work plus 40,000.00 of materials → 200. |

## P21-058 · P1 · RBAC · **FIXED** (Codex CX21-702)

| | |
| --- | --- |
| **Observed** | `POST /pay-apps/:id/reopen` required only the update permission, but from *approved* it revokes the PM's certification and reverses the cost it posted. The route's own comment said it "needs the approval permission"; the code did not check it. A QS or a subcontractor-party editor could undo a certification. |
| **Root cause** | **CONFIRMED PRODUCT DEFECT** (authorization). |
| **Fix** | The route tells the service whether the caller holds the approval permission; revoking a certified application without it is refused with `403 SUB_PAY_APP_REVOKE_FORBIDDEN`. Coming back from *rejected* is an ordinary edit and still needs only update. Voiding keeps its own delete-on-void permission. |
| **Regression** | `sub-pay-app.service.test.js` "CX21-702" (two cases). Live: the QS reopening a PM-approved application → **403**, status stays approved; the PM → 200, status draft. |

## Codex round 9 — on the eighth loop's fixes (HEAD `65bddc2`)

CX21-702 CORRECT; CX21-701 INCOMPLETE because its fix had over-reached; one
more pre-existing rule. **BLOCK**. Both confirmed; fixed in the commit
after `65bddc2`, with two regressions that fail on the round-8 code.

## P21-059 · P1 · Subcontract pay applications · **FIXED** (Codex CX21-801, a regression of P21-057)

| | |
| --- | --- |
| **Observed** | The round-8 fix folded other applications' materials into the line's "previous" amount, which the approved-progress cap also reads: 40,000.00 of work and 30,000.00 of materials certified before, progress now 50 %, a valid claim of 10,000.00 more work computed cumulative work 80,000.00 against a 50,000.00 cap and was refused as an over-claim. Codex caught it before it reached any run. |
| **Root cause** | **REGRESSION** of the eighth loop (one figure for two rules). |
| **Fix** | "Previous" keeps work and materials apart: work meets the progress cap; work plus materials — earlier and this period's — meets the line's value. |
| **Regression** | `sub-pay-app.service.test.js` "CX21-801" (the valid claim goes through with previous 40,000.00 and no over-claim; the value ceiling still holds). |

## P21-060 · P1 · Subcontract closeout · **FIXED** (Codex CX21-802)

| | |
| --- | --- |
| **Observed** | The final-application test summed work only. An application that exhausted the subcontract's value with work plus materials was not "final", skipped the closeout gate (as-builts, warranties) and its override reason, and could be paid in full. |
| **Root cause** | **CONFIRMED PRODUCT DEFECT** (pre-existing). |
| **Fix** | Materials on site — this application's and the other counted applications' — count towards the value that makes an application final. |
| **Regression** | `sub-pay-app.service.test.js` "CX21-802" (60,000.00 of work plus 40,000.00 of materials on 100,000.00 is final; 60,000.00 of work alone is not; materials paid on an earlier application count). |

## The final release challenge — HEAD `28a2d50`: one Critical, eight Highs

Unlike rounds 1–10, the release challenge read the **whole backend** and the
money, stock and RBAC features of the frontend, and returned DO NOT RELEASE.
Every finding was verified against the code; eight of the nine hold as
described and one holds as a bug with no reachable effect. All fixed in the
commit after `28a2d50`, each with a regression that fails on that commit
(mutation-checked), and five staged live.

## P21-061 · **P0** · Tenant isolation · **FIXED** (Codex CX21-410, Critical)

| | |
| --- | --- |
| **Observed** | A stock issue resolved its activity by id alone. An activity id from **another organisation** resolved to that organisation's project, and this organisation's stock then posted cost — with this organisation's `orgId` and the other's `projectId` — onto the other tenant's activity. No composite tenant constraint stopped it. |
| **Root cause** | **CONFIRMED PRODUCT DEFECT** — the only cross-tenant write found in Phase 21; the Phase 21 isolation stage attacked with an outsider *reading and writing the project's own routes*, never with a foreign id inside an otherwise legitimate request. |
| **Fix** | The activity must be on a project of the caller's organisation; any other id is refused (`404 ACTIVITY_NOT_FOUND`) and nothing moves. |
| **Regression** | `inventory.service.test.js` "CX21-410". Live: an issue naming an activity of the only other organisation in the database → **404**, stock 86 → 86. |

## P21-062 · P1 · RBAC · **FIXED** (Codex CX21-415)

| | |
| --- | --- |
| **Observed** | A role-only route guard (`requireRoles`, used on project create/update/archive, billing, BOQ, change orders and EOT) never looked at an API key's scopes; the permission guard always had. A key restricted to `*:read` owned by a PM could edit a project's contract value and archive the project. |
| **Root cause** | **CONFIRMED PRODUCT DEFECT** (authorization). |
| **Fix** | A write through a role guard now needs a write scope for the route's module (`403 API_KEY_SCOPE`); reads are unchanged. |
| **Regression** | `src/middleware/__tests__/rbac.api-key.test.js`. Live: a `*:read` key → PATCH project **403**, GET 200. |

## P21-063 · P1 · RBAC / project isolation · **FIXED** (Codex CX21-416)

| | |
| --- | --- |
| **Observed** | The warehouse routes for purchase orders, the three-way match and stock issue/receipt sit under `/inventory`, not under a project router, so a key limited to some projects could list another project's orders (with prices and lines), read its match, and issue or receive against it. |
| **Root cause** | **CONFIRMED PRODUCT DEFECT** (the project restriction was enforced only by the project-router middleware). |
| **Fix** | Those routes honour the key's project list: a named project outside it is refused (`403 FORBIDDEN_PROJECT`), an unfiltered list is filtered to it, and single-order reads are checked after loading. |
| **Regression** | Live: a key limited to Riverside → the other project's orders **403**; own project 200; unfiltered list 200 with 0 foreign rows. |

## P21-064 · P1 · Cost · **FIXED** (Codex CX21-412)

| | |
| --- | --- |
| **Observed** | An activity's actual cost was writable through the cost-record routes (and offered as an editable field on the cost dashboard), exactly as a budget line's had been (P21-031): a PM could zero it under posted ledger entries and corrupt AC/CPI/EAC. |
| **Root cause** | **CONFIRMED PRODUCT DEFECT**. |
| **Fix** | A changed actual is refused on create and update (`400 COST_ACTUAL_IS_DERIVED`); an unchanged echo passes; the dashboard no longer offers the field. |
| **Regression** | `cost.actual-derived.test.js`. Live: changed actual → **400**; unchanged echo → 200. |

## P21-065 · P1 · Client billing · **FIXED** (Codex CX21-413)

| | |
| --- | --- |
| **Observed** | Two IPC periods certified at once each locked only their own certificate and read the other's items as not yet certified; 120,000.00 could be certified against a 100,000.00 allocation without an override. |
| **Root cause** | **CONFIRMED PRODUCT DEFECT** (same class as P21-056). |
| **Fix** | Certification holds the project row before the certificate, so certifications on one project are decided one at a time. |
| **Regression** | `ipc-allocation-impact.test.js` "CX21-413" (lock order). |

## P21-066 · P1 · Labour · **FIXED** (Codex CX21-414)

| | |
| --- | --- |
| **Observed** | A return that started on a submitted timesheet could land after it was approved and posted: the sheet became rejected — editable — with its cost still on the ledger; replaced entries carry new ids, so re-approval posted the same labour again. |
| **Root cause** | **CONFIRMED PRODUCT DEFECT** (race; same class as P21-045). |
| **Fix** | Every timesheet transition (submit, approve, return, reopen) holds the sheet and refuses if its status moved. |
| **Regression** | `timesheet.service.test.js` "CX21-414". |

## P21-067 · P1 · Procurement · **FIXED** (Codex CX21-417)

| | |
| --- | --- |
| **Observed** | A purchase-order edit that started on a pending order could write after the order was approved, changing its terms (a tax rate, a line) with the status left at approved. |
| **Root cause** | **CONFIRMED PRODUCT DEFECT** (race). |
| **Fix** | The edit holds the order and refuses if it is no longer editable (`409 PO_LOCKED`). |
| **Regression** | `purchase-order.service.test.js` "CX21-417". |

## P21-068 · P1 · Cost ledger · **FIXED** (Codex CX21-418)

| | |
| --- | --- |
| **Observed** | Approving equipment usage on a daily report wrote the activity's actual **absolutely** and created no ledger entry: it could overwrite a concurrent posting, approving twice charged twice, and the equipment cost never reconciled against the ledger. |
| **Root cause** | **CONFIRMED PRODUCT DEFECT** — the one cost source that bypassed OCTA-FIN-LEDGER-059 (the Phase 21 project has no equipment usage, which is why every reconciliation balanced). |
| **Fix** | Equipment usage posts through the cost ledger, once per report (`sourceType: equipment`); the record keeps only the equipment category and the derived forecast. |
| **Regression** | `daily-report.service.test.js` "posts approved equipment usage…" now asserts the ledger post and that no absolute actual is written. |

## P21-069 · P3 · RBAC hygiene · **FIXED** (Codex CX21-411, reported as High)

| | |
| --- | --- |
| **Observed** | Thirteen inventory routes passed their transition name (`stock.adjust`, `stock.issue`, …) as a bare string where the guard expects an options object, so the name was dropped. |
| **Verification** | **The claimed impact is a FALSE POSITIVE**: no policy — `shared/permissions.json`, the party permissions, the permission templates — names any inventory transition, so nothing was let through; the procurement role is refused `stock.adjust` by the generic rule (live: **403**), before and after. |
| **Fix** | The routes pass `{ transition }` and the guard accepts either form, so a future transition rule will bind. Recorded at P3. |

## T-14 · the isolation stage moved the certified project

The final gate run on `28a2d50` failed its last two steps by exactly **22.00**: the stage-7 RBAC probes (a storeman's and a site engineer's issue of one bag each) ran again as part of the gates and issued two more bags at 11.00 from the certified project. The 21A–21C baseline had absorbed the first run's bags; a second run moved the figures. **ENVIRONMENT / TEST-INFRASTRUCTURE**, not the product: the two bags were returned through the product's own return movement (ledger −22.00, stock 86, snapshot 36/36), and the stage now returns the bags its probes issue and checks it left the ledger where it found it.

## T-15 · my own probe moved a through-date, and found a rule that no longer held

The second full gate run (on `79f5ea1`) went red in the pay-application spec, which reconciles the seeded demo project: one activity was flagged *date-stale*. Between the two runs, the CX21-412 live probe had echoed an activity's unchanged actual — and the through-date resolver still treated any `actual` in a payload as a posting made now, resetting the date under the latest ledger entry. **Two things**: an instrument effect (the probe echoed a field on the demo project), and a **product rule made wrong by the phase's own fix** — with actual now derived, an echo is never a posting. The date was restored (200), the resolver no longer moves the date on an echo (`772f2c5`, with a regression that fails on `79f5ea1`), and the gates were run a third time.

## The second release pass — HEAD `772f2c5`: one Critical, nine Highs

The reviewer account's usage limit lifted at 04:29 CDT and the second pass
ran on `772f2c5` (checkout `221eb25`, documents only on top): DO NOT
RELEASE — one Critical and nine Highs, and three of the first pass's fixes
(CX21-410, 412, 416) marked INCOMPLETE because of them. Every finding was
verified against the code before anything changed; all ten hold. All fixed
in `29456c4`, each with a regression that fails on `772f2c5` (10 / 10,
mutation-checked by reverting the fourteen product files), six staged live.

## P21-070 · **P0** · Tenant isolation · **FIXED** (Codex CX21-420, Critical)

| | |
| --- | --- |
| **Observed** | P21-061 closed the activity path only. A stock issue that named a **project id and a cost code, with no activity**, trusted the project id: another organisation's project id resolved, and this organisation's stock posted cost — this `orgId`, that `projectId` — onto the other tenant's budget line. |
| **Root cause** | **CONFIRMED PRODUCT DEFECT** — the same gap as P21-061 one field over; the ledger itself had no last line against a foreign project either. |
| **Fix** | The named project must be the caller's organisation's (`404 PROJECT_NOT_FOUND`), and the cost ledger refuses, as its last line, to post onto any project that is not the organisation's (`403 COST_LEDGER_PROJECT_FOREIGN`), whatever a caller hands it. |
| **Regression** | `inventory.service.test.js` "CX21-420", `cost-ledger.repost.test.js` "CX21-420". Live: an issue naming the only other organisation's project ("UAT Regression Tower") → **404**, our stock 86 → 86, their ledger, cost records and movements read straight from the tables **unchanged**. (The outsider tenant registered by stage 7 has no subscription and cannot create a project; the foreign project was read from the database instead.) |

## P21-071 · P1 · RBAC / project isolation · **FIXED** (Codex CX21-421)

| | |
| --- | --- |
| **Observed** | P21-063 checked the project a request *named*. A key limited to some projects could **omit** `projectId` and issue through another project's activity, receive against another project's order, and read every project's stock movements. |
| **Root cause** | **CONFIRMED PRODUCT DEFECT** (the restriction was enforced at the route on a field the caller could leave out). |
| **Fix** | The key's project list travels into the service: an issue or receipt whose project — named or derived from the activity or the order — is outside it is refused (`403 FORBIDDEN_PROJECT`); the movement list is filtered to it. |
| **Regression** | `inventory.service.test.js` "CX21-421" (refused outside, allowed inside). Live, a `*:write` key limited to Riverside: issue via the P21 project's activity **403**, receipt against its order **403**, its movements **403**, unfiltered movements 200 with 369 rows and **0** outside Riverside. |

## P21-072 · P1 · Cost · **FIXED** (Codex CX21-422)

| | |
| --- | --- |
| **Observed** | P21-064 refused a *changed* actual. A budget-only edit still wrote back the actual it had read, so a ledger posting that landed between the read and the write was overwritten. |
| **Root cause** | **CONFIRMED PRODUCT DEFECT** (the echo was allowed through and then persisted). |
| **Fix** | Cost-record create and update never write `actual`; only the ledger moves it. |
| **Regression** | `cost.actual-derived.test.js` "CX21-422" (the update's data carries no `actual`). Live: a budget-only PATCH on a Riverside record → 200, actual and its through-date unchanged. |

## P21-073 · P1 · Labour · **FIXED** (Codex CX21-423)

| | |
| --- | --- |
| **Observed** | P21-066 locked submit/approve/return/reopen. Edit and delete still decided on a status read before the lock: an edit that started on a draft landed on a sheet approved (and posted) meanwhile; a delete likewise. |
| **Root cause** | **CONFIRMED PRODUCT DEFECT** (two writers left outside the lock). |
| **Fix** | Both hold the sheet and re-check its status (`409 TIMESHEET_LOCKED`). |
| **Regression** | `timesheet.service.test.js` "CX21-423" (edit and delete refused once the lock reports *approved*; nothing deleted or rewritten). |

## P21-074 · P1 · Cost dashboard · **FIXED** (Codex CX21-424, a regression of the P21-064 fix)

| | |
| --- | --- |
| **Observed** | Removing `actual` from the dashboard's editable fields removed the **Actual column** from the table, so the money columns no longer matched their headings. |
| **Root cause** | **CONFIRMED PRODUCT DEFECT** — my own regression, in the frontend, which no backend gate could see. |
| **Fix** | The column is back; while a row is being edited the actual is shown read-only rather than as an input. |
| **Regression** | `tsc -b` and the file's lint clean; the full Playwright run exercises the dashboard. |

## P21-075 · P1 · Portfolio / project isolation · **FIXED** (Codex CX21-425)

| | |
| --- | --- |
| **Observed** | The portfolio ignored an API key's project list and returned every project of the organisation. |
| **Root cause** | **CONFIRMED PRODUCT DEFECT**. |
| **Fix** | `getPortfolio` takes the key's projects and narrows the project query to them. |
| **Regression** | `portfolio.service.test.js` "CX21-425". Live: the Riverside-only key → 1 project listed, 0 outside it. |

## P21-076 · P1 · Procurement · **FIXED** (Codex CX21-426)

| | |
| --- | --- |
| **Observed** | P21-067 locked the order *edit*. Lifecycle transitions (submit, approve, reject, issue, acknowledge, close, cancel) still decided on a status read before the transaction, so a rejection that started on a pending order landed on it after approval and issue. |
| **Root cause** | **CONFIRMED PRODUCT DEFECT**. |
| **Fix** | The transition holds the order and refuses if its status moved (`409 PO_STATE_CHANGED`). |
| **Regression** | `purchase-order.service.test.js` "CX21-426" (rejection refused once the lock reports *issued*; no update written). |

## P21-077 · P1 · Commitments · **FIXED** (Codex CX21-427)

| | |
| --- | --- |
| **Observed** | Replacing a commitment's schedule of values, and editing its header, checked the editable statuses before the lock; a replacement that started on a draft landed after approval, under pay applications already valued against the old lines. |
| **Root cause** | **CONFIRMED PRODUCT DEFECT**. |
| **Fix** | Both hold the commitment and re-check (`409 COMMITMENT_LOCKED` / `COMMITMENT_STATE_CHANGED`). |
| **Regression** | `commitment.service.test.js` "CX21-427" (replacement refused once the lock reports *approved*; the old lines are not deleted). |

## P21-078 · P1 · Cost reconciliation · **FIXED** (Codex CX21-428)

| | |
| --- | --- |
| **Observed** | The reconciliation *repair* computed each record's actual from the ledger, then wrote that number — a posting between the read and the write was erased by the very tool meant to restore the figures. |
| **Root cause** | **CONFIRMED PRODUCT DEFECT**. |
| **Fix** | The repair sets actual from a `SUM` over the ledger **in the same UPDATE statement**. |
| **Regression** | `cost-reconciliation.service.test.js` (suite green). Live: a dry-run recompute on the certified project → 200, 21 ledger entries, 71,204.00, migration not required, nothing to repair; snapshot 36 / 36 and actual-cost delta 0.00 afterwards. |

## P21-079 · P1 · Account security · **FIXED** (Codex CX21-429)

| | |
| --- | --- |
| **Observed** | An API key acting as its owner could begin a new MFA enrolment and replace the owner's factor — a leaked key becoming a second factor. |
| **Root cause** | **CONFIRMED PRODUCT DEFECT** (authorization). |
| **Fix** | The four `/auth/mfa/*` routes refuse API keys (`403 API_KEY_FORBIDDEN`), and enrolment is refused while two-factor is on (`409 MFA_ALREADY_ENABLED`) — it must be turned off with the password and a current code first. |
| **Regression** | `rbac.api-key.test.js` "CX21-429", `mfa.service.test.js` "CX21-429". Live: a `*:write` key → `POST /auth/mfa/setup` **403**. |

## The third release pass — HEAD `29456c4`: no Critical, seven Highs

Launched at 04:45 CDT, it stopped on the account's usage limit after
196,872 tokens; re-run at 09:33 CDT with the prompt narrowed to the code
diff, it returned in six minutes (153,432 tokens): DO NOT RELEASE — no
Critical, seven Highs, three of the second pass's fixes INCOMPLETE because
of them, two Mediums. Every finding was verified against the code before
anything changed; all seven Highs hold, one Medium is the missing half of
P21-071 and is closed with it, the other is registered at P2. All fixed in
`2b0df2b`, each with a regression that fails on `29456c4` (11 / 11,
mutation-checked by reverting the twelve product files); the two reachable
by a single request staged live.

## P21-080 · P1 · RBAC / project isolation · **FIXED** (Codex CX21-430; closes the INCOMPLETE on CX21-416)

| | |
| --- | --- |
| **Observed** | P21-063 and P21-071 covered issue, receipt and the movement list. The **return, adjustment, damage, quarantine and release** routes passed the request straight through, so a key limited to some projects could add stock and post negative cost to another project through its activity; the inventory **analytics** ignored the key's projects and answered with every project's usage and cost by activity. |
| **Root cause** | **CONFIRMED PRODUCT DEFECT** (the same gap as P21-071, on the five routes the second loop did not touch). |
| **Fix** | The key's project list travels with every movement (`403 FORBIDDEN_PROJECT`, named or derived from the activity) and narrows every project-scoped analytics query. |
| **Regression** | `inventory-analytics.service.test.js` "CX21-430" (every project-scoped query carries `projectId: { in }`). Live, a `*:write` key limited to Riverside: return to the P21 project's activity **403**, stock 86 → 86; its analytics **403**; unfiltered analytics 200 with no row of it; Riverside's analytics 200. |

## P21-081 · P1 · RBAC / project isolation · **FIXED** (Codex CX21-431)

| | |
| --- | --- |
| **Observed** | Global search answered an API key with its owner's whole view — any project by id, any module — and the report builder ran a report as the owner: a key limited to project A with `report:read` could preview B's cost records with neither B nor `cost:read`. |
| **Root cause** | **CONFIRMED PRODUCT DEFECT** (authorization; two readers outside the guards that had learned about keys). |
| **Fix** | Search refuses a project outside the key's list (`403`), narrows results to it and searches only the modules the key's scopes allow; a report runs only with a scope on its source's module (`403 API_KEY_SCOPE`) and only on the key's projects; deferred runs, their files and schedules — rendered later as the owner — refuse API keys altogether (`noApiKey`). |
| **Regression** | `search.service.test.js` and `report-builder.service.test.js` "CX21-431". Live: search by the other project's id **403**, by name 0 rows of it, 1 of Riverside; a preview on it **403**, on Riverside 200; a `report:read` key → cost source **403 API_KEY_SCOPE**, project search 200 with 0 rows. (No report definition exists on the database, so the deferred-run refusal rests on the guard's own test and the route wiring.) |

## P21-082 · P1 · Cost reconciliation · **FIXED** (Codex CX21-432; closes the INCOMPLETE on CX21-428)

| | |
| --- | --- |
| **Observed** | P21-078 moved the SUM into the UPDATE. But an UPDATE that waits on a posting's row lock keeps the snapshot it started with: once the posting commits, the statement re-checks the row it is writing, not the ledger rows it is summing — and writes the total from before the posting. |
| **Root cause** | **CONFIRMED PRODUCT DEFECT** (READ COMMITTED semantics: the sub-select's snapshot is the statement's, not the lock's). |
| **Fix** | The repair holds the projection rows in a statement of their own first; a posting adding to one of them holds the same lock until it commits, and the SUM — taken by the next statement — sees it. The through-date is derived in the same UPDATE (`MAX(incurredOn)`), never from a date read before the lock. |
| **Regression** | `cost-reconciliation.repair.test.js` "CX21-432" (two locks before any write; amount and date in one statement; no pre-read date written). Gates run 5 re-ran the dry-run recompute and the reconciliation on the certified project (0.00). |

## P21-083 · P1 · Commitments · **FIXED** (Codex CX21-433)

| | |
| --- | --- |
| **Observed** | P21-077 locked the edit and the schedule of values. The lifecycle transitions (submit, approve, return, execute, close, void) still decided on a status read before the transaction and updated unconditionally: a return that started on an approved commitment landed after it was executed, turning an executed agreement back into an editable draft with its committed cost still posted. |
| **Root cause** | **CONFIRMED PRODUCT DEFECT**. |
| **Fix** | The transition holds the commitment and refuses if its status moved (`409 COMMITMENT_STATE_CHANGED`). |
| **Regression** | `commitment.service.test.js` "CX21-433" (approval refused once the lock reports *executed*; no update written). |

## P21-084 · P1 · Procurement / receipt · **FIXED** (Codex CX21-434, and the CX21-421 remainder)

| | |
| --- | --- |
| **Observed** | A goods receipt locked the order's lines but never the order: a cancellation that landed between its status read and its final update was overwritten with "partial" or "received", with the stock booked against a cancelled order. And (the Medium Codex attached to CX21-421) the receipt resolved — and created — stocked items before checking the key's projects, so a refused receipt left an item behind. |
| **Root cause** | **CONFIRMED PRODUCT DEFECT** (two). |
| **Fix** | The receipt locks the order row and takes its status from under the lock before the receivable check; the key's projects are checked before anything is created. |
| **Regression** | `goods-receipt.service.test.js` "CX21-434" (refused once the lock reports *cancelled*; no stock moved, no order update) and "CX21-421" (refused before any item is created). |

## P21-085 · P1 · Billing · **FIXED** (Codex CX21-435)

| | |
| --- | --- |
| **Observed** | Subscribing had no serialisation and no idempotency: two concurrent requests both read "no active subscription" and each created a Stripe subscription, the second hiding the first in the database; and a subscribe after a cancel-at-period-end took the create branch while the first subscription ran to its period end — two billable subscriptions. |
| **Root cause** | **CONFIRMED PRODUCT DEFECT** (money). |
| **Fix** | One subscribe per organisation at a time (an advisory transaction lock), decided on a row read under it; a Stripe subscription still running (any status but canceled or incomplete-expired) is changed in place with cancel-at-period-end cleared; a creation carries an idempotency key so a replayed attempt gets the same subscription back. |
| **Regression** | `subscription.service.test.js` (new): a subscribe while the Stripe subscription still runs updates it and creates nothing; the lock precedes the read; a first creation carries the key. Stripe is not configured on this database, so the live path is not staged. |

## P21-086 · P1 · Cost · **FIXED** (Codex CX21-436)

| | |
| --- | --- |
| **Observed** | P21-072 stopped an edit writing `actual`; it still wrote back the **through-date** it had read, so a ledger posting that advanced the date between the read and the write was undone — and a cutoff report then included cost from after the cutoff. |
| **Root cause** | **CONFIRMED PRODUCT DEFECT** (the same shape as P21-072, one field over). |
| **Fix** | An edit writes the through-date only when the caller supplies one; otherwise the field is not written at all. |
| **Regression** | `cost.actual-derived.test.js` "CX21-436" (a budget-only edit writes no date; a supplied date is written); the T-15 assertion tightened to "not written". |

## P21-087 · P2 · Account security · **OPEN** (Codex third pass, Medium)

Backup-code consumption rewrites an unlocked JSON array; two verifications
racing on the same code could both succeed, or one could restore a code the
other consumed. A code is single-use in practice (the window is the
milliseconds between two verifications of the same account); no money, data
or tenant boundary is at stake. **Not fixed** — outside P0/P1 by the brief;
dispositioned below.

## The fourth release pass — HEAD `2b0df2b`: no Critical, eight Highs

Run at 09:46 CDT on `2b0df2b` (127,143 tokens, twenty minutes): DO NOT
RELEASE — no Critical, eight Highs, one of them a regression of the
thirteenth loop's own subscription fix, and four of the third pass's fixes
INCOMPLETE because of them. Every finding was verified against the code
before anything changed; all eight hold. All fixed in the commit after
`2b0df2b`, each with a regression that fails on `2b0df2b` (6 of 7 by
reverting the ten product files; the seventh guards a flow that must keep
working and passes on both), the four reachable by a single request staged
live.

## P21-088 · P1 · Billing · **FIXED** (Codex CX21-440, a regression of the P21-085 fix; closes the INCOMPLETE on CX21-435)

| | |
| --- | --- |
| **Observed** | The thirteenth loop looked the running Stripe subscription up before deciding whether to change or create — and swallowed a failed lookup as "no subscription". A transient Stripe error at that moment created a second billable subscription and the database kept only the new id. |
| **Root cause** | **CONFIRMED PRODUCT DEFECT** — my own: a `.catch(() => null)` written for "not found" that also caught "not reachable". |
| **Fix** | A failed lookup fails the subscribe (the caller retries); only Stripe's "no such subscription" means there is none to change. |
| **Regression** | `subscription.service.test.js` "CX21-440" (a connection error propagates, nothing created or written; a `resource_missing` still creates once). |

## P21-089 · P1 · RBAC / project isolation · **FIXED** (Codex CX21-441; closes the INCOMPLETE on CX21-416 and CX21-430)

| | |
| --- | --- |
| **Observed** | Three more inventory doors ignored a key's project list: the **direct stock receipt** passed the request straight through (a key limited to A could book stock to B), the **item list** and the **summary** took any `projectId`, and the summary's and analytics' **warehouse values** counted every project's items. |
| **Root cause** | **CONFIRMED PRODUCT DEFECT** (the same gap as P21-071 and P21-080, on the doors those loops did not reach). |
| **Fix** | The key's projects travel with the receipt (`403 FORBIDDEN_PROJECT`) and narrow the item list, the summary and both warehouse valuations to items of those projects or of none. |
| **Regression** | `inventory.service.test.js` "CX21-441" and the analytics case extended (warehouse balances filtered by item project). Live, a `*:write` key limited to Riverside: receipt to the P21 project **403**, stock 86 → 86; its items and summary **403**; unfiltered summary and items 200 with no row of it. |

## P21-090 · P1 · Reports · **FIXED** (Codex CX21-442)

| | |
| --- | --- |
| **Observed** | A stored report file is rendered with its requester's whole access. Any reader who could see the definition — a session user with narrower project or module access, not only a key — could download it and read the projects a fresh query would have hidden from them. |
| **Root cause** | **CONFIRMED PRODUCT DEFECT** (authorization: the file's visibility was the definition's, not the reader's). |
| **Fix** | A stored file is its requester's (a scheduled run: the report owner's) and a company admin's to download (`403 REPORT_RUN_NOT_YOURS`); everyone else runs the report afresh as themselves. |
| **Regression** | `report-builder.service.test.js` "CX21-442" (a narrower reader refused; the requester and an admin served). No stored run exists on the database, so the live path rests on the regression. |

## P21-091 · P1 · RBAC · **FIXED** (Codex CX21-443; closes part of the INCOMPLETE on CX21-431)

| | |
| --- | --- |
| **Observed** | The assistant retrieved records through global search without the key's restrictions and read conversations as the key's owner — a key limited to A could ask about B and read B's stored conversations. |
| **Root cause** | **CONFIRMED PRODUCT DEFECT**. |
| **Fix** | The assistant refuses API keys altogether (`403 API_KEY_FORBIDDEN`): it retrieves, answers and keeps conversations as the person it talks to. A key keeps the report assistant, which is scoped to the key. |
| **Regression** | The `noApiKey` guard's own test; live: a key → `/assistant/status` **403**, `/assistant/conversations` **403**. |

## P21-092 · P1 · RBAC · **FIXED** (Codex CX21-444)

| | |
| --- | --- |
| **Observed** | Retrying or cancelling a background job checked the role statically, outside the decision every other write goes through: a read-only key (or a PM held to a read-only template) could cancel a queued schedule generation. |
| **Root cause** | **CONFIRMED PRODUCT DEFECT**. |
| **Fix** | Retry and cancel go through `hasPermission` — role, project template and key scopes. |
| **Regression** | `routes/__tests__/jobs.routes.test.js` "CX21-444" (a `*:read` key refused on retry and cancel; `*:write` allowed). Live: a read-only key on a queued job → cancel **403**, retry **403**. |

## P21-093 · P1 · Cost ledger · **FIXED** (Codex CX21-445)

| | |
| --- | --- |
| **Observed** | A ledger posting decided whether to advance the activity's through-date from a row read before its lock; two postings reading the same date could each "advance" it, and the later-committing one dragged it back — a January cutoff then included a later cost. |
| **Root cause** | **CONFIRMED PRODUCT DEFECT** (the same shape as P21-082 and P21-086, on the normal posting path). |
| **Fix** | The decision is taken from the row as held for the transaction. |
| **Regression** | `cost-ledger.repost.test.js` "CX21-445" (a posting that read an old date leaves a later held date alone, and advances an earlier one). |

## P21-094 · P1 · Budget · **FIXED** (Codex CX21-446)

| | |
| --- | --- |
| **Observed** | Two concurrent transfers out of the same budget line both passed the available-budget check and left the line negative, past the very guard written to stop that. |
| **Root cause** | **CONFIRMED PRODUCT DEFECT**. |
| **Fix** | A transfer holds both lines, in id order, before it counts what is available. |
| **Regression** | `budget.service.test.js` "CX21-446" (the lock, in sorted id order, precedes every read of the lines). |

## P21-095 · P1 · RBAC / reports · **FIXED** (Codex CX21-447; closes the rest of the INCOMPLETE on CX21-431)

| | |
| --- | --- |
| **Observed** | Report definitions and schedules were changed and deleted as the key's owner: a key limited to A could delete an org-visible B report or re-enable its schedule, which then ran under the owner's access. |
| **Root cause** | **CONFIRMED PRODUCT DEFECT**. |
| **Fix** | Definitions and schedules are a person's act: every report mutation refuses API keys, as runs, downloads and schedule creation already did. A key previews, runs and exports synchronously, within its scopes and projects. |
| **Regression** | Route wiring on the `noApiKey` guard (its own test). Live: a key → `POST /reports` **403 API_KEY_FORBIDDEN**. |

## The fifth release pass — HEAD `59cf34b`: no Critical, eight Highs, two Mediums

Run at 10:19 CDT on `59cf34b` (114,024 tokens, thirteen minutes): DO NOT
RELEASE — no Critical, eight Highs, two Mediums, and three of the fourth
pass's fixes INCOMPLETE because of them. Every finding was verified against
the code before anything changed; all ten hold. All fixed in the commit
after `59cf34b`, each with a regression that fails on `59cf34b` (8 / 8 by
reverting the nine backend product files), the five reachable by a single
request staged live.

## P21-096 · P1 · RBAC / project isolation · **FIXED** (Codex CX21-450)

| | |
| --- | --- |
| **Observed** | The item list built its project scope and its search as two `OR` keys on one object, so the search **replaced** the scope: a key limited to A searching by name was given B's project items — prices and balances included. (The same collision hid a session user's project filter behind a search before the key existed.) |
| **Root cause** | **CONFIRMED PRODUCT DEFECT** (an object literal, not a query). |
| **Fix** | Scope and search are two clauses of one `AND`. |
| **Regression** | `inventory.service.test.js` "CX21-450". Live: a Riverside-only key searching for a P21-only item by name → 200 with 0 rows; the storeman's own search finds it. |

## P21-097 · P1 · RBAC / project isolation · **FIXED** (Codex CX21-451; closes the INCOMPLETE on CX21-441, CX21-430 and CX21-416)

| | |
| --- | --- |
| **Observed** | A project's own item or warehouse (`projectId` on the item master and the warehouse) was not that project's to a key: single-item reads, scans and edits took any item of the organisation; a receipt naming no project moved a project item's stock; a reservation claimed it. |
| **Root cause** | **CONFIRMED PRODUCT DEFECT** — the checks had only ever looked at the project a *movement* named, never at the project the *stock* belonged to. |
| **Fix** | Every movement loader refuses an item or warehouse of a project outside the key's list, whatever the movement names; item reads and scans answer through the same check; an edit checks the item's project and the project it is moved to; reservations carry the key's projects. |
| **Regression** | `inventory.service.test.js` "CX21-451" (a P21-only item: receipt and reservation refused to a key limited elsewhere, received by a key allowed there). Live, a Riverside-only key on a P21-only item: read **403**, scan **403**, edit **403**, receipt naming no project **403**, reservation **403**; the item untouched. |

## P21-098 · P1 · RBAC · **FIXED** (Codex CX21-452)

| | |
| --- | --- |
| **Observed** | Conversations answered an API key as its owner: a key limited to A listed and read B's conversations and messages wherever the owner was a member. |
| **Root cause** | **CONFIRMED PRODUCT DEFECT**. |
| **Fix** | Conversations are between people: the router refuses API keys. |
| **Regression** | The `noApiKey` guard's own test; live: a key → `GET /conversations` **403**. |

## P21-099 · P1 · Budget / authorization · **FIXED** (Codex CX21-453)

| | |
| --- | --- |
| **Observed** | A budget revision was created **approved** by whoever could *create* cost — a QS or cost controller — and an approved revision's amount could be changed by whoever could *update* cost, while the policy reserves approval to the PM and finance. Every such revision moved the project's revised budget at once. |
| **Root cause** | **CONFIRMED PRODUCT DEFECT** (a default of "approved" and no approval check). |
| **Fix** | Only someone who may approve cost creates an approved revision, approves one, or changes the money of one (`403 BUDGET_REVISION_APPROVAL_REQUIRED`, `409 BUDGET_REVISION_APPROVED`); everyone else starts a draft to submit. Workflow-driven approvals keep their authority. |
| **Regression** | `budget-revision.service.test.js` (new). Live, on Riverside (every revision deleted afterwards): a QS's revision → status **draft**; created as approved → **403**; approving their own draft → **403**; the PM's → **approved**. |

## P21-100 · P1 · Commitments · **FIXED** (Codex CX21-454)

| | |
| --- | --- |
| **Observed** | A commitment change order was edited and moved on a status read before the transaction: an edit that started on a pending order landed after its approval had posted the old value, leaving an approved order at a new amount with committed cost at the old one. |
| **Root cause** | **CONFIRMED PRODUCT DEFECT** (the same shape as P21-077 and P21-083, on the change orders). |
| **Fix** | Edit and transition hold the change order and re-check (`409 COMMITMENT_CO_LOCKED` / `COMMITMENT_CO_STATE_CHANGED`). |
| **Regression** | `commitment.service.test.js` "CX21-454". |

## P21-101 · P1 · Inventory costing · **FIXED** (Codex CX21-455)

| | |
| --- | --- |
| **Observed** | "Return from site" put stock back without reversing the activity's cost: the dialog sent no activity, and the product posts no cost for a movement naming none — so the activity kept the cost of material it no longer had, and issuing it again charged it twice. |
| **Root cause** | **CONFIRMED PRODUCT DEFECT** (a rule that held for issues and not for returns). |
| **Fix** | A return names the activity or cost code its cost goes back to, exactly as an issue names where it goes (`400 INV_NO_COST_SOURCE`); the dialog asks for it and sends it. The inventory spec's put-back — which returned without naming the activity — now names it (a TEST DATA correction that the rule exposed). |
| **Regression** | `inventory.service.test.js` "CX21-455" (a bare return refused; a return naming the activity posts the negative entry). Live: a bare return → **400**. |

## P21-102 · P1 · Tenant isolation (frontend) · **FIXED** (Codex CX21-456)

| | |
| --- | --- |
| **Observed** | Signing out cleared the session and the offline store but not the query cache; signing in as another organisation on the same tab could render the previous organisation's inventory and billing before its own requests answered. |
| **Root cause** | **CONFIRMED PRODUCT DEFECT** (frontend). |
| **Fix** | Signing out, and signing in, clear the query cache. |
| **Regression** | `tsc -b` and lint clean; the full Playwright run signs in and out throughout. |

## P21-103 · P1 · Cost ledger · **FIXED** (Codex CX21-457)

| | |
| --- | --- |
| **Observed** | Two first postings for an activity could each find no projection row and each create one; official actual cost reads one row per activity, so half the cost vanished from the reports. |
| **Root cause** | **CONFIRMED PRODUCT DEFECT** (no uniqueness on the pair; the P21-093 lock protected existing rows only). |
| **Fix** | A posting holds the (project, activity) pair for its transaction before it looks for the row, so the second finds the first's. |
| **Regression** | `cost-ledger.repost.test.js` "CX21-457". |

## P21-104 · P2 · Reports · **FIXED** (Codex CX21-458, Medium; closes the INCOMPLETE on CX21-442)

A company admin could not download a run of a report private to someone else: the visibility filter refused it before the admin exception. The admin now takes any run's file. `report-builder.service.test.js` "CX21-458".

## P21-105 · P2 · Budget · **FIXED** (Codex CX21-459, Medium)

The P21-094 lock held both budget lines in one `ANY(...)` statement, which does not order the row locks the comment claimed it did. The lines are held one statement at a time, in id order. `budget.service.test.js` "CX21-446" tightened.

## The sixteenth loop — my own regression, caught by the gate

Gates run 7, on `d23dc05`, failed the greenfield spec on its first request
and eight more specs after it: every cost posting to an activity answered
500. Not a finding of the reviewer's — the fifteenth loop's advisory locks
were taken with a client call that cannot read the `void` they return. The
fix is `ded5fa0`; gates run 8 is the run the certification cites for the
fifteenth and sixteenth loops together.

## P21-106 · **P0** · Cost ledger · **FIXED** (my own regression, found by the greenfield gate)

| | |
| --- | --- |
| **Observed** | On `d23dc05` (the fifteenth loop) every cost posting to an activity — a stock issue, a timesheet approval, a direct cost — failed with **500**: the advisory lock added for P21-103 was taken with `$queryRaw`, and Prisma refuses to deserialize the `void` that `pg_advisory_xact_lock()` returns. The subscription lock (P21-085) had the same shape on a path no gate exercises. |
| **Root cause** | **CONFIRMED PRODUCT DEFECT** — mine; the unit tests fake the client and could not see it. Gates run 7 caught it on its first request: the greenfield spec's issue of two bags. Two 5xx responses were produced on the certified project before the run was superseded; the movement was refused whole, so no stock or cost moved. |
| **Fix** | Both locks are taken with `$executeRaw`, which runs the statement and reads nothing back; the regression asserts the lock never goes through `$queryRaw`. Nothing on `d23dc05` was pushed or deployed. |
| **Regression** | `cost-ledger.repost.test.js` "CX21-457" and `subscription.service.test.js` tightened. Live: an issue of one bag to A-130 and its return, both 2xx, ledger back where it started; greenfield 3/3 twice in gates run 8. |

## T-16 · a superseded gate run overlapped a restart

Gates run 6 (on `59cf34b`) was already superseded by the fifth pass's findings when it reached its last two steps; its snapshot and reconciliation failed with "connection refused" because the API was restarting on the fifteenth loop's code at that second (15:47:40 UTC). **ENVIRONMENT** (my own scheduling); the run is recorded as such and run 7, on the new HEAD, is the one the certification cites.

## Codex round 10 — on the ninth loop's fixes (HEAD `28a2d50`): PASS

Every fix CORRECT, no regressions, nothing new of Critical or High
severity. `28a2d50` is the frozen source for the final gates.

## Further test and environment defects found in my own instruments (21D)

| id | what was wrong | consequence, and what was done |
| --- | --- | --- |
| T-11 | The two database-backed Jest suites that open twenty connections each (`reference-number`, `raw-sql-reference-numbering`) failed with "Can't reach database server" in three of nine full runs — each time another process (an API restart, a live probe) was using the same embedded PostgreSQL, and once with the default worker count alone. They passed alone every time. | **ENVIRONMENT** (connection bursts against the embedded database), not the product. The final gate runs Jest with four workers and nothing else touching the database; recorded, not hidden. |
| T-12 | The round-1 live probe for CX21-007 patched the budget line's own actual back onto it, which proved the field was writable but would have counted the fix's deliberate "unchanged echo" as a failure. | The probe now sends a changed value; a separate probe covers create and the echo. |
| T-13 | My round-8 regression for CX21-701 encoded a merged "previous" (work plus materials) that round 9 showed to be wrong; the test was corrected with the fix. | Recorded so the register does not overstate what the eighth loop proved. |

## Codex round 1 findings not carried as defects (restated)

- **CX21-012** closed by this phase; **CX21-009** is P21-023; **CX21-013** is folded into P21-024.

## Prisma drift — the P21-035 observation, examined

`migrate diff --from-schema-datasource --to-schema-datamodel` on the frozen HEAD reports: index and foreign-key **renames** (hand-written migration names vs Prisma's); **thirty-three "removed" indexes** which are the GIN trigram search indexes the migrations create in SQL and the schema cannot declare; `updatedAt` **defaults** the database carries and the schema does not; one index the schema declares that the database lacks (`ActivityBoqAllocation(projectId, boqItemId, activityId)` — performance only); and one referential action that differs — `ActivityProgressMethod.projectId` is `ON DELETE RESTRICT` in the database and `Cascade` in the schema. Nothing in the code deletes a `Project` row, so the last has no reachable effect today; it is recorded so that a future project hard-delete is written against the database as it is. No table, column or type differs.

## Disposition of open P2 / P3 findings

Every finding that stays open after Phase 21D, with what a pilot/UAT client would meet and whether it is compatible with the readiness verdict. "Timing" says when it should be closed.

| ID | Sev | Area | Client impact | Workaround | Financial risk | Security risk | Data-integrity risk | Timing | Compatible with CLIENT READY — PILOT/UAT |
| --- | :---: | --- | --- | --- | :---: | :---: | :---: | --- | :---: |
| P21-007 | P2 | Schedule baseline | A project planned in the app shows "no schedule revision" as a baseline blocker; the baseline cannot be locked from the screen. | Import the schedule (XER/XML) or accept an unlocked baseline during the pilot; EV and progress work without the lock. | none | none | none | Phase 22 (first sprint) | Yes — carried deliberately; no evidence it blocks a pilot flow |
| P21-023 | P2 | Task deep links | A notification for a task beyond the first 25 rows opens the register without the drawer. | Filter or scroll to the task. | none | none | none | Phase 22 | Yes |
| P21-087 | P2 | Account security | Two verifications racing on the same backup code could both pass; the code is single-use in practice. | None needed; regenerate codes if one is suspected shared. | none | low (needs a stolen code used twice within milliseconds) | none | Phase 22 | Yes |
| P21-003 | P3 | OpenAPI | `POST /activities` does not document the required `engineerIds`. | The API's 400 says so. | none | none | none | Phase 22 docs pass | Yes |
| P21-004 | P3 | OpenAPI | Purchase-order `status` documented wider than the validator accepts. | Use `submit/approve/issue`. | none | none | none | Phase 22 docs pass | Yes |
| P21-005 | P3 | Security posture | An outsider tenant's write meets `402` before `403`. | None needed — the write is refused either way. | none | low (information: the gate order reveals the subscription state, not data) | none | Phase 22 | Yes |
| P21-006 | P3 | RBAC (business question) | A site engineer can issue stock, as a storeman can. | Policy decision; restrict if the client's process demands it. | low | low | none | Client decision at pilot kick-off | Yes |
| P21-008 | P3 | RBAC (business question) | A planning engineer can see the commercial module and its figures. | Policy decision. | none | low (read visibility) | none | Client decision at pilot kick-off | Yes |
| P21-012 | P3 | Change orders | `budgetLineId` on a variation is discarded; approved changes sit on the holding line. | Distribute from the holding line with a budget transfer (works, audited). | none — totals are exact; distribution is manual | none | none | Phase 22 | Yes |
| P21-013 | P3 | Persona UX | "Users" and "Company" are offered to roles that get 403; the page shows an empty list, not a refusal. | Ignore the two entries. | none | none | none | Phase 22 | Yes |
| P21-014 | P3 | Console hygiene | One 401 (`/auth/me`) per load before sign-in; 403 on `/parties` for four roles. | None needed; the console gate (spec 30) allows exactly these, no others. | none | none | none | Phase 22 | Yes |
| P21-016 | P3 | Procurement read model | Package stays `tendering` after award + PO. | Read the register row, which carries the state. | none | none | none | Phase 22 | Yes |
| P21-017 | P3 | OpenAPI | `purchaseOrderId` / `poLineId` undocumented on direct costs. | The UI sets them. | none | none | none | Phase 22 docs pass | Yes |
| P21-018 | P3 | Procurement UX | "Waiting on you" counts 0 while a row says "Your action" for the user's own draft. | Use the row. | none | none | none | Phase 22 | Yes |
| P21-019 | P3 | Quality score (business question) | Score counts NCRs raised, not open. | Read open NCRs on the dashboard. | none | none | none | Client decision | Yes |
| P21-020 | P3 | Inventory analytics | Variance list is a fixed top-25 without paging. | Use the purchase-order register. | none | none | none | Phase 22 | Yes |
| P21-021 | P3 | Deep links | Package/receipt links land on the long-lead view, empty for a package with no long-lead item. | Open the package from the RFQ register. | none | none | none | Phase 22 | Yes |
| P21-022 | P3 | Match tab | Match tab shows at most 100 open orders, no search. | Receive from the purchase order itself. | none | none | none | Phase 22 | Yes |
| P21-024 | P3 | Contracts (observation) | A prime contract does not inherit the project's default retention rate. | Set the rate on the contract (the QS sees it there). | low — only if a QS assumes the project default | none | none | Phase 22 | Yes |
| P21-033 | P3 | Cash flow (legacy) | Legacy sub-valuation module counts cash-out at certification. | Use subcontract pay applications (the connected flow). | low — legacy module only | none | none | Phase 22 (retire or align) | Yes |
| P21-034 | P3 | Cash flow (design) | A failed projection rebuild after a payment is logged, not retried. | Any later payment or a manual rebuild refreshes it. | none — the payment is the record | none | none | Phase 22 | Yes |
| P21-035 | P3 | Tooling | `migrate diff` reports index/FK names, `updatedAt` defaults and 33 search indexes the schema cannot declare; one index the schema declares is missing from the database (`ActivityBoqAllocation(projectId, boqItemId, activityId)`). | none | none | none | none — no column, type or constraint definition differs | Phase 22: add the missing index in a migration; leave the names | Yes |

**Test defects in my own instruments** (T-01 … T-10) are recorded in the register; none affects the product verdict.
