# Parallel branch reconciliation — `claude/change-sets-0001-0006`

**Product line:** `feat/p0-foundations-sprint1` @ `19d6140` (clean)
**Parallel branch:** `claude/change-sets-0001-0006-20260904-2353` @ `18b54c7`
**Merge base:** `78bdd25` (2026-06-14) · product line is **69 ahead, 3 behind**
**Decision:** nothing merged, nothing cherry-picked in this pass. Two items
recorded as deferred candidates, one pattern adopted by design rather than by
code.

---

## The three commits

| Commit | Date | Subject |
| --- | --- | --- |
| `9faf14c` | 2026-06-13 | fix: unblock CI release validators |
| `9b4598f` | 2026-06-13 | feat: simplify auth account links |
| `18b54c7` | 2026-09-04 | Apply Claude change-sets 0001-0006 (prisma fix, RBAC templates, contract spine, RFI v2, UI slice) |

The two June commits predate the merge base by hours but sit on the `ai-dev`
line that was never fully folded in. Only `18b54c7` is substantial.

---

## Classification

### 1. `money.js` — defensive `Prisma.Decimal` fallback · **REJECT (deferred)**

Their change stops importing `Prisma.Decimal` at module load, falling back to
`@prisma/client/runtime/library`'s `Decimal` when `Prisma.Decimal` is not a
function.

**Tested on this branch before deciding:**

```
typeof Prisma.Decimal = function
isDecimal              = function
new Prisma.Decimal('1.005').plus('0.01') = 1.015
```

The failure mode it defends against does not occur here (Prisma 6.19.3). Their
accompanying test only exercises the fallback itself — it adds no coverage of
money behaviour. My `money.test.js` already covers decimal arithmetic,
two-decimal input validation, Prisma `Decimal` normalisation and retention
rounding.

**Reasoning:** this file is the arithmetic foundation of the entire financial
posting spine being built in this phase. Adding an untested indirection layer
to it, for a fault we cannot currently reproduce, is a bad trade at exactly the
wrong moment. Revisit only if a Prisma packaging change makes it real.

### 2. `validate-ec2-user-data.mjs`, `CHANGELOG.md` · **REJECT**

Infrastructure CI validator, unrelated to the product. This branch has its own
EC2 bootstrap work committed separately.

### 3. Auth sign-in / sign-up link simplification · **CONFLICTING — REJECT**

`9b4598f` removes the account links from `user-auth-form.tsx` and
`sign-up-form.tsx`.

This branch has **PW-08** (`08-auth-entry.spec.ts`, 6 tests) which asserts
*"sign-in offers a way to create an account, and back again"* and drives both
legal-page links. Taking this commit would break a currently-passing browser
test that encodes a deliberate product decision. If the simplification is
wanted, it should be re-specified against the current entry pages, not merged.

### 4. `contract.service.js` — **NAME COLLISION, NOT A COMPETING IMPLEMENTATION**

This is the most important finding of the reconciliation, and it would be easy
to get wrong.

| | Parallel branch | Product line |
| --- | --- | --- |
| `contract.service.js` | commitment + prime-contract **spine** — `createCommitment`, `transitionCommitment`, `createPrimeContract`, `getCommittedReconciliation`, `syncCommittedFromCommitments` | **AI contract intelligence** — `ContractProfile`, clause extraction, notice monitor, EOT entitlement assessment |

They are two entirely different features that happen to share a filename. The
parallel branch's *contract spine* corresponds to this branch's
`commitment.service.js` + `prime-contract.service.js`, which are substantially
further developed:

| Capability | Parallel | Product line |
| --- | --- | --- |
| Commitment SOV lines | flat `commitmentLine` | `CommitmentSovLine` with `boqItemId`, `budgetLineId`, `costCodeId`, `activityId` |
| Commitment change orders | — | `CommitmentChangeOrder` with `sovLineId` revised ceilings |
| Prime contract | basic CRUD | advance ledger, retention cap, advance recovery, tax-on-remainder certification, receivables ageing |
| Scope / agreement / closeout / evaluation | — | four further modules, browser-tested |

**Verdict: superseded.** Do not merge.

### 5. `getCommittedReconciliation` — **PATTERN WORTH ADOPTING, CODE REJECTED**

Their reconciliation reads well:

```js
derived  = Σ commitmentLine.amount  by activityId   (approved/complete only)
recorded = costRecord.committed     by activityId
variance = recorded − derived
sync     = write only the rows where variance ≠ 0, in one transaction, audited
```

The code is not portable — it references `commitmentLine` (this branch:
`commitmentSovLine`) and statuses `approved`/`complete` (this branch:
`executed`/`closed`). But **the derived-vs-recorded-with-variance shape is
exactly right**, and it is the shape this phase needs for
`recomputeActualCost`.

**Verdict: adopt the pattern in Phase 7, written natively against this
branch's schema. Credit recorded here.**

### 6. `permission-template.service.js` · **SUPERSEDED**

Theirs 379 lines; this branch's 1,069, with party templates, resolution
ordering and template context used across the workflow engine, report builder
and custom fields.

### 7. `rfi.service.js` (RFI v2) · **SUPERSEDED**

Theirs exports `addRfiAssignees`, `computeBallInCourt`, `forwardRfi`,
`getRfiWorkflow`, `respondToRfi`, `setOfficialRfiResponse`. This branch
implements the same concepts in `rfi-workflow.service.js` layered over
`rfi.service.js`, with `RfiAssignee` / `RfiResponse` tables, one official answer
per revision, schedule-impact links, change conversion and PDF export.

Same functionality, different file organisation, further developed here.

### 8. `shared/permissions.json` · **SUPERSEDED, one item deferred**

The parallel file is 381 lines larger but **smaller in scope** — it is more
verbose per module, not broader.

| | Parallel | Product line |
| --- | --- | --- |
| version | `2026-06-12-v6-meeting-minutes` | **`2026-09-05-v7-locations`** |
| modules | 21 | **37** |

**In theirs only:** `prime_contract`
**In this branch only (17):** `inventory`, `report`, `workflow`, `custom_field`,
`assistant`, `bid`, `portfolio`, `sub_pay_app`, `location`, `inspection`,
`punch`, `timesheet`, `change_event`, `lookahead`, `conversation`, `bim`,
`email`

> **Deferred candidate DC-1 — a dedicated `prime_contract` permission module.**
> This branch gates prime-contract endpoints under `ipc.*`. A dedicated module
> is arguably cleaner: certifying a client application and administering the
> head contract are different authorities. **Not actioned** — changing a
> permission module mid-phase would invalidate the 224-probe authorisation
> sweep, and it is unrelated to financial posting. Raise as its own card.

### 9. Frontend `features/contracts`, `features/rfi-workflow`, `features/admin/permission-templates` · **SUPERSEDED**

Replaced on this branch by `features/commercial/*` (commitments, pay apps,
client billing, closeout, evaluation), `features/doc-control/*` (RFI create,
detail, saved views, people) and `features/company/permissions.tsx`.

### 10. Seven documents absent from this branch · **REJECT (stale), one deferred**

`PROCORE_BENCHMARK.md` (727 lines), `OCTAPM_CURRENT_ARCHITECTURE.md`,
`OCTAPM_TARGET_ARCHITECTURE.md`, `OCTAPM_VS_PROCORE_GAP_ANALYSIS.md`,
`OCTAPM_PRODUCT_ROADMAP.md`, `OCTAPM_FEATURE_INVENTORY.md`,
`LAUNCH_RUNBOOK.md`.

These describe a **June-era architecture**. This branch has since delivered
cards 001–058 and the architecture they document no longer matches the code.
Importing them would place two contradictory architecture descriptions in the
same repository — the precise "duplicate architecture" outcome the brief warns
against.

> **Deferred candidate DC-2 — `PROCORE_BENCHMARK.md`.** Has standing value as a
> *historical* competitive benchmark. If wanted, import it under
> `docs/history/` with a header stating the date and that it describes a
> superseded state.

---

## Summary

| # | Item | Classification |
| --- | --- | --- |
| 1 | `money.js` Decimal fallback | **Reject (deferred)** — unreproducible fault; wrong moment |
| 2 | EC2 validator, CHANGELOG | **Reject** — unrelated |
| 3 | Auth link simplification | **Conflicting → Reject** — breaks PW-08 |
| 4 | Contract/commitment spine | **Superseded** — name collision, different domain |
| 5 | `getCommittedReconciliation` | **Pattern adopted**, code rejected |
| 6 | Permission templates | **Superseded** (1,069 vs 379 lines) |
| 7 | RFI v2 | **Superseded** — same concepts, further developed |
| 8 | `permissions.json` | **Superseded** (v7/37 vs v6/21) · DC-1 `prime_contract` deferred |
| 9 | Three frontend features | **Superseded** |
| 10 | Seven architecture documents | **Reject (stale)** · DC-2 benchmark deferred |

**Nothing was merged or cherry-picked.** One pattern (5) is adopted by design in
Phase 7 and credited here. Two deferred candidates (DC-1, DC-2) are recorded as
their own future cards, neither blocking this phase.

**Recommendation:** the parallel branch should be **formally abandoned** once
DC-1 and DC-2 are dispositioned. Leaving it live invites a future wholesale
merge that would regress the product line by 16 permission modules and four
commercial subsystems.
