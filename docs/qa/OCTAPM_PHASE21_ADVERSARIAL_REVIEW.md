# Phase 21 — adversarial review

## CODEX INDEPENDENT REVIEW NOT AVAILABLE

Checked, not assumed: there is no `codex` CLI on this machine, no Codex MCP
server configured for this session, and no Codex agent definition in the
repository.

What follows is a **self-review**, performed by the same author who wrote both
the product fixes and the tests that pass against them. It is therefore
**weaker evidence than an independent review** and must not be reported as
one. Its value is limited to the specific falsifiable checks below.

---

## 1. The question I put to my own work

*Where could Phase 21 be green and wrong?*

Six candidates, each attacked rather than argued.

---

### 1.1 "The financial figures are green because the assertions are weak"

**This was true once, and it was caught.** The first actual-cost helper read
`recon.totals.*`, which does not exist on that payload. Every "actual cost is
0" check passed against `undefined ?? 0` — a test that could not fail. It was
found because the figure stayed 0 after a material issue that should have
posted 660.00.

The replacement reads `ledger.total`, `ledger.bySource`, `ledger.byCostType`,
both materialised projections and the service's own `balanced` flag. That is
four independent numbers that must agree, not one that can be absent.

**Residual risk:** all five come from one endpoint. A fault inside
`/cost/reconciliation` itself would be invisible to this suite. The direct
database read in stage 9 (`CostRecord` rows with their `actualThroughDate`)
partially covers this, but the CostLedgerEntry table was never summed straight
from SQL and compared. **That check is missing and should exist.**

---

### 1.2 "The weighted average is 11.00 because the test chose easy numbers"

Yes — deliberately, and it is stated in the code. 100 @ 10.00 and 50 @ 13.00
give exactly 11.00 with no repeating decimal, so an arithmetic error cannot
hide behind rounding.

**What that does not prove:** the product's rounding behaviour on an average
that *doesn't* divide cleanly. A run with 100 @ 10.00 and 50 @ 14.00 (average
11.333…) would test the harder case and was not done. **Gap.**

---

### 1.3 "The subcontract gate passes because 60,000 and 54,000 differ obviously"

The check that matters is not that the ledger equals 60,000 — it is the
**delta** across certification: `afterCertify − ledgerBefore === 60,000.00`,
asserted alongside `delta !== 54,000.00`. Both directions are pinned, so
posting the net instead of the gross would fail, and so would posting nothing.

The payment step then asserts the ledger is **unchanged**, which catches the
opposite error of treating cash as cost.

**Residual risk:** retention release was never exercised. If releasing
retention later posts a second cost, this suite would not notice.

---

### 1.4 "Tenant isolation passed because the attacker was never authenticated"

**This exact failure happened and nearly got reported as a leak.** The first
attempt borrowed a seeded user from another organisation whose password is not
the demo one. Every call returned `401 INVALID_CREDENTIALS`, and the check —
which only counted 403 and 404 as refusals — reported a **cross-tenant leak
that did not exist**.

It was verified before being written down. The fix is twofold: the outsider is
now a tenant registered through the product's own sign-up so its password is
known, and a `401` now **throws** rather than passing or failing quietly,
because an attack that never authenticated proves nothing either way.

The non-disclosure check was then strengthened past the original brief: a real
project and a non-existent one are compared verb by verb, and they answer
identically.

---

### 1.5 "The EV numbers are circular — the dashboard agreeing with itself"

EV is computed in the test from the approved allocation amounts and the
approved percentages **before** the EV report is fetched:

```
A110 60,000.00 x 100% = 60,000.00
A120 30,000.00 x  50% = 15,000.00
A130 90,000.00 x  25% = 22,500.00
                        97,500.00
```

The product is then required to match. AC likewise comes from `CostRecord`
rows read directly, not from the report.

**PV is the exception and is declared as one.** Planned value depends on the
data date and the working calendar, and it was taken from the product. SPI is
therefore checked as arithmetic over an independently derived EV, not as an
independently derived SPI. In this run PV was 0 (every planned date is beyond
the cutoff) and SPI was `null` — correct, and untested.

---

### 1.6 "Re-running the stages inflated the figures"

**True, repeatedly, and it is the most persistent test defect in this work.**
Stock compounded to 239 bags where 150 were expected; a second identical
variation was approved and — because approved variations are immutable — could
not be taken back, which is why Revised Budget is 1,950,000.00 rather than the
1,825,000.00 the brief suggested.

Stages are now find-or-create, and the change-order arithmetic is asserted as
an **identity** (`Revised = Original + approved changes + approved revisions`)
rather than a fixed total, precisely because the fixed total was no longer
truthful. The report says so rather than quietly restating the brief's number.

**Residual risk:** the project now carries four zero-valued approved
variations and several drafts from earlier runs. They contribute 0.00 and the
identity still holds, but a genuinely clean certifying run would start from a
fresh project.

---

## 2. Where I would look first if I distrusted this work

1. **Sum `CostLedgerEntry` in SQL** and compare with `/cost/reconciliation`.
   Nothing in Phase 21 does this; every actual-cost figure trusts one endpoint.
2. **A weighted average that does not divide cleanly.**
3. **Retention release**, and whether it posts cost a second time.
4. **The synthetic schedule revision** from P21-001: it satisfies every field
   the dashboard reads, but `readiness`, `baseline` and the revisions list were
   only observed, not asserted, against a synthetic one.
5. **Concurrency on the cost ledger** — the reference-number generators were
   proven atomic in Phase 20.6, but nothing here posts two costs at once.

---

## 3. What this review does not establish

It does not establish that the product is correct. It establishes that six
specific ways of being falsely green were looked for, that three of them were
found and fixed, and that three named gaps remain open. An independent
reviewer would be looking for the seventh, which by definition is not in this
document.

---

# Phase 21C — adversarial self-review

## ADVERSARIAL SELF-REVIEW — NOT INDEPENDENT

Codex was checked for again on 2026-09-12 and is not available in this
environment. What follows is the author attacking the author's own 21C
work, and is labelled as such. It is weaker evidence than an independent
review would be; it is not no evidence.

## 4. The question put to the 21C work

### 4.1 "The RBAC fix could have broken a legitimate flow"

Forty-one routes gained a guard in one commit. If any role that legitimately
used one of them was not in the policy row chosen, that flow now 403s.

What was done about it: every route is exercised in the regression test as
an **allowed** role too, not only a denied one; the full Jest suite (2,005)
and the full Playwright suite ran after the change; stages 15–18, which use
these routes as site engineer, QS, planner and PM, all passed after the
restart. The module chosen for each router is the one the policy already
names for its neighbours (drawing sets → `document_control`, budget →
`cost`, pay apps → `sub_pay_app`), not one invented for the fix. The residual
risk is a flow no test drives — e.g. a cost controller reading cash flow was
allowed by the policy and is exercised; a **site engineer reading cash flow**
was never allowed by the policy and now cannot; if the UI shows that page to
site engineers it will 403 (that is P21-014's shape, and the product's
choice).

### 4.2 "The quality-score assertion was bent to fit the duplicate"

The first version typed `65`; after the T-10 duplicate the stage asserts the
product's formula against the dashboard's own counts and gets `45`. Is that
"lowering the assertion to achieve green"?

No, and here is the difference: the formula assertion is stronger than the
constant (it fails if the product mis-weights any term), the duplicate is
**named by id** in the stage so that a third copy fails loudly, and a second
independent check asserts that nothing but NCR-01, the named duplicate and
the failed ITP moved the score (55 points, exactly). What was lowered is my
own tidiness, which is recorded as T-10.

### 4.3 "The deep-link grades are a heuristic"

RECORD OPENED means the record's reference was on screen **and** a dialog
was open, or the reference was inside the dialog. A page that opens a
detail panel that is not a `role=dialog` would be under-graded as "list row
only". So the 8 "on screen, no detail" rows may include some that did open.
The 5 "module home" rows and the 2 "wrong record type" rows are not
heuristic: the reference was absent, or the network showed a 404 for the
wrong record type. The grade is therefore a floor for the good cases and
exact for the bad ones.

### 4.4 "The permanent spec only asserts what it built"

It does — that is what a greenfield regression is. It does not assert against
the manually driven Phase 21 project, by design (the brief forbids that
dependence). What it proves is the connected spine on an empty project, with
the personas the policy names, twice in a row, with the project retired and
the allowance checked. What it does not prove is anything about the ledger of
an existing project — the Phase 21 stages do that.

### 4.5 "A 20-second regression is too small to mean much"

It is seventeen API-side assertions and five browser ones on one spine. It
is small so that it can run on every change. Breadth is the job of the
twenty Phase 21 stages, which are committed beside it and are re-runnable.

### 4.6 "The audit that found P21-010 could have false negatives"

The probe sends an invalid body; a guard that runs **after** validation would
answer 400 and be graded as unguarded when it was not. The opposite error —
a missing guard graded as present — cannot happen: nothing but a guard
answers 403 to an invalid body. So the audit can over-report, never
under-report; and every over-report would have shown up as a failing
"allowed role" case in the regression test, which none did.

## 5. Where I would look first if I distrusted this work (21C)

1. The `delete → update` mapping for `document_control` and `eot` routes:
   a planning engineer can now delete a drawing record. That follows the
   drawing-sets convention, but it is a choice.
2. NCR-002: an approved major NCR that exists because of a test defect. It is
   named everywhere it matters; it is still there.
3. The manpower report agreeing with the timesheet proves the report adds
   up, not that the two are linked — they are not.
4. `persona-browser.json` grades were produced by one script and one run;
   the procurement persona was also driven by hand and agreed.

## 6. What this review does not establish (21C)

That anyone other than the author has read the fix, the spec or the grades.

# Phase 21D — independent review, at last

## CODEX INDEPENDENT REVIEW — PERFORMED

The heading above section 1 ("CODEX INDEPENDENT REVIEW NOT AVAILABLE") is
superseded. Phase 21D put the branch in front of OpenAI Codex CLI 0.154.0,
run from this session as `codex exec --sandbox read-only`, and proved the
connection first: Codex returned `CODEX_FROM_CLAUDE_OK`, the branch name, the
HEAD SHA and the remote URL, all matching `git`, and modified nothing (the
working tree was checked after every round). No token was printed or stored
in the repository.

The rule of engagement, from the brief: nothing Codex said was acted on
until it had been reproduced — live against the demo project where a request
could stage it, by a regression test that fails on the unfixed code where the
race could not be timed from outside — and nothing was dismissed because the
existing tests were green. Every fix went back to Codex as a new HEAD.

## 5. Round 1 — HEAD `11c2335`: seven Highs, all real

Codex read the ledger, stock and payment services and reported seven HIGH
findings (CX21-001 … 007), one MEDIUM test-infrastructure finding
(CX21-008), four MEDIUM/LOW observations and a BLOCK verdict. All seven Highs
reproduced live, first try, exactly as described (register P21-025 … 031):
an invoice billing another project's purchase-order line posted no cost; a
receipt naming one line twice took 120 on a line of 100; two stores blended
to the wrong average; two concurrent issues both succeeded; two concurrent
payments both cleared; a reopened, re-approved timesheet posted nothing; a
budget line's actual was writable through the API.

What this says about Phases 21A–21C: every one of those defects sat under
flows those phases drove and certified, and none of the 36 snapshot checks or
the 163 Playwright tests could have caught them, because none of them fired
two requests at once or sent a second project's id where the first was
expected. The self-review in sections 1–4 said as much in principle
("where I would look first"); the independent review found the instances.

## 6. Round 2 — HEAD `aa1972c`: the fixes were incomplete

Codex read the first loop's diff and returned BLOCK: five of the seven fixes
were INCOMPLETE — each one a race variant of the same defect, reachable
through a code path the first fix did not cover — plus two regressions it
predicted from PostgreSQL lock semantics: a deadlock between a balance
insert's `KEY SHARE` and the item `FOR UPDATE`, and a warehouse-wide split
failing on a bin emptied under it. All were confirmed against the code
(register P21-036 … 040) and fixed; the reservation fix took a per-warehouse
bin prelock.

## 7. Round 3 — HEAD `ffe09fc`: the second loop's own gaps

BLOCK again, and the most instructive round. The bin prelock did not stop a
bin being *created* between the lock and the read (a phantom), and locked
bins in query order, which a two-line receipt could contradict — a new
deadlock. Issues still priced from an average read before any lock, so a
receipt and an issue at once could lose value. Every status transition on
invoices and pay applications decided on a status read before the write.
Transfers could be dispatched or landed twice. Retention releases had no
lock. (Register P21-041 … 046.)

The third loop replaced the piecemeal locks with one protocol: every stock
operation holds the item row first (`FOR NO KEY UPDATE`, which does not
conflict with the `KEY SHARE` a balance insert takes), multi-item operations
take all their items up front in id order, and every financial transition
holds its row and refuses if the status moved since it was decided. The
probes that had reproduced rounds 1 and 2 were re-run after every loop; none
came back.

## 8. Rounds 4 and 5 — the last writers, and one valuation rule

Round 4 (HEAD `6165c04`) confirmed the stock protocol and named the four
writers still deciding on a status read before their transaction: the
pay-application edit (which also wrote lines before the application — the
opposite order to every transition, a deadlock), the invoice delete, and
the IPC item edit, adjustment, submit, certify and invoice paths; plus a
delivery prelock that missed the items a line resolves to by choice or by
SKU. Round 5 (HEAD `5345f36`) found that the edit still recomputed from its
pre-lock copy (a notes-only edit could erase a deduction another edit had
just made), that a transition's guard was not asked again about the claims
it reloaded, and — sequentially, no race — that a purchase made while a
transfer was on the road reset the item's average to its own price, so the
transfer landed at that price and stock plus consumption no longer added
up to what was bought. (Register P21-047 … P21-053.) All fixed, each with a
regression that fails on the previous services; the valuation defect was
also staged live: 200 units bought for 4,000.00 now land at 20.00.

## 9. Rounds 6 and 7 — rules, not races

Round 6 (HEAD `adee79d`) confirmed everything and found two rules rather
than races: quarantined stock left out of the average the way in-transit
stock had been, and a line's "previous" amount trusted from the value stored
when the application was raised — so a rejected application reopened after
a newer one was approved and paid could bill the same work again. Round 7
(HEAD `66da083`) found the concurrent form of the second: two applications
open on one commitment could be approved at once, each reading the other's
claims as not yet certified. The fix serialises every decision on a
commitment on the commitment row and closes the gap that let two be open —
a rejected application cannot come back to draft while another is open.
Both re-billing scenarios were staged live on a fresh commitment: the
re-bill is refused with the line showing the other application's 60 % as
previous, and reopening while another is open is refused.
(Register P21-054 … P21-056.)

Round 8 (HEAD `f3c8591`) confirmed the commitment lock and found two
pre-existing rules in the same service: materials stored on site were added
to the gross and posted to cost *after* the line ceiling had been checked
on work alone (a 100,000 line accepted 200,000 of materials), and the
reopen route required only the update permission although from *approved*
it revokes the PM's certification and reverses posted cost — the route's
own comment said it needed the approval permission. Both fixed and staged
live on a fresh commitment (register P21-057, P21-058).

Round 9 (HEAD `65bddc2`) did what an independent reviewer is for: it caught
a regression in the eighth loop before any run could. Folding other
applications' materials into the line's "previous" amount had made
materials look like work to the approved-progress cap, and a valid claim of
more work after materials had been certified would have been refused. The
ninth loop keeps work and materials apart — work meets the progress cap,
work plus materials meets the line's value — and, from the same round, an
application that exhausts the subcontract with work plus materials is now
the *final* one and runs the closeout gate it used to skip (register
P21-059, P21-060). Round 10 (HEAD `28a2d50`) returned **PASS**: every fix
CORRECT, no regressions, nothing new of Critical or High severity.

## 10. The release challenge — the whole backend, not the changed files

Rounds 1–10 were confined to the files each loop had changed. The release
challenge, on `28a2d50`, was told to try to stop a pilot across the whole
backend and the money, stock and RBAC features of the frontend — and it
did: DO NOT RELEASE, one Critical and eight Highs. Eight of the nine held
(register P21-061 … P21-068), and they are the most serious findings of the
phase: a stock issue that resolved its activity by id alone and would post
this tenant's cost onto **another tenant's** activity; a role-only route
guard that never looked at an API key's scopes, so a read-only key could
archive a project; warehouse routes outside the project routers that ignored
a key's project list; an activity's actual cost writable through the
cost-record routes; two IPC periods certifiable at once past the shared
ceiling; a stale timesheet return that left posted labour editable; a
purchase-order edit landing after approval; and equipment usage that wrote
the activity's actual absolutely, with no ledger entry at all. The ninth
(CX21-411) was a real argument-shape bug with **no reachable effect** — no
policy names the inventory transitions it dropped — and is recorded at P3.
All fixed in `79f5ea1`, each with a regression that fails on `28a2d50`, five
of them staged live (the cross-tenant issue against the only other
organisation in the database → 404, stock unchanged).

The first full gate run, on `28a2d50`, also exposed my own instrument: the
isolation stage's RBAC probes issue two bags each time they run, and the
run moved the certified ledger by exactly 22.00. The bags were returned
through the product's own return movement, the stage now gives back what it
issues, and the gates were re-run (T-14).

The second pass ran once the usage limit lifted (04:31 CDT, on `772f2c5`):
DO NOT RELEASE again — one Critical and nine Highs, and three of the first
pass's fixes marked INCOMPLETE *because of* the new findings. All ten held
(register P21-070 … P21-079), and they are instructive precisely because
each is the first pass's finding **one field over**: the cross-tenant
check on an activity id (P21-061) had left the project id, named without an
activity, trusted — and the ledger had no last line of its own against a
foreign project; the key's project restriction (P21-063) was enforced on
the `projectId` the request *named*, so omitting it walked past the check
through the activity, the order and the movement list; the refusal of a
*changed* actual (P21-064) still wrote back the unchanged one, overwriting
whatever the ledger had posted meanwhile — and my own frontend fix for it
had hidden the Actual column; the timesheet lock (P21-066) covered the
transitions but not edit and delete; the purchase-order lock (P21-067)
covered the edit but not the lifecycle transitions; a commitment's schedule
of values and header could be replaced after approval by a writer that
decided before its lock; the reconciliation *repair* wrote an actual it had
read before the lock; the portfolio ignored a key's project list; and an
API key could begin a new MFA enrolment and replace its owner's factor. All
fixed in `29456c4`, each with a regression that fails on `772f2c5` (10/10
by reverting the fourteen product files), six staged live — the cross-tenant
issue against the only other organisation's project → 404 with our stock
and their ledger, records and movements read from the tables unchanged; a
Riverside-only key → 403 on the other project's activity, order and
movements, 0 foreign rows unfiltered, 1 project in its portfolio; a
budget-only edit leaving actual and its through-date alone; a write-scoped
key → 403 on MFA setup.

The lesson the two passes teach is the one section 11 draws: a reviewer
that reads the whole backend finds the *shape* of a fix's gap, and a fix
that closes the reported path and not the shape will be found again.

The third pass, on `29456c4`, was launched as soon as the fixes were
committed (04:45 CDT); it read for twenty-three minutes and 196,872 tokens
and met the same usage limit. Re-run when the window opened (09:33 CDT),
with the prompt narrowed to the code diff, it answered in six minutes: DO
NOT RELEASE — no Critical, seven Highs (register P21-080 … P21-086), three
of the second pass's fixes INCOMPLETE because of them, two Mediums. Again
each finding is a closed path's neighbour: the five stock routes the second
loop had not touched (return, adjust, damage, quarantine, release) and the
analytics; two readers — global search and the report builder — that had
never heard of API keys and answered as the owner; the repair's SUM inside
the very UPDATE that waited on a posting's lock (READ COMMITTED keeps the
statement's snapshot, so the posting it waited for is invisible to it); the
commitment lifecycle transitions beside the locked edit; the receipt that
locked the lines but not the order; a subscribe with no serialisation or
idempotency, able to create two billable Stripe subscriptions; and the
through-date written back beside the actual that no longer was. All fixed
in `2b0df2b`, each with a regression that fails on `29456c4` (11 / 11 by
reverting the twelve product files); the two reachable by one request staged
live (a Riverside-only key: return to the other project's activity → 403 with
stock unchanged, its analytics → 403, unfiltered analytics with no row of it;
search by its id → 403, by name → 0 rows; a report preview on it → 403, on
Riverside → 200; a `report:read` key → 403 on the cost source). One Medium —
backup-code consumption unlocked — is registered at P2 (P21-087) and not
fixed, by the brief.

The fourth pass, on `2b0df2b` (09:46 CDT, twenty minutes): DO NOT RELEASE
— no Critical, eight Highs (register P21-088 … P21-095), four of the third
pass's fixes INCOMPLETE because of them. One is mine: the lookup I added
to reuse a running Stripe subscription swallowed a failed lookup as "no
subscription", so a Stripe outage at that instant would have created a
second billable one — the pass caught it before any client could. The
others are, again, the closed path's neighbours: three more inventory doors
(the direct receipt, the item list, the summary and both warehouse
valuations); a stored report file downloadable by any reader of the
definition with the requester's wider access — a session-user disclosure,
not only a key's; the assistant retrieving and reading conversations as a
key's owner; job retry/cancel on a static role check; the ledger's own
through-date advance decided from an unlocked read; two concurrent budget
transfers past the available-budget guard; and report definitions and
schedules mutable by a key as the owner. All fixed in the commit after
`2b0df2b`, each with a regression that fails on `2b0df2b` (6 of 7 by
reverting the ten product files; the seventh guards a flow that must keep
working), four staged live (a Riverside-only key: receipt to the other
project → 403 with stock unchanged, its items and summary → 403, unfiltered
summary and items with no row of it; a key → the assistant 403; a read-only
key → cancel and retry of a queued job 403; a key → creating a report 403).

The fifth pass, on `59cf34b` (10:19 CDT, thirteen minutes): DO NOT
RELEASE — no Critical, eight Highs and two Mediums (register P21-096 …
P21-105), three of the fourth pass's fixes INCOMPLETE because of them. The
best of them is not a race at all but an object literal: the item list's
search clause and its project clause were two `OR` keys on one object, so
the search silently replaced the scope — a bug older than the key checks
that it defeated. The rest: a project's own item and warehouse were never
treated as that project's stock (reads, scans, edits, reservations and a
receipt naming no project all walked past the checks that looked only at
what the *movement* named); conversations answered a key as its owner; a
budget revision was born "approved" by whoever could create cost; the
commitment change orders beside the locked commitment; "Return from site"
putting stock back without reversing the activity's cost; the browser's
query cache surviving a sign-out into another organisation; two first
postings each creating a projection row of which the reports read one;
and, at Medium, an admin exception applied after the filter that excluded
it, and a lock order my own comment claimed and the SQL did not deliver.
All fixed in the commit after `59cf34b`, each with a regression that fails
on `59cf34b` (8 / 8 by reverting the nine backend product files), five
staged live (a Riverside-only key: a P21-only item invisible to its search,
refused on read, scan, edit, receipt and reservation; a key → conversations
403; a QS's revision born a draft, refused as approved, refused approval,
the PM's born approved; a bare return 400).

The sixth pass, on `ded5fa0`, was launched at 10:47 CDT and stopped on the
reviewer account's usage limit after 39,535 tokens ("try again at 2:33 PM");
no verdict was written and the tree was unchanged. In the same hour the
gate, not the reviewer, found the sixteenth defect — mine: the fifteenth
loop's advisory locks were taken with `$queryRaw`, which cannot read the
`void` that `pg_advisory_xact_lock()` returns, and every cost posting to an
activity answered 500 on `d23dc05`. The greenfield spec's first request
failed, run seven was stopped, the locks moved to `$executeRaw` (P21-106,
`ded5fa0`), and run eight passed every gate. A unit test with a faked
client could never have seen it; the gate that drives the real product did,
on its first request — which is the whole argument for the gate. Until the
sixth pass returns, the final HEAD has been re-challenged by 92 regression
cases, 45 live probes and the full gate sequence, but not by the
independent reviewer — stated as such in the verdict rather than papered
over.

Re-run when the window opened (14:34 CDT), the sixth pass answered in five
minutes: DO NOT RELEASE — no Critical, eight Highs, one Medium (register
P21-107 … P21-115). This time every High was **reproduced before anything
changed**, four of them against the live API: a QS moved a PM-approved
revision back to draft and a cost controller deleted one (the approval
guard covered entering approval, not leaving it); a key limited to one
project created a transfer of another project's stock (transfers had never
met the key), listed and edited another project's warehouse; a return
naming only a cost code put a bag back and left its 11.00 on the activity
(a cost code names no project). The other four by regression: a receipt
into another project's warehouse or onto its item; two more creators of the
projection row outside the ledger's lock; two concurrent change-order
approvals each writing a committed total without the other; a change order
re-linked to another project's prime order on an edit where creation had
checked; and, on the browser, a token refresh installing another person's
session without emptying the cache. All fixed in the commit after
`ded5fa0`, each with a regression that fails on `ded5fa0` (8 / 8 by
reverting the eight backend files); the four live findings re-probed
refused on the fix. The Medium — a QS's revision now starts as a draft and
the screen has no submit control — is a consequence of the fifth pass's own
fix, registered at P2 (P21-115) and not fixed, by the brief.

The seventh pass, on `fa7b28b` (14:55 CDT, five minutes): DO NOT RELEASE
— no Critical, eight Highs (register P21-116 … P21-123). Two reproduced
live: the billing history route had no permission check at all, so a key
with only an inventory scope read the company's invoices; and the transfer
list had never met the key. The rest confirmed by reading and by
regressions that fail on `fa7b28b`: the revision guards of the two
previous loops decided on a status read before the write and copied it
back; the analytics' item balances behind its totals were still unfiltered;
a transfer could link another tenant's item and echo its details (no other
tenant on this database holds one, so the live path could not be staged);
the post-import seeding created projection rows outside every lock — and
the schema had never forbidden a second row for a pair, which it now does
(`@@unique([projectId, activityId])`, the last line every writer meets); a
cost edit wrote back the `committed` it had read, as it once wrote back
`actual`; and, on the browser, a refresh answering late installed the
previous person's session over the current one. All fixed in the commit
after `fa7b28b`, each with a regression that fails on it (7 / 7 by
reverting the eight product files).

Gates run nine, meanwhile, caught my own unfinished work: the dev server
serves the working tree, and the refresh guard I was still writing refused
the fresh-tab sign-in every spec relies on — stopped, corrected (a tab with
nobody signed in is not a change of identity), recorded as T-17.

The eighth pass, on `b2bd518` (15:53 CDT, six minutes): DO NOT RELEASE —
no Critical, seven Highs, two Mediums that were mine (register P21-124 …
P21-130). The revision edit I had just fixed still copied back the money
and the approval it had read — the status alone had been refreshed under
the lock; the transfer list I had just scoped by warehouse still carried
another project's item on a line; the cost upsert I had just stopped from
writing `committed` still wrote a 0 onto the row a commitment created
meanwhile; the unique-pair migration would have failed on a database that
had met the defect it fixes; the refresh guard compared identities at the
401 rather than at the request; an access token kept a deactivated or
demoted person's authority until it expired; and the task API mounted
outside a project answered a key as its owner. Two reproduced live, the
rest by regressions that fail on `b2bd518`; all fixed in the commit after
it, with the two Mediums. Gates run ten, on `b2bd518`, also showed ten
runs' worth of order residue filling the Match tab's window (T-18): test
data, closed before run eleven.

The ninth pass, on `e5f1c70` (19:35 CDT, after the usage window
reopened; six minutes, 142,281 tokens): DO NOT RELEASE — no Critical, eight
Highs, two Mediums (register P21-131 … P21-141). The migration I had just
taught to merge duplicates merged only their actual and discarded what
else they held; the account check I had put on the REST layer was missing
from the socket, so a deactivated person kept their rooms; the project
template that decides on a project's own mount was never asked on the
task mount outside a project; the committed figure I had stopped an upsert
from zeroing could still be typed to zero by anyone; the notification routes
took any key and every project; an advance receipt decided its cap on a
copy; a change-order edit decided its approval lock on a copy; and the
cost-record edit that I had just made keep a row's committed still wrote
the row's other fields back from its copy. Six reproduced live (the
migration inside a rolled-back transaction, the socket with a throwaway
deactivated account, the template on the QS, the typed committed on A310,
the key on the inbox, the two receipts — in five of six runs), two by
regressions that fail on `e5f1c70`; all eight fixed in the commit after
it, with twelve regressions in nine suites, eleven of which fail on
`e5f1c70`. The two Mediums and one observation are recorded and, as the
brief asks, not fixed.

The tenth pass, on `8a1d7dd` (20:19 CDT, seven minutes, 169,276 tokens):
DO NOT RELEASE — no Critical, six Highs, and three notes on my own ninth
loop (register P21-142 … P21-150). One was a regression of mine: the task
mount I had just taught to ask the project's template resolved that
project's access and then listed every project under it. The recompute I
had left outside the pair lock could still be written over by an edit
echoing the figure it had read; the change-order archive decided its
approved-state check on a copy, as the edit had; the retired valuations
module let an editor move a paid valuation back to draft and restate it;
search asked the role's policy and never a project's template; and the
role guard — used by change orders, billing, BOQ, EOT and project settings
— never asked the template the permission guard asks. Two reproduced live
(the template on the QS: four document hits either way; a change order
created under a template refusing them), four by regressions that fail on
`8a1d7dd`; all fixed in the commit after it, with the two regressions and
the stray export the pass noted, and nine regressions in nine suites,
all of which fail on `8a1d7dd`. Gates run twelve, on `8a1d7dd`, passed
every gate but skipped thirteen subcontract tests whose seeded record had
fallen past the commitments list's first page (T-19): test infrastructure,
corrected before run thirteen.

## 11. What the rounds cost, and what they were worth

Nine loops, ten release loops and one loop of my own: 111 confirmed product
defects in the ledger, stock, payment, transition, authentication,
authorization, billing and tenant-isolation paths (7 + 5 + 6 + 4 + 3 + 2 + 1
+ 2 + 2 + 8 + 10 + 7 + 8 + 8 + 1 + 8 + 8 + 7 + 8 + 6, five of them regressions
of a loop's own fix, plus six P2 and two P3 fixed, and two P2 and one P3
carried), 136 regression cases (87 of them fail on the code they guard; five guard flows that must keep working), and
a demo-project reconciliation that still balances to the cent after all of
it. The Phase 21 project's own figures did not move once (36/36 before and
after every loop); the defects lived in what those figures never exercised —
concurrency, cross-scope ids and stock in motion — which is exactly where a
certification driven from one client, one request at a time, is blind.
