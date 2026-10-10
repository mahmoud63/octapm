# CERT-3: open owner decisions (consolidated draft, 2026-10-10)

Compiled read-only from the CERT-3 plan, the journal, the register and every WP-2..WP-8 preparation, adjudication, ruling and fix plan written so far. Nothing here is decided. Every question asked in several files appears once, with all its sources. Items already decided (D-ID-1, Q-KEY, deep companies, HR-Q1, HR-P1, HR-C1's rule, HR-S2, HR-X1 scope, L34 in CERT-3, L35/L36 in CERT-5) are left out. So are the integration owner's own rulings, unless they were passed to you.

**Source shorthand.**
- `PLAN` = `docs/certification/OCTAPM_CERT3_PLAN.md`, in the cert worktree.
- `REG` = `docs/certification/OCTAPM_LAUNCH_BLOCKERS.md`.
- `JNL` = `docs/certification/OCTAPM_CERT_JOURNAL.md`.
- `S\` = `C:\Temp\octapm-cert\scratch\`.
- `QP` = the HR-Q1/HR-P1 fix plan, `S\wp2\fixplan\r3c\WP2-FIX-PLAN.r3c.md`.
- `X` = the HR-X1 batch plan, `S\wp2\fixplan-hrx1\r3c\HRX1-FIX-PLAN.r3c.md`.

**What "Blocks?" means.**

| Value | Meaning |
|---|---|
| **YES: blocks WP-2** | The WP-2 implementation (HR-Q1, HR-P1, HR-X1) cannot be finished or proven until you answer. |
| **Default ships in WP-2** | WP-2 is drafted on the proposal shown and will implement it unless you object before WP-2 lands. Answering now is cheap; changing it later means rework. |
| **Before <fix>** | A later fix (L34 in WP-3, HR-C1 in WP-4, F-2 in WP-5) waits on it. It does not hold up WP-2. |
| **Default (later)** | A later step goes ahead on the proposal unless you object. |
| **Deploy gate** | Blocks putting the fix on a real customer database, not the certification. |
| **No: can wait** | The certification records today's behaviour as a "known answer, BLOCKED" until you decide. Nothing is built on a guess, so waiting costs nothing now. |

**Plan reviews still pending.** The L34 (WP-3) and HR-C1 (WP-4) fix plans have not had their Codex plan review yet (JNL, last entry). Items marked *may change after its Codex plan review* could be reworded or dropped after that review.

---

## Summary

**Count: 102 open decisions.**
- **1** blocks WP-2: WP2-X O10.
- **15** have a default that ships in WP-2 unless you object.
- **1** is a deploy gate: WP2-QP O10.
- **8** must be answered before a later fix: L34 O-1..O-6, HR-C1 Q5, F-2.
- **5** have a default that applies later.
- **72** can wait. Of these, 48 are undecided plan §5 rule rows, and 7 are register items from earlier checkpoints.

### WP-2: progress, hold points, evidence (next to be fixed)

| Id | Question (short) | Blocks? | Recommendation |
|---|---|---|---|
| WP2-X O10 | Stored reference naming nothing anywhere: legacy (one unscoped lookup) or refused? | **YES: blocks WP-2** | (i) legacy, a narrow documented exception (integration owner) |
| WP2-X O15 | Must daily-report submission meet the evidence requirement for linked progress? | Default ships in WP-2 | (a) keep it at approval, as today |
| WP2-X O16 | A bare foreign id inside free text: harmless text or refused? | Default ships in WP-2 | Treat as text (legacy) |
| WP2-X O1 | End of transition controlled by one global switch? | Default ships in WP-2 | Global switch, default "transition" |
| WP2-X O4 | NCR/safety closeouts with old-style references stay approvable until HR-Q5? | Default ships in WP-2 | Yes |
| WP2-X O5 | Must the submitter be able to read a progress document for it to count? | Default ships in WP-2 | Yes (can be cut) |
| WP2-X O6 | Rejected uploads never count as evidence? | Default ships in WP-2 | Yes |
| WP2-X O7 | Does any stored project document type count, or only photo/evidence types? | Default ships in WP-2 | Any type, if readable |
| WP2-X O8 | Refusals keep existing error codes (with details) rather than a new code? | Default ships in WP-2 | Keep existing codes |
| WP2-X O11 | Workflow-engine CO approval refused by evidence: "failed apply" or refuse before deciding? | Default ships in WP-2 | Failed-apply contract |
| WP2-QP O1 | Who may approve a downward progress correction? | Default ships in WP-2 | The existing progress approvers |
| WP2-QP O2 | Does growing the planned quantity also need a reason? | Default ships in WP-2 | Yes |
| WP2-QP O3 | Is an "N/A" hold item released by closing the inspection? | Default ships in WP-2 | Yes, by `inspection.close` holders (visibility-checked) |
| WP2-QP O5 | Where is the correction record kept? | Default ships in WP-2 | Audit event, its snapshot and the answer |
| WP2-QP O6/O7 | A lower figure from a daily report or import: held until a reason is given? | Default ships in WP-2 | Yes |
| WP2-QP O9 | Two submissions in the same millisecond: simultaneous, or refuse duplicates in bulk? | Default ships in WP-2 | Simultaneous; lowering still needs a reason |
| WP2-QP O10 | Deploy-target data: back-fill undated or tied progress rows before deploying? | Deploy gate | Back-fill, N-1(a) |
| WP2-X O2 | At the flip, do text notes and URLs stop counting together? | No: before the flip | Together |
| WP2-X O3 | Items still pending at the flip: refused, or grandfathered? | No: before the flip | Refused (no grandfathering) |
| WP2-X O9 | Record the client channel/version on NCR, safety and CO before the flip? | No: before the flip | Your call (proposed as readiness telemetry) |
| WP2-X O13 | Records holding out-of-scope references: fixed by people from a census, no data change? | No: before the flip | Yes, census plus manual replace or reject |
| WP2-X O14 | Should unified `/attachments` rows count as NCR/safety evidence? | No: can wait | Unchanged (they do not count) |
| WP2-QP O8 | May PATCH re-target an open ITP whose holds are unreleased? | No: can wait | None (today: allowed) |
| HR-P4 (=QP O4) | Segregation of duties: PM and planner approving their own progress? | No: can wait | Keep for Phase 1; self-approvals visible in audit |
| HR-P2 | Lock the effective progress method once progress is approved? | No: can wait | Yes |
| HR-P3 | PUT on the progress method: partial update instead of reset? | No: can wait | Partial update |
| HR-Q2 | Hold-point gates read the instance's own template version? | No: can wait | Yes |
| HR-S9 | Activities retired by activation: refuse approval, keep their AC/EV? | No: can wait | Refuse (409); keep AC and EV in totals |

### WP-3: earned value, periods, forecast

| Id | Question (short) | Blocks? | Recommendation |
|---|---|---|---|
| WP3-L34 O-1 | Unmigrated legacy actual cost: ledger only, or keep the record's remainder? | Before L34 fix | Ledger only; gap shown in reconciliation |
| WP3-L34 O-2 | Periods locked before the fix: served as stored, or flagged? | Before L34 fix | Served as stored, no flag, no repair |
| WP3-L34 O-3 | A voided cost entry counts at the original's date or the void's? | Before L34 fix | Original's date (today's ledger design) |
| WP3-L34 O-4 | The typed "actual through date": a display field, or derived only? | Before L34 fix | Display-only register field |
| WP3-L34 O-5 | Future-dated postings count only from their date? | Before L34 fix | Yes |
| WP3-L34 O-6 | Wording: EV notes and truth labels, version-keyed or untouched? | Before L34 fix | Reword notes (L-5b); version-keyed labels (L-6) |
| WP0-72K | 087-SCH's 72,000 row: allocated to A220 at baseline (EV budget 459,000)? | Default (later) | Yes, as the answer book reads it |
| HR-E3 | EAC when CPI = 0: keep budget (BAC), labelled, as today? | No: can wait | Keep as is (today already matches) |
| HR-E4 | SPI/CPI < 0.9 "alert": report flag only, plus an exception kind? | No: can wait | Flag plus exception kind; no new notice. Or defer to WP-9 |
| WP3-Q11 | Cost loadings in a locked period: by period link (today) or by date? | No: can wait | None (today's rule is asserted) |
| HR-E2 | Refuse a period lock before its cutoff; no unlock; audit every lock? | No: can wait | Yes |

### WP-4: commercial core (HR-C1 retention fix)

| Id | Question (short) | Blocks? | Recommendation |
|---|---|---|---|
| WP4-HRC1 Q5 | Which existing contracts count as "retention configured"? Accept refusals on unconfigured drafts? | Before HR-C1 fix | Q5-a (conservative, audit-based) |
| WP4-HRC1 O-2 | Remove the pre-filled 5% from the project form and templates? | Default (later) | Yes (P-3) |
| WP4-HRC1 O-3 | May a configured contract retention rate be unset again? | Default (later) | Yes (P-6) |
| WP4-HRC1 Q3 | Commitments without a retention rate: refused at create? | Default (later) | Refuse at create, 400 `COMMITMENT_RETENTION_REQUIRED` |
| HR-C2 | Variation allowance applies only to the linked allocation, and how severe is today's leak? | No: can wait | Linked allocation only; P1 proposed |
| HR-C3 | IPC states: return from submitted to draft; status follows payment; refuse empty periods? | No: can wait | Yes to all three |
| HR-C12 | Change events: one accepted quote; archive returns event; carry budget lines? | No: can wait | Yes |
| HR-C13 | Deductive prime CO (L199) and subcontractor retention release (L116) in Phase 1? | No: can wait | Your call; without L116 every sub closeout needs an override |

### WP-5: supply chain

| Id | Question (short) | Blocks? | Recommendation |
|---|---|---|---|
| WP5-F2 | May a cancelled award order be replaced, and should existing awards be back-linked? | Before F-2 fix (if it confirms P1) | None; default: no back-fill |
| HR-C5 | Three-way match blocking verdict refuses invoice approval without an override? | No: can wait | Yes, PM or finance override with a reason |
| HR-C7 | Issuing material raises plan usage; ignored fields refused (400)? | No: can wait | Yes |
| HR-C8 | Purchase order after delivery: close short and cancel rules; show the close reason? | No: can wait | Section 5 recommendation |
| HR-C9 | PO reference scan: require projectId or answer 409 ambiguous (mobile change)? | No: can wait | Require projectId or 409 |
| WP5-SEV | Severity alignment: WP0-INV-1 (P2) and HR-C9 (P1) are the same class | No: can wait | None given |
| WP5-AWD-1 | Is the prequalification override an acceptable record for a non-lowest award? | No: can wait | None (P3 otherwise) |

### WP-6: BOQ, allocations, budgets

| Id | Question (short) | Blocks? | Recommendation |
|---|---|---|---|
| HR-C14 | BOQ import package: section column, AI batches of 60, flags, quota, after baseline | No: can wait | Section 5 recommendation |
| HR-C17 | A rejected allocation goes back to draft and is resubmitted? | No: can wait | Yes; withdrawal only through a BOQ revision |
| HR-C18 | "7-category breakdown" vs 8 cost types: which seven does the dashboard show? | No: can wait | Keep 8; show "other" separately; you name the seven |
| WP6-L109-111 | Are a released Original lock, a hidden archived actual or a negative budget ever acceptable? | No: can wait | P2 proposed (recorded, not fixed) |

### WP-7: contract time (EOT, weather)

| Id | Question (short) | Blocks? | Recommendation |
|---|---|---|---|
| HR-C10 | EOT: lock approved claims; impact net of float; linked weather delays locked too? | No: can wait | Lock (409); delay minus least float; project date stays manual |
| HR-C11 | Half-days (decimal) or refuse fractions; 0 means 0; a notice at 70%? | No: can wait | Section 5: decimals or refuse; 0 means 0; keep the flag |
| HR-F4 | Daily log: approve only submitted; reopen needs a reason; who makes contractual delays? | No: can wait | Yes; contractual only with `eot:create` |

### WP-8: field, quality, documents

| Id | Question (short) | Blocks? | Recommendation |
|---|---|---|---|
| HR-F5 | Timesheets: 24 h cap per worker per day; rate at submission; no inactive workers | No: can wait | Yes |
| HR-Q3 | Do form ITPs count in the quality score (087-FLD would read 6, not 21)? | No: can wait | Yes; legacy register counts until retired |
| HR-Q4 | Quality inputs: ITP status change needs a reason; delete becomes archive | No: can wait | Yes; closed NCRs keep counting |
| HR-Q5 | Freeze NCR/safety details after submit; approval re-checks evidence? | No: can wait | Yes |
| HR-F1 | PM approval of a submittal while review steps are pending? | No: can wait | Refuse (409) unless PM override with a reason |
| HR-F2 | Drawing approval only from review; no older revision over current? | No: can wait | Yes, unless superseded with a reason |
| HR-F3 | Who may reassign a punch item's final approver once open? | No: can wait | PM or current final approver only |
| HR-F6 | Meetings: status only via finalize/distribute; lock after distribution | No: can wait | Yes; action items updated in place |

### WP-1 and WP-9 rule rows (undecided plan §5 rows, no fix pending)

| Id | Question (short) | Blocks? | Recommendation |
|---|---|---|---|
| HR-S1 | Cap late finish at project finish (SS/SF/lead-driven finishes)? | No: can wait | Yes |
| HR-S3 | Judge a staged revision's readiness by running CPM on it? | No: can wait | Yes; critical = TF ≤ 0 for every format |
| HR-S4 | Schedule-file conversion: rounding, two-project files, encoding, calendars | No: can wait | Section 5 recommendation |
| HR-S5 | Refuse activity calendars that differ from the project's? | No: can wait | Yes (400) until CPM handles calendars |
| HR-S6 | Recalculate on start/calendar change; refuse after baseline lock? | No: can wait | Yes (409 unless re-baselined) |
| HR-S7 | Show finishes inclusive (P6-style) or exclusive (today)? | No: can wait | Document it for Phase 1; your call |
| HR-S8 | Hand-built programmes: baseline only from an import or AI generation? | No: can wait | Yes for Phase 1; the UI says so |
| HR-P5 | Search, lookahead, export, assistant: show approved progress only? | No: can wait | Yes, everywhere |
| HR-K1 | One shared 7-dimension health formula with workspace definitions? | No: can wait | Yes |
| HR-K2 | Delayed status on dashboards via `deriveActivityStatus` and the working-day finish? | No: can wait | Yes |
| HR-K3 | Exception engine: reopen rules, slip episode key, drop a pair, thresholds | No: can wait | Section 5 recommendation |
| HR-K4 | Who receives role-addressed notifications? | No: can wait | Project members plus the PM org-wide |
| HR-K5 | Notify when a snooze ends on a row that is now critical? | No: can wait | Yes |
| HR-K6 | Scheduled reports rendered per recipient's permissions? | No: can wait | Yes |
| HR-K7 | Project XLSX: one permission per sheet; exclude retired and archived rows? | No: can wait | Yes |
| HR-K8 | Rename the report's "CPI (budget / actual)" column? | No: can wait | "Budget / actual" |
| HR-K9 | Audit writes inside the transaction for ledger moves and approvals? | No: can wait | Yes; the rest recorded |
| HR-K10 | Risk severity not derived from probability and impact? | No: can wait | Record only |

### Cross-cutting

| Id | Question (short) | Blocks? | Recommendation |
|---|---|---|---|
| XC-1 | CLAUDE.md says "Retention default 5%", which your HR-C1 decision overrides. Update it? | No: can wait (best before the HR-C1 fix) | Update CLAUDE.md to match HR-C1 |
| XC-2 | Budget-revision running totals: compute on read, or rewrite stored totals in the population? | Default (later) | Compute on read; no data write |
| XC-3 | Repair existing duplicate or orphan promoted weather rows after the PROMO-TX fix? | No: can wait | None; read-only census first |
| HR-A1 | Company admin grants beyond the policy, and BOQ template access (WP0-BOQ-1)? | No: can wait | None given |
| HR-A2 | Deletes guarded as updates: a separate `delete` key, or delete means archive? | No: can wait | None given |
| HR-A3 | Company with no finance member: who records payments and releases retention? | No: can wait | None given |
| QKEY-F1 | Revoke webhooks and accounting connections on a credential event too? | No: can wait | None given |
| QKEY-F2 | Suspending an admin in one workspace: revoke the keys they created there? | No: can wait | None given |

(WP2-X O10 is also cross-cutting: it is an exception to CLAUDE.md's "every query scoped by org_id". It is listed once, under WP-2.)

### Carried from earlier checkpoints (register; outside CERT-3's fix scope, listed so nothing is lost)

| Id | Question (short) | Blocks? | Recommendation |
|---|---|---|---|
| RFI-DRAFT | Allow RFIs to be created as drafts, or always open? | No: can wait (builder steps BLOCKED on it) | None given |
| R5 | Internal engineers can't edit submittal reviews but the UI shows the buttons | No: can wait | Keep the rule and gate the UI, or narrow it to guests |
| R22 | Liquidated-damages (LD) rate visible via EOT but withheld on the project record | No: can wait | Option A: follows `ipc:read` OR `eot:read` |
| OPS-1 | Restarting an API task whose database engine has died (operations design) | No: can wait | Options listed in REG |
| C4-NEW-3 | What does a provider-reported "unpaid" subscription mean for access? | No: CERT-4 | None given |
| GIT-HIST | Rewrite git history to remove the rotated Stripe test key? | No: can wait | Not needed once the key is rotated |
| D-ID-2 | What may past records show for a former member (name/e-mail)? | No: CERT-7 | None given |

---

## Details: WP-2 (next to be fixed)

WP-2 implements three decided rules. HR-Q1: a hold point is released only by a completed inspection. HR-P1: lowering official progress needs an explicit correction. HR-X1: evidence must be a stored project document, with both formats accepted during a transition. The plans are final after three Codex plan-review rounds. QP is implemented first, then X.

### WP2-X O10: a stored reference that names nothing anywhere (BLOCKS WP-2)
- **Question.** When an older record holds a file reference that matches no document in any company, should it count as harmless "legacy" text, or be refused like a reference to another company's file?
- **Options.**
  - **(i) Legacy.** One id-only lookup that is not scoped by organisation tells "names nothing" from "names another company's file". It answers nothing about the file and only ever sees stored names. It is a documented exception to CLAUDE.md's "Database queries always scoped by org_id".
  - **(ii) Refuse.** No query leaves the organisation. Records holding dangling keys, old local-file keys `<uuid>.<ext>` or own-project links to nothing cannot pass their gates until a person replaces the reference. A mobile closeout that re-sends such a record's references gets 404 until the user removes them.
- **Recommendation (integration owner, 2026-10-10): (i) Legacy, as a narrow documented exception.**
  - The lookup reaches only names already stored on the record, never fresh input; mutation HX-44 and unit U-J5 hold that boundary. It returns only a yes/no that is used to refuse, never data.
  - Option (ii) would block approvals on existing customers' records that hold harmless old local-file keys.
  - If you prefer CLAUDE.md's rule without exception, (ii) is ready and safe; it only costs those records a manual fix.
  - For context: the read-only trace found 0 cross-project rows among 2,925 commercial and 9,009 workflow references on the certification database (JNL 2026-10-10). How many "names nothing" rows exist on a real database is what the readiness census measures.
- **Blocks.** The HR-X1 batch: the proof is not run past confirm-first, and the branch-specific mutations wait (X §17.1 item 2). WP-8's `KA.X1.F8V.textOnly` value also follows it.
- **Sources.**
  - X §2 P-C2 branch table and §11 (O10 extended), §7 R14, §17.1.
  - `S\wp2\codex-plan-review-r2-adjudication.md` (X-R2-Q, Q1).
  - `codex-plan-review-r3-adjudication.md` ("O10 extended").
  - `r3c-rulings.md` ("O10. The owner's call").
  - `S\wp8\WP8-ADJUDICATION.md` and `S\wp8\WP8-PREP.md` §11.2 (O10, carried).

### WP2-X O15: evidence requirement at daily-report submission (default ships)
- **Question.** When a daily report is submitted with linked draft progress, must that progress already meet the evidence requirement (`PROGRESS_EVIDENCE_REQUIRED`), or is it checked only at approval, as today?
- **Options.**
  - **(a)** Keep the requirement at approval. Drafted. Submission still checks that stored evidence is in scope.
  - **(b)** Also require it at report submission, as create-as-submitted does. A five-line addition.
- **Recommendation.** (a), as drafted. It keeps today's behaviour, and the scope check already runs at submit.
- **Blocks.** Nothing. (a) ships unless you choose (b) before the batch lands.
- **Sources.** X §4.10 and §11 (O15); `codex-plan-review-r2-adjudication.md` (X-R2-H5); `codex-plan-review-r3-adjudication.md`; `r3-rulings.md`.

### WP2-X O16: a bare foreign id inside free text (default ships)
- **Question.** A file name, description or external URL that happens to contain another company's document id as plain text: is it harmless text, or must it be refused?
- **Options.**
  - **(a)** Text stays legacy text. Recommended.
  - **(b)** Refuse. This needs either an unscoped probe on what the caller sends, which contradicts the CERT-2 rule C2-EVIDENCE R1, or refusing every bare id in text. The second would refuse first-party closeouts of downloaded files, whose names carry document ids.
- **Recommendation.** (a). It matches CERT-2's progress behaviour and avoids false refusals of the product's own clients. Product links and lone ids are still judged.
- **Blocks.** Nothing (default (a)). Pinned by `N.T.fileNameDownloadedName`.
- **Sources.** X §2 P-C2a, §11 (O16), §12b, §15; `codex-plan-review-r3-adjudication.md`; `r3-rulings.md`.

### WP2-X O1: how the transition ends (default ships)
- **Question.** The end of the "both formats accepted" transition is one global switch, `EVIDENCE_DOCUMENT_REQUIRED`, default `transition`, which you flip later. Accept a global switch?
- **Options.**
  - (a) A global switch.
  - (b) A per-company switch, which needs a migration.
  - (c) A version check, which is not possible with today's mobile header.
- **Recommendation.** (a), as proposed. The flip itself stays your later decision.
- **Blocks.** Nothing now (default (a)).
- **Sources.** `S\wp2\fixplan-hrx1\HRX1-FIX-PLAN.md` §11 (O1), carried by X §11 ("r1's O1-O9 stand"); `codex-plan-review-r2-adjudication.md` ("O1-O3 (the flip)").

### WP2-X O2: what ends at the flip (can wait until the flip)
- **Question.** After the flip, do text notes and URLs stop counting at the same time, or should text-only evidence end earlier? No first-party client sends text-only evidence.
- **Options.** (a) Together. (b) Text-only first.
- **Recommendation.** (a), as proposed.
- **Blocks.** Only the flip.
- **Sources.** `HRX1-FIX-PLAN.md` §11 (O2); X §11.

### WP2-X O3: items still pending at the flip (can wait until the flip)
- **Question.** Items submitted with old-style evidence and still pending when you flip: refused at approval, or grandfathered? Refusal includes a change order decided by a workflow after the flip, which then ends as `applyStatus: failed`.
- **Options.** (a) Refused at approval, with no grandfathering. (b) Grandfather items submitted before the flip.
- **Recommendation.** (a), as proposed.
- **Blocks.** Only the flip.
- **Sources.** `HRX1-FIX-PLAN.md` §11 (O3); `HRX1-FIX-PLAN.r2.md` §11 (O3 restated); X §11 (O3); `codex-plan-review-r3-adjudication.md` ("the transition flip and pending legacy records").

### WP2-X O4: NCR/safety closeouts until HR-Q5 is decided (default ships)
- **Question.** A submitted NCR or safety closeout carrying old-style or out-of-scope references stays approvable after the flip until you decide HR-Q5 ("approval re-checks evidence"). Accept?
- **Options.** (a) Accept the interim. (b) Decide HR-Q5 now (see WP-8), which removes the interim.
- **Recommendation.** (a). HR-X1 must not decide HR-Q5 through the back door.
- **Blocks.** Nothing (default (a)).
- **Sources.** `HRX1-FIX-PLAN.md` §11 (O4); `.r2.md` §11; X §11; `codex-plan-review-r3-adjudication.md`.

### WP2-X O5: readability of progress evidence (default ships)
- **Question.** Must a progress document be readable by its submitter to count as evidence? Readability is used only to classify the evidence, and it is reclassified at approval.
- **Options.** (a) Yes, classification only (proposed). (b) Drop the readability condition; it can be cut without touching the rest.
- **Recommendation.** (a), as proposed.
- **Blocks.** Nothing (default (a)).
- **Sources.** `HRX1-FIX-PLAN.md` §11 (O5); `codex-plan-review-adjudication.md` (X6 answer, "stays a proposal for the owner (O5)"); X §2 (O5); `codex-plan-review-r3-adjudication.md` ("the canonical and readability proposals").

### WP2-X O6: rejected uploads (default ships)
- **Question.** Rejected uploads, such as failed imports or BOQ files, never count as evidence. The product has no "archived" document state, so this is the nearest equivalent. Accept?
- **Options.** (a) Accept. (b) Count them.
- **Recommendation.** (a).
- **Blocks.** Nothing.
- **Sources.** `HRX1-FIX-PLAN.md` §11 (O6); X §11.

### WP2-X O7: which document types count (default ships)
- **Question.** Does any stored project document count as evidence (a BOQ workbook could be cited), or only evidence-type documents (site photos, workflow uploads, record attachments)?
- **Options.** (a) Any type, if readable (proposed). (b) Evidence types only.
- **Recommendation.** (a), as proposed.
- **Blocks.** Nothing.
- **Sources.** `HRX1-FIX-PLAN.md` §11 (O7); X §11.

### WP2-X O8: refusal codes (default ships)
- **Question.** Refusals reuse the existing error codes, with details, instead of a new code. Accept?
- **Options.** (a) Existing codes (proposed). (b) A new code, which mobile and web would have to learn.
- **Recommendation.** (a).
- **Blocks.** Nothing.
- **Sources.** `HRX1-FIX-PLAN.md` §11 (O8); X §11.

### WP2-X O9: readiness telemetry before the flip (can wait until the flip)
- **Question.** The audit records which evidence basis was used. Should the client channel or app version also be recorded for NCR, safety and CO, so you can see that mobile has moved before you flip?
- **Options.** (a) Basis counts only (as drafted). (b) Add a channel or version record.
- **Recommendation.** None beyond the draft (a).
- **Blocks.** Only the flip.
- **Sources.** `HRX1-FIX-PLAN.md` §11 (O9); X §11.

### WP2-X O11: workflow-engine change-order approvals (default ships)
- **Question.** When a configured approval workflow approves a change order whose evidence is then refused, the workflow decision is already committed and the apply step reports `applyStatus: failed` inside a successful response. Keep that "failed-apply" contract, or check evidence before the workflow decision is committed?
- **Options.** (a) Failed-apply contract (chosen in the plan). (b) An engine pre-check that refuses first.
- **Recommendation.** (a), as chosen.
- **Blocks.** Nothing.
- **Sources.** `HRX1-FIX-PLAN.r2.md` §11 (O11); X §2 P-C9 and the round-1 row X-M3; `codex-plan-review-adjudication.md` (X-M3); `codex-plan-review-r3-adjudication.md`.

### WP2-X O13: existing records holding out-of-scope references (can wait until the flip)
- **Question.** Records that already hold another company's or project's reference can no longer pass their gates. They would be handled from a read-only census: authors replace the references, or approvers reject the records. The batch makes no data change. This also covers revision issuers and contract-profile documents written before the fix. Accept?
- **Options.** (a) Census plus people fix them (proposed). (b) A reviewed data repair.
- **Recommendation.** (a).
- **Blocks.** Nothing now. The census runs before the flip.
- **Sources.** `HRX1-FIX-PLAN.r2.md` §11 (O13); X §3, §11, §15, §16, §17.7; `codex-plan-review-r3-adjudication.md` ("existing-reference remediation").

### WP2-X O14: unified attachments (can wait)
- **Question.** Should rows in the unified `/attachments` store count as NCR or safety closeout evidence? Today they do not, and the batch keeps that.
- **Options.** (a) Unchanged. (b) Count them, which would be a later change.
- **Recommendation.** (a) for now.
- **Blocks.** Nothing.
- **Sources.** `HRX1-FIX-PLAN.r2.md` §11 (O14); X §10, §11.

### WP2-QP O1: who approves a downward correction (default ships)
- **Question.** Who may approve a correction that lowers official progress?
- **Options.**
  - (a) The existing progress approvers (proposed).
  - (b) A narrower role, such as the PM only.
- **Recommendation.** (a).
- **Blocks.** Nothing (default (a)).
- **Sources.** QP §8 (O1); `codex-plan-review-r2-adjudication.md`; `codex-plan-review-r3-adjudication.md` ("correction authority").

### WP2-QP O2: planned-quantity growth (default ships)
- **Question.** Raising an activity's planned quantity lowers its percentage. Does that also need a correction reason?
- **Options.** (a) Yes (proposed). (b) No.
- **Recommendation.** (a). "Lower" is judged on the resulting percentage for every method.
- **Blocks.** Nothing.
- **Sources.** QP §8 (O2), §2.3 P-3.

### WP2-QP O3: how an "N/A" hold item is released (default ships)
- **Question.** Your HR-Q1 decision says "N/A on a hold item needs the approver". Is closing the inspection that approval act?
- **Options.**
  - (a) Yes, by anyone holding `inspection.close`, now visibility-checked (proposed).
  - (b) A separate approval step.
- **Recommendation.** (a).
- **Blocks.** Nothing.
- **Sources.** QP §8 (O3); `S\wp2\WP2-ADJUDICATION.md` Q2; `codex-plan-review-r3-adjudication.md` ("the N/A release act").

### WP2-QP O5: where the correction is kept (default ships)
- **Question.** Where is the correction's history kept?
- **Options.**
  - (a) In the audit event, its snapshot and the answer (proposed, no schema change).
  - (b) A dedicated correction table.
- **Recommendation.** (a).
- **Blocks.** Nothing.
- **Sources.** QP §8 (O5).

### WP2-QP O6/O7: lower figures from daily reports and imports (default ships)
- **Question.** When a daily report, or an approver's progress-import row, carries a figure lower than official progress, does it stay held or pending until a reason is given?
- **Options.** (a) Yes (proposed). (b) Refuse it outright.
- **Recommendation.** (a).
- **Blocks.** Nothing.
- **Sources.** QP §8 (O6/O7); `codex-plan-review-r3-adjudication.md` ("daily-report and import correction handling").

### WP2-QP O9: two submissions in the same millisecond (default ships)
- **Question.** Two progress submissions for one activity made in the same millisecond by separate requests: are they simultaneous, so neither supersedes the other and lowering still needs a reason? Or should a bulk batch that names one activity twice be refused?
- **Options.** (a) Simultaneous (proposed). (b) Refuse duplicates in a bulk batch, which changes the bulk contract.
- **Recommendation.** (a). A tie can never lower progress silently.
- **Blocks.** Nothing.
- **Sources.** QP §8 (O9), §2.3 P-1; `codex-plan-review-adjudication.md` (QP-M2); `codex-plan-review-r2-adjudication.md`.

### WP2-QP O10: data treatment on the deploy target (DEPLOY GATE)
- **Question.** Before deploying the HR-P1 fix to a real database, read-only counts run. C-1 counts approved progress rows with no approval date. C-4 counts rows tied on their date. If either is non-zero, what do we do? And do you acknowledge the lists of figures that will move at deploy?
- **Options.**
  - **(a)** A reviewed back-fill (`approvedAt = updatedAt` where it is missing), repeating June's migration.
  - **(b)** Leave the nulls sorted last. This contradicts the single "official row" definition.
- **The lists to acknowledge.**
  - C-2: figures that move at deploy, including the IPC and sub-pay-app caps.
  - C-5: ITP holds that start blocking.
- **Recommendation.** (a) for C-1. C-4's tied rows are listed for you to decide.
- **Blocks.** The deploy only. On `cert3d` both counts are expected to be 0.
- **Sources.** QP §2.3 N-1, §2.10, §8 (O10), §9; `codex-plan-review-r2-adjudication.md` (QP-R2-Q); `codex-plan-review-r3-adjudication.md`.

### WP2-QP O8: re-targeting an open ITP (can wait)
- **Question.** May someone PATCH an open inspection to point at a different activity while its hold items are unreleased? Today they can. The fix only adds visibility and "still open" checks.
- **Options.** (a) Keep today's behaviour. (b) Refuse while holds are unreleased, which would be a new rule.
- **Recommendation.** None given.
- **Blocks.** Nothing.
- **Sources.** QP §8 (O8); `codex-plan-review-r2-adjudication.md` (QP-R2-H1: "O8 stays the owner's").

### WP-2 rule rows (plan §5, undecided; the certification records today's answer as BLOCKED)

| Id | Today | Plan recommendation | Sources |
|---|---|---|---|
| HR-P4 (=QP O4) | PM and planner approve their own progress; PM approves their own timesheets | Keep for Phase 1 (CLAUDE.md: PM has all access); self-approvals visible in audit. Its confirm-first item stays reported, not "expected behaviour", until you decide | PLAN §5 :1040; QP §8 (O4); `S\wp2\WP2-ADJUDICATION.md` Q11 |
| HR-P2 | Only a configured method is locked | Lock the effective method once progress is approved | PLAN §5 :1038; WP2-ADJUDICATION Q11; QP §6 |
| HR-P3 | PUT on the method resets omitted fields (switches evidence off) | Partial update | PLAN §5 :1039; WP2-ADJUDICATION Q11 |
| HR-Q2 | Gates read the current template | Gate on the instance's own template version | PLAN §5 :1048; WP2-ADJUDICATION Q11 |
| HR-S9 | Pending submissions on retired activities can be approved; their AC/EV drop out (L118) | Refuse approval (409); keep AC and EV in totals. The L34 fix keeps today's filter so it does not decide this | PLAN §5 :1036; WP2-ADJUDICATION Q11; `S\wp3\WP3-ADJUDICATION.md` Q4 |

---

## Details: WP-3 (earned value)

*All L34 items may change after the L34 Codex plan review, which has not run yet.* L34 itself is decided and confirmed. The fix makes official actual cost (AC) come from the cost ledger by `incurredOn`. The plan says no proposal is final until the review is adjudicated and you have seen O-1..O-6 (`S\wp3\fixplan\L34-FIX-PLAN.md` header and §10).

### WP3-L34 O-1: unmigrated legacy actual cost (before L34 fix)
- **Question.** A project whose cost records exceed its ledger total has pre-ledger cost that was never migrated. Should AC be the ledger alone, which drops that remainder?
- **Options.**
  - (a) Ledger only. The gap stays visible in `GET /cost/reconciliation`. Run a read-only census (`migration.required`) before any deploy.
  - (b) A hybrid that keeps the remainder, which hides the gap.
  - (c) A basis warning on the EV report when the ledger and the records disagree.
- **Recommendation.** (a). The seed and the certification population post through the ledger, so only old, never-migrated databases are affected.
- **Blocks.** The L34 fix.
- **Sources.** L34 plan §2 item 5, §8 R-6, §10.

### WP3-L34 O-2: periods locked before the fix (before L34 fix)
- **Question.** Snapshots locked before the fix keep their understated AC for ever, because there is no unlock. Serve them as stored, or flag them?
- **Options.**
  - (a) Served exactly as stored. Their `formulaVersion` says `ev.v2`, the release notes explain it, and a read-only census of `ev.v2` snapshots runs before deploy.
  - (b) A basis warning on affected `ev.v2` snapshots. That changes a locked answer, which is a new rule.
- **Recommendation.** (a).
- **Blocks.** The L34 fix.
- **Sources.** L34 plan §3 L-8, §6.1, §8 R-2, §10; `S\wp3\WP3-PREP.md` §9 item 5.

### WP3-L34 O-3: dating a voided cost entry (before L34 fix)
- **Question.** Does a reversal count at the original entry's date (today's ledger design), or at the void's date?
- **Options.**
  - (a) The original's date. A void after a lock moves open past-cutoff reports, never the snapshot.
  - (b) The void's date. This is a ledger change outside WP-3.
- **Recommendation.** (a).
- **Blocks.** The L34 fix and the book leaf `WP3.L34.reversals`.
- **Sources.** L34 plan §9 item 8, §10, §11.

### WP3-L34 O-4: the typed "actual through date" (before L34 fix)
- **Question.** `PATCH /cost/:id {actualThroughDate}` would no longer affect EV. Keep it as a display field, or derive it only and refuse typed values?
- **Options.** (a) Display-only register field. (b) Derived only, which is a cost-API change.
- **Recommendation.** (a). L118's typed half disappears without a rule change.
- **Blocks.** The L34 fix.
- **Sources.** L34 plan §3 L-9, §10.

### WP3-L34 O-5: future-dated postings (before L34 fix)
- **Question.** A posting dated after today counts only from its date. Today such an activity loses all its cost; after the fix only the future amount is left out. This can raise AC, lower CPI and raise EAC on some dashboards. Confirm this is wanted for invoices dated ahead?
- **Options.** (a) Yes, HR-E1 read literally. (b) Some other treatment.
- **Recommendation.** (a).
- **Blocks.** The L34 fix.
- **Sources.** L34 plan §8 R-1, §10.

### WP3-L34 O-6: wording (before L34 fix)
- **Question.** Should the EV note text and the "truth" labels change to say "cost-ledger postings"?
- **Options.**
  - Notes: (a) reword (L-5b), or (b) keep the text and record a P3 wording item.
  - Labels: (a) version-keyed, so old answers stay byte-identical (L-6), or (b) untouched, with a P3 wording item (L-6b).
- **Recommendation.** Reword the notes (L-5b) and use version-keyed labels (L-6).
- **Blocks.** The L34 fix's text only.
- **Sources.** L34 plan §3 L-5b, L-6/L-6b, §10.

### WP0-72K: 087-SCH's 72,000 row (default applies)
- **Question.** "One 72,000 row stays unallocated until the baseline step covers it" names neither the activity nor the EV effect. The answer book reads it as allocated to A220 at baseline, so 087-SCH's EV budget is 459,000.00 after baseline, while WP-2 uses the five allocations totalling 387,000.00.
- **Options.** (a) Accept that reading. (b) Give another.
- **Recommendation.** (a). The reading stands unless you say otherwise.
- **Blocks.** Nothing.
- **Sources.** PLAN §0 item 5; REG (WP-0 findings table, "087-SCH 72,000 row").

### HR-E3: EAC when CPI = 0 (can wait)
- **Question.** Today EAC falls back to the budget, labelled `budget_cpi_zero`, which already equals the plan's recommendation. Confirm "keep as is"?
- **Options.** (a) Keep, which classifies `CF.HRE3` as expected behaviour. (b) Another rule.
- **Recommendation.** (a).
- **Blocks.** Nothing. `CF.HRE3` stays reported until you answer.
- **Sources.** PLAN §5 :1094; `S\wp3\WP3-ADJUDICATION.md` Q15; `WP3-PREP.md` table row (EAC at CPI 0) and §11 Q15.

### HR-E4: what "triggers alert" means for SPI/CPI < 0.9 (can wait)
- **Question.** Today the alert is a flag computed on the report only, with no notification and no SPI exception kind. Decide now, or defer to WP-9, where the exception engine lives?
- **Options.**
  - (a) The plan's recommendation: the report flag, plus an exception kind when the engine is on, and no new notice.
  - (b) Defer to WP-9.
  - (c) Add a notification.
- **Recommendation.** (a), or (b) to defer.
- **Blocks.** Nothing.
- **Sources.** PLAN §5 :1095; WP3-ADJUDICATION Q15; `WP3-PREP.md` §11 Q15.

### WP3-Q11: cost loadings in a locked period (can wait)
- **Question.** Today a loading that names a locked period is refused, judged by its period link. Should it instead be judged by its date?
- **Options.** (a) Keep the period-linked rule. (b) A date-based rule, which is a rule change.
- **Recommendation.** None. Today's behaviour is what the proof asserts.
- **Blocks.** Nothing.
- **Sources.** `S\wp3\WP3-ADJUDICATION.md` Q11 ("recorded for the owner, not implemented"); `WP3-PREP.md` §11 Q11.

### HR-E2: period lock before its cutoff (can wait)
- **Question.** Refuse a lock before its cutoff (409 `CUTOFF_NOT_REACHED`), allow no unlock, and audit every lock?
- **Recommendation.** Yes (plan). L113 is provisionally P2.
- **Blocks.** Nothing.
- **Sources.** PLAN §5 :1093; WP3-ADJUDICATION Q16.

---

## Details: WP-4 (commercial)

*The HR-C1 items may change after the HR-C1 Codex plan review, which has not run yet.* HR-C1 itself is decided: no silent 5% retention. The plan's sequence is: Codex review, then adjudication, then **you answer Q5 (and see Q10)**, then the fix (`S\wp4\fixplan\HRC1-FIX-PLAN.md` §13).

### WP4-HRC1 Q5: which existing contracts count as configured (before HR-C1 fix)
- **Question.** After the fix, a draft or submitted certificate on a contract whose retention was never configured is refused until someone enters a rate or 0. Which existing contracts and lines count as already configured? And do you accept that consequence?
- **Options.**
  - **Q5-a (conservative).** Configured only if the audit shows a contract manager changed the rate, or the rate equals the project's explicit default.
  - **Q5-b (permissive).** Any `contract.manage` save counts. This also counts API saves that never sent a rate.
  - **Q5-c (grandfather).** Every existing contract counts at its stored rate. This makes every silent 5% authoritative, which HR-C1 forbids.
- **Recommendation.** Q5-a.
  - The 97 other certification companies are expected to be unaffected: every population project carries an explicit default, and the drivers set rates explicitly. The census confirms this before deploy.
  - Certified and paid certificates are never touched.
- **Blocks.** The HR-C1 fix, its migration and backfill (WP-4). If the census finds affected rows outside the deep companies, you decide before deploy.
- **Sources.** HRC1 plan §11.1, §11.2, §12 R-1/R-5, §15; `S\wp4\WP4-ADJUDICATION.md` Q5; `S\wp4\PREP4-ADJUDICATION.md` §A; `S\wp4\WP4-PREP.md` §9, §11 Q5.

### WP4-HRC1 O-2: no pre-filled 5% in forms and templates (default later)
- **Question.** The fix (P-3) removes the pre-filled 5 from the project form and templates. A new project then starts with no retention default unless one is typed, and its contract is unconfigured until a rate (or 0) is entered. Accept?
- **Options.** (a) Accept. (b) Keep a pre-fill, which brings back a silent default.
- **Recommendation.** (a), as proposed.
- **Blocks.** Nothing beyond the HR-C1 fix's contract.
- **Sources.** HRC1 plan §3 P-3, §15 (O-2); PREP4-ADJUDICATION §A.

### WP4-HRC1 O-3: unsetting a configured rate (default later)
- **Question.** May a contract manager take a configured retention rate back to "not configured" (null)?
- **Options.** (a) Yes (P-6). (b) Only change it to another number.
- **Recommendation.** (a), as proposed.
- **Blocks.** Nothing beyond the fix's contract.
- **Sources.** HRC1 plan §3 P-6, §15 (O-3); PREP4-ADJUDICATION §A.

### WP4-HRC1 Q3: commitments under HR-C1 (default later)
- **Question.** The adjudication reads HR-C1 as covering commitments too. Confirm, and choose how a commitment with no rate is treated on a project with no default.
- **Options.**
  - (a) Refused at create with 400 `COMMITMENT_RETENTION_REQUIRED`, with no schema change.
  - (b) Allow null drafts and refuse them at submit with 409, which needs a nullable column.
- **Recommendation.** (a).
- **Blocks.** Nothing beyond the fix's contract. The book leaf `WP4.C3.noDefaultNoRate` stays an assumption until you confirm.
- **Sources.** WP4-ADJUDICATION Q3; HRC1 plan §3 P-12, §15, §16; WP4-PREP §11 Q3; PREP4-ADJUDICATION §A.

### HR-C2: variation allowance scope, and its severity (can wait)
- **Question.** Today an approved variation raises the allowance of every allocation of the BOQ row, so a sibling allocation can be over-certified (A130 reads 650 / 97,500.00 instead of 600 / 90,000.00). Should it apply only to the linked allocation? Is today's behaviour P1?
- **Recommendation.** The linked allocation only (plan); P1 proposed (prep).
- **Blocks.** Nothing. Mutant M-VAR1 joins the evidence only after you decide.
- **Sources.** PLAN §5 :1070; WP4-ADJUDICATION Q8, Q9; WP4-PREP table row "Variation allowance leaks", §11 item 9.

### HR-C3: IPC states (can wait)
- **Question.** Should a certificate be able to go from submitted back to draft (QS or PM, with a reason, audited)? Should its status follow payment? Should empty periods be refused?
- **Recommendation.** Yes to all three (plan).
  - Related: the HR-C1 fix refuses submission of an unconfigured certificate (P-11b) precisely because there is no route back today.
- **Blocks.** Nothing.
- **Sources.** PLAN §5 :1071; WP4-PREP RULES line; PREP4-ADJUDICATION §A I-1.

### HR-C12: change events (can wait)
- **Question.** One accepted quote per line? Archiving the change order returns the event to "priced"? Conversion carries each line's budget line and cost code?
- **Recommendation.** Yes (plan). Atomic conversion is a separate defect fix on the plan's list.
- **Blocks.** Nothing.
- **Sources.** PLAN §5 :1080; WP4-PREP (`KA.HRC12.*`).

### HR-C13: new capabilities for Phase 1 (can wait)
- **Question.** Add a deductive prime change order (L199) and subcontractor retention release (L116) in Phase 1?
- **Recommendation.** Your call (plan). Without L116, every subcontract closeout needs an override.
- **Blocks.** Nothing.
- **Sources.** PLAN §5 :1081; WP4-PREP table row L116/L199, §11 item 9.

---

## Details: WP-5 (supply chain)

### WP5-F2: replacing a cancelled award order (before the F-2 fix)
- **Question.** "One order per award" is on the plan's defect-fix list and is fixed if it confirms as P1. If an award's purchase order is cancelled, may a replacement order be raised, which means clearing the link on cancel? And should existing awards be linked to their one live order by a back-fill?
- **Options.**
  - Replacement: (a) yes, clear the link on cancel; (b) no, never.
  - Back-fill: (c) leave existing awards unlinked, so they can be ordered once more; (d) back-fill the link.
- **Recommendation.** None on replacement. The default for the back-fill is (c).
- **Blocks.** The F-2 fix, if AWARD-ONE-ORDER confirms as P1.
- **Sources.** `S\wp5\WP5-PREP.md` §9 F-2, §11 Q3/Q4; `S\wp4\PREP4-ADJUDICATION.md` §D Q4.

### HR-C5: invoice approval against a blocking three-way match (can wait)
- **Question.** Today a blocking three-way-match verdict is only advisory. Should it refuse approval unless the PM or finance overrides with a reason, and should the verdict downgrade be fixed?
- **Recommendation.** Yes (plan).
- **Blocks.** Nothing. `KA.D5.overInvoicedLedger` is decided only once both the HR-C5 and WP5-SVC-1 fixes exist.
- **Sources.** PLAN §5 :1073; WP5-PREP §1, §11 Q4; `S\wp5\PREP5-ADJUDICATION.md` (P3).

### HR-C7: material plan usage (can wait)
- **Question.** An issue to an activity raises the issued quantity of the linked plan rows, and ignored fields are refused (400)?
- **Recommendation.** Yes (plan).
- **Blocks.** Nothing.
- **Sources.** PLAN §5 :1075; PREP5-ADJUDICATION (B2, P1); WP5-PREP §11 Q4.

### HR-C8: purchase orders after delivery (can wait)
- **Question.** Should a partly received order be closable with force and a reason, and a fully received one closable? Should cancel after any delivery answer 409 `PO_CANCEL_AFTER_DELIVERY`? And should the order show the short-close reason? Today it is only in the audit; that sub-question comes from the prep.
- **Recommendation.** Yes to the plan's rules. The close-reason display is your call.
- **Blocks.** Nothing. Several builder steps and 6 known answers stay BLOCKED until you decide.
- **Sources.** PLAN §5 :1076; WP5-PREP §9 (HR-C8 note), §11 Q4; JNL 2026-10-09 builders entry; PREP5-ADJUDICATION B1, B5.

### HR-C9: purchase-order reference scan (can wait)
- **Question.** Today, looking up an order by reference searches the whole company and picks any project. Should it require `projectId` or answer 409 when ambiguous? This is a mobile contract change.
- **Recommendation.** Yes (plan; P1 proposed, an authorisation issue within the company).
- **Blocks.** Nothing.
- **Sources.** PLAN §5 :1077; WP5-PREP §1, §11 Q3/Q4.

### WP5-SEV: aligning WP0-INV-1 with HR-C9 (can wait)
- **Question.** Two findings are the same class: access within the company beyond the person's projects. WP0-INV-1 (a warehouse keeper not on a project receives, issues and returns its stock) is registered P2. HR-C9 (any member reads any project's order) is proposed P1. Which severity should both carry?
- **Options.** (a) Both P1, so WP0-INV-1 would be fixed. (b) Both P2. (c) Keep them different, with a stated reason.
- **Recommendation.** None given.
- **Blocks.** Nothing.
- **Sources.** PREP4-ADJUDICATION §D Q3; WP5-PREP §11 Q3; REG (WP0-INV-1).

### WP5-AWD-1: awarding to a non-lowest bidder (can wait)
- **Question.** The only override recorded on an award is the prequalification override. There is no "not the lowest" justification. Is that acceptable as the record?
- **Options.** (a) Accept, so it becomes expected behaviour. (b) Not acceptable: P3, recorded.
- **Recommendation.** None given.
- **Blocks.** Nothing.
- **Sources.** WP5-PREP §5 table (WP5-AWD-1); REG builder suspects.

---

## Details: WP-6 (BOQ, allocations, budgets)

| Id | Question | Today | Plan recommendation | Sources |
|---|---|---|---|---|
| HR-C14 (WP6 O1) | BOQ import package | No section column; one AI prompt for all rows; dropped rows stay active; a non-AI import uses AI quota; the AI job runs after baseline | Optional section column; AI job in batches of at most 60 by section; dropped rows flagged, not deactivated; quota only for the AI job; AI job refused after baseline | PLAN §5 :1082; `S\wp6\WP6-PREP.md` §11.2 O1; `WP6-ADJUDICATION.md` |
| HR-C17 (WP6 O3) | Allocation lifecycle | A rejected allocation cannot be resubmitted | Rejected → draft → submit; withdrawal only through a BOQ revision | PLAN §5 :1085; WP6-PREP §11.2 O3 |
| HR-C18 (WP6 O4) | 7 categories vs 8 types | Two vocabularies (8 cost types; a 7-field category list) | Keep 8 types and show "other" separately; **you name the seven** the dashboard reports | PLAN §5 :1086; WP6-PREP §11.2 O4 |
| WP6-L109-111 (WP6 O6) | Are these ever acceptable: L109 (an Original lock released when an approved change order is re-pointed), L110 (archiving a budget line hides its actual), L111 (a negative revision below actual)? | Allowed | P2 proposed: recorded, not fixed. If you rate one P1, it is fixed | WP6-PREP §9 (L109/L110/L111), §11.2 O6 |

All four can wait: their known answers stay BLOCKED.

---

## Details: WP-7 (contract time)

### HR-C10: extension-of-time (EOT) claims (can wait)
- **Question.** Should approved claims be locked (409)? Should impact be the delay minus the least float along the named activities, instead of summed per activity? Should the project date stay manual? And should a weather delay linked to an approved claim also be locked (WX-DEL-1, P2)?
- **Recommendation.** Yes to the plan's three. WX-DEL-1 is your call.
- **Blocks.** Nothing. Mutant M-LOCK joins after the decision.
- **Sources.** PLAN §5 :1078; `S\wp7\WP7-PREP.md` §11.2 O1; `WP7-ADJUDICATION.md` (O1, Q4, Q10).

### HR-C11: fractional days, zero allowance, the 70% warning (can wait)
- **Question.** Today days are integers (1.5 becomes 1), an allowance of 0 becomes 20, and the 70% warning is only a flag.
  - Store half-days, which needs a migration to decimal, or refuse non-integers? Refusal collides with the daily-log promotion's rounding of 2 h to 0.5 day.
  - Should 0 mean 0?
  - Should the 70% line also send a notice?
  - Should one contractual day against a zero allowance warn? That expected value is missing today.
- **Recommendation.** Plan: decimals or refuse (your pick); 0 means 0; keep the flag, with a notice your call. The prep notes the rounding collision against refusal.
- **Blocks.** Nothing. Builder steps and stored weather checks stay BLOCKED or STORED-PRE-FIX.
- **Sources.** PLAN §5 :1079; WP7-PREP §11.2 O2; WP7-ADJUDICATION (O2, Q9, Q12); `S\wp8\WP8-PREP.md` (KA.DL refs); JNL builders entry.

### HR-F4: daily log approval, reopen and weather promotion (can wait)
- **Question.** Approve only submitted days, and refuse an empty one? Require a reason to reopen? Should a weather delay promoted by site staff be contractual only if they hold `eot:create`, and otherwise non-contractual?
- **Recommendation.** Yes to all (plan).
- **Blocks.** Nothing. WP-7 probes the promotion and WP-8 classifies it.
- **Sources.** PLAN §5 :1061; WP7-PREP §11.2 O3; WP7-ADJUDICATION (O3, Q8); WP8-PREP §11.2 O1; `WP8-ADJUDICATION.md` (O1, Q8).

---

## Details: WP-8 (field, quality, documents)

| Id | Question | Today | Plan recommendation | Sources |
|---|---|---|---|---|
| HR-F5 (WP8 O2) | Timesheet controls | 24 h cap per sheet only; rate read at approval; inactive workers accepted | Cap per worker per day across all sheets; rate at submission; refuse inactive workers | PLAN §5 :1062; WP8-PREP §11.2 O2 |
| HR-Q3 (WP8 O3) | Which ITP model feeds the quality score | Legacy register drives the score; form ITPs drive the gate | Form ITPs count in both, so 087-FLD reads 6 instead of 21 and WP-9's 087-HLT reads 42; the legacy register counts until retired | PLAN §5 :1049; WP8-PREP §11.2 O3; WP8-ADJUDICATION Q3 |
| HR-Q4 (WP8 O4) | Quality-score inputs | Legacy ITP status changes freely; NCR and ITP hard delete | Closed NCRs keep counting (CLAUDE.md); an ITP status change needs a reason and is audited; delete becomes archive, and archived/void records are excluded | PLAN §5 :1050; WP8-PREP §11.2 O4 |
| HR-Q5 (WP8 O4) | Changes after closeout | NCR severity, safety type and lost days editable after submit; approval does not re-check evidence | Freeze them after submit; approval re-checks evidence. Deciding this also settles WP2-X O4 | PLAN §5 :1051; WP8-PREP §11.2 O4; X §11 (O4) |
| HR-F1 (WP8 O5) | PM approval of a submittal while review steps are pending | Allowed | Refuse (409) unless a PM override with a reason | PLAN §5 :1058; WP8-PREP §11.2 O5 |
| HR-F2 (WP8 O5) | Drawing approval without review, or out of order | Allowed | Approve only from review; refuse a revision older than the current approved one unless it supersedes with a reason | PLAN §5 :1059; WP8-PREP §11.2 O5 |
| HR-F3 (WP8 O5) | Reassigning the punch final approver | Anyone with the right | Only the PM or the current final approver once the item is open | PLAN §5 :1060; WP8-PREP §11.2 O5 |
| HR-F6 (WP8 O5) | Meetings | Status set by PATCH; drafts distributed; minutes editable after distribution; action items re-created on each edit | Status changes only through finalize and distribute; distribution needs a finalized meeting; lock after distribution; update action items in place | PLAN §5 :1063; WP8-PREP §11.2 O5 |

All eight can wait: their known answers stay BLOCKED.

---

## Details: WP-1 and WP-9 rule rows

These are plan §5 rows with no fix pending. Each has a plan recommendation (summary table above, verbatim in PLAN §5 :1028-1041 and :1096-1105). The WP-1 rows HR-S1, S3-S6 and S8 are named in JNL 2026-10-09 ("wait for owner decisions"). HR-S7 and HR-K8 are wording and display choices; the rest are behaviour rules. HR-P5 sits here because its readers (search, lookahead, export, assistant) are WP-9's. All can wait.

---

## Details: cross-cutting

### XC-1: CLAUDE.md "Retention default 5%" (can wait; best answered before the HR-C1 fix)
- **Question.** CLAUDE.md's business rules say "Retention default 5% of certified value per IPC period". Your HR-C1 decision (no silent 5% fallback) overrides it. CLAUDE.md is your file, so it is not edited without your word. Update it?
- **Options.**
  - (a) Reword it to HR-C1, for example: "retention comes from contract configuration or an explicit 'no retention'; otherwise configuration is required".
  - (b) Leave it, knowing the rulebook and the product then disagree.
- **Recommendation.** (a). The WP-4 book maps the old rule onto the HR-C1 refusal checks in the meantime.
- **Blocks.** Nothing.
- **Sources.** JNL 2026-10-09 (WP-0 entry); REG (WP-0 findings table); `S\wp4\WP4-ADJUDICATION.md` Q10; `S\wp4\WP4-PREP.md` (CLAUDE.md rule E4), §11 Q10; HRC1 plan §0, §15, §16; PREP4-ADJUDICATION §A.

### XC-2: budget-revision running totals in existing data (default later)
- **Question.** Back-dated budget revisions store a wrong running total. The plan says this affects 222 companies. If the fix goes ahead, which it does only if it confirms as P1 at the WP-6 run, do we rewrite the stored totals across the population, or compute them on read?
- **Options.**
  - (a) Compute on read (P-2), plus stop the stored column drifting (P-1). No data write.
  - (b) A one-off recompute per project. This is a population-wide write that changes the 97-company fingerprint at the exit run.
- **Recommendation.** (a). The adjudication prefers compute on read; any data remediation is yours. Severity is P2 proposed, because the totals heal on the next edit and the summary, waterfall and EV totals are right.
- **Blocks.** Nothing now.
- **Sources.** `S\wp6\WP6-PREP.md` §9 F-1, §11.2 O2; `S\wp6\WP6-ADJUDICATION.md` Q6; PLAN §5 :1083, :1113.

### XC-3: repairing duplicate or orphan weather rows (can wait)
- **Question.** PROMO-TX was reproduced 3 of 3 times: two promotions of one daily-log delay give two contractual weather rows, and a promotion racing a delete leaves an orphan. If the fix lands, should existing duplicate or orphaned promoted rows be repaired?
- **Options.**
  - (a) A read-only census only, then decide.
  - (b) A reviewed repair, which changes the 97-company fingerprint.
  - (c) Leave them.
- **Recommendation.** None beyond "census first".
- **Blocks.** Nothing.
- **Sources.** WP7-PREP §11.2 O4; WP7-ADJUDICATION (O4, Q6, Q11); JNL 2026-10-10 (WP-7 entry).

### HR-A1: what company administration grants (can wait)
- **Question.** Being a company admin grants more than the two policy modules (`user_management`, `project_parties`). It also grants:
  - org-wide project visibility;
  - the `/company` routes (cost codes, vendors, prequalification, templates);
  - report management and moderation.

  For example, 052's finance admin can create cost codes and vendors, but 087's cost controller cannot. Is that by design?

  Folded in: WP0-BOQ-1. The BOQ template and stored bill are limited to PM, planner and QS, while the policy gives `boq:read` to all nine roles. Should the route follow the policy, or the policy narrow?
- **Recommendation.** None given. The probe records these grants and does not fail on them.
- **Blocks.** Nothing.
- **Sources.** PLAN §0 item 5; REG (WP0-BOQ-1, WP-0 findings table); `S\wp6\WP6-PREP.md` §11.2 O5; `WP6-ADJUDICATION.md` (O5); WP5-PREP §6 (HR-A1 note).

### HR-A2: deletes guarded as updates (can wait)
- **Question.** Weather delays, drawings, transmittals, correspondence and daily-log entries are deleted under the module's `update` key, while the `delete` row is empty. L146 covers the document-control part. Should `delete` be its own key, or should delete mean archive?
- **Options.** (a) A separate delete key. (b) Delete becomes archive.
- **Recommendation.** None given.
- **Blocks.** Nothing.
- **Sources.** PLAN §0 item 5; `S\wp7\WP7-PREP.md` §11.2 O5; WP7-ADJUDICATION (O5); `S\wp8\WP8-PREP.md` §11.2 O7; WP8-ADJUDICATION (O7).

### HR-A3: a company with no finance member (can wait)
- **Question.** Recording a client payment and releasing retention are finance-only, so a PM cannot do them (L211, P3). Should a small company without a finance person be able to record payments some other way?
- **Options.** (a) Keep finance-only. (b) Let the PM do it, perhaps only when no finance member exists.
- **Recommendation.** None given. The proof asserts today's 403.
- **Blocks.** Nothing.
- **Sources.** PLAN §0 item 5; WP4-ADJUDICATION Q14; WP4-PREP (I12, L211), §11 Q14.

### QKEY-F1 and QKEY-F2: Q-KEY follow-ups (can wait)
- **QKEY-F1.** Webhook subscriptions and accounting connections created from a stolen session survive a credential event; Q-KEY covers API keys only. Extend it?
- **QKEY-F2.** Suspending an administrator in one workspace, while their identity stays open, is not a credential event. Keys they created there that act as other people keep working. Extend it?
- **Recommendation.** None given. Nothing changes until you say.
- **Sources.** PLAN §0 item 5; REG (Q-KEY-F1, Q-KEY-F2).

### Register items from earlier checkpoints (can wait; not CERT-3 fix work)
- **RFI-DRAFT (P2).** No RFI can be created as a draft: "raise RFI" from a specification and the assistant's create-RFI always answer 409. Create them open, or add draft transitions with draft-privacy checks? Builder steps are marked BLOCKED on it. Sources: REG review-rounds table; JNL 2026-10-09 builders entry.
- **R5 (P2).** Internal site and quality engineers can no longer edit submittal review routes, but the web still shows the buttons. Keep the rule and gate the UI, or narrow the rule to party guests only? Source: REG.
- **R22 (P2).** The liquidated-damages rate reaches planners and consultants through the EOT module while the project record withholds it. Recommended option A: the project record follows `ipc:read` OR `eot:read`. Source: REG.
- **OPS-1 (P2).** A task whose database engine dies is never restarted. Options: an alarm on `/api/health/ready`; a self-check that exits; database timeouts on the production role. Source: REG.
- **C4-NEW-3 (P2, CERT-4).** What a provider-reported "unpaid" subscription means for access. Source: REG.
- **GIT-HIST.** Rewrite git history to remove the exposed Stripe test key? Rotation makes it worthless; a rewrite forces every clone to be re-made. The rotation itself is an owner action still listed in REG. Source: REG "Git history".
- **D-ID-2 (P3, CERT-7).** What past records may show for a former member: live name and e-mail, or "Former user". Sources: REG; JNL 2026-10-09.

---

## Informational (no decision needed)

- **The XDOC family: all CONFIRMED P1, all fixed in the HR-X1 batch.**
  - XDOC-1, XDOC-1b, XDOC-1c, XDOC-UPB, XDOC-ISS and XDOC-CP were each reproduced live. They are cross-company writes with no read exposure: every read path was traced, and none reads another company's file.
  - The HR-X1 batch refuses them on EOT claims, weather delays, sub valuations, the nine other workflow types, the revisions door, drawing and transmittal file fields, revision issuers and contract-profile documents. It also stamps the uploader on the server.
  - These are fixes under the certification's P1 mandate, so you are informed, not asked (X §11 O12).
  - Sources: REG builder-suspects table; JNL 2026-10-10 entries; `S\wp2\codex-plan-review-r2-adjudication.md`; `r3c-rulings.md`.
- **Round-3 plan review: one HIGH, closed.**
  - The last allowed Codex plan-review round found one HIGH in the HR-X1 plan (X-R3-H1). A file reference sent as a one-item list was turned into a string that judges reading only string fields would miss.
  - It is closed by Codex's own smallest fix: the judge reads both the raw and the normalised values on every path. It has live catchers and mutations, and the Codex diff review of the implementation verifies it.
  - QP had no HIGH at round 3.
  - Sources: `codex-plan-review-r3-adjudication.md`; X §11 O12; QP §8.
- **Defect fixes that go ahead if they confirm as P1, unless you object (plan §5's list).**
  - **PROMO-TX** (weather promotion in one transaction; reproduced 3 of 3).
  - **RFI-RESP-1** (an RFI's official answer can be rewritten after closure; provisional P1).
  - **SAFE-ARCH-1** (health counts archived incidents; provisional P2).
  - Atomic, idempotent change-event conversion; the commitment-CO live-parent check; atomic award confirmation, one order per award, and award orders keeping their coding; the receivable PO list; budget-revision running totals; L106; the exception lock; the rollback stamp.
  - Silence means go ahead (PLAN §5 :1107; WP8-PREP §11.2 O6; WP8-ADJUDICATION O6).
- **Suspects and leads recorded, not owner decisions.**
  - WP4-AGG-1 (P2: stored change totals lag under concurrent converts and heal on the next change).
  - WP3-ALLOC-1 (P2: the allocation summary does not filter progress by cutoff).
  - FCST-WIN-1 (P3), SCHED-RET-1 (P3).
  - L-DETAILS: production strips `error.details`, so client flows that read it go to the WP-8/client sweep.
  - EOT-CONC-1 and WX-DEL-1 (P2); DST-1, EOT-REC-2, EOT-APPLY-1 (P3).
  - DL-REPLAY-1 (P3); SUB-LINK-1 and MTG-SENT-1 (P2).
  - WP-6's orphan upload (P3), the activity-delete cascade (P2) and the capacity race.
  - Sources: the WP adjudications; JNL.
- **For information from WP-3.** Site engineers receive forecast money because `boq:read` grants it (your earlier E1 rule). It is classified as expected behaviour. Tell us if you want that narrowed (WP3-ADJUDICATION Q6).
- **Decided elsewhere or in another checkpoint.**
  - HR-C4 (what "invoiced" means), HR-C15's baseline half and HR-C16 (cash flow) are CERT-5's.
  - HR-C6 (L35, L36, X-FINANCE-1) stays CERT-5 by your decision.
  - HR-E1 is decided (L34 in CERT-3).
- **Deploy-time reports you will receive.** QP C-2 lists the figures that move and C-5 the inspection holds that start blocking. HR-C1's census and the L34 `ev.v2` census each produce a list before any deploy.
- **TEST GAP.** L121 (the AI-quota refusal on a non-AI import) is not run live, because it would spend a fingerprinted company's quota (WP6-ADJUDICATION).
- **Integration-owner items already ruled.** IQ-1..IQ-3, the WP-2 adjudications, P-11b, `cert3d` re-apply. They are listed only so you know they are settled.
