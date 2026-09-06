# OctaPM full system QA report

**Date** 2026-09-06 · **Build** `feat/p0-foundations-sprint1`
**Method** two passes — API scenario testing against a real PostgreSQL database,
then browser-driven end-to-end testing with Playwright against the real React
application.

---

## Executive summary

OctaPM has now been tested three ways: unit tests that mock the database,
scenario tests that drive the API and verify in the database, and browser tests
that drive the interface and verify in both.

Each layer found defects the layer below could not see. The unit suite — 1583
tests — could not see a `Decimal` serialisation failure, a `NOT NULL`
constraint, or a missing route guard. The API pass could not see a page that
crashes, a date rendered a day early, or a user silently signed out.

**Ten defects have been found and fixed across the two passes**, four of them
blockers or criticals that would have stopped a real company on day one. The
financial spine — the chain that *is* the product for a construction business —
is now proven from the interface through to the database, with exact arithmetic.

| Measure | Result |
| --- | --- |
| Browser E2E tests | 16 passing |
| API scenario tests | 13 (9 pass, 4 partial, 0 fail) |
| Backend unit tests | 152 suites, 1583 tests |
| Permission probes (28 modules × 8 roles) | 224, **0 mismatches** |
| Routes swept in a browser | 35, all render, none crash |
| Project modules with correct context | 16 / 16 |
| Failed network requests in the module sweep | 0 |
| Defects found and fixed | 10 |
| Defects open | 6 (1 major, 5 minor) |

## What is now proven

**The financial spine, through the interface.** Cost codes created in the
company workspace, adopted by a project, budget lines created through the
dialog totalling **1,550,000**, a **125,000** change order raised through the
UI, approved, and the revised budget moving to exactly **1,675,000** while the
original correctly stays at 1,550,000. The budget screen shows the new figure.
Repeatable across four runs. Detail in `OCTAPM_FINANCIAL_E2E_REPORT.md`.

**Commercial governance is real.** A variation cannot be submitted without a
schedule impact summary, a cost impact summary, an affected activity **and** a
cited supporting document. A generic file attachment does not satisfy it. This
held under direct attempts to get past it.

**Security.** Nine cross-tenant attacks refused with no stray rows. Forged and
malformed tokens refused. Wrong password and unknown user are indistinguishable,
so the endpoint is not a user-enumeration oracle. 224 permission probes with
zero mismatches between what the policy declares and what the server enforces.

**The application runs.** All 93 migrations apply to an empty database, the API
boots, all 35 routes render in a browser, all 16 project modules keep their
project in context, and the workspace dashboard's Active Projects count
reconciles against the records behind it.

## Defects found and fixed

### Blockers

**BUG-AUDIT-001** — No company-scoped record could be created at all.
`AuditEvent.projectId` was `NOT NULL`, so any organisation-level entity failed
its audit write and rolled back. The company template library was unusable: a
construction company could not define one shared inspection checklist.

**BUG-WORKFLOW-001** — Creating a change order threw a Prisma serialisation
error and rolled back, because a `Decimal` was written into a JSON column as its
internals. Invisible to the unit suite, where mocked rows carry plain numbers.

### Criticals

**BUG-PERM-001 / -002** — The change-order register and the EOT claim register
had no read guard. Warehouse, procurement and site engineers could read contract
values, variation pricing and delay entitlement.

**FE-001** — A transient failure on `/auth/me` logged the user out and dumped
them on the marketing landing page. A rate limit, a 500 or a dropped connection
during the session check discarded whatever they were entering. Only a 401 now
means "not signed in".

**FE-002** — The Reports page crashed into an error boundary.
`sources: listSources()` was missing an `await`, so JSON serialised a pending
Promise as `{}` and the frontend called `.find()` on an object.

### Major

**FE-003** — Every calendar date displayed a day early west of UTC. Contract
start and finish, baseline, and the data date that gates all earned-value
reporting. A completion date shown a day early is a liquidated-damages date
shown a day early. Fixed for the project list with a new shared date helper;
**57 files still call `toLocaleDateString` directly** and remain to be migrated.

## Open

| ID | Severity | Summary |
| --- | --- | --- |
| GAP-UI-001 | Major | Procurement has an API, a permission module and a user role, but no interface |
| GAP-INT-001 | Major | An RFI cannot enter the change-event pricing flow; it converts straight to a change order |
| FE-003 (remainder) | Major | 57 files still format calendar dates in local time |
| FE-004 | Minor | Five different list envelope shapes across the API |
| FE-005 | Minor | The subscription is re-fetched on every navigation |
| FE-006 | Minor | No client-side validation on the cost code form |

Also open from the setup pass: `schema.prisma` and the migrations have drifted
(33 index differences), with no runtime impact but a spurious migration waiting
for anyone who runs `prisma migrate dev`.

## Module readiness

Scored on evidence, not on code inspection. "Integration" scores only what was
observed crossing a module boundary; "Tested" scores what an automated test now
pins.

| Module | Feature | Workflow | Integration | Permissions | Tested | Overall |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Authentication & tenancy | 95 | 92 | 90 | 100 | 92 | **94** |
| Permissions / RBAC | 95 | 90 | 85 | 100 | 95 | **93** |
| Cost & budget | 90 | 85 | 85 | 100 | 80 | **88** |
| Change management | 92 | 90 | 85 | 100 | 82 | **90** |
| Projects | 92 | 82 | 78 | 100 | 78 | **86** |
| Company workspace | 90 | 82 | 85 | 95 | 75 | **85** |
| RFIs | 90 | 80 | 75 | 100 | 75 | **84** |
| Reporting & dashboards | 85 | 65 | 45 | 100 | 45 | **68** |
| Schedule & progress | 85 | 70 | 50 | 100 | 45 | **70** |
| Quality (punch, NCR, ITP) | 85 | 70 | 40 | 100 | 38 | **67** |
| Commitments & pay apps | 85 | 70 | 30 | 100 | 22 | **61** |
| Drawings & documents | 85 | 70 | 32 | 100 | 25 | **62** |
| Site reporting | 85 | 70 | 30 | 100 | 27 | **62** |
| Notifications | 75 | 50 | 20 | 90 | 10 | **49** |
| Procurement | 80 | 55 | 20 | 100 | 15 | **54** |

A low "Tested" score means *not yet exercised*, not *known broken*.

## Top issues to fix

1. Build the Procurement interface, or remove the role and module.
2. Finish the financial chain: commitment → pay application → payment → actual
   cost → forecast.
3. Migrate the remaining 57 date call sites off local-time formatting.
4. Cover bid → award → commitment in a browser test.
5. Decide the RFI → change event path (GAP-INT-001).
6. Verify inspection → punch → reinspection → closure in a browser.
7. Reconcile the remaining dashboard KPIs; expose percent complete on the
   project health payload so it can be reconciled at all.
8. Extend permission testing from read-only to all nine actions, at both layers.
9. Drive submittals, drawings, daily logs and notifications.
10. Normalise the list envelope shapes in a versioned change.

---

## Can a construction company now use OctaPM through the actual interface, from
## project creation through project closeout, without hitting a broken critical
## workflow?

# PARTIALLY

### The evidence for the improvement

Before these two passes the answer was **NO**, and not marginally. Two blockers
would have stopped a real company within the first hour: no company standard of
any kind could be created, and raising a change order from an RFI crashed and
rolled back. Two permission holes exposed contract values to warehouse staff. A
transient network blip signed users out and lost their work. The Reports page
crashed outright. Every contract date displayed a day early.

All of those are fixed and retested, most of them in a real browser.

And the chain that matters most now works end to end through the interface:
budget → change order → governance → approval → revised budget, with the
arithmetic exact and the screen agreeing with the database.

### Why it is not YES

Measured against the criteria in the brief, five of eleven are unmet:

| Criterion | Met |
| --- | --- |
| Real browser project lifecycle completes | ❌ preconstruction and closeout not driven |
| Financial spine completes | 🟡 budget→change→revised proven; commitment→pay app→actual not |
| Bidding / award chain completes | ❌ not exercised |
| RFI / change chain completes | 🟡 RFI→change order works; RFI→change event does not exist |
| Drawings and submittals complete | ❌ render only |
| Procurement has a functional UI | ❌ none |
| Quality workflow completes | ❌ not exercised in a browser |
| Permissions tested beyond read-only | 🟡 API only, read actions |
| Notifications function | ❌ not exercised |
| Dashboard values reconcile | 🟡 one KPI pinned, the rest by hand |
| No P0 or P1 workflow defect remains | ❌ GAP-UI-001 and GAP-INT-001 are P1 |

The single hardest blocker is **Procurement**: it is one of the eight user
roles, it has an API and a permission module, and it has no screen. A
procurement officer cannot use this product at all. That alone prevents "from
project creation through closeout".

Beyond that, the second half of the financial chain — commitments, pay
applications, actual cost, forecast — is where a contractor's money actually
moves, and none of it has been driven through the interface.

### What would move this to YES

Four pieces of work, in order:

1. Build the Procurement UI on the existing API, connected to long-lead items.
2. Drive commitment → pay application → payment → actual cost → forecast in a
   browser and prove the arithmetic, as was done for the budget.
3. Cover bid → award → commitment, and the quality chain, with browser tests.
4. Clear the remaining date-formatting call sites.

None of that is a rewrite. The architecture held up under adversarial testing at
both layers — tenant isolation, token forgery, privilege escalation and
governance bypass all failed to break it. What remains is coverage and one
missing interface, which is a far better position than this report could have
described a day ago.

---

## Documents

| Document | Contents |
| --- | --- |
| `OCTAPM_BROWSER_E2E_REPORT.md` | The browser pass, what it covers and what it does not |
| `OCTAPM_FINANCIAL_E2E_REPORT.md` | The financial spine, stage by stage, with the arithmetic |
| `OCTAPM_FRONTEND_ROUTE_AUDIT.md` | Every route, rendered and checked |
| `OCTAPM_FRONTEND_TECHNICAL_DEFECTS.md` | Console errors, failed calls, rendering faults |
| `OCTAPM_DASHBOARD_RECONCILIATION.md` | KPIs recomputed from source records |
| `OCTAPM_DEFECT_REGISTER.md` | Every defect, with reproduction and fix |
| `OCTAPM_INTEGRATION_MAP.md` | Which module connections actually carry data |
| `OCTAPM_PERMISSION_TEST_MATRIX.md` | 28 modules × 8 roles, observed behaviour |
| `OCTAPM_FEATURE_TEST_MATRIX.md` | 56 features probed live |

## Reproducing everything

```bash
npm run db:dev --workspace=backend       # terminal 1
npm run db:seed --workspace=backend
npm run dev --workspace=backend          # terminal 2
npm run dev --workspace=frontend         # terminal 3

npm run test --workspace=backend                        # 1583 unit tests
node backend/scripts/qa/run.js                          # API scenarios
npx playwright test --config=frontend/playwright.config.ts   # browser E2E
```
