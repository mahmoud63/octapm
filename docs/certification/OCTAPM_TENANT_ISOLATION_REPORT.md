# OctaPM certification — tenant isolation report

**Status: CERT-2 complete (2026-10-05).** Every acceptance count of the final
run is 0. L38, the one cross-company P1 the sweeps could not reach, is closed
on the owner's decision (below): P0 = 0, P1 tenant-isolation = 0. The document
text-content gap is carried to CERT-6.

## The final run

| | |
|---|---|
| Run | `cert2c`, 2026-10-05, on `4856924` (fix rounds 1-7 and the run's tooling); `run-cert2.js --tag=cert2c`, 236 min, 0 API restarts |
| Population | Regenerated from empty on that code: layer 1 identical to run 1; 100 companies, 704 projects; 3,895 record-driver runs, 0 failed; 14 certified lifecycles × 496 checks, 0 failed. Kept as the server-side snapshot `octapm_cert_snap_cert2c` |
| Results | `C:\Temp\octapm-cert\results\isolation\cert2c-*.json` (tally: `cert2c-tally.json`); logs `logs\cert2c\` |

## Attacks and results

| Attack | Count | Result |
|---|---|---|
| Reads: another company's records by id, list, search and query, as an outsider and as a member of another company (after an owners-only warm-up) | 73,712 | 56,210 refused, 302 filtered, 17,200 query probes empty; **0 leaks, 0 answered** |
| Replay: every route template (501) with another company's ids, reads and writes | 235,180 | 225,169 refused, 2,596 filtered, 511 refused by validation, 6,904 refused on the caller's own billing; **0 accepted writes, 0 answered; data changed 0** |
| Files: download, preview and signed links of another company's files | 5,904 | **all refused; data changed 0** |
| Injection: another company's id in every reference field of a write (291 route/field pairs) | 28,727 | 23,444 refused, 3,488 refused by the caller's own record state, 1,795 by its own billing; **0 accepted** |
| Stored cross-company references (census of every reference column, 241 tables) | — | start 0, after injection 0, end 0; **0 new** |
| Injection with every victim company fingerprinted (odd→even, even→odd) | 28,727 | **victim (company, table) pairs changed: 0**; new references 0 |
| Realtime and workspace switching (`realtime-proof.js`, five company pairs, both companies acting at once) | 117 checks | **117 passed**: no socket received another company's event; a person of two companies receives each company's events only in that workspace, and switching carries nothing across (50 of the checks) |
| Shapes: each reference sent as an array, nested array, object, number, boolean, operator | 1,746 | **0 5xx, 0 new references, 0 victim tables changed** |
| Query shapes: every read's query parameters, repeated and malformed | 52,255 | **0 5xx, 0 leaks; 10,451 oracle pairs, 0 differing** |
| Dates and figures the database cannot hold | 9,854 | **0 5xx** |
| Proofs of every lead and fix round, in process (59 scripts) | — | 54 passed in the run; four more failed only at setup on the regenerated population (they read ids and residue rows of the earlier one) and pass after that correction: 167/167, 138/138, 140/140, 279/279. `availability-7` fails one timing margin of its own baseline comparison, 37/38 (not tenant; CERT-7) |

**Lazy initialisation.** The rows a read creates were attributed row by row
(`attribute-changes.js`) to the person whose request made them. Read window:
1,206 rows, warm-up window: all rows — every one in the requesting person's own
company (each company PM's notification preferences, scope matrices, closeout
lists, evaluations and their criteria, one weekly report, its owner's audit
trail). **Rows naming anyone outside their company: 0.**

**Tenant-related 5xx: 0** in every sweep above.

## Acceptance counts

| Count | Result |
|---|---|
| Cross-company reads | 0 |
| Cross-company writes | 0 |
| Stored foreign references | 0 |
| Foreign-record response leaks | 0 |
| File leaks | 0 |
| Realtime leaks | 0 |
| Workspace-switch leaks | 0 |
| Victim-state changes | 0 |
| Tenant-related unexpected 5xx | 0 |

## What was found and fixed on the way

Recorded in [OCTAPM_LAUNCH_BLOCKERS.md](OCTAPM_LAUNCH_BLOCKERS.md): the lead
findings (L3-L10, L39, cross-company P0/P1, fixed before CERT-2), the first
run's foreign-reference findings (C2-BID … C2-EXPORT: eight P1 cross-company
writes, three P3), and fix rounds 1-7 (C2-R1 … C2-R6), which drove the 40
injection pairs the sweeps could reach only in a refusing state.

## L38 — closed on the owner's decision (2026-10-05)

`POST /users` with the e-mail of a person homed in another company attached
them as an active member without their consent and answered with their profile.
The sweeps attack with ids, not e-mail addresses, so the run did not exercise it.
Owner decision: such an e-mail joins only through an invitation the identity
accepts with its own authenticated session, and nothing about it is disclosed
before. Implemented, reviewed independently three times (plan, diff, fixes —
Codex; every finding adjudicated), and proven:

| Check | Result |
|---|---|
| `l38-invitation-proof.js`: the owner's cases A–M on `POST /users` and `POST /users/invitations`, and every review case (former members and home identities whose membership ended, races, foreign and same-company SSO sessions, changed party offers, a reopened account, malformed names, custom fields) | 54/54 on the fixed code; the old code failed 15 of its first 35 checks |
| Mutations re-introducing each defect | 14/14 caught |
| L38 lead | no longer reproduces; it and the proof now run in every CERT-2 run |
| Membership, people-reference and custom-field regression proofs (14) | all pass (team membership 11/11, shared identity 10/10, people templates 54/54, people refs 96/96, people evidence 230/230, evidence 208/208, punch/RFI/tasks 167/167, quality forms 138/138, daily logs 98/98, inventory references 19/19, workflow activity 72/72, audit/custom fields/assistant, L39 and L45 leads) |
| Tenant sentinel on the final code (reference census, read sweep and injection from ten companies, full replay of 501 routes, realtime + workspace switching) | 247,530 attacks over 666 routes: leaks 0, answered 0, writes accepted 0, 5xx 0, replay data changed 0, new cross-company references 0; replay verdicts identical to the final run's; realtime 117/117 |

**Found by the review and fixed with it — a cross-company read (C2-CF, P1):** a
custom field of type person or company took any id, and a report then printed
the other company's person (name, e-mail) or company by name. Values are now
checked against the company's people and directory, refused exactly as an id
that exists nowhere, and report names are resolved in the company only.

**Reference census.** The sentinel's census counted 38 cross-company references
at its start and end: the proof's own fixture rows (a stored foreign value, to
show a report does not resolve it) and the audit trail of one mutation run that
deliberately re-introduced the custom-field defect — all on the proof's own
records in company 024. They were deleted and the census re-taken; the proof now
removes its fixture rows itself.

Recorded, not tenant isolation: D-SEC-1 (a workspace's "MFA required" is not
enforced anywhere — CERT-7), D-ID-1 (`POST /users` answers 201 for a new e-mail
and 202 for an existing one, which tells an admin an account exists for it —
owner decision), D-ID-2, D-ID-3, D-SSO-1 (register).

## Open or carried

- **Document text content (CERT-6).** Every `DocumentText` row of the
  population is pending — the extraction worker was not running — so reads of
  extracted text were exercised only by the document proofs, not the sweeps.
- **Not tenant, deferred:** see the register's deferred list (D-FIN-1, D-FUN-1/2,
  D-VAL-1, D-DQ-1, D-OPS-1, D-PERF-1, D-SEC-1, D-ID-1..3, D-SSO-1).

**Backend suite.** 290/296 suites passed. 6 suites were not executable because
the expected development PostgreSQL on :55432 was unavailable. The full suite is
not green yet: those six are rerun in their intended environment, and must pass,
before final release certification.

See [OCTAPM_FULL_SAAS_CERTIFICATION.md](OCTAPM_FULL_SAAS_CERTIFICATION.md) for the programme and
[OCTAPM_CERT_JOURNAL.md](OCTAPM_CERT_JOURNAL.md) for where the work stands.
