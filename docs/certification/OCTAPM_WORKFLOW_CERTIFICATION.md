# OctaPM certification — workflow certification

**Status: CERT-3 in progress.** One section per work package, added when the work package closes: rule → evidence → result. Plan: [OCTAPM_CERT3_PLAN.md](OCTAPM_CERT3_PLAN.md). Register: [OCTAPM_LAUNCH_BLOCKERS.md](OCTAPM_LAUNCH_BLOCKERS.md). Journal: [OCTAPM_CERT_JOURNAL.md](OCTAPM_CERT_JOURNAL.md).

**Method:** `OCTAPM_CERT3_PLAN.md` is authoritative: its scope, sequencing, exit criteria (§6.1) and review gates (§6.4) apply unchanged. The owner's efficiency rules of 2026-10-09 (plan §0.0) only change execution:
- rerun just the invalid cases when that still gives valid evidence;
- use targeted regression after a fix;
- run every full run the exit criteria require.
Findings are classified CONFIRMED, PARTIAL, REJECTED, EXPECTED BEHAVIOUR or TEST GAP. Confirmed P0 and P1 are fixed; P2 and P3 are recorded or deferred as the plan says.

---

## WP-0 Foundations — IN PROGRESS (E1, E7, E8 met; E2 executed 2026-10-12, `cert3d` taken; closes when the allowed BLOCKED refs land)

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

**E2 (plan §3.3), build order run 2, 2026-10-12 (run date Monday):** cert2c restored and migrated; D-ID-1 proofs 316/316; 15 builders fresh with 0 failed steps, 0 5xx, 0 pending; run-all exit 2 with 26 BLOCKED steps, every one on an allowed ref (L34 8, HR-C11 6, HR-C1 3, HR-C8 2, HR-K1 2, L112, HR-S9, RFI-DRAFT, HR-K2, HR-K7); the 97 other companies unchanged (fingerprint97 exit 0, 0 pairs); snapshot `cert3d` taken. WP-0's formal close (builder exit 0) waits for those refs' rule decisions and fixes; `cert3d` is the working baseline.

---

## WP-1 Schedule — EVIDENCE COMPLETE (2026-10-12); closure waits for the owner's HR decisions (HR-S1, S3, S4, S5, S6, S8, P5)

Primary run `wp1-schedule-proof.js` on `cert3d` (restored after the confirm-first sweep), full, no flags, in process: **exit 0, 147/147** (146 + `G.5xx`); known answers **21 BLOCKED with refs, 1 at value, 0 wrong**; 0 5xx. No product or proof change followed, so this run is the WP-1 result and the mutation baseline.

| Rule or item (plan WP-1) | Evidence (final check ids) | Result |
|---|---|---|
| Conversion: hours / 8 with Math.round, clamped at 0; lags the same; FS, SS, FF, SF; parity | CONV.durations, CONV.lags, CONV.floatMinus80, CONV.parity.p6xml / .xlsx / .mspdiF1 / .mspdiF2 (087-IMP snapshots); KA.CONV.mspNegativeSlackCritical | pass; rounding as the plan states it (HR-S4 note); HR-S3 BLOCKED |
| Imports are staged, never applied; out of range refused | IMP.stagedNotApplied, CONV.activeEqualsStaged, CONV.range.atMax, CONV.range.beyond, IMP.dryRun, IMP.formats; mutations I1, I2, I3; UI3 | pass; I1 (guard), I2, I3 caught; UI3 caught |
| Import roles | IMP.siteEngineer (403), IMP.outsider (404 PROJECT_NOT_FOUND) | pass |
| Two-project files, Windows-1252, second calendar | KA.IMP.twoProjectXer (X), KA.IMP.windows1252, KA.IMP.secondCalendar | HR-S4 BLOCKED (two); secondCalendar at value, P2 recorded |
| Revision state codes | REV.* state checks, KA.REV.hrS3.approve (400 SCHEDULE_NOT_READY) | pass; contracts D1, D2 named; HR-S3 BLOCKED |
| Activation: CPM inside the transaction; record counts; mapped ids keep approved progress; mapping by code | REV.activate.*, REV.mapByCode.live / .stored; `wp1-activation-code-repro.js` 12/12 on `cert3d` | pass; plan :506 TEST GAP (C4, C5 SURVIVED as designed) |
| F1b, second baseline, rollback | REV.F1b.live / .stored, BL.secondBaseline, REV.rollback.live, KA.REV.rollback.A140id | pass; WP1-RB-1 BLOCKED (P2) |
| CPM invariants: T1, T2, cycle with no write | T1.*, T2.*, CYC.*; mutation C1 | pass; C1 (guard) caught by all 15 named catchers |
| SS / FF / SF / lead (T3, T4) | T3.*, T4.*, KA.T3.*, KA.T4.*; mutations C2, C3 | pass; HR-S1 BLOCKED (4); C2 (guard), C3 caught |
| Mixed calendar | CYC.mixed.A, KA.CYC.mixed.B | HR-S5 BLOCKED |
| Baseline gates and coverage | BL.* (W, stored, 087-SCH); mutations G1-G5; UG1-UG4 | pass; G1 and G5 (guards) and G2-G4 caught; UG1-UG4 caught; PB-2 closed (expected behaviour) |
| Hand-built programme (L124) | KA.BL.handBuilt (X) | HR-S8 BLOCKED |
| Roles | REV.roles.*, REV.approve.*, BL.planner, BL.siteEngineer, IMP.*; WP-0 permission probe | pass |
| Milestones (HR-S2, decided) | REV.approve.pm, DATES.renameM900, DATES.readiness, DATES.endBeforeStart.*; CF.1; `wp1-milestone-repro.js` 11/11 on `cert3d` | pass; CF.1 REJECTED (fix holds) |
| Start date and calendar changes | KA.DATES.startMoved.*, KA.DATES.calendarChange.*; CF.7 | HR-S6 BLOCKED (4) |
| Status boundaries and surfaces | STATUS.*, TAIL.*, KA.STATUS.* | pass; HR-P5 BLOCKED (5) |
| 052-SCH-EV and 006-LITE lanes | LANES.052, LANES.006 (first execution) | pass |
| Confirm-first items | CF.1-CF.10 | CF.1, CF.4 REJECTED (fixes hold); CF.2, 3, 5, 6, 7, 8, 9, 10 CONFIRMED (reported) |
| Mutations (E6) | `results\cert3\wp1-mutations\<id>.json`, `wp1-mutations.unit.json`, `wp1-mutation-evidence.js` (exit 0) | E6 5/5 (C1, C2, G1, G5, I1) by their named catchers; C3, G2-G4, I2, I3 caught; C4, C5 SURVIVED as designed; unit 7/7; the 22 landed-fix guards stand at `f599e67` (no diff since) |
| Census | fingerprint wp1-post vs cert3-post (fingerprint97 exit 0) | the 97 others 0 pairs; 087 only the throwaway projects, the F1float5 status and noise; 088 sign-in noise; tree clean |
| Reviews (E11) | no product diff beyond `f599e67`; proof, lists and book unchanged since `fc29478` | Codex not needed (loop closed by the owner); no new diff to review |

**Severity:** P0 = 0, P1 = 0 new. Owner decisions pending: HR-S1, HR-S3, HR-S4, HR-S5, HR-S6, HR-S8, HR-P5 (and HR-S7 documentation).
