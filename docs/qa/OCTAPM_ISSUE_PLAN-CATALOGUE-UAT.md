# PLAN-CATALOGUE-UAT — the UAT organisation is on a plan the catalogue does not contain

**Status:** open · **Severity:** P2 — configuration / product consistency · **Opened:** 2026-09-26 ·
**Owner decision needed:** yes (see Questions). Not a blocker for the enterprise or project-controls
waves.

## What is true now

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

## Proposed resolution (after the answers)

- If UAT should be a paying customer: change `seed-uat-fixtures.mjs` to `business` (as the demo seed
  was) and re-run it — no hand edit of the database row.
- If `standard` is a legacy plan still held somewhere: add it to `config/plans.js` with explicit limits,
  or migrate those organisations through the normal plan-change path.
- Make `serializeSubscription` report an unknown plan as a configuration fault, consistent with
  `enforceProjectLimit`, with a unit test and a live test.
- The subscription invariant checkpoint (`scripts/enterprise/subscription-invariants.js`) already flags
  any plan outside the catalogue; the UAT row passes today only because the restoration expectation
  names `standard` on purpose.
