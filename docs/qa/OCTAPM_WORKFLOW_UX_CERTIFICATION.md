# Workflow UX and ball-in-court certification

**Phase 20** · **Written:** 2026-09-08
**Cards:** OCTA-UX-GATE-092 · OCTA-UX-BIC-094 · OCTA-PROC-STATUS-095 · OCTA-UX-BIC-096 · OCTA-UX-BIC-097 · OCTA-UX-ACTION-098 · OCTA-UX-ACTION-099 · OCTA-UX-RECEIPT-100 · OCTA-UX-SCHEDRISK-101 · OCTA-UX-PODUP-102
**Specs:** `e2e/24-procurement-personas` · `25-ball-in-court-ui` · `26-needs-you` · `27-receipt-result` · `28-schedule-risk` · `29-raise-order-from-award`

Phase 19 joined procurement to quoting, to the warehouse and to cost, and said
plainly that none of it reached a screen. This phase put it in front of people
and then watched four of them try to use it.

**Ten defects. Every one found by driving the live system; none by a test
suite that was already green.** That is not a comment on the suites — it is
what this phase was for. Seven of the ten were invisible in exactly the same
way: they produced a blank, a silent skip, or a plausible-looking wrong answer
that no assertion was watching.

---

## 1. What a person can now do that they could not

| | before | after |
| --- | --- | --- |
| Get a package priced | open Commercial, know it is a "bid package", choose commitment type | **Request quotes** on the package |
| Compare the quotes | find the enquiry in Commercial | **Compare quotes** → opens that record |
| Raise the order | **no path at all** — API only | **Raise the order** → 0 fields typed |
| Receive it | find Inventory, retype the PO reference | **Receive delivery** → order and warehouse prefilled |
| See what a delivery did | a toast, then nothing | accepted / rejected / still to come / on hand |
| Know whose move it is | nothing | on four registers, in words |
| Know what needs *you* | nothing | **Needs you**, per person, deep-linked |
| See a late delivery | "critical" | **"136d late"** + why, in English |

---

## 2. Four people, one delivery

`24-procurement-personas` walks one cladding requirement from package to
enquiry to award to order to two deliveries to the three-way match, as the four
people who actually do it. It records what each had to do rather than
asserting an impression afterwards.

| persona | steps | dialogs | **typed** | inherited | navigations |
| --- | --- | --- | --- | --- | --- |
| Procurement Manager | 2 | 0 | **0** | 2 | 1 |
| Project Manager | 1 | 0 | **0** | 1 | 0 |
| Warehouse Manager | 1 | 0 | **0** | 1 | 1 |
| Finance | 1 | 0 | **0** | 1 | 0 |

**Nobody retyped anything the system already knew.** The order window, the
enquiry's title and due date, the order and its lines, the warehouse, and the
ordered-versus-received quantities all arrived on their own.

The handoffs, read back from the register as each person:

```
planned          → Your action                     (the buyer)
pending_approval → Awaiting the project manager — approval
approved         → Your action                     (the buyer, to issue)
issued           → Awaiting Beta Facades — the supplier to acknowledge
partial          → Your action                     (the warehouse)
received         → Awaiting finance — the supplier's invoice
```

Three-way match: **2,000 ordered = 2,000 received, matched.** Receiving stock
is still not a project cost — the ledger stayed at 0 until issue.

---

## 3. Ball-in-court: derived, never stored, never a permission code

One service (`ball-in-court.service.js`), one table per record type, six record
types. `getAllowedRoles` from `shared/permissions.json` supplies the roles, so
the answer cannot drift from what the system will actually permit. Nothing is
stored: a stored "next action" is wrong the moment somebody transitions the
record by another route.

It is on **purchase orders, pay applications, commitments and bid packages** —
in the payload and on the screen. `25-ball-in-court-ui` reads all four
registers and fails if any badge contains something shaped like a permission
code.

### 3.1 Two tables were wrong, and nothing failed — OCTA-UX-BIC-094

A status the table does not know returns `state: "none"`, which renders as no
badge at all — indistinguishable from a record nobody is waiting on.

| type | table said | the service says |
| --- | --- | --- |
| `sub_pay_app` | *(no entry)* | `under_review` — a claim the QS is working through |
| `commitment` | `pending_approval`, `cancelled` | **`pending`, `void`** |

Every commitment in the system therefore showed no badge. The unit test
asserted the same invented status the table had, so **the two agreed with each
other and not with the product.**

The fix is not the two edits. `ball-in-court.vocabulary.test.js` reads each
vocabulary from the service that publishes it and holds the table against it —
a list copied into the test would rot exactly like the one it checks.

### 3.2 The vocabulary test found a product defect immediately — OCTA-PROC-STATUS-095

Goods receipt has always moved an order into `partial` and then `received`.
Neither was in `purchase-order.service.STATUS`, and the register's filter
validates against exactly that list:

```
GET /purchase-orders?status=issued        → 200, 24 orders
GET /purchase-orders?status=partial       → 400 VALIDATION_ERROR
GET /purchase-orders?status=received      → 400 VALIDATION_ERROR
GET /purchase-orders?status=acknowledged  → 200, 13 orders
```

A buyer could not ask which orders were part-delivered or delivered — the two
states an order spends most of its life in after issue. On the seeded project
that hid **30 part-delivered and 19 delivered orders** behind a validation
error. After: 200 and 200, each row with a correct badge.

### 3.3 A named company only stands in for the external party — OCTA-UX-BIC-096

Every caller has a vendor to hand and no reason to know when it is the wrong
answer. Passing it through produced:

| record | shown | should be |
| --- | --- | --- |
| approved pay app | *Awaiting E2E Concrete — payment* | **Awaiting finance — payment** |
| draft commitment | *Awaiting Beta Facades — to be sent* | **Awaiting the QS — to be sent for approval** |

The guard now lives in `describe()`, not at each call site.

### 3.4 "Your action" meant "you have permission" — OCTA-UX-BIC-097

These are different questions, and conflating them made the answer useless:

```
commitment.submit:  pm, qs, procurement
commitment.approve: pm
bid.publish:        pm, procurement
po.submit:          pm, procurement, planning_eng
sub_pay_app.pay:    pm, finance
```

A PM is permitted on nearly everything, so a PM opening any register saw
**"Your action" on six of six rows** — of purchase orders, of commitments, of
bid packages. A prompt that fires on everything is not a prompt.

- **`isYou`** — whose *turn* it is: the viewer is the party the record is
  waiting on.
- **`canAct`** — whether the viewer *may* act, from the policy. Action buttons
  hang on this.

A PM may still submit a draft commitment. It is simply the QS's move. Pinned
by a test that fails if the old rule returns (verified by reverting the fix).

---

## 4. What needs my attention today — OCTA-UX-ACTION-098/099

The action centre was built for records that name a person: an NCR's assignee,
an RFI's ball-in-court user. Nothing in commercial or procurement does — an
order waiting on approval waits on whoever holds the PM role, not on a stored
user id. So none of that work appeared on the one screen meant to list it, and
**the endpoint that would have listed it had no caller at all.**

`listMyOpenItems` now folds in the derived handoffs, using the same shape, sort
and deep link — the existing centre, not a competing task list. Driven live,
the same project gives five people five different lists:

| persona | items | what they are |
| --- | --- | --- |
| Procurement | 47 | 30 orders to send, 17 packages to put out to bidders |
| Warehouse | 43 | orders part-delivered or awaiting delivery |
| QS | 74 | 73 commitments to raise, 1 claim to certify |
| Finance | 76 | 56 approved claims to pay, 20 orders awaiting the invoice |
| PM | 2 | bid packages closed, waiting on an award decision |

**Two defects, both of the kind that look like success.**

The model name was `purchaseOrder`; it is `procurementOrder`. A
skip-if-missing guard swallowed that, so every buyer's orders were absent with
nothing failing anywhere. The guard now degrades one record type rather than
the request, and `record-assignment.models.test.js` runs against the **real**
client — a mock would only hold a second copy of the same guess.

And the rows deep-linked with our own name for the type. The workspace calls a
purchase order `procurement_order` when it opens one from a URL, so those rows
loaded the register and opened nothing — **which looks exactly like a row that
worked, because the list is there either way.** The spec now follows a row and
requires the record to open.

---

## 5. Quoting was gated behind a programme — OCTA-UX-GATE-092

Procurement's own *Compare quotes* link goes to the bidding engine, which
lives under Commercial, and Commercial refused to render at all until a
schedule had been generated. The link this phase added landed on *"Generate a
schedule first to access commercial modules."*

The gate is right for most of Commercial, which prices work against
activities. It is wrong for quoting: getting long-lead packages priced
**before** the programme is baselined is the entire reason long-lead items
exist. The bidding panel takes no activities, so it is let through; every
other tab still waits.

Deep link verified: opens `BP-044 · PK-… Aluminium cladding panels`, and
survives a refresh, so it can be sent to somebody else.

---

## 6. The delivery says what it did — OCTA-UX-RECEIPT-100

Posting a receipt raised a toast — *"GRN-00052 posted"* — and took the answer
away with it. A storeman's next three questions are what was accepted, what is
still to come, and how much is now in the shed.

```
GRN-00053 posted · Central Warehouse · PO-ratpj is now part-delivered
Rebar B500B, 16mm   accepted 1 bag   rejected —   still to come 99   on hand 1
```

Two names were wrong on the way and both were failing silently: balances live
in `StockBalance`, not an "inventoryStock" model; and an inventory item is
identified by its **sku** — `item.code` is not a field, so that column would
have been null on every line of every receipt.

---

## 7. How late, not how worried — OCTA-UX-SCHEDRISK-101

The risk engine has always worked out that a package cannot be ordered and
still arrive in time, and the activity has always carried the number of days.
Both schedule views showed the severity word and kept the figure to themselves.

```
A-1000   critical   136 days   order_by_missed

cell     "136d late"
tooltip  "critical — 136d late — too late to order and still arrive in time"
dates    ES 0 → EF 40, unchanged
```

The reasons are written out rather than title-cased: *"Order By Missed"* was a
database column with the underscores taken out.

**Nothing reschedules.** A late delivery is a warning to a planner, not a
licence for the system to move the job behind their back — the spec asserts
the dates are untouched.

---

## 8. The order for an award writes itself — OCTA-UX-PODUP-102

There was **no way to create a purchase order in the interface at all.** The
register listed them and the dialog showed one, but nothing made one — every
order in this programme's tests was created over the API. And the API demanded
a reference the buyer had to invent: the system knows every reference it has
ever issued and the person does not, so they keep a list somewhere else and two
of them working the same afternoon collide.

### The duplicate-entry classification, settled field by field

| field | verdict | source |
| --- | --- | --- |
| PO reference | **AUTO-GENERATE** | project numbering; a typed one still honoured |
| supplier | **INHERIT** | the winning bid |
| line description | **INHERIT** | the priced package line |
| unit, quantity | **INHERIT** | the priced package line |
| unit cost | **INHERIT** | the rate that supplier quoted |
| activity | **INHERIT** | the package line |
| required date | **KEEP WITH OVERRIDE** | the package's, changeable on the call |
| lead weeks | **KEEP WITH OVERRIDE** | the package's, changeable on the call |

An empty request body produces:

```
PO-00006 · Gamma Cladding · required 2027-09-01 · 10 weeks
Anodised panel 3mm · M2 · 1,500 @ 172

Procurement Manager: 1 step, 0 dialogs, 0 typed, 5 inherited
```

The rate is the quoted one, not the estimate it was priced against — an order
that drifts from the award leaves the three-way match nothing true to compare
with. Raising one before a winner is chosen is refused as
`PROCUREMENT_NO_AWARD` rather than producing an empty order.

Two model mistakes on the way, both silent: a `Bid` has no vendor relation (the
company is on the invitation it answers), and an order's `supplierId` points at
this project's own `ProcurementSupplier` while a bid names a `Company` from the
directory — passing one for the other is refused as `SUPPLIER_NOT_FOUND`.

---

## 9. Long-lead says which package it belongs to

A long-lead item linked to a procurement package no longer keeps its own
dates — they are read from the package, its orders and its deliveries, and
typing one is refused. The register never said so, which made the refusal look
arbitrary. It now carries a **Procurement** column: the package number and how
far it has got, or *"Tracked by hand"* when nobody has linked it.

---

## 10. Open — not fixed, and needing a decision

**No way to put a team on a project.** There is no API or UI path to add an
existing colleague to a project. The only route is an email invitation the
person must accept. `setProjectUserPermission` refuses with
`PROJECT_USER_NOT_MEMBER` — *"Assign the user to the project (or a project
party) before setting a permission template"* — an instruction the product
does not implement.

This is why the persona drive runs on the seeded project: a freshly created
project has a team of one, and every non-PM persona is refused with
`PROJECT_ACCESS_DENIED`. Any real customer creating their second project hits
this on their first afternoon. **Recorded as OCTA-UX-TEAM-093; not built,
because a project-team endpoint is a feature decision rather than a UX repair.**

---

## 11. The lesson, again

Roughly half of everything found in this programme has been found the same
way: by driving the product as a person and looking at what came back, rather
than by asking a suite whether it was happy. This phase is the clearest case
yet, because **seven of the ten defects were literally invisible** — a missing
badge, a skipped record type, a deep link that opens the list instead of the
record, a null column, an empty filter result behind a 400. None of them throw.
None of them look like failure.

The corollary is the one worth keeping: a test that agrees with the code
because both were written from the same guess is not evidence. Three of this
phase's guards now read their expectations from the thing they are checking —
the service's own status list, the real Prisma client, the permission policy —
so the next divergence is a red test rather than a blank cell.

---

## 12. UX quality gate

Scored against what the specs actually measured, not against an impression.
🔴 is a flow a competent person cannot complete without help; 🟡 is one they
complete but with avoidable friction; 🟢 is one that works.

| flow | before Phase 20 | after | evidence |
| --- | --- | --- | --- |
| Get a package priced | 🔴 no path from Procurement | 🟢 | `24` — 2 steps, 0 typed |
| Compare the quotes | 🔴 dead end on the schedule gate | 🟢 | `24` — opens the record, survives refresh |
| Raise the order | 🔴 **no path at all**, API only | 🟢 | `29` — 1 step, 0 typed, 5 inherited |
| Receive a delivery | 🟡 retype the PO reference | 🟢 | `24` — order and warehouse prefilled |
| Know what a delivery did | 🔴 a toast, then nothing | 🟢 | `27` — accepted/rejected/remaining/on hand |
| Know whose move it is | 🔴 nothing | 🟢 | `25` — four registers, no permission codes |
| Know what needs *you* | 🔴 endpoint with no caller | 🟢 | `26` — five people, five lists, deep-linked |
| See a late delivery | 🟡 "critical", no magnitude | 🟢 | `28` — "136d late" + why |
| See long-lead's package | 🟡 refusals looked arbitrary | 🟢 | Procurement column |
| Filter orders being delivered | 🔴 **400** | 🟢 | 200 + 200, correct badges |
| Put a team on a project | 🔴 | 🔴 **open** | OCTA-UX-TEAM-093, §10 |

**Ten of eleven flows are green. One remains red and is named rather than
quietly downgraded**: a project cannot be given a team, so every persona test
in this programme runs on the seeded project. It is a feature decision, not a
UX repair, and is the honest answer to "did this phase reach zero red" — it
did not, and the reason is written down.

### Two things deliberately not done

- **Activities table virtualisation.** The Gantt already virtualises
  (`visibleRows` from `scrollTop`); the activities table renders every row. On
  a real P6 import that matters. It is not fixed here because it could not be
  measured honestly this phase — the seeded project has three activities, and
  shipping a virtualisation change verified against three rows would be worse
  than leaving it.
- **Agreement readiness (§14).** Already built, front and back: the commitment
  detail shows what insurance is missing before execution
  (`uat-commitment-insurance-gate`), execution is refused with
  `COMMITMENT_INSURANCE_MISSING`, and the override requires both the
  permission and a written reason, which is recorded on the transition. This
  phase verified it rather than rebuilding it.

---

## 13. The regression gate, and what it cost to trust it

**Final: Playwright 138/138 · Jest 1,881/1,881 · OpenAPI contract green.**

The gate took three full runs to produce a number worth quoting, and the two
that failed are recorded here rather than discarded, because the reason each
failed is the phase's own lesson pointed at me.

| run | result | failing spec | cause |
| --- | --- | --- | --- |
| 1 | 137/138 (16.2m) | `19-payapp-actual-cost` — sign-in | **my tooling.** nodemon restarted mid-suite and could not rebind: `EADDRINUSE` → `app crashed`. Logins in that window failed. |
| 2 | 137/138 (20.4m) | `22-user-smoke` — cost overview | the app shell never hydrated within 30s. Not reproducible. |
| 3 | **138/138 (20.0m)** | — | — |

`retries` stayed at 0 and no test was touched. Adding a retry would have made
the board green on run 1 and taught nobody anything.

### Two explanations I would have been happy to assert, and why both were wrong

**The login rate limiter.** My first instinct, and it is the usual suspect in
this suite. The arithmetic killed it: the suite makes roughly 178 `pm` logins
(83 bare `signIn`, 10 explicit, 79 via `openProject`, 6 direct `apiToken`)
against a documented limit of 12 per 15 minutes — which would fail at test 12,
not test 116. Checking `.env` finished the job: dev raises it to **2000 per 60
seconds**. The limiter was never involved.

**Accumulated test data.** The obvious second suspect, and I had genuinely
polluted the seeded project all session — 158 purchase orders, 222
commitments, 162 lead-time alerts. Every endpoint the failing page needs
returns in **25–152 ms**, and the page itself loaded in 1.4–2.4s on three
consecutive probes. Not it either.

### What is actually true

Run 1 is diagnosed and proven: the API restarted underneath the suite because
I was committing while it ran, and this worktree also sits under OneDrive,
which rewrites files. The API now runs as a plain `node src/index.js` with no
file watcher, so nothing can restart it mid-suite.

Run 2 is not diagnosed. It is a single non-reproducible hydration stall in a
20-minute single-worker pass against a **dev Vite server**, on a machine also
running Postgres and the API. That is a harness fragility, not a product
defect, and it is written down as an unexplained failure rather than dressed
up as one.

**The standing instruction for this programme is that a green result is only
worth the scepticism applied to the instrument that produced it. This phase
made the same demand of a red one** — twice, the instrument was at fault, and
twice the tempting explanation was wrong on the numbers.

---

## 14. Smoke retest — OCTA-UX-ACTCODE-103

**14 modules · 14 ✅ · 0 🟡 · 0 🔴.**

One module came back 🟡 on the first clean pass: Activities opened, survived a
refresh and raised no console error, but reported no content. It was not
broken — the register listed all three activities with their names, dates,
progress, values and statuses. What it did not show was the **activity code**.

That is the identifier everyone on a site and in a programme actually uses. The
Gantt has always shown it; the standalone register showed only the name, so the
one thing a person arrives holding — *"what is happening on A-1000?"* — could
not be answered on the page named after it. The code was already in the
schema and simply never rendered.

The column was added. **The rating moved because the missing information
appeared, not because the check was relaxed** — which is the whole point of the
instruction not to game the score.

---

## 15. Final gate, on the committed state

| gate | result |
| --- | --- |
| Playwright | **138 / 138** (19.5m) — two consecutive green full runs |
| Jest | **1,881 / 1,881** (172 suites) |
| OpenAPI contract | green — every live route documented |
| Smoke retest | 14 modules · **14 ✅ · 0 🟡 · 0 🔴** |
| UX quality gate | 10 of 11 flows 🟢 · 1 🔴 named (OCTA-UX-TEAM-093) |

`retries: 0` throughout. No test was weakened, skipped or re-scoped to reach
this. The activity-code column is the only case where a rating changed, and it
changed because the missing information was added.

### Eleven defects, none found by a failing test

| card | what it looked like |
| --- | --- |
| GATE-092 | Procurement's own link hit "Generate a schedule first" |
| BIC-094 | every commitment showed **no badge**; the test asserted the same invented status |
| PROC-STATUS-095 | filtering for part-delivered orders returned **400** |
| BIC-096 | "Awaiting E2E Concrete — payment" when it waited on finance |
| BIC-097 | a PM saw "Your action" on **6 of 6 rows** of every register |
| ACTION-098 | every buyer's orders absent — wrong model name behind a silent skip |
| ACTION-099 | rows loaded the register and opened nothing |
| RECEIPT-100 | a toast, then the answer gone; two columns permanently null |
| SCHEDRISK-101 | "critical" with no magnitude; "Order By Missed" as a tooltip |
| PODUP-102 | **no way to create a purchase order in the interface at all** |
| ACTCODE-103 | the Activities register never showed the activity code |

Eight of the eleven were invisible rather than loud. That is the phase in one
line: **the product was green, and it was not working.**
