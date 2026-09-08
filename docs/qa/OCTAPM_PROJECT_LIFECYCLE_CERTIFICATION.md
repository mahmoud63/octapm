# Project lifecycle certification

**Phase 16** · **Written:** 2026-09-08
**Cards:** OCTA-BILL-PLAN-072 · OCTA-INV-PROJECT-073
**Harnesses:** `scratchpad/isolation.js`, `scratchpad/greenfield.js`

Two questions the earlier phases could not answer, because the database held one
organisation and one long-lived project:

1. **Does anything cross a tenant or project boundary?**
2. **If somebody signs up today and starts a project, does the money come out
   right?**

Both are now answered by driving the running system. **Isolation: 31 of 31.
Greenfield lifecycle: 17 of 17.** Three defects were found on the way, two of
them front-door.

---

## 1. The front door was shut

### 🔴 → ✅ OCTA-BILL-PLAN-072 · The demo organisation could not create a project

`enforceProjectLimit` read the allowance as:

```js
const limit = PLANS[sub.plan]?.projectLimit ?? 0;
```

The plan catalogue contains `trial`, `individual`, `business` and `enterprise`.
`prisma/seed.js` wrote **`"standard"`**, which it never has. So the lookup
missed, `?? 0` made the allowance nought, `count >= 0` is always true, and the
demo and UAT organisations **could never create a project** — told, on the front
door of the product:

> *Your current plan allows 0 project(s). Upgrade to add more.*

A configuration fault of ours, presented to a customer as a billing problem they
could only fix by paying.

**Fixed in two places.** The seed writes a plan that exists (`business`). And the
gate no longer translates "I do not recognise this plan" into "you have used
your allowance" — an unknown plan now raises `500 SUBSCRIPTION_PLAN_UNKNOWN`
naming the plan and saying whose fault it is, because a limit you cannot
determine is not a limit of nought. Seventeen organisations and two
subscriptions were moved off the non-existent plan in this database.

### ✅ Not a defect: a new tenant is locked until it adds a card

A newly registered organisation gets `status: 'incomplete'`, which is not in
`ACCESS_STATUSES`, so every write answers `402 SUBSCRIPTION_REQUIRED`. That
looked like the same class of bug — but the 7-day trial is started by
`startTrialSetup` → `confirmTrial`, which attaches a Stripe payment method
first. **The paywall is deliberate** and was left alone.

---

## 2. Tenant and project isolation — 31 / 31

A second organisation was registered through `/auth/register`, given an active
`business` plan, and pointed at everything the first one owns.

> **Why the plan mattered.** On the first run, every write by tenant B came back
> `402 SUBSCRIPTION_REQUIRED` — the paywall refusing before the tenancy check
> ever ran. Scoring those as passes would have been a lie: the request never
> reached the code under test. They were recorded as **SKIP**, and the tenant was
> made a paying customer so the question could actually be asked.

### Reading across the boundary

| | |
| --- | --- |
| Project, commitments, a commitment, pay applications, a pay application, cost ledger, budget lines, activities, cash flow, audit trail | **404 PROJECT_NOT_FOUND** — 10 of 10 |
| Project list, companies, inventory items, warehouses | **200, empty** — 4 of 4, no rows of the other organisation |
| Tenant A reading tenant B's project | **404**, and not in A's list |

### Writing across the boundary

All eight refused: raise a pay application on A's commitment, certify it, pay it,
raise a commitment, recompute A's actual cost, open A's legacy balances, issue
A's stock, receive into A's warehouse. Cost and inventory answer
`ITEM_NOT_FOUND`; everything project-scoped answers `PROJECT_NOT_FOUND`.

**404 rather than 403 is the right refusal** — it does not confirm the record
exists.

### Across projects inside one organisation

| | |
| --- | --- |
| Raise a pay application on project 1's commitment from project 2 | 404 |
| Read project 1's commitment, pay application or activity from project 2 | 404 × 3 |
| Issue stock naming project 2 with an activity from project 1 | **was accepted** — see below |
| A new project starts with a clean ledger | 0.00, balanced |

---

## 3. 🔴 → ✅ OCTA-INV-PROJECT-073 · Cost could be posted to the wrong project

The attack neither adversarial pass could run:

```
issue naming project 2 with an activity from project 1
  → ACCEPTED — cost posted to project 2 for work on another project
```

**This was mine.** In Phase 12 I made a stock issue derive its project from the
activity when the caller omitted one — which fixed material cost vanishing. But
when the caller supplied *both* and they disagreed, the caller's `projectId` won
and the activity's real project was ignored. One project's budget absorbing
another's cost, accepted with a `201`.

The evidence was right there in the same run: the brand-new project reported a
ledger of **588.85** it had never spent — my own attack's money.

**Fixed.** The activity is the stronger claim: it says what the material was
actually used on. A contradicting `projectId` is now refused with
`400 INV_PROJECT_MISMATCH`, naming both projects.

**Re-driven:** `400 INV_PROJECT_MISMATCH`, and the new project's ledger back to
`0.00, balanced`.

---

## 4. Greenfield lifecycle — 17 / 17

A project created from nothing, driven to a certifiable state. Every figure
recomputed from the cost ledger.

| Step | Result |
| --- | --- |
| A project can be created | ✅ |
| It starts empty, balanced, with nothing to migrate | ✅ `ledger 0.00` |
| Cost codes available to budget against | ✅ |
| A budget line can be created | ✅ 900,000 |
| An activity can be created | ✅ G-1000 |
| A subcontract can be raised | ✅ SC-001 |
| It can be executed | ✅ |
| Committed cost is the schedule of values, not a typed total | ✅ 800,000 |
| Progress can be recorded and approved | ✅ 40% |
| A payment application can be raised | ✅ SC-001-PA01 |
| It can be certified | ✅ gross 200,000 |
| **Certified cost is exactly what the ledger holds** | ✅ 200,000 = 200,000 |
| **Balanced, no legacy balance to open** | ✅ |
| **The cost reaches the activity it was done on** | ✅ 1 entry, 200,000 |
| **The cost reaches the budget line** | ✅ actual 200,000 against a 900,000 budget |
| Paying it moves cash, not cost | ✅ ledger unchanged |
| The payment reaches cash flow | ✅ outflow 180,000 = the net payment |

**A project started today is financially sound end to end** — which the seeded
project could not demonstrate, carrying 4.1m of opening balance that had to be
migrated before it reconciled.

### One setup dependency worth knowing

An activity will not be created without `engineerIds` — *"At least one engineer
required"*. So a new project needs its people before it can have a programme.
Correct as a rule; worth stating because it is the first thing that stops a
brand-new project.

---

## 5. Evidence

| | |
| --- | --- |
| Isolation | **31 pass · 0 fail · 0 skip** |
| Greenfield certification | **17 / 17** |
| Backend | **1,830 Jest across 166 suites** (plus the known `report-builder-sources` timeout under parallel load) |
| New unit tests | 5 on the project limit, 1 on the project/activity mismatch |

## 6. A note on method, again

Of the six things that first looked broken in this phase, **three were not**:
the new-tenant paywall is deliberate; `budget` and `engineerIds` on activity
creation were my harness's payload, not the product's fault; and the progress
route existed all along. Each was checked against the code or the API before
being written down.

The two that survived were both real, and both were **silent wrong answers
rather than errors** — a plan lookup that missed and returned nought, and a
project id that quietly overrode the activity it contradicted. That is the shape
this codebase's remaining defects keep taking, and it is the shape a test suite
is worst at seeing.
