# Planning spine certification

**Phase 17** · **Written:** 2026-09-08
**Cards:** OCTA-PROG-ROLE-074 · OCTA-STATUS-ONE-075 · OCTA-IMPORT-CPM-076 · OCTA-ACT-P6ID-077
**Harnesses:** `scratchpad/planning.js`, `scratchpad/import-spine.js`, `scratchpad/boq-activity.js`

Everything certified up to now begins with an activity that already exists. The
financial spine, the subcontractor lifecycle, procurement, isolation, the
greenfield project — all of them start after the planning is done. This phase
drives the half upstream of that, which is where the product's central claim
lives: *every record links to a schedule activity, and progress propagates to
earned value.*

**Planning spine: 20 of 20. Import spine: 9 of 9.** Four defects found, all four
fixed and re-driven. Two of them made the product silently disagree with itself.

---

## 1. The arithmetic holds

The network was chosen so every number can be worked out on paper:

```
A (10d) ─┬─ B (5d) ─┬─ D (10d)
         └─ C (3d) ─┘
```

The long way round is 25 days; through C it is 23, so C carries two days of
float and nothing else carries any.

| | |
| --- | --- |
| Total float is late finish minus early finish, on every activity | ✅ |
| Zero float means critical, and nothing else is marked critical | ✅ |
| C carries 2 days, A, B and D carry none | ✅ |
| The project finishes when the longest path finishes | ✅ 25 days |
| **Lengthening the slack chain moves the critical path onto it** | ✅ C→6d: C critical, B gains a day, finish moves to 26 |

The last row is the one that matters. A critical path that does not move when a
duration moves is not a critical path — it is a picture of one.

> **A deliberate difference from the written rule.** The rule says *TF = 0 →
> critical*; the code marks `tf <= 0`. Negative float is more critical, not
> less, so the code is right and the shorthand in `CLAUDE.md` is the
> simplification. Left alone.

### Earned value, recomputed from the rows the formulas name

| | |
| --- | --- |
| Planned value is the approved cost loading up to the cutoff | ✅ 100,000 |
| Progress nobody has approved earns nothing | ✅ EV 0.00 while the submission sits unapproved |
| Earned value is the approved allocation times the approved progress | ✅ 100,000 × 60% = 60,000 |
| SPI is earned over planned, not a stored number | ✅ 0.6000 |
| Cost certified through the commercial spine reaches official AC | ✅ 60,000 |
| CPI is earned over actual, and EAC follows it | ✅ 1.0000, EAC 100,000 |
| **Approving more progress moves EV by exactly what it earned** | ✅ 60%→90% moved EV by 30,000 |

That last row is the propagation claim, measured rather than asserted.

---

## 2. 🔴 → ✅ OCTA-PROG-ROLE-074 · Nobody could record progress on most activities

`assertProgressSubmitAllowed` lets a PM or planning engineer record progress on
an activity they are not personally assigned to, and says so in the refusal it
raises:

> *Progress can only be submitted by assigned activity users or PM/planning
> overrides*

The route never passed `userRole`. It arrived `undefined`, the override could
never apply, and **the promised capability did not exist**. A PM could only
record progress on activities they were personally assigned to.

The evidence that settled it — same person, same activity, two endpoints:

```
POST /activities/:id/progress      → 403 ACTIVITY_PROGRESS_ASSIGNMENT_REQUIRED
POST /activities/bulk-progress     → 200
```

`bulk-progress` passes `userRole: getEffectiveRole(req)`; the single-activity
route did not. One line.

**Why it bites hardest:** an activity created from the BOQ grid has no engineer
assigned to it at all. Not the engineer (unassigned), not the PM (override
dropped) — so **no one could ever record progress against it**, and those are
precisely the activities that carry the approved allocations earned value is
computed from. The whole EV chain was unreachable through the front door.

**Re-driven:** PM on an unassigned activity now `200`. A site engineer with
project access but no assignment is still refused on all three activities
tried — the door opened only for the roles the message names.

---

## 3. 🔴 → ✅ OCTA-STATUS-ONE-075 · The schedule and the report disagreed about the same activity

One rule — *0% is To do, part done is In progress, all done is Complete, past
its finish date and unfinished is Delayed* — written four times:

| | order of tests | a 40%-complete, overdue activity |
| --- | --- | --- |
| `activity.service.js` (the API) | percentage first | `in_progress` |
| `schedule.service.js` | percentage first | `in_progress` |
| `export.service.js` | percentage first | `in_progress` |
| `report-sources.js` (report builder) | **date first** | **`delayed`** |

Measured on one activity, 40% complete and seven months past its finish date:

```
API /activities        → "in_progress"
report builder preview → "delayed"
```

The schedule screen and the report sent to the client disagreed about the same
record at the same moment. Three of the four also contradicted the rule the
product states, and the case they got wrong is the one that matters: **every
late activity anybody had touched vanished from the delayed count.** An activity
99% done and months overdue read as healthy.

The four also disagreed on spelling — `to_do` in the report builder,
`todo` in the API and the OpenAPI contract the mobile team consumes.

**Fixed** with one `deriveActivityStatus` in `utils/activity-status.js`, used by
all four. Precedence, because two facts can be true at once: finished outranks
everything (work done late is still done), then late, then under way.

**Re-driven:** all six activities on the test project now agree across the API
and the report builder — **0 disagreements**, and the overdue one reads
`delayed` in both.

> **What you will see change.** Delayed counts will rise on real projects. That
> is the correct number arriving, not a new problem — those activities were
> always late. Saved report definitions filtering on `to_do` would need the new
> spelling; there are none in this database, but check yours before deploying.

---

## 4. 🔴 → ✅ OCTA-IMPORT-CPM-076 · An imported programme arrived without dates

The most important thing a planner does on day one is import the programme they
already have. A four-task XER with finish-to-start logic was parsed perfectly —
4 tasks, 4 links, durations converted from hours to working days — staged as a
draft revision rather than dropped onto the live programme (good), reviewed,
approved and activated.

Then this is what the planner saw:

```
as activation left it:
    X-A ES0 EF10 TF0*  no date
    X-B ES0  EF5 TF0*  no date
    X-C ES0  EF3 TF2   no date
    X-D ES0 EF10 TF0*  no date
```

Every activity starting on day one, in parallel, with **no dates at all**, and a
critical path copied out of the file rather than calculated. A twenty-five day
job reading as ten.

`schedule.service.js` never called the CPM engine — not once, anywhere. The
import stored the logic correctly and nothing ever worked out what it meant.

```
after a critical-path run:
    X-A ES0  EF10 TF0*  2027-01-04
    X-B ES10 EF15 TF0*  2027-01-18
    X-C ES10 EF13 TF2   2027-01-18
    X-D ES15 EF25 TF0*  2027-01-25
```

Exactly the hand-computed answer. The parser was right, the engine was right;
only the trigger was missing.

**Fixed:** activation recalculates, inside the same transaction, so the
programme is never briefly wrong.

### ✅ Not a defect: the import refuses to touch the live programme

A staged revision changes nothing until somebody reviews, approves and activates
it — and the response says so on its face. Verified: **0 activities live while
the revision sat in draft.** My first harness called that a failure; the product
was right and the harness had skipped three steps.

---

## 5. 🔴 → ✅ OCTA-ACT-P6ID-077 · Imported activities had no visible identifier

`p6ActivityId` is stored on import (`X-A`, `X-B`…) and exposed by the report
builder, but the activities API never returned it, and imported activities have
no `activityCode` of ours. So after importing from P6 the activity list showed a
blank code against every row — the identifier everyone on site refers to work by
was in the database and unreachable.

**Fixed:** the DTO carries it, beside `activityCode` rather than folded into it.
They are two different identifiers and conflating them would lose which is
which.

---

## 6. A BOQ row cannot be attached to an activity that already exists

Not fixed in this phase — recorded, because it is a design question rather than
a fault, and the answer is the user's.

`docs/qa/boq-activity-spine.md` documents that a BOQ grid row mints a schedule
activity, deliberately. What is not addressed anywhere is what happens when a
programme already exists. Three bill rows all naming "Blockwork", on a project
whose planner had already made a "Blockwork" activity:

```
activities named "Blockwork": 4
   P-1000  duration 20   <- the planner's
   BL-001  duration 0    <- from the bill
   BL-002  duration 0
   BL-003  duration 0
```

Each row's whole quantity is auto-allocated to the activity it mints, so the
allocation endpoint — whose entire job is to link a BOQ row to an activity —
then refuses:

```
attach 100 m2 of BW-01 to the planner's P-1000
  → 400 ALLOCATION_QUANTITY_EXCEEDED
```

So on a project with an imported P6 programme, the bill and the programme cannot
be joined at all: you get a shadow programme of zero-duration stubs holding all
the money, beside the real one holding all the logic. And because earned value
reads approved allocations, EV would sit entirely on the stubs.

The blast radius is narrower than it first looks — the **upload** path does not
mint activities, only the grid, AI generation and the explicit endpoint do — so
this bites the planner who types rows into the grid on a project that already
has a schedule.

**Two ways to close it**, and the choice is a product decision:

1. **Let a row name the activity.** An optional `activityId` on the BOQ row:
   allocate to that activity, mint nothing. Explicit, no guessing, additive.
2. **Treat the same `activityName` as the same activity.** Fixes the duplicate
   stubs too, but joins by name — and this program has already decided, over
   company names, not to merge on a name.

Recommendation: (1), and leave the name alone.

> **Closed in Phase 18** by option (1), as recommended: a bill row now
> references an activity by `activityId`, creates one from `activityName`, or is
> left unallocated to be split across several. Nothing matches on a name. See
> `OCTAPM_BOQ_SCHEDULE_SPINE_CERTIFICATION.md` — 19 of 19 driven, plus a
> `POTENTIAL_SHADOW_ACTIVITY` diagnostic that reports the stubs already created
> and refuses to merge them.

---

## 7. Evidence

| | |
| --- | --- |
| Planning spine | **20 / 20** |
| Import spine | **9 / 9** |
| Backend | **1,842 of 1,843 Jest across 168 suites** (the known `report-builder-sources` timeout under parallel load; passes alone in 2.5s) |
| New tests | 9 on the status rule, 3 on the progress route's role, 1 on activation recalculating |

Every new test was checked by mutating the fix away: all three route-role tests
fail without the one-line change, and the schedule test fails without the
recalculation.

## 8. A note on method

Of the failures this phase produced, **five were the harness's and four were the
product's**, and they were indistinguishable until each was chased down:

- The allocation refused as over-capacity — correct; the grid had already
  allocated the row.
- Earned value reading 0.00 — a `403` upstream, not arithmetic.
- Earned value "not moving" — I read `?.totals?.ev` from a report with no
  `totals` key, so both readings were 0. The figure had moved by exactly 30,000.
- The import "losing" every activity — it had staged them, correctly, and said
  so.
- Activation rejected with a validation error — `mappings` is required and I
  sent none.

Each looked exactly like a defect until the instrument was checked. The four
real ones all shared a shape the earlier phases keep turning up: **a silent
wrong answer rather than an error** — a dropped argument, a rule written four
times, a calculation nobody triggered, a field never serialised.
