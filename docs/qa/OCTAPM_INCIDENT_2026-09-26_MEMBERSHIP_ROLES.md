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
- **Status: restoration prepared, not applied.** A dry run and a backup of the 24 rows as they stand
  exist; applying it writes the shared database outside a designed repair path, so it waits for the
  product owner's approval.

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

## Lessons

- A fix pass that finds data it did not expect must stop and report — it did — and must date the
  evidence from the rows, not from assumption: the rows' identical timestamp was the fingerprint of a
  single statement inside the session.
- An `undefined` in a Prisma filter is not an error; on a shared database it is a table-wide write.
