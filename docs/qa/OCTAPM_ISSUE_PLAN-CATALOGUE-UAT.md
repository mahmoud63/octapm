# PLAN-CATALOGUE-UAT — the UAT organisation is on a plan the catalogue does not contain

**Status:** **fixed** 2026-09-29 (commits `0e069d1`, `dd1dc30`, `c0675cd`, `4bb0861` on
`feat/p0-foundations-sprint1`, after the Round-4 checkpoint) — the `Organisation.plan` →
`workspaceType` work (decision 4) stays open for M8/M9 · **Severity:** P2 — configuration / product
consistency · **Opened:** 2026-09-26 ·
**Owner decisions:** recorded below (2026-09-26). Not a blocker for the enterprise or project-controls
waves.

## Resolution (2026-09-29)

### What changed

| Where | Before | Now |
|---|---|---|
| `backend/src/config/plans.js` | four plans; `PLANS[id]` lookups everywhere (`PLANS.toString` counted as a plan) | the same four plans, nothing added; `isRecognizedPlan` / `recognizedPlan` (own keys only), `storedPlanIdentifier` (echo a plain token, withhold anything else), `planConfigurationError` — one sentence for every surface |
| `serializeSubscription` (GET `/billing/subscription`, subscribe, cancel, trial confirm) | unknown plan shown as `PLANS.trial` — "Trial", one project, three AI generations | `recognized: false`, `planName: null`, `limits: null`, `configurationError: { code: "SUBSCRIPTION_PLAN_UNKNOWN", message }`, `plan` = the stored identifier when it is a plain token (else `null`); the flat `projectLimit` / `aiLimit` are left out for it (null there means "unlimited"). Recognised plans keep every field and gain `recognized: true`, `limits`, `configurationError: null` |
| `enforceProjectLimit` | 500 `SUBSCRIPTION_PLAN_UNKNOWN` | unchanged code and status, the shared sentence, marked `expose` so production keeps it |
| `assertAiQuota` | `PLANS[plan]?.aiLimit ?? 0` → 402 `AI_LIMIT_REACHED` "allows 0 … Upgrade" | 500 `SUBSCRIPTION_PLAN_UNKNOWN`, the same sentence as the project gate and the screen |
| Error catalogue / OpenAPI | code not catalogued; `BillingSubscription.plan` an enum a fault would violate | `SUBSCRIPTION_PLAN_UNKNOWN` (billing, 500) in the catalogue and the `ErrorCode` enum; `BillingSubscription` documents `recognized`, `limits`, `configurationError` |
| Web Settings › Billing, plans page | printed `planName` ("Trial") | "Subscription plan: configuration issue", stored plan, "Limits unavailable — contact your administrator." and the server's sentence; a recognised plan shows its name and limits ("Up to 25 live projects · 0 of 150 AI generations used this period") |
| Mobile | no billing screen; the refusal was a generic retryable "try again" | the same configuration-issue sentence, not retryable |
| `e2e/uat/seed-uat-fixtures.mjs` | `Subscription.plan = "standard"` | `UAT_SUBSCRIPTION = { plan: "business", status: "active" }`; `Organisation.plan` untouched (decision 4). The seed could not run at all since ENT-3 (ProjectAssignment's `orgId`, NOT NULL since M7, was missing from the upsert's create) — it now passes it |

### The reseed (the owner-sanctioned path, 2026-09-29 11:17–11:19 UTC)

- `membership-integrity-sentinel.js --snapshot` before, `--compare` after: **PASS** — 24 durable
  organisations, 48 memberships, 0 changes to existing memberships, 0 created.
- A read-only whole-database digest per table and organisation before and after: every changed
  group is UAT's (`Organisation`, `Subscription`, `User`, `Project`); every row written since 11:17 in
  the tables without `orgId` (`Activity`, `BoqItem`, `ActivityBoqAllocation`, `ActivityProgress`,
  `CostRecord`, `ScheduleRevision`) belongs to a UAT project. Nothing deleted; every row count
  unchanged. `bulk-write-fingerprint.js --since "2026-09-29 11:16:00"`: PASS.
- The first attempt stopped at the ProjectAssignment upsert (above) after writing only UAT's
  organisation, subscription, users and projects; the second, with the seed fixed, completed.
- `subscription-invariants.js`: 24 durable organisations, **24 PASS, 0 REVIEW**; UAT `business /
  active / seats 1 / no period end`. (Its restoration expectations file still names `standard` for
  UAT and is the orchestrator's to update.)

### Verified afterwards (owner decision 2)

- **Subscription display says Business:** GET `/billing/subscription` under the UAT owner's token
  reads `plan business, recognized true, planName Business, limits 25 / 150`; Settings › Billing
  signed in as `uat.pm` reads "Business" and "Up to 25 live projects · 0 of 150 AI generations used
  this period", no fault block.
- **AI quota is the business allowance:** `assertAiQuota` lets UAT through (0 of 150 used).
- **Project creation works:** a nameless POST `/projects` as the UAT owner passes the subscription
  gate and the project limit and stops at the validator (400), with nothing written — the full
  creation path is proven on a business LiveTest organisation (201).
- **Guards agree with the display:** for every restored organisation the billing read's
  `limits.projectLimit` equals the gate's catalogue limit; for an unknown plan the read's
  `configurationError.message` is the sentence the project gate answers with.

### Tests (each mutation-proved, restored byte-identical)

- `backend/src/services/__tests__/subscription-plan-catalogue.test.js` — the catalogue is exactly the
  four; an unknown plan is not serialized as trial; unsafe identifiers are withheld; the AI quota is
  the configuration fault; the seed writes business / active; the company workspace label
  `standard` (Organisation.plan) is not a subscription plan.
- `backend/src/services/__live__/subscription-plans.live.test.js` — unknown plan on a LiveTest
  organisation (one row by its `orgId`): display and gates agree; business shows Business and
  creates; restored organisations' display equals their gate limit; UAT business through the
  product.
- `frontend/e2e/59-subscription-plan-display.spec.ts` — the web display for business and for
  `standard`, and the gate's sentence on screen.
- `mobile/src/api/errors.test.ts` — the mobile sentence, not retryable.

Still open, by decision: **decision 3/9** (scan staging / legacy snapshots for plans outside the
catalogue before AWS staging or production) and **decision 4** (the `workspaceType` migration, M8/M9,
below).

## What was true before the fix (2026-09-26)

- `PMcopilots UAT Fixtures` holds `Subscription.plan = "standard"`, `status = "active"` — restored to
  exactly that on 2026-09-26 after the ENT-6 test incident
  ([incident record](OCTAPM_INCIDENT_2026-09-26_MEMBERSHIP_ROLES.md)); the value predates the incident.
- `backend/src/config/plans.js` defines four plans: `trial`, `individual`, `business`, `enterprise`.
  There is no `standard`.
- Consequences for the UAT organisation, proven by `subscription-plans.live.test.js`:
  - the subscription gate lets it write (status `active`);
  - creating a project answers **500 `SUBSCRIPTION_PLAN_UNKNOWN`** (`enforceProjectLimit`, the guard
    OCTA-BILL-PLAN-072 added so an unknown plan reads as a configuration fault instead of a limit of
    nought);
  - its AI allowance is nought (`assertAiQuota`: `PLANS[plan]?.aiLimit ?? 0`).

## Where `standard` comes from

| Source | What it writes | Reachable by a customer? |
|---|---|---|
| `e2e/uat/seed-uat-fixtures.mjs` | `Subscription.plan = "standard"` and `Organisation.plan = "standard"` on every run | No — a local fixture script |
| `prisma/seed.js` before `0de2d09` (2026-09-08) | the demo organisation was on `standard`; OCTA-BILL-PLAN-072 moved the demo seed to `business` and left the UAT seed unchanged | No |
| `subscription.service.subscribe` | only `PLANS[planId]` other than `trial`/`enterprise` (400 `INVALID_PLAN` otherwise) | Yes — but never `standard` |
| `ensureSubscription` (sign-up, provisioning) | `trial / incomplete` | Yes — never `standard` |
| Stripe webhook | never writes `plan` | — |

So **no real customer can reach `Subscription.plan = "standard"`** through the product today: the
inconsistency is confined to the UAT fixture. That is why the severity is P2, not higher.

## Related inconsistencies found while investigating

1. **Two plan vocabularies.** `Organisation.plan` (a separate column, default `"standard"`) is used by
   ENT-6 as a workspace label: `individual` for a personal workspace, `standard` for a company one
   (`organisation.service.js planForKind`). Nothing gates on `Organisation.plan`, but the word
   `standard` means "a company workspace" there and "an unknown subscription plan" on `Subscription`.
2. **Unknown plans are treated two ways.** `serializeSubscription` shows `PLANS[sub.plan] ?? PLANS.trial`
   — the UAT organisation is *displayed* with trial limits (one project, three AI generations) while the
   gate answers 500 for any project. A user would be told they are on a trial when they are not.

## Questions for the product owner (not to be decided by guessing)

1. Which plans does the product officially support — exactly the four in `config/plans.js`?
2. What should the UAT fixture organisation represent: a paying `business` customer (like the demo), a
   trial, or a deliberately unknown plan to exercise the configuration-fault path?
3. Is `standard` a legacy plan any real (production) organisation still holds? If yes, the catalogue
   needs it (or a migration path); if no, retire it everywhere.
4. Should `Organisation.plan` keep a separate vocabulary (`individual` / `standard`) from
   `Subscription.plan`, or be renamed (e.g. a workspace `tier`) so the two cannot be confused?
5. Should an unknown subscription plan be displayed as a configuration fault too, rather than as a
   trial?

## Owner decisions (2026-09-26, authoritative)

1. **Official subscription catalogue:** `trial`, `individual`, `business`, `enterprise` — nothing else.
   `standard` is not added to the catalogue to preserve an old fixture value.
2. **UAT Fixtures represents a normal paying company:** `Subscription.plan = business`,
   `status = active`, set through the canonical seed (`e2e/uat/seed-uat-fixtures.mjs`) and a normal
   reseed — never a hand edit of the row as the permanent fix. Verify afterwards: project creation
   works, the AI quota is the business allowance, the subscription display says Business, and the
   guards agree with the display.
3. **`standard` as a subscription plan is legacy residue.** Before any production migration, scan the
   production/legacy database and any retained snapshot for `Subscription.plan = standard` or any plan
   outside the catalogue; map each real tenant by its actual entitlement — never convert every row to
   `business` automatically. Local/demo/UAT fixtures may follow canonical seed intent.
4. **`Organisation.plan` is a different concept** (ENT-6 uses it for workspace kind:
   `individual` / `standard`). It is deprecated; the target is `Organisation.workspaceType`
   (`PERSONAL` / `COMPANY`). Not changed during PC-4: scheduled for enterprise cleanup / M8-M9 with an
   additive migration — add `workspaceType`; backfill deterministically (`individual` → `PERSONAL`,
   `standard` → `COMPANY`, any other value classified and reported, never guessed); move reads and
   writes to `workspaceType`; keep `Organisation.plan` for compatibility while needed; remove it only
   after every consumer and the migration are certified. No destructive one-step rename.
5. **Workspace type and subscription plan never mix:** "ABC Construction" = `COMPANY` +
   `business`; "Mohamed's Workspace" = `PERSONAL` + `individual`.
6. **An unknown plan is a configuration fault, never the lowest tier.** Display: "Subscription plan:
   configuration issue", the stored plan identifier where safe, limits unavailable, action "contact
   your administrator". Read endpoints return structured information within the existing envelope
   (conceptually `plan`, `recognized: false`, `limits: null`,
   `configurationError: "SUBSCRIPTION_PLAN_UNKNOWN"`); mutation gates keep refusing with
   `SUBSCRIPTION_PLAN_UNKNOWN`. Audit every subscription consumer so no screen shows Trial, 0 projects
   or 0 AI generations for an unknown plan.
7. **Order:** PC-4 merge → Round-4 checkpoint → this small hardening fix → Round 5 (PC-5, PC-7a,
   PC-8) → PC-6 → PC-7b → full certification → Codex. Smallest isolated fix; no billing redesign.
8. **Tests required:** the catalogue contains exactly the four plans; the UAT seed creates
   `business / active`; an unknown plan is not serialized as trial; an unknown plan's project creation
   is refused with the configuration error; an unknown plan's AI quota does not masquerade as a tier;
   business UAT creates a project within its limit and receives the business AI allowance; new code
   cannot confuse `workspaceType` with `Subscription.plan`.
9. **Legacy data certification before AWS staging/production:** scan local, staging and any legacy AWS
   database/snapshot; report recognised plans, unknown plans, `standard` rows, organisation ids and the
   intended migration. No production plan migration without an explicit mapping.

## Proposed resolution (after the answers)

*Carried out on 2026-09-29 as recorded under "Resolution" above: UAT is `business` through the
canonical seed; `standard` was not added (decision 1; after the reseed no durable organisation in the local database
holds a plan outside the catalogue — staging/legacy scans remain decision 9's); the serializer
reports an unknown plan as a configuration fault.*

- If UAT should be a paying customer: change `seed-uat-fixtures.mjs` to `business` (as the demo seed
  was) and re-run it — no hand edit of the database row.
- If `standard` is a legacy plan still held somewhere: add it to `config/plans.js` with explicit limits,
  or migrate those organisations through the normal plan-change path.
- Make `serializeSubscription` report an unknown plan as a configuration fault, consistent with
  `enforceProjectLimit`, with a unit test and a live test.
- The subscription invariant checkpoint (`scripts/enterprise/subscription-invariants.js`) already flags
  any plan outside the catalogue; the UAT row passes today only because the restoration expectation
  names `standard` on purpose.
