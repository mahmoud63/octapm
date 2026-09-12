# Phase 21C — final report

Ninety items, in the order the brief asked for them. Every figure was read
from the running system on 2026-09-12; where a claim rests on a file, the file
is named. 21A, 21B and 21C are distinguished throughout; there is one verdict,
at the end.

## A. The project and the rules (1–8)

1. **Project**: `OCTA PHASE21 GREENFIELD 20260910093852`, id `0ce999f2-b175-432b-8551-20182b4fc990`, created 2026-09-10 by the PM through the API. Every 21C stage read it back by id before doing anything.
2. **Pre-seeded business records used**: none. Identities, roles and plan configuration only (8 demo users, one organisation, one plan).
3. **Stages driven in 21C**: 10 (client), 11 (RFQ → award), 12 (3-way match), 13 (labour), 14 (RFI → change), 15 (document control), 16 (quality), 17 (field and safety), 18 (meetings and tasks), 19 (browser personas and deep links), snapshot.
4. **Idempotency**: every stage finds its own record by a deterministic key (title, description, drawing number, `clientRequestId`, date) and throws on a duplicate it did not expect. Each was run at least twice back to back after its first green run.
5. **Harness rules kept**: no `.catch(() => {})`; every non-2xx throws with method, path, status, code and validation detail; tokens re-mint on an 8-minute cache (harness) / 10-minute cache (Playwright support) inside the 15-minute expiry; no known record was looked up through a first cursor page or a `take: 100` — records are read by id, and the plan-allowance walk pages to the end.
6. **Restarts**: one API restart, logged with its reason (loading the P21-010 route-guard fix). Database and Vite untouched throughout.
7. **API health across 21C**: 2,720 requests in the API log, 0 × 429, 0 × 5xx.
8. **Test-data corrections**: one, logged — see T-10.

## B. Client commercial chain — stage 10 (9–16)

9. Prime contract exists automatically with the project; IPC-01 created against it.
10. IPC items are one per **approved BOQ allocation** (B-001/A110, B-002/A120, B-002/A130); the product caps quantity and progress (`IPC_ALLOCATION_QTY_EXCEEDED`, `IPC_APPROVED_PROGRESS_EXCEEDED`) — both refusals driven.
11. Certified gross **120,000.00**; retention 5 % = **12,000.00**; net **108,000.00**.
12. Certified revenue equals earned value (120,000.00 = 120,000.00) — the same approved progress governs both.
13. One invoice issued; a second issue refused (`IPC_INVOICE_ALREADY_ISSUED`).
14. Payment **80,000.00** recorded; receivable **28,000.00**; invoice `part_paid`.
15. **P21-009 (P1)**: cash-flow inflow was **0.00** after the payment — the client path never rebuilt the projection. Fixed (`ipc.service.js` rebuilds after the payment commits); regression test 3 cases, 2 fail without the fix; inflow now **80,000.00**.
16. Cash out 54,000.00 (21B) unchanged by any 21C step.

## C. RFQ → quotes → comparison → award — stage 11 (17–24)

17. **Prequalification gates the RFQ**: an unqualified directory vendor cannot be invited (`PREQUAL_NOT_QUALIFIED`); scored 9 criteria, approved with validity, then invited.
18. Package → bid package **BP-001** → lines from the BOQ (60 t high-tensile reinforcement) → three invitations (two directory vendors, one ad-hoc) → published.
19. Each bidder priced through its own tokenised portal: 1,150 / 35 d, 1,240 / 14 d, 1,190 / 21 d ex-works.
20. The portal exposes the package reference and the bidder's own invitation only — no internal ids, no estimate rate, no other bidders.
21. Levelling read all three; soft award to the 14-day bid (the schedule need), idempotent on repeat.
22. Confirm **refused** for the ad-hoc bidder (`PREQUAL_AWARD_BLOCKED`) until a written `prequalOverrideReason` was given — the refusal was driven first, then the override.
23. **PO-00001** raised from the confirmed award, numbered from the atomic reference counter.
24. P3s: the PO read model lacks `packageId` (the register row has it); the package stays `tendering` after award and order (P21-016).

## D. Three-way match — stage 12 (25–31)

25. Invoice A: 100 @ 10.00 = 1,000.00 against PO-A (ordered 1,000.00, received 1,000.00) — **clean**.
26. Invoice B: 50 @ 14.00 = 700.00 against PO-B ordered @ 13.00 — variance **+50.00**, flag `price_variance` blocking, verdict not clean. Detected, not accepted.
27. The match names the PO line it reconciled — the invoice-to-order link is proven from the product's side.
28. From the invoice's side the match sees the same order.
29. PO-A shows 1,000.00 invoiced and nothing left to invoice.
30. **Capitalisation gate**: both invoices approved and the ledger moved by **0.00** — cost was recognised at issue (704.00) and the invoice does not post it twice.
31. Who may: finance cannot book a supplier invoice (403); the cost controller books, the PM approves; a site engineer cannot approve (403). P3: OpenAPI omits `purchaseOrderId` / `poLineId` (P21-017).

## E. Labour — stage 13 (32–37)

32. Five workers @ 50.00 created (found by employee number on re-run).
33. One timesheet, `clientRequestId` keyed, five entries × 8 h on A130 / 01-100 (the product caps a worker at 24 h a day).
34. Submitted by the site engineer; a storeman cannot approve (403); approved by the cost controller.
35. Approval snapshots the rate: sheet total **2,000.00**, each entry at 50.00.
36. Ledger +**2,000.00** as source `timesheet`, cost type `labour`; both projections agree; balanced.
37. Budget line 01-100 shows the 2,000.00 actual.

## F. RFI and RFI → change — stage 14 (38–45)

38. A project location created (zone "Foundation zone, grid A-D"); RFI-001 raised by the site engineer on A130 at that location, managed by the PM, assigned to the planner, QS on distribution, with a 4,500.00 cost impact and 3 days.
39. Ball in court, as the product reports it: open → **the planner**; the QS can read it and never holds it; a storeman cannot answer (403).
40. Answered by the planner (official response recorded) → ball to **the PM**.
41. `convert-to-change` created **VO-22** (4,500.00, same activity, draft), linked both ways; a second conversion refused (`RFI_ALREADY_CONVERTED`).
42. VO-22 approved with impact summaries, activity links and an attached instruction — the same three rules 21B confirmed.
43. Revised Budget **+4,500.00 exactly** (1,950,000.00 → 1,954,500.00); approved changes +4,500.00; ledger **+0.00**.
44. Closed by the PM → nobody holds the ball; another tenant cannot read it.
45. P3: `budgetLineId` was given on create and on update and discarded both times (P21-012) — the 4,500.00 sits on the product's holding line with the 21B changes.

## G. Document control — stage 15 (46–53)

46. Drawing S-101 raised by the site engineer; rev A uploaded as a PDF, submitted for review, approved by the PM (self-approval 403).
47. Rev B the same → B is latest, A **superseded** with a timestamp.
48. Rev C uploaded and left in review (`submitted`).
49. The storeman sees **rev B only** — not C in review, not superseded A; the PM sees all.
50. Rev B downloads as the PDF that was uploaded.
51. Submittal SUB-001: submit → **reject** (PM) → resubmit → review (QS) → approve (PM); a storeman cannot decide (403).
52. Transmittal TRM-001 issued and acknowledged; letter COR-001 issued and closed; one register lists drawing, submittal, transmittal, letter and RFI-001.
53. **P21-010 (P1)** was found here: a storeman issued a transmittal (200) and a site engineer closed a letter (200). See 70–74.

## H. Quality — stage 16 (54–61)

54. ITP-01 (hold) passed by the site engineer; ITP-02 (witness) failed by the QS; a storeman and finance cannot raise or record (403).
55. Quality score read from the dashboard, not computed: 100 → 85 (−15, failed ITP) → 65 (−20, major NCR); formula `100 − 20·major − 8·minor − 15·failed` asserted against the dashboard's own counts.
56. NCR-001 (major) raised by the site engineer on A130; closeout **refused without evidence**; a photo uploaded; closeout submitted; site and QS cannot approve (403); PM approved → closed.
57. A closed NCR still counts in the score (P21-019, business question).
58. DEF-001 (minor): open → in progress (site) → closed (PM); finance cannot work it (403).
59. MT-001 cube test: pending → pass (QS); a storeman cannot record (403).
60. PL-001: draft → open → ready for review (site) → close refused for the site engineer (403) → closed by the PM; reopen without a reason refused (400). OBS-001: a safety observation with its own numbering, closed by the PM.
61. **T-10**: the stage's first lookup used a `title` the NCR does not store; the second run raised NCR-002 and took it through closeout and approval before the mistake was seen. NCR-002 is named in the stage as approved history (score now 45 with it), a third copy fails loudly. Not deleted.

## I. Field and safety — stage 17 (62–66)

62. Daily log 2027-02-01 written by the site engineer: manpower (5 × 8 h on A130), a 50 t crane, a cement delivery against PO-A, a 2 h weather delay, a safety note; a storeman cannot write (403).
63. Manpower report: **40 man-hours** Steelfixer — agrees with the timesheet's 40 hours.
64. A weather delay raised from the log's delay entry; on the register, contractual; a storeman cannot read weather delays (403).
65. Day submitted; site engineer and planner cannot approve (403); PM approved; an approved day cannot be edited.
66. SAF-001 near miss: closeout refused without evidence; photo attached; submitted; site cannot approve (403); PM approved → closed. A storeman and the planner cannot raise one (403). Photos appear in the gallery; a site engineer cannot attach to a schedule activity (403).

## J. Meetings and tasks — stage 18 (67–69)

67. MTG-01: five attendees, three agenda items, one decision on A130, two actions (site, QS); a storeman cannot create a meeting (403).
68. Finalised and distributed by the planner, stamped who/when; a storeman cannot distribute (403); an attendee can read; another tenant cannot.
69. The site engineer's action is a task on the project and A130, linked back to the minutes, commented on and closed by its assignee; a storeman cannot close it (403); it appears under "assigned to me".

## K. RBAC — P21-010 (70–74)

70. `rbac-audit.js`: every project-nested prefix as two roles the policy denies, with a body that cannot pass validation — a present guard answers 403 before validation; a missing one lets the request through. **22 of 108** probes got through, all on ten routers: drawings, transmittals, correspondence, itp, defects, material-tests, budget-revisions, cash-flow, sub-valuations, weather-delays.
71. Fix: `requirePermission` on all 41 routes with the module the policy already names for the neighbouring routers (`document_control`, `inspection`, `punch`, `cost`, `sub_pay_app`, `eot`); delete follows the drawing-sets convention where the policy has no delete row. Commit `935d500`.
72. Regression test `project-route-guards.test.js`: 87 cases through the real RBAC middleware (denied → 403, allowed → through) plus route coverage; **5 of 87 fail** with one router reverted.
73. After the fix: **2 of 108** through the door, both `comments`, which every role may use by design.
74. Nothing else broke: full Jest 2,005 / 2,005; stages 15–18 re-run green; full Playwright — see 84.

## L. Personas and deep links — stage 19 (75–80)

75. All eight staff personas signed in through the real form (headless Chromium) and, for the procurement manager, by hand in the app's browser pane.
76. Every persona lands on Workspace Control with the product's own "waiting on you right now" panel — responsibility is signalled, not inferred.
77. The module strip is role-aware where it matters (Lock Baseline is the PM's alone); the sidebar is not (Users and Company offered to five roles the API refuses — P21-013).
78. Console noise on every page: `401 GET /auth/me` on load for everyone, `403 GET /parties` for four roles (P21-014); the PO register's "Waiting on you 0" beside a row saying "Your action" (P21-018).
79. Deep links, 26 graded as the PM after the P21-011 fix: **12 open the record** (both ITPs now selected inline; ITP and defect used to open the wrong record type with a 404), 9 land on the register with the row visible (the defect register on this project holds one record, so its fix is proven by the regression spec on a register with two), 5 land on the module home, 0 open the wrong record type (P21-015 P3). A module-home URL was not counted as a record deep link.
80. External personas: the supplier portal was driven (three bidders); the client's money was driven from the contractor's side; no client or subcontractor **user** exists to sign in as, and none was created.

## M. The permanent regression (81–83)

81. `frontend/e2e/32-greenfield-regression.spec.ts` builds its own project every run (team, cost codes, two activities, priced bill allocated and approved, budget, PO received and issued at 10.00, a 25,000.00 change approved), asserts nil-on-receipt / 640.00-on-issue / ledger = both projections / Revised 175,000.00 with the ledger untouched, has the PM see the figures in the browser, retires the project, and walks the plan allowance page by page.
82. Two back-to-back runs: **3 / 3 and 3 / 3** (17 s, 14 s). Cleanup failure throws; no project leaked (checked by listing).
83. It does not depend on the Phase 21 project; it is lint-clean (`eslint` 0 errors) and typed without `any`.

## N. Gates (84–88)

84. Full Playwright: **145 / 147** in 15.1 min. The two failures are both in `11-inventory.spec.ts` and both environmental: (69) the spec's own screenshot write into the OneDrive-synced `docs/design/screenshots` folder was refused by the file system (`UNKNOWN: unknown error, open …`) — the test passes when the spec is run alone; (72) the analytics variance list is a first-25 crowded out by purchase orders left behind by earlier lifecycle specs (`PO-xxxxxxxx` refs, which the seed's `PO-E2E-` / `PO-LC-` cleanup does not cover), so the seeded cement row is absent — reproducible alone (1 of 11 fails), and no 21C change touches that path. Recorded as P21-020 (P3). Every other spec, including the three new ones, passed.
85. Jest (backend): 2,005 / 2,005 in 179 suites, 91 s. OpenAPI: 733 paths valid. `prisma validate`: valid.
86. Frontend typecheck green; production build green (16.5 s).
87. Frontend lint: **25 pre-existing errors in 11 files untouched by Phase 21** (ten earlier e2e specs, `goods-receipt-panel.tsx`); CI's frontend lint job would be red on the branch before and after 21C. Not fixed — out of scope and not Phase 21's.
88. Snapshot: **36 / 36** — the project reconciles to the cent, transaction by transaction: ledger 71,204.00 = SQL sum (12 entries) = budget projection = activity projection; Revised 1,954,500.00; cash in 80,000.00, out 54,000.00; 86 bags @ 11.00.

## O. Verdict (89–90)

89. Defects across 21A/B/C: 3 P1 found, **3 fixed** with regression tests; 3 P2 found, **2 fixed** (P21-002, and P21-011 after the first report — `33-quality-deep-links.spec.ts` fails 2 of 3 without the fix), **1 open** (P21-007); 13 P3 open, documented; 0 P0. Codex independent review **not available** (checked); the adversarial review is a self-review and says so.
90. **PHASE 21 CERTIFIED** — as a greenfield system simulation on one project across 21A, 21B and 21C. The certification conditions hold: no P0; no P1 open (three found, three fixed, each with a regression test shown to fail without the fix); every financial identity exact to the cent and reconciled four ways; the permanent greenfield regression green twice from nothing with its project retired; all eight staff personas driven in the browser; the adversarial self-review complete and labelled. Carried, not hidden: one open P2 (P21-007), thirteen P3s, the frontend lint debt in files Phase 21 did not touch, the two environmental Playwright failures above, and the **PRE-DEPLOYMENT SECURITY DEBT — OPEN**. Codex independent review was genuinely unavailable and, per the brief, is not a condition. Phase 22 has not been started.
