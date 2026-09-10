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
