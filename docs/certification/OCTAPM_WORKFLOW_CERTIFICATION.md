# OctaPM certification — workflow certification

**Status: CERT-3 in progress.** One section per work package, added when the work package closes: rule → evidence → result. Plan: [OCTAPM_CERT3_PLAN.md](OCTAPM_CERT3_PLAN.md). Register: [OCTAPM_LAUNCH_BLOCKERS.md](OCTAPM_LAUNCH_BLOCKERS.md). Journal: [OCTAPM_CERT_JOURNAL.md](OCTAPM_CERT_JOURNAL.md).

**Method:** `OCTAPM_CERT3_PLAN.md` is authoritative: its scope, sequencing, exit criteria (§6.1) and review gates (§6.4) apply unchanged. The owner's efficiency rules of 2026-10-09 (plan §0.0) only change execution:
- rerun just the invalid cases when that still gives valid evidence;
- use targeted regression after a fix;
- run every full run the exit criteria require.
Findings are classified CONFIRMED, PARTIAL, REJECTED, EXPECTED BEHAVIOUR or TEST GAP. Confirmed P0 and P1 are fixed; P2 and P3 are recorded or deferred as the plan says.

---

## WP-0 Foundations — IN PROGRESS (E1, E7, E8 met; E2 outstanding)

| Rule or item | Evidence | Result |
|---|---|---|
| D-ID-1 identity batch (owner Q1–Q14, Q-KEY) | `scripts/cert/cert3/d-id-1-*-proof.js`. CERT-2 regression proofs; realtime proof. Mutations: 208 on `886c9f1`, then 73 targeted after Q-KEY, 235 in all, every one checked to parse. Codex: three rounds on the batch, one on Q-KEY, all adjudicated | 335/335; 506/506; 188/188. Mutations all caught: the one survivor (M17) was a proof gap, now covered. No CRITICAL or HIGH open. Closed at `00c9486` |
| Known answers (answer book) | `scripts/cert/cert3/answers/` (schedule 706, commercial 580, field and controls 268 figures). Each section was drafted, then re-derived by an independent verifier; disagreements adjudicated (`C:\Temp\octapm-cert\scratch\wp0\adjudication.md`) and the applied fixes verified again | 1,439 of 1,477 agreed at first; every disagreement resolved; plan corrected where it was wrong (087 DST, 087-COM-B rates, the 052-SCH-EV order, HR-C1 in C3 and I1) |
| Weak lifecycle checks (E7) | `lifecycle-posthoc-verifier.js` (read only) over the 14 certified projects; `snapshot.js` on 14 of 14; one proving lifecycle, stamp C087R, in 087 with the edited stage scripts | 1,694/1,694 stored figures, 0 contradict, rows identical before and after; `snapshot.js` 14 × 52/52; C087R 582/582 over 18 stages and the snapshot (the certified runs had 496: the stage-table assertions add the rest) |
| Personas (E8) | `permission-probe.js`: 292 transitions × 087's nine personas, and 052's finance administrator, expectations computed from `shared/permissions.json` | Every policy decision matched (124/126). The two failures are the registered suspects, now confirmed: WP0-INV-1 (P2 → WP-5) and WP0-BOQ-1 (P3 → WP-6) |
| Identity leftovers | `d-id-2-repro.js`, `d-id-3-repro.js` | D-ID-2 CONFIRMED (P3 → CERT-7). D-ID-3 CONFIRMED (P3 → WP-8). New: D-ID-7 (P3), D-ID-8 (P3), D-ID-9 (P2), D-ID-10 (P3) |
| Third deep company | `wp0-d3-confirm.js` (read only) | 006 Atlas Infrastructure confirmed, 8/8 |
| Pagination (found by the unit gate) | `d-page-1-proof.js` | D-PAGE-1 (P2) fixed at `d341bd5`: 17/17, mutations 7/7 caught |

**Severity so far:** P0 = 0, P1 = 0. P2 and P3 findings are recorded and deferred (register, "CERT-3 WP-0 findings").

**Outstanding for WP-0 (E2, plan §3.3):**
1. Write the deep-company builders.
2. Stop the API and restore `cert2c` (then re-apply the migrations made since the snapshot).
3. Start the API and run the D-ID-1 proof.
4. Run the builders, detached with the watchdog. Every creation is asserted, and builder exit 0 is required.
5. Confirm the 97-company fingerprint is unchanged.
6. Take snapshot `cert3d`.
WP-0 closes when these pass.
