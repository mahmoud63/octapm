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
