# OctaPM certification — issue register and launch blockers

Every finding of the certification programme is recorded here, whatever its
severity. The launch blockers are the open P0 and P1 rows.

**Severity.** P0: one company can see or change another's data, financial
corruption, or a way round authentication. P1: a business launch blocker. P2:
important, can be scheduled after launch if the risk is controlled. P3: polish.

**Status.** Open · Fixed (with the commit) · Accepted (a recorded decision not to
change it) · Deferred (scheduled after launch) · Not a defect.

## Launch blockers now

*None recorded yet. The programme is at CERT-0.*

## Register

| ID | Severity | Area | Company / role | Reproduction | Expected | Actual | Cause | Fix | Test | Status | Commit |
|---|---|---|---|---|---|---|---|---|---|---|---|
| C0-1 | P1 | Background jobs / exception engine | Any deployment | Start the API without `EXCEPTIONS_ENGINE_ENABLED` in its environment | The engine is off unless it is explicitly switched on | The engine is on: it evaluates every organisation on domain events and nightly, and opens exception rows | The flag's default in `exception-engine.service.js` is "on unless set to false" | Reverse the default: on only when explicitly set to `true`; the same for the nightly scheduler | Unit test of the default with the variable missing, empty and malformed; live proof that an unset environment produces no evaluation job | Open | — |
