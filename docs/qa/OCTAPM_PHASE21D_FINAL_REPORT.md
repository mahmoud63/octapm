# Phase 21D — final certification closure

Branch `feat/p0-foundations-sprint1`. Starting HEAD `11c2335f9f27fc97be65039112fee2c443d0a489` (local = origin, 0 0). Final code HEAD **`ded5fa0414b8ef907255c210442587c3a7685bff`**; the documents commits on top of it make the final HEAD named in section L. Worktree `.claude/worktrees/procore-competitive-benchmark-6bd1b6`. 2026-09-12 (evening UTC) to 2026-09-13.

Constraints honoured: no Phase 22 work, no new features, P21-021 not fixed, nothing deployed, nothing merged to main, no force push.

## A. Git verification (1–3)

1. HEAD at start `11c2335f…`; `git rev-list --left-right --count HEAD...origin/feat/p0-foundations-sprint1` = **0 0**; `origin/main` had not moved.
2. Working tree clean of everything but the 38 churned gallery PNGs (screenshot noise, excluded from every commit; restored before the final push).
3. Successor HEADs, each a logical commit: `77a1340` (round-1 fixes), `aa1972c` (gate repairs and the driver), `ffe09fc` (round 2), `15a9713` + `6165c04` (round 3 and a test correction), `5345f36` (round 4), `adee79d` (round 5), `66da083` (round 6), `f3c8591` (round 7), `65bddc2` (round 8), `28a2d50` (round 9), `79f5ea1` (release challenge, first pass), `772f2c5` (through-date correction), `221eb25` (documents), `29456c4` (release challenge, second pass — ten fixes), `7788c98` (documents), `2b0df2b` (third pass — seven fixes), `59cf34b` (fourth pass — eight fixes), `d23dc05` (fifth pass — ten fixes), `ded5fa0` (the sixteenth loop's correction of my own regression), then the documents.

## B. The 145/147 gate (4–8)

4. **Gate A — screenshot write**: the spec wrote its PNG into the OneDrive-synced, tracked gallery; the sync client holds files open and the write fails with `UNKNOWN`. Root cause **ENVIRONMENT**. A `SHOTS` helper in `e2e/support.ts` now writes every screenshot to a per-run folder under `test-results/screenshots/<stamp>` (git-ignored, never rewritten); the gallery is refreshed on purpose with `E2E_SHOTS_DIR`. No visual assertion was weakened. Spec 11 alone: **11/11, 11/11**.
5. **Gate B — inventory**: (a) the analytics check hunted a seeded row in a ranked top-25 that residue had filled — a **TEST DEFECT**, now compared against the API's own ranked rows; (b) the match test raised an unpromised order that the Match tab's 100-order window (sorted on the order's promised date, unpromised last) no longer showed — a **PRODUCT LIMITATION**, registered as **P21-022**; the spec gives its order a promised date the product sorts first and asserts through the API that the order is inside the window before it clicks. No `take: 500/1000`, no newest-first assumption, no deletions.
6. Spec 11 after the polluting specs 13, 21 and 29: **21/21**.
7. Greenfield spec 32 twice before any fix: **3/3, 3/3** (allowance, cleanup, duplicate transactions, token expiry, reference collisions all asserted by the spec).
8. Both gates closed at `aa1972c`; the full run is in section H.

## C. Claude → Codex connection (9)

9. `codex exec --sandbox read-only` from this session returned `CODEX_FROM_CLAUDE_OK / BRANCH=feat/p0-foundations-sprint1 / HEAD=11c2335f9f27fc97be65039112fee2c443d0a489 / REMOTE=https://github.com/mahmoud63/octapm.git`, all three matching `git`; no token printed or stored; `git status` unchanged after every one of the twelve Codex runs.

## D. Codex rounds and Claude's verification (10–16)

10. **Round 1** (`11c2335`): 7 HIGH, 5 MEDIUM, 1 LOW, BLOCK. All seven Highs **reproduced live** before any code changed (`repro-cx.js before`). CX21-001…007 CONFIRMED PRODUCT DEFECT (P1); CX21-008 CONFIRMED TEST-INFRASTRUCTURE; CX21-009 CONFIRMED PRODUCT DEFECT P2 (P21-023, not fixed — outside P0/P1); CX21-010 LEGACY MODULE P3 (P21-033); CX21-011 ACCEPTED DESIGN P3 (P21-034); CX21-012 closed by this phase; CX21-013 DOCUMENTATION DEFECT (corrected; product observation P21-024).
11. **Round 2** (`aa1972c`): 5 fixes INCOMPLETE, 5 new HIGH, 2 predicted regressions, BLOCK — all confirmed, fixed, probed live.
12. **Round 3** (`ffe09fc`): 3 still INCOMPLETE, 6 new HIGH, 1 new deadlock, BLOCK — the piecemeal locks replaced by one protocol; probed live.
13. **Rounds 4–9**: 4 + 3 + 2 + 1 + 2 + 2 findings (one of them a regression of the eighth loop's own fix, caught before any run), each BLOCK, each confirmed, fixed, probed where a request could stage it. **Round 10** (`28a2d50`): **PASS**.
14. **Release challenge, first pass** (`28a2d50`, whole backend): DO NOT RELEASE — 1 Critical (a cross-tenant cost write through a stock issue) + 8 High. Eight CONFIRMED and fixed (`79f5ea1`), one (CX21-411) a real argument bug with **no reachable effect** — no policy names the transitions it dropped — recorded at P3. Five staged live (cross-tenant issue → 404 with stock unchanged; typed activity actual → 400; read-only API key → PATCH 403; project-limited key → other project's orders 403, own 200, unfiltered list 0 foreign rows).
15. **Release challenge, passes two to five** — each on the HEAD the previous pass's fixes produced, each DO NOT RELEASE, each answered the same way: **pass 2** (`772f2c5`, 04:31 CDT): 1 Critical + 9 High → `29456c4` (P21-070 … P21-079). **Pass 3** (`29456c4`, 09:33 CDT after the usage limit lifted, prompt narrowed to the code diff): 7 High + 2 Medium → `2b0df2b` (P21-080 … P21-087). **Pass 4** (`2b0df2b`, 09:46 CDT): 8 High, one a regression of the third loop's own subscription fix → `59cf34b` (P21-088 … P21-095). **Pass 5** (`59cf34b`, 10:19 CDT): 8 High + 2 Medium → `d23dc05` (P21-096 … P21-105). Every finding was CONFIRMED by reading the code before anything changed (41 held; the only one not fixed is the P2 P21-087, dispositioned); every fix carries a regression that fails on the commit it was found on (10 / 11 / 6-of-7 / 8, mutation-checked) and the 24 reachable by one request were staged live. **The sixteenth loop** was mine: gates run 7 on `d23dc05` failed its first cost posting — the fifth pass's advisory locks were taken with a client call that cannot read the `void` they return, and every posting to an activity answered 500 (P21-106, P0); fixed in `ded5fa0` within the hour, nothing pushed on `d23dc05`. **Pass 6** on `ded5fa0`: launched 10:47 CDT, stopped on the usage limit after 39,535 tokens ("try again at 2:33 PM"); tree unchanged; to be run when the window opens.
16. **Nothing Codex said was acted on unverified, and nothing was dismissed because tests were green.** 74 CONFIRMED PRODUCT DEFECTS fixed at P0/P1 (P21-025…031, 036…068, 070…086, 088…103, 106) plus two P2 fixed (P21-104, P21-105), the P21-069 hygiene item, and one P2 carried (P21-087), 1 TEST-INFRASTRUCTURE defect fixed (P21-032), 1 P2 registered and carried (P21-023), 3 P3 dispositions, 2 documentation corrections, 1 FALSE-POSITIVE impact (P21-069). Each fix carries a regression that **fails on the unfixed code** — proved by reverting the services and running the new cases: 11 / 9 / 8 / 5 / 3 / 3 / 3 / 3 / 2 / 6 / 10 / 11 / 6 / 8 / 1 failures across the loops (four cases guard flows that must keep working and pass on both).

## E. The fixes, in one table (17)

17. See `OCTAPM_PHASE21_DEFECT_REGISTER.md` P21-025 … P21-106 (each with observed, root cause, fix, regression and live evidence) and `OCTAPM_PHASE21_ADVERSARIAL_REVIEW.md` §5–§11. In one line each, by loop: (1) foreign PO line on an invoice; duplicate receipt lines; per-bin weighted average; issue lost update; concurrent payments; reversed key never reposted; budget actual typed. (2) stale average under the item lock; reactivated line resets actual; payment ∥ void; header-only order move; reservation from an unlocked read. (3) issue priced before any lock; phantom bins and a lock-order deadlock; edit validated before its lock; every transition deciding before its write; retention release unlocked; transfers landed twice. (4) delivery prelock incomplete; pay-app edit ∥ transition; delete after approval; five IPC writers deciding before the write. (5) edit recomputed from a stale copy; guard not re-run after reload; stock in transit dropped from the average. (6) quarantined stock dropped from the average; a reopened application re-billing certified work. (7) two open applications approved at once. (8) materials on site outside the line ceiling; an editor revoking a PM's certification. (9) prior materials mistaken for work (own regression); materials-exhausted application not "final". (release) cross-tenant activity on a stock issue; API-key scopes ignored by role guards and by the warehouse routes; activity actual typed; concurrent IPC certifications; stale timesheet return; PO edit after approval; equipment usage outside the ledger; transition names dropped (no effect). (T-15) an echoed actual reset the through-date. (release, second pass) a project id trusted without an activity, and no last line in the ledger; a key's projects bypassed by omitting projectId; a budget-only edit writing actual back; timesheet edit and delete unlocked; the Actual column hidden (own regression); the portfolio ignoring a key's projects; purchase-order transitions stale; commitment schedule and header stale; the reconciliation repair writing a pre-read actual; an API key enrolling MFA. (third pass) five stock routes and the analytics outside the key's projects; search and the report builder answering as the owner; the repair's SUM inside the UPDATE that waited on a lock; commitment transitions stale; the receipt not holding the order; subscribe unserialised and able to bill twice; the through-date written back. (fourth pass) a failed Stripe lookup taken as "no subscription" (own regression); the direct receipt, item list, summary and warehouse values outside the key's projects; a stored report file downloadable by any reader; the assistant as the owner; job retry/cancel on a static role; the ledger's through-date advance decided unlocked; concurrent budget transfers past the guard; report definitions and schedules mutable by a key. (fifth pass) the item search replacing the project scope; a project's own item and warehouse not that project's stock; conversations as the owner; a budget revision born approved by whoever could create cost; change orders stale; a return putting stock back without its cost; the query cache surviving a sign-out; two first postings each creating a projection row; an admin exception after the filter; a lock order claimed and not delivered. (sixteenth loop) advisory locks taken with a call that cannot read void — every cost posting 500 on `d23dc05`.

## F. Financial reconciliation, recomputed from source (18)

18. `OCTAPM_PHASE21_FINANCIAL_RECONCILIATION.md` §17: SQL over the tables, the API's reconciliation and the documents' figures agree line for line; **actual-cost delta 0.00** on all three readings; snapshot **36/36** after every loop and on the frozen HEAD; 12 ledger entries on the certified project, 0 reversals, 0 re-postings, 0 duplicate keys database-wide. The certified project's figures moved once during the phase — by my own isolation stage (T-14, 22.00) — and were put back through the product's own return movement before the final gates.

## G. Source freeze (19)

19. Source frozen at **`ded5fa0`**. Seven earlier freezes (`28a2d50`, `79f5ea1`, `772f2c5`, `29456c4`, `2b0df2b`, `59cf34b`, `d23dc05`) were reopened by the five release passes, by two gate failures the loop's own fixes caused (T-15, P21-106) and by the sixteenth loop; each reopening is a commit with its reason.

## H. Final gates on `ded5fa0` — run eight (20–34)

20. `prisma validate`: valid. 21. `prisma migrate status`: 113 migrations, up to date. 22. `prisma migrate diff`: names, search indexes and defaults only — no table, column or type differs (P21-035, examined in the register). 23. OpenAPI: 733 paths valid.
24. Jest: **185 suites, 2,097 tests, 0 failures** (four workers; T-11 explains why). 25. `tsc -b`: clean. 26. `vite build`: built.
27. Greenfield ×2: 3/3, 3/3 — allowance and cleanup exact, 0 duplicate irreversible transactions, 0 token expiry, 0 reference collisions.
28. **Full Playwright: 163 / 163 in 16.8 min, retries 0, skipped 0.** 29. Console gate: 5/5, errors 0, warnings 0. 30. Smoke: 14 paths, console errors 0, failed requests 0.
31. RBAC audit: exit 0. 32. Isolation (stage 7): 36/36, ledger left where it was found. 33. Snapshot 36/36; reconciliation 0.00.
34. API log: since the restart that loaded `ded5fa0`, **8,166 requests, 5xx 0, 429 0**; the whole log (17 segments) **102,219 requests, 5xx 15, 429 0, unhandled 0, deadlocks 0** — the fifteen are the P21-106 regression on `d23dc05` during the superseded run seven (eight pay-application approvals, seven stock issues, all refused whole), none before or since; 17 restarts, every one logged with its reason (all product changes); unexpected restarts 0. Runs three to six had passed the same gates on `772f2c5`, `29456c4`, `2b0df2b` and `59cf34b`; run seven on `d23dc05` failed on P21-106 (greenfield 1 failed twice, Playwright 8 failed, stage 7 33/34) and run eight is its correction.

## I. Lint (35–36)

35. The 45 frontend files Phase 21 touched (the cost dashboard, the movement dialog, the sign-out dialog, the sign-in form and the inventory spec re-checked after the later passes): **0 errors** after two fixes — `scripts/inspections-ui.test.mjs` (the P21-011 block appended three times; a parse error) and `goods-receipt-panel.tsx` (a mutation object in an effect's dependency list, written before Phase 21 in a file 21A touched). Backend has no ESLint configuration.
36. Whole frontend tree: **24 errors in 10 files** — the ten earlier e2e specs untouched by Phase 21, carried (Phase 21C recorded 25 in 11; the eleventh was `goods-receipt-panel.tsx`, now clean).

## J. Final Codex release challenge (37)

37. Five passes, five DO NOT RELEASE (1 Critical + 8 High; 1 Critical + 9 High; 7 High; 8 High; 8 High + 2 Medium), every finding dispositioned and every one that held fixed (section D). Sixth pass on `ded5fa0`: **stopped by the reviewer account's usage limit** after 39,535 tokens; to be run when it lifts (14:33 CDT). No Critical or High is open; the fifth pass's ten and the sixteenth loop's one have not yet been independently re-confirmed closed.

## K. Disposition of open P2/P3 (38)

38. Register, "Disposition of open P2 / P3 findings": two P2 open (P21-007 carried by instruction; P21-023 navigation only), twenty P3 open, every one with a workaround and no financial, security or data-integrity risk; all compatible with pilot/UAT.

## L. Git finalization (39–41)

39. Churned gallery PNGs restored (`git checkout -- docs/design/screenshots`); no logs, `.env`, PID files, runtime database files or secrets committed; `git status` clean at the end.
40. Pushed normally, no force: local = origin, `left-right 0 0` — the SHA is recorded in the closing message of this session and in `git log`.
41. Commits this phase: eighteen fix/test commits (section A.3) and the documents commits.

## M. Verdict (42–43)

42. Every certification condition holds — P0 = 0, P1 open = 0, Playwright 163/163 with retries 0, console clean, smoke clean, reconciliation 0.00, greenfield twice, 429/5xx/restarts 0, isolation and RBAC clean, lint clean on touched files, Codex PASS on the changed files — **except one**: the independent reviewer has not yet re-challenged the final HEAD `ded5fa0`; its five passes found 41 more defects, all fixed, and its sixth pass ran out of usage before a verdict. The rule admits no partial credit.

43. **PHASE 21 VERDICT: PHASE 21 GREENFIELD SYSTEM CERTIFICATION WITHHELD** — one condition outstanding (the sixth release pass), everything else met; no defect above P2 is open.
    **CLIENT READINESS VERDICT: CONDITIONAL CLIENT READY — PILOT/UAT** — the single condition being that the sixth release pass on `ded5fa0` returns no Critical or High (or that the loop closes whatever it returns, as it closed the fifteen rounds before).
