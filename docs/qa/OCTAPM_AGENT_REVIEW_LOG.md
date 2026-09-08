# Adversarial review log

**Phase 15** · **Written:** 2026-09-08 · **Card:** OCTA-QA-ADVERSARIAL-071
**Harness:** `scratchpad/adversarial.js` (driven against the live API)

---

## Codex availability

# CODEX NOT AVAILABLE

Checked rather than assumed, on this machine:

| Check | Result |
| --- | --- |
| `codex` / `codex-cli` on PATH | not found |
| `npm ls -g` for `@openai/codex` | not installed |
| `CODEX_*` / `OPENAI_*` environment variables | none set |
| `%LOCALAPPDATA%\Programs\codex`, `%APPDATA%\npm\codex.cmd` | absent |
| MCP servers in `.mcp.json`, `.claude/`, user settings | no Codex server |
| Codex tool in this session's tool list | absent |

**Nothing in this document was produced by Codex.** What follows is a Claude
adversarial pass — the same attack list, run by the same agent that wrote the
code, which is a weaker guarantee and is labelled as one.

### To make Codex available

```bash
npm install -g @openai/codex
```

```bash
codex login
```

Then either leave it on PATH (it can be driven with `codex exec "…"`), or wire
it as an MCP server so it returns structured results:

```bash
printf '%s' '{"mcpServers":{"codex":{"command":"codex","args":["mcp"]}}}' > .mcp.json
```

The login and any API billing are the owner's to do.

---

## What was attacked

The brief's list, run against the running system. Each attack reports **PASS**
(refused or absorbed), **FAIL** (got through) or **SKIP** (could not be set up —
recorded as untested rather than passed).

### Subcontractor chain

| # | Attack | Verdict | What happened |
| ---: | --- | :---: | --- |
| 1 | Bill 150,000 against a 100,000 schedule line | ✅ PASS | `400 SUB_PAY_APP_EXCEEDS_SCHEDULED` |
| 2 | Claim a negative amount | ✅ PASS | `400 VALIDATION_ERROR` |
| 3 | Certify the same application twice | ✅ PASS | ledger unchanged at 9,215,429.53 |
| 4 | Retention silently deducted from actual cost | ✅ PASS | gross 20,000 posted; retention 2,000 held, not netted off |
| 5 | Pay more than the net certified | ✅ PASS | `400 SUB_PAY_APP_PAYMENT_EXCEEDS` |
| 6 | Pay the same certificate twice | ✅ PASS | `400 SUB_PAY_APP_PAYMENT_EXCEEDS` |
| 7 | Paying posts the cost a second time | ✅ PASS | ledger unchanged |
| 8 | Revoke a certificate after it was paid | ✅ PASS | `409` |
| 9 | Raise a claim on another project's commitment | ⚪ SKIP | only one project in this database |
| 10 | Read a record that is not there | ✅ PASS | `404`, not a leak or a 500 |
| 11 | Change order naming another contract's schedule line | ✅ PASS | `400 COMMITMENT_CO_LINE_SOV_INVALID` |

### Procurement and inventory

| # | Attack | Verdict | What happened |
| ---: | --- | :---: | --- |
| 12 | Issue more stock than exists | ✅ PASS | `409 INV_INSUFFICIENT_STOCK` |
| 13 | Issue a negative quantity | ✅ PASS | `400 INV_QUANTITY` |
| 14 | Issue with no activity and no cost code | ✅ PASS | `400 INV_NO_COST_TARGET` |
| 15 | Two concurrent issues that together exceed the shelf | ✅ PASS | `409/409`, on hand 350 → 350, **never negative** |
| 16 | Receive against an order never issued to a supplier | 🔴 → ✅ | **was accepted `201`** — see below |
| 17 | Receive 500 against an order for 10 | ✅ PASS | `409 RECEIPT_OVER_ORDER` |
| 18 | Post the same delivery note twice | 🟡 → ✅ | caught, but as a `500` — see below |
| 19 | Receiving stock counted as a cost | ✅ PASS | reconciliation balanced |
| 20 | Issue naming a project and an activity that disagree | ⚪ SKIP | only one project in this database |

**Final: 18 PASS · 0 FAIL · 2 SKIP.**

---

## Findings, and the loop

### 🔴 FIND-01 · Goods received against an order that was never sent

**Attack 16.** A `planned` purchase order — never submitted, never approved,
never issued — accepted a delivery and created stock (`201`).

The same shape as the Phase 12 finding at the other end of the chain: the
approval workflow can be walked around. Here the walk-around is from the
warehouse. Stock appears, a cost follows it when issued, and a supplier invoice
then three-way-matches against an order nobody authorised.

| Step | |
| --- | --- |
| **Reproduced** | attack 16, deterministically, on a fresh order |
| **Investigated** | `receiveAgainstOrder` loaded the order and checked it existed; it never checked its state |
| **Fixed** | `RECEIVABLE_STATUSES` — a delivery may only arrive against `issued`, `acknowledged`, `partial` or `received`. Anything earlier is refused with `409 PO_NOT_ISSUED` naming the order's actual state and the route that issues it |
| **Retested** | `409 PO_NOT_ISSUED` |
| **Regression** | attacks 17–19 still pass against a properly issued order |

### 🟡 FIND-02 · A duplicate delivery note answered with a 500

**Attack 18.** Posting the same delivery note twice was caught — by the unique
index, as `500` with a raw `P2002`.

The money was safe; the answer was not. A storeman rescanning a note, or
re-tapping on a flaky phone signal, was told the system had broken rather than
that they had already done this.

| Step | |
| --- | --- |
| **Reproduced** | attack 18 |
| **Investigated** | `@@unique([projectId, receiptNumber])` held, but nothing caught the violation, so it escaped as an unhandled Prisma error |
| **Fixed** | the receipt number is checked before the write and refused with `409 RECEIPT_ALREADY_POSTED`, naming the note and the receipt that already has it |
| **Retested** | `first 201, second 409 RECEIPT_ALREADY_POSTED` |

---

## Where this pass is weak, stated plainly

- **It is not independent.** The same agent wrote the code and the attacks, so it
  cannot find what it did not think of. That is the whole reason the brief asked
  for Codex, and the reason this section exists.
- **Two attacks were skipped**, both cross-project. This database has one
  project, so isolation between projects and between tenants is **untested**,
  not passed. That is the most valuable gap remaining.
- **Three attacks passed for the wrong reason on the first run** and were
  corrected: the purchase order in the harness had no supplier and no required
  date, so it never reached `issued`, and the receipt attacks were all short-
  circuiting on `PO_NOT_ISSUED` while reporting green. The harness now refuses to
  report PASS on a step whose set-up failed, and reports SKIP instead.

That last point is the honest summary of this whole phase: **a green result is
only worth the scepticism applied to the instrument that produced it.** Across
Phases 11–15, four separate "findings" evaporated on inspection and three
"passes" were false. Every one was caught by an internal contradiction in the
measurement, not by re-reading the product.

---

# Phase 20 — reviewing the reviewers

Codex remains unreachable from this machine. Rather than record another
Claude-reviewing-Claude pass and call it independent, this phase attacked the
**instruments** instead: where a test and the code it checks were written from
the same guess, that pair was replaced by a test that reads its expectation
from the thing being checked.

## Three tests that agreed with the code and not the product

| what agreed | how it was broken | what replaced it |
| --- | --- | --- |
| The ball-in-court table said a commitment is `pending_approval`; the unit test asserted `pending_approval` | The service says `pending`. Every commitment showed **no badge**, and both halves were happy | `ball-in-court.vocabulary.test.js` reads each vocabulary from the service that publishes it |
| The action centre named the model `purchaseOrder` behind a skip-if-missing guard | The model is `procurementOrder`. Every buyer's orders were absent; nothing failed | `record-assignment.models.test.js` runs against the **real** Prisma client — a mock would hold a second copy of the same guess |
| "Your action" derived from the permission policy | A PM is permitted on nearly everything, so it fired on six of six rows of every register | A test that asserts a PM is *not* told a draft commitment is theirs, verified by reverting the fix |

The first of those found a product defect within a minute of being written:
`partial` and `received` were missing from the purchase-order status
vocabulary, so filtering the register for them returned **400** — on the two
states an order spends most of its life in after issue.

## Fixes verified by removing them

Two fixes were confirmed the hard way — the fix was reverted in place and the
test watched to fail, then restored:

- `isYou` reverted to the permission rule → *"does not tell a PM that
  everything is their action"* fails.
- The model name reverted to `purchaseOrder` → both model tests fail, naming
  the exact typo.

## What this still is not

It is not an independent adversarial review, and it is not offered as one.
Everything above was written by the same agent that wrote the code, and a
shared blind spot survives all of it. **Codex, or any second reviewer, remains
the most valuable gap in this programme** — it has been the most valuable gap
since Phase 15 and nothing in this phase changes that.

What did change is the standard applied to a green result. Ten defects were
found this phase and **not one of them was found by a failing test.** Seven
were literally invisible: a missing badge, a skipped record type, a deep link
that opens a list instead of a record, two permanently-null columns, and a
filter returning 400. The only instrument that found them was driving the
product as a person and reading what came back.
