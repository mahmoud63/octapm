# Subcontractor lifecycle — user experience test

**Phase 11** · **Written:** 2026-09-08 · **Card:** OCTA-UX-SUB-066
**Drive:** [`frontend/e2e/20-subcontractor-lifecycle.spec.ts`](../../frontend/e2e/20-subcontractor-lifecycle.spec.ts)

The whole lifecycle run through the real screens as four people:

> Profile → prequalification → invitation → bid → levelling → award →
> commitment → scope → schedule of values → progress cap → pay application →
> certification → payment → actual cost → cash flow → change → closeout

The API is used only to read back what the screens did and to sign the personas
in. Every number below was **emitted by the drive**, not written from
impression: each persona records its own steps, dialogs, values typed and
values inherited, and the run prints them as JSON.

**Result: the lifecycle completes.** Every stage was reachable, and one broken
nerve was found, fixed and re-driven.

---

## 1. The journeys, as measured

| Persona | Goal | Steps | Dialogs | Typed | Inherited | Nav | Friction |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| **Project Manager** | Get a package out to a prequalified sub | 9 | 2 | 33 | 1 | 3 | 2 |
| **Subcontractor** | Price the package and bid | 4 | 0 | **1** | 2 | 0 | **0** |
| **QS** | Compare bids, recommend a winner | 3 | 0 | 0 | 1 | 1 | 2 |
| **Project Manager** | Award | 3 | 0 | **0** | 1 | 1 | 0 |
| **Project Manager** | Scope and execute | 3 | 0 | 1 | 1 | 1 | 0 |
| **QS** | Raise and submit the application | 4 | 2 | 2 | 2 | 1 | 2 |
| **Project Manager** | Certify | 2 | 1 | **0** | 1 | 1 | 0 |
| **Finance** | Pay | 2 | 1 | 1 | 0 | 1 | 1 |
| **Project Manager** | Change, and closeout | 6 | 1 | 2 | 0 | 0 | 0 |

The PM's 33 typed values are almost all prequalification: nine criteria × (score
+ note), plus expiry dates and the decision. Everything after the award is close
to typing-free — award enters **0** values, certification enters **0**.

**The subcontractor's journey is the best in the product**: four steps, one
number typed, no dialogs, no friction, and the priced draft survives closing the
tab.

---

## 2. Enter once, use everywhere

Traced through the chain the brief names. **No duplicate entry was found.**

| Data | Entered at | Reached, without retyping |
| --- | --- | --- |
| Company name, legal name, registration, email | Vendor profile | Invitation → bid → **commitment vendor** → agreement parties → pay application → payment |
| BOQ item, description, unit, quantity, estimate rate | BOQ | Bid package line → bidder's pricing form → **schedule of values** |
| Rate | Bidder's portal (the only figure they type) | Bid total → award value → **commitment original** → SOV line |
| Retention rate | Commitment | Pay application header, and its arithmetic |
| Schedule of values | Award | Pay application lines, with previous claims and progress caps |
| Gross / retention / net | Claim | Certification, payment, cash flow |

Verified rather than assumed: the awarded commitment's `vendor.id` **is** the
profile created at the start, `commitment.original` **equals** the bid total, and
the SOV line count **equals** the priced line count.

**UX-DUP-SUB-###: none raised.** The one candidate — Finance typing the payment
amount when the net payable is the only valid figure — is logged as an unclear
label rather than a duplicate, because the field exists to allow part payments.

---

## 3. Friction found

### UX-SUB-001 · "Publish & invite" cannot invite — 🟡
The control is enabled on a package with no bidders, and its label promises to
invite. Clicking it fails with `BID_INVITATIONS_REQUIRED`. Inviting has to
happen first, which the label denies.
**Observed:** `PUBLISH_BEFORE_INVITING {"status":"draft"}`.

### UX-SUB-002 · The QS cannot close bidding or select a winner — 🟡
`bid.close` and `bid.award` are PM-only. Commercially right — an award is not
the QS's decision — but the levelling screen offers Select and Close buttons
that will refuse, and nothing says the decision is now the PM's.
**Observed:** `PACKAGE_CLOSE 403`, `QS_CAN_AWARD 403 (bid.award)`.

### UX-SUB-003 · The QS submits the application but cannot certify it — 🟡
Correct separation of duties. But the record reads "Submitted" and says nothing
about whose desk it is on, so the QS has no way to know whether to chase.
**Observed:** `QS_SEES_APPROVE false`.

### UX-SUB-004 · No ball-in-court anywhere in the chain — 🟡
Three separate handoffs (QS→PM award, QS→PM certification, PM→Finance payment)
and none of them is stated on the record. Each is a place work stalls silently.

### UX-SUB-005 · Finance types the payment amount — 🟡
The net payable is the only valid figure for a full payment, and it is on the
screen directly above the empty box.

### UX-SUB-006 · A subcontract can be executed with an unallocated scope matrix — 🟡
22 scope and responsibility rows, **none** allocated to anybody, and the
commitment executed anyway. The agreement knows — it reports `ready: false` —
but nothing between the matrix and the signature enforces it.
**Observed:** `SCOPE_MATRIX {"items":22,"unallocated":22}`.

---

## 4. Scope / responsibility, and the agreement

**Automatic agreement generation already exists**, and was driven rather than
described. `GET …/commitments/{id}/agreement` assembles:

- parties from the company profiles, project from the project record
- money, retention and payment terms from the commitment
- the schedule of values, line by line
- milestones from the activities the SOV is tied to
- **structured scope**: `works`, `responsibilities`, `inclusions`, `exclusions`,
  `clarifications`, `interfaces`
- nine standard clauses that quote the record (change the retention rate and the
  retention clause changes with it)

It also refuses to call itself ready, and says why:

```
ready: false
  The period of the works is not set
  Payment terms are not stated
  The scope matrix has not been agreed
  22 scope rows still have nobody against them
```

### The gap, stated exactly rather than built silently

| Section | Supported by the model | Present after a normal award |
| --- | ---: | ---: |
| Scope of works | ✅ | 11 rows |
| Responsibilities | ✅ | 11 rows |
| **Inclusions** | ✅ | **0** |
| **Exclusions** | ✅ | **0** |
| **Clarifications** | ✅ | **0** |
| **Interfaces** | ✅ | **0** |

The seeded matrix creates only `scope` and `responsibility` rows. Inclusions,
exclusions and clarifications are carried end to end by the data model and by
the agreement — but nothing seeds them and nothing asks for them, so a real
subcontract goes out with those sections empty. **Not built in this phase**, per
the brief.

Also: the bid itself captures `inclusions` and `exclusions` as free text from
the bidder, and they are pasted into the commitment *description* rather than
becoming matrix rows. That is the natural source and it is being discarded.

---

## 5. The broken nerve — found, fixed, re-driven

### 🔴 → ✅ Bid-awarded cost reached the ledger attached to nothing

A package seeded from the BOQ produced bid lines carrying only `boqItemId`. The
award faithfully copied what the line had — which was no activity, no cost code
and no budget line. So certification posted real money to a ledger entry with:

```
sub_pay_app  775,000.00  subcontract
   activity=NULL   costCode=NULL   budgetLine=NULL

=> 1 of 1 entries reach NEITHER an activity NOR a budget line
   value with nowhere to land: 775,000.00
```

Activity actual cost, budget actual and therefore earned value were all blind to
it — while reconciliation still read **balanced**, because both sides agreed on
nothing. That is the worst shape a financial defect can take: invisible to the
check built to find it.

**The information was there the whole time.** The BOQ item behind that line had
an approved 100% allocation to an activity.

**Fix** (`bid.service.codingForBoqItems`): a bid line seeded from the BOQ
inherits the activity from the BOQ item's approved allocation, and the budget
line and cost code from that activity's budget allocation — **only where each is
unambiguous**. A BOQ item split across three activities cannot honestly be one
SOV line naming one of them, and picking the largest share would put real money
on the wrong activity, so split items stay uncoded and visible.

**After, on the same drive:**

```
schedule of values:  activity=01ccac91…  boqItem=set
pay app line:        approvedPct 8 · cap 248,000 · scheduled 3,100,000
certified:           248,000 → ledger 248,000, activity 01ccac91…
=> 0 of 1 entries reach neither an activity nor a budget line
```

The progress cap now binds, which is itself proof the link is live: the claim
was refused above 248,000 until it was brought within the approved 8%.

**Residual, stated:** `costCodeId` and `budgetLineId` stay null when the activity
has no single budget-line allocation. The design refuses to guess. Budget-line
actual therefore still does not see this cost — tracked as the remaining half.

---

## 6. Change, and closeout

Both correct, driven through the screens.

```
original           3,100,000
approved changes      50,000
revised            3,150,000     = original + changes ✓
SOV ceiling        3,100,000 → 3,150,000  (rose by exactly the change) ✓
```

Closeout: 10 items, all outstanding, and closing is refused with
`CLOSEOUT_OUTSTANDING` naming each one.

---

## 7. What worked without comment

- The bidder portal — the one screen an outsider uses — is the cleanest in the
  product.
- Award → commitment with the full schedule of values, zero retyping.
- Certification → actual cost, balanced, at the right figure.
- Payment → cash flow, and **no** second cost posting.
- Prequalification gates both invitation and award, and both refusals name the
  company and the reason.

## 8. A note on method

Two findings in the first pass were **my measurement error, not defects**:
"Finance cannot open a payment application" (an immediate `isVisible()` where a
waiting assertion was needed — Finance is fine) and "the agreement has no scope
section" (read from `clauses` when scope is its own top-level section). Both
were checked against the API before being written down, and both evaporated.
They are recorded here because a UX report that only lists confirmed problems
hides how many candidates did not survive checking.
