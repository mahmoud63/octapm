# QA incident — membership roles and subscriptions overwritten by a live test (2026-09-26)

**Classification:** test-harness defect against the local shared development/test database.
**Not a production incident:** no production, staging or customer data exists or was touched; the
database is the embedded Postgres on this machine (`localhost:55432`, `octapm_verify`).

## Timeline (CDT)

| Time | Event |
|---|---|
| 17:52:36 | One statement set `role = 'pm'` on every row of `OrganizationMembership` (identical `updatedAt` 22:52:36.677 UTC on 47 rows). |
| ~18:45 | The ENT-6 fix pass noticed non-owner memberships reading `pm` on three durable organisations and stopped under §134 instead of "repairing" them — correctly — but misdated the rows as older than the session. |
| 19:00 | The integrator traced the statement, sized it, backed up the damaged rows and restored them. |
| 19:05 | Verified; test-harness guard committed (`a5ce39a`). |

## Cause

`backend/src/services/__live__/organisation-lifecycle.live.test.js` (ENT-6 branch, line 585):

```js
await prisma.organizationMembership.updateMany({ where: { orgId: personal.orgId, userId: colleague.id }, data: { role: "pm" } });
```

During a mutation-proof run an earlier step failed, leaving `personal.orgId` and `colleague.id`
undefined. Prisma omits a filter whose value is `undefined`, so the statement had no `where` at all
and updated every membership in the database.

## Impact

- 47 of the 48 membership rows were set to `pm`; **23 were materially wrong** (the other 24 already
  held `pm`). Only `role` changed — `isAdmin`, `isOwner`, `kind` and `status` were untouched.
- Affected organisations: OctaPM Demo Contracting (8), OctaPM E2E (8), PMcopilots UAT Fixtures (7),
  plus single-member test residue organisations whose members were already PMs.
- Because `authenticate` reads the membership role, for about 70 minutes every site engineer, QS,
  planner, cost controller, procurement, warehouse, finance and quality user of those three
  organisations held PM authority on the local API.

### Second write from the same run — subscriptions (found 2026-09-26 ~19:50 CDT)

Ten seconds later (22:52:46.209 UTC) the same file's helper
`activate(orgId) → prisma.subscription.updateMany({ where: { orgId }, … })` ran with `orgId`
undefined and set **all 24 subscriptions** to `plan business, status active, seats 25,
currentPeriodEnd +30 days`. A scan of all 190 tables for rows sharing one `updatedAt` across
organisations found these two writes and nothing else on the day.

- `seats` is display-only and `currentPeriodEnd` only matters for a cancelled subscription (all 24
  are active), so those two fields changed nothing behaviourally.
- Material: **PMcopilots UAT Fixtures** moved from `standard` (a plan the catalogue does not contain,
  so no project allowance) to `business`; **21 harness residue organisations** (the security
  harnesses' intruder organisations and two manual sign-ups) moved from `trial / incomplete` — which
  the subscription gate refuses — to `business / active`. The demo and E2E organisations' plan and
  status did not change (`business / active` is what the seed writes).
- No history table exists for subscriptions; the pre-incident values are reconstructed from the only
  code paths that could have written them (none of the 24 has a Stripe subscription):
  demo and E2E ← `prisma/seed.js` (business/active; seats and period end never written); UAT ←
  `e2e/uat/seed-uat-fixtures.mjs` (standard/active); residue ← `POST /auth/register` →
  `ensureSubscription` (trial/incomplete).
- **Status: restored (2026-09-26 20:18 CDT, on the product owner's instruction).**

#### Subscription restoration

| | |
|---|---|
| Subscription blast radius | 24 subscriptions (every subscription of every durable organisation) |
| Affected fields | `plan`, `status`, `seats`, `currentPeriodEnd` (no other column; `updatedAt` stamped) |
| Cause | unsafe mutation-proof helper `activate(orgId)` — its `orgId` came out undefined and widened `subscription.updateMany` to the whole table |
| Rows restored | **24** |
| Rows requiring review | **0** (no row had a Stripe customer or subscription, trial dates, or a change after the incident) |
| Membership incident | repaired separately (above) |
| Production impact | **NONE** — no production, staging or customer database exists or was touched |

Canonical sources, and why each value is provable rather than guessed:

- **Every non-test writer of these columns** since the subscription module arrived (commit
  `19b0c3f`): `plan`/`status` are written at creation (register → `ensureSubscription`
  = `trial / incomplete`; `prisma/seed.js` = `business / active`; `seed-uat-fixtures.mjs` =
  `standard / active`) and otherwise only by Stripe-driven paths (subscribe, webhook, trial
  confirmation, cancel) or scheduler paths that need a `trialing`/`canceled` row. `seats` has never
  been written by non-test code (column default 1, migration `20260523182810`). `currentPeriodEnd` is
  written only by the Stripe subscribe path and the Stripe webhook. No migration updates
  `Subscription`. None of the 24 rows has a Stripe id or trial dates, so none of those paths ran.
- **Demo, E2E** ← `prisma/seed.js` upsert: plan/status `business / active` kept as they were; seats
  restored to 1, `currentPeriodEnd` to NULL.
- **UAT** ← `e2e/uat/seed-uat-fixtures.mjs` upsert: `standard / active`, seats 1, `currentPeriodEnd`
  NULL. Note: `standard` is not in `config/plans.js`, so project creation in the UAT organisation
  answers 500 `SUBSCRIPTION_PLAN_UNKNOWN` — the pre-incident state OCTA-BILL-PLAN-072 recorded; the
  demo seed was moved to `business` then, the UAT seed never was (follow-up).
- **21 harness residue organisations** (security harnesses' intruders "Other Corp Contracting",
  "Rival …", "Probe Corp", and two sign-ups "as", "g") ← `POST /auth/register` →
  `ensureSubscription`: `trial / incomplete`, seats 1, `currentPeriodEnd` NULL —
  `scripts/phase21/stage7-security.js` documents this as the intended state ("a brand new
  organisation is on a trial with no allowance, so its writes are stopped by the subscription gate").

How it was applied: a dry-run table first; then one transaction of 24 writes, each addressed to one
subscription id and preceded by assertions (subscription exists, belongs to the planned
organisation, the organisation exists and still classifies as planned, the row still holds the
incident's values) — any failed assertion would have rolled back every write; 5 ms between writes so
each row has its own timestamp. Only differing fields were written (demo/E2E: seats and period end;
UAT: plan, seats and period end).

Verification (durable organisations; concurrent live tests' throwaway organisations excluded):
24/24 rows at their targets; subscription and organisation counts unchanged; no subscription
created or deleted; no field other than the four changed; memberships (48), projects (435),
organisations, the cost ledger (969 rows, 101,877,948.38), budget lines, budget-line changes and cost
records byte-identical before and after; owners 24, admins 24; membership sentinel PASS; financial
snapshot 36/36 and reconciliation 16/16 with actual-cost delta 0.00 before and after, tables
identical; bulk-write fingerprint since the repair: none — the 24 writes are individual (the
membership incident's fingerprint remains visible; the subscription one is overwritten by the
repair's own timestamps and is preserved in this record and the backup). Subscription invariant
report (`scripts/enterprise/subscription-invariants.js --expect …`): 24 PASS, 0 REVIEW.
Behaviour (`subscription-plans.live.test.js`, 5/5, with a mutation proof): a never-started trial
reads but every write stops at the gate (402); a running trial allows one project and three AI
generations; `standard` passes the gate, cannot create a project (500 SUBSCRIPTION_PLAN_UNKNOWN) and
has no AI allowance; business allows projects and 150 generations; the 24 restored organisations
read as restored through their rows, the gate's decision functions and GET /billing/subscription
under each owner's token. The backup of the damaged rows stays outside the repository.

## Scope

Local shared development/test database only.

## Repair

The M2 membership backfill (`backend/scripts/enterprise/backfill-memberships.js --apply --org <id>`,
once per affected organisation) restored each home membership's role from its `User.role` — the
dual-written source the backfill was built from. Dry run first: 23 updates, 0 creates, no ownership
decisions. A backup of the damaged rows was taken before the repair.

## Verification

- Against the backup: 23 roles restored; **0 changes to any field other than `role`**.
- Whole table: **0 home memberships whose role differs from `User.role`**.
- A second backfill pass: 0 changes. §50 membership report: every row OK.
- Membership integrity sentinel: 24 durable organisations, 48 memberships, 24 owners, 24 admins, 0
  violations.

## Preventive controls

1. **Test-harness bulk-write guard** (`backend/src/__live__/bulk-write-guard.js`, installed by
   `enable-live.js`): in every live test and every in-process service, `updateMany`,
   `updateManyAndReturn` and `deleteMany` refuse a `where` that is missing, empty, or undefined
   throughout. Regression test: `bulk-write-guard.live.test.js` (its refusals run inside a transaction
   that always rolls back, so the proof cannot damage data even with the guard removed).
2. **Exact-key writes**: a test that changes one known membership uses
   `update({ where: { orgId_userId: { orgId, userId } } })`, which throws on a missing id instead of
   widening. The offending test is rewritten this way, with before/after assertions that exactly one
   membership changed.
3. **Isolated mutation-proof policy**: an experiment that removes a guard, breaks authorisation,
   tests an unsafe query or a destructive write runs in an ephemeral database/schema, inside a
   transaction rolled back regardless of the result, or on a throwaway `LiveTest` organisation whose
   identity is proven before every destructive action — never on the demo, UAT or E2E organisations,
   the certified project, or shared fixtures.
4. **Membership integrity sentinel** (`backend/scripts/enterprise/membership-integrity.js`):
   `globalSetup`/`globalTeardown` of every live-test run snapshot durable memberships and fail the run
   when any existing membership's role, kind, admin, owner or status changed, when one disappeared, or
   when a person was left with none; the same checks, plus the owner/admin/role-drift/assignment
   invariants, run at every integration checkpoint
   (`node scripts/enterprise/membership-integrity-sentinel.js`). Proof: `membership-sentinel.live.test.js`.
5. **Bulk-write fingerprint check** (`backend/scripts/enterprise/bulk-write-fingerprint.js --since
   <previous checkpoint>`): every table with a tenant column, grouped by identical `updatedAt`; a
   group spanning three or more organisations, one of them durable, fails the checkpoint. Over the
   incident window it reports exactly the two writes above; since the repair, none.
6. **Subscription invariant checkpoint** (`backend/scripts/enterprise/subscription-invariants.js
   [--expect <file>]`): every durable organisation has exactly one subscription, on a plan the
   catalogue knows (or one an expectation names on purpose), and — without a Stripe subscription —
   seats 1 and no period end, because no other code path writes them; with `--expect`, each
   organisation's plan, status and seats. Anything else is REVIEW, never silently fixed.
7. **The three other live tests that activated a throwaway organisation with
   `subscription.updateMany({ where: { orgId: user.orgId } })`** (auth-workspaces,
   ent-4-workspace-links, integrations-gate) move to the exact `update({ where: { orgId } })` form
   when ENT-6 — which edits the same helpers — is merged.

## Lessons

- A fix pass that finds data it did not expect must stop and report — it did — and must date the
  evidence from the rows, not from assumption: the rows' identical timestamp was the fingerprint of a
  single statement inside the session.
- An `undefined` in a Prisma filter is not an error; on a shared database it is a table-wide write.
