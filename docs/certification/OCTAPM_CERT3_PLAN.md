# CERT-3 plan: construction-workflow certification

**Status:** draft for the owner's review, 2026-10-05. Branch `cert/full-saas-certification` at `01904f5`. Repository root: `C:\Users\mabde29\OneDrive - Louisiana State University\Constech\octapm-main\octapm-main\.claude\worktrees\cert`; every path below is relative to it.

Nothing in this plan has been run. The expected figures come from the five read-only area maps. Each one is derived again on paper in the answer book before its proof runs. Items marked **(assumption)** must be confirmed before the step that depends on them.

---

## 0. What I need you to decide

1. **D-ID-1 detail decisions, ID-a to ID-h (§2.1).** Each has a recommendation. Once you answer and Codex has reviewed the D-ID-1 plan, implementation can start.
2. **The deep companies (§3):** 087 (large), 052 (medium) and 011 (small).
3. **The high-risk rule decisions (§5).** For each group you can approve the recommendations, change them or hold them. No fix that changes one of these rules starts before you answer on it.
4. **Where the open finance P1s go.** L34, L35 and L36 are open P1s; X-FINANCE-1 is a related P2.
   - Recommended: they stay with CERT-5, as the register says. CERT-3 builds their known-answer tests and leaves those tests red and labelled.
   - The other option is to fix them inside CERT-3. L34 is the strongest case for this, because a period lock freezes the wrong actual cost (AC).

---

## 1. Scope and principles

### 1.1 What CERT-3 certifies

The construction lifecycle is run on representative deep companies, from project setup to reporting and audit:
- programme and earned value: schedule, progress, earned value, forecast and reporting periods;
- commercial: BOQ, budget, change, commitments, client payment certificates (IPC), subcontractor payment applications and cash flow;
- supply chain: procurement, purchase orders, goods receipt, inventory and direct costs;
- field and quality: site records, quality, safety and document control;
- controls: exceptions, notifications, dashboards, exports, reports and audit.

For every workflow:
- each state change is driven by the persona who should make it;
- each refusal is asserted by its exact error code;
- each effect is read back through the API, and in process where time or a process-wide switch must be controlled;
- each figure is compared with a value derived on paper.

D-ID-1 (invitation-only user add) is item 1.

The CLAUDE.md business rules each get a known answer:

| CLAUDE.md rule | Work package | Known answer (paper) | Risk already seen |
|---|---|---|---|
| TF = LF − EF; TF = 0 → critical | WP-1 | A140 TF 47, A300 TF 20, 12 critical of 14 | LF not capped at the project finish (HR-S1) |
| SPI = EV/PV; < 0.9 alert | WP-3 | 0.251938, alert | — |
| CPI = EV/AC; < 0.9 alert | WP-3 | 1.21875 no alert; 0.886364 alert | L34 |
| EAC = budget / CPI | WP-3 | 317,538.46 | CPI 0 gives BAC (HR-E3) |
| BOQ > 60 → chunk by section, max 60 | WP-6 | 130 rows → [60, 60, 10]; sections 50/50/30 → [50, 50, 30]; 70/45 → [60, 55] | The AI job ignores the rule (L131); no section column |
| XER hours / 8 = working days | WP-1 | 40 h → 5, 80 → 10, 12 → 2, 20 → 3, 4 → 1, 3 → 0 | Rounding policy (HR-S4) |
| Retention default 5% | WP-4 | 40,000 → retention 2,000, net 38,000 | A project with no default certifies at 0% (HR-C1) |
| Weather warning at 70%+ | WP-7 | 13/20 → 65%, no warning; 14/20 → 70%, warning | Half-days stored as 0 (HR-C11) |
| Quality score | WP-8, WP-9 | 2 major + 3 minor + 1 failed ITP → 21; 6 major → 0 | Form ITPs are not counted (HR-Q3) |
| Activity auto-status | WP-1 | 0 → todo; 1–99 → in progress; 100 → complete; past end and < 100 → delayed | Imported file percent leaks out (HR-P5); dashboards count calendar days (HR-K2) |

Authorisation inside one company is certified as part of each workflow: persona probes, party guests and withheld figures. Tenant isolation is not certified again.

### 1.2 What stays unchanged
- **Earlier checkpoints.** CERT-0, CERT-1 and CERT-2 are not restarted or reopened. The CERT-2 evidence at `01904f5` remains authoritative.
- **The clean copy.** Snapshot `octapm_cert_snap_cert2c` is never written to. CERT-3 starts by restoring the population from it, not by regenerating it.
- **The 14 certified projects.** The `OCTA PHASE21 GREENFIELD` projects are read only, and the EXPECTED figures in `scripts/phase21/snapshot.js` do not change.
- **What CERT-3 adds:** new projects in three companies, and new identities created by invitation. The other 97 companies are fingerprinted before and after, and the two fingerprints must match.
- **Any cross-company finding** during CERT-3 is reported to you at once as a new P0 or P1. It is not filed under CERT-2.

### 1.3 What belongs to other checkpoints

| Checkpoint | Takes from the CERT-3 area |
|---|---|
| CERT-4 billing | Seats and plan gates (any 402 in the small lane); L37 (project limit through templates); the billing seat suite's move to the invitation helper |
| CERT-5 finance | AC definition (L34); stocked-material cost (L35, L36, X-FINANCE-1); money precision (D-FIN-1); currency minor units; definitions of "invoiced" and invoice gross (HR-C4); the budget-revision register's baseline; cash-flow completeness (L115, L120); the population-wide reconciliation and the 0.00 delta |
| CERT-6 web, mobile, files, jobs | Running the migrated Playwright and mobile specs; spec 68 with the exception engine on; drawing-set processing (needs the job worker); notification delivery and realtime; fake-success bulk user actions (users `data-table-bulk-actions.tsx`); D-DQ-1; L11 |
| CERT-7 performance and security | SSO provisioning and its existence oracle (D-SSO-1); MFA enforcement (D-SEC-1); account-existence leaks through registration and sign-in; D-OPS-1; D-PERF-1; OPS-1 |
| Before release | Re-run the six suites that need :55432; D-TEST-1; production e-mail working (ID-h); the C0-3 key rotation |

### 1.4 Working rules (quality-first)
- **Known answers first.** Every expected value is derived on paper before the run and recorded in an answer book. An expected value changes only through a new derivation logged in the journal, never to make a check green.
- **Checks assert, they never just note.** Error codes are asserted exactly and figures are compared in cents. `probe()` is never used without a `check()`. Notes left by the existing drivers are leads, not evidence. Mocked-Prisma unit tests are not evidence.
- **Reproduce before fixing.** Each suspected defect gets a reproduction script that exits 2 while the defect is present. The fix follows, then a green proof, then a mutation that puts the defect back and must turn the proof red.
- **Fix scope.** Only confirmed P0/P1 defects in main workflows are fixed: broken workflows, financial errors, authorisation errors and data loss. P2/P3 findings are recorded and deferred.
- **Rule changes.** No high-risk rule change is made before your decision (§5).
- **How data is built.** Records are created through the API by drivers. Direct database writes are used only where §2 and §3 say so: guarded test fixtures, and in-process calls with an injected time.
- **Exception engine.** It is never switched on in the shared certification API (:5190). Engine proofs run in process with explicit environment objects.
- **AI.** No AI provider is called. The AI BOQ job runs in process against a recorder stub.
- **Long runs** (over 1.5 hours) go detached with the watchdog (§7). One writer uses the certification database at a time. The full jest suite never runs at the same time as proofs or Codex.

---

## 2. Item 1: D-ID-1, invitation-only user add

### 2.1 Decisions

| ID | Question | Recommendation | Why |
|---|---|---|---|
| ID-a | Keep or retire `POST /users` | Keep it for one release as a documented, deprecated alias of the invitation, with the same handler, gate, status and body as `POST /users/invitations` | The mobile team and the scripts call it. One behaviour behind two paths. |
| ID-b | Status code | **201** with the invitation, for every e-mail, on both routes | Today it is 201 for a new account and 202 for an existing one on `/users`, and 201 on `/users/invitations`. The L38-proof checks that expect 202 are recorded as superseded. |
| ID-c | A `password` field in the request | Refuse with `400 USER_PASSWORD_NOT_ACCEPTED` from the validator, before any e-mail lookup, so the answer is the same for every e-mail. Ignore `name` and `phone` and document that the person sets them when accepting. | If the password were silently ignored, an old client would think it had set one. |
| ID-d | Admin password reset | Remove `POST /users/:id/reset-password`, `userService.resetPassword` and the `user.reset_password` transition. Add `POST /users/:id/password-reset-email`. | The new route calls `authService.requestPasswordReset` for the person's own address and always answers `202 {sent:true}`. It is audited, uses the forgot-password throttle, and the admin never sees a token. |
| ID-e | Admin changing another person's sign-in e-mail | **Forbid it.** `PATCH /users/:id` with `email` answers 400 `USER_EMAIL_IDENTITY_OWNED`, whoever the target. | Otherwise an e-mail change followed by forgot-password still lets an admin take over a password, including for outside-company guests whose home is the inviting workspace. It also removes the `EMAIL_EXISTS` oracle on that route. A person who loses their mailbox needs a new invitation. **(assumption: there is no self-service e-mail change with verification today; if there is none, it is recorded as P2)** |
| ID-f | Re-inviting someone already in the workspace | Answer `409 ALREADY_MEMBER` for active **and** suspended members, which is L38's meaning of "part of the workspace"; the admin reactivates instead. Use one code, `ALREADY_MEMBER`, and retire `EMAIL_EXISTS` from user add. | Today `inviteUser` refuses only active members and `createUser` also refuses suspended ones. |
| ID-g | Managing invitations | In scope: `GET /users/invitations` (pending only, scoped to the workspace, `user_management:read`) and `DELETE /users/invitations/:id` (revoke, audited; the link then fails as an expired one does). Resending means inviting again, which already supersedes the earlier link. | With one door, an admin who cannot see pending invitees loses track of them. Today the empty state says "No engineers yet". |
| ID-h | E-mail delivery | Working production e-mail becomes a release gate. No "copy invitation link" fallback for admins. A send failure after the commit gets one stable code for every e-mail (for example `502 INVITATION_EMAIL_FAILED`) and the invitation stays pending. | A copied link would hand the admin the password choice and an existence check. |

SSO auto-provisioning (D-SSO-1) stays outside D-ID-1 and belongs to CERT-7. A display-name hint on invitations: recommended **no**.

### 2.2 Server behaviour after the change
- **`POST /users/invitations` is the single door** for adding a person (`inviteUser`). Its gate is `user_management` submit plus the `user.invite` transition.
- **`POST /users`** (ID-a) runs the same handler with the same gate.
  - `password` and `confirmPassword` are refused (ID-c).
  - The new-identity branch of `createUser` is deleted (`user.service.js:271-320`).
  - The 409 for every existing e-mail when `AUTH_MEMBERSHIP_WRITE=false` is removed (`:264`).
  - Only the `ALREADY_MEMBER` code is used (ID-f).
- **The answer** is the same for a new e-mail, an existing identity in one company, an existing identity in several companies, a closed identity and a former member. It carries the invitation's own fields and `invited: true`. The personal-workspace refusal (`409 PERSONAL_WORKSPACE_CONVERT_REQUIRED`) is also the same for every e-mail.
- **No User row and no membership exist until acceptance.** Acceptance already creates the identity and the membership (`auth.service.js:1186-1520`), and the personal-workspace seat is checked again under the organisation lock at that point.
- **Password routes.** The admin reset route is removed, and the reset-e-mail route is added (ID-d). `PATCH /users/:id` refuses `email` (ID-e). Admin MFA reset stays as it is: home workspace only and refused for shared identities. Without the e-mail change it can no longer complete a takeover.
- **Error catalogue and spec.** `utils/error-codes.js` and the `spec.js` error enum gain `USER_PASSWORD_NOT_ACCEPTED`, `USER_EMAIL_IDENTITY_OWNED` and the revoke codes. `EMAIL_EXISTS` is no longer used for user add.
- **Permissions.** In `shared/permissions.json`, `user.reset_password` is removed or renamed for the reset-e-mail route, and both add routes share one gate.
- **OpenAPI.** Rewrite `POST /users`, drop `/users/{id}/reset-password` (or document its replacement), and add the list and revoke operations. `scripts/validate-openapi.js` must pass.
- **Documentation.** Update `docs/architecture/OCTAPM_MEMBERSHIP_AND_RBAC.md` (§131-145), `docs/user-guide/roles/ADMIN_GUIDE.md` (77-84), `docs/user-guide/OCTAPM_USER_GUIDE.md:335`, `docs/mobile/OCTAPM_MOBILE_API_MAP.md` (30, 53), `docs/mobile/OCTAPM_MOBILE_PERMISSION_MATRIX.md:194` and `docs/architecture/OCTAPM_MULTI_TENANT_ARCHITECTURE.md:65`, plus the register and journal entries.

### 2.3 Web
- **Add person.** The users "Add person" create mode becomes the invitation: no password, confirm, name or phone fields, and one neutral toast. Alternatively the create mode is removed and the dialog is used for editing only.
- **One add action.** A single "Invite" action replaces "Add person" and "Invite by e-mail".
- **Pending invitations.** A new section lists pending invitations with revoke and resend.
- **Reset password.** The reset dialog, its hook and its row action are removed. If ID-d is approved, they become "Send password-reset e-mail".
- **Edit dialog.** The e-mail field becomes read-only (ID-e).
- **Unchanged:** `users-invite-dialog.tsx` and the accept page, apart from small copy edits.

### 2.4 Mobile and other API clients
- **Mobile app:** no UI change. It has no add-person or admin-reset screen, and "Forgot password?" opens the web page.
- **Contract change.** This is a breaking change for API clients and is documented in the mobile API map. `POST /users` no longer returns a user id, and the reset route is gone. A project assignment travels on the invitation's `projectId` and takes effect at acceptance.

### 2.5 Tests and scripts to move
- **Certification scripts.** Add a new-identity helper to `scripts/cert/lib/invitations.js`, following `leads/lib/party-visibility.js:67-82`. It sends the invitation, reads the link with `latestInvitationToken`, accepts with `CERT_PASSWORD` (no bearer), takes the id, then calls `api.forget`.
  - Only the setup of the 12 tracked certification scripts (18 call sites) moves to the helper. What they judge does not change.
  - The checks that assert the old behaviour are recorded as **superseded by D-ID-1**, not as CERT-2 failures:
    - `isolation/l38-invitation-proof.js` check A (201 for a new e-mail);
    - its 202 expectations, if ID-b is approved;
    - the solo admin reset in `isolation/shared-identity-proof.js:68-70`;
    - the reset step of the L39 lead.
  - The five tracked scratch checks (`leads/scratch/*`) stay pinned to `01904f5` as history.
- **Development-database live tests.** `auth-workspaces`, `ent-4-workspace-links`, `integrations-gate` and `organisation-lifecycle` move to invite plus acceptance, or to `createLiveUser`. The direct-add race test becomes an acceptance race test. They cannot run while :55432 is down **(assumption)**, so they join the release carry.
- **Mocked unit tests** (`user-invitations.service`, `module-action-permissions`, `subscription-gate-order`) are updated to the new contract. They are not evidence.
- **Web end-to-end.** `frontend/e2e/support-workspaces.ts` and 16 specs move to a guarded member fixture in `backend/scripts/e2e/`, behind the data-script guard, for specs that only need a member who can sign in. One real onboarding spec reads the link from the API log or a local webhook mail sink. This also repairs specs 40 and 41, broken since L38. They are run at CERT-6.
- **Mobile end-to-end and UAT.** `mobile/e2e/cert-helpers.ts` (`ensureTempUser`) and `pc6-daily-log-quantities.spec.ts` move to the same fixture. `e2e/uat/run-uat-regression.mjs` uses `--use-seeded-fixtures`.
- **Not affected:** `finalize-population.js`, `generate-population.js`, the drivers, the lifecycle sign-ins and self-registration paths.

### 2.6 Risks
1. **Nobody new can join without e-mail.** Production fails closed without a mail provider. Mitigation: ID-h release gate; first-administrator bootstrap keeps its own set-password link.
2. **Self-service reset is the only recovery.** It does nothing for inactive accounts. Mitigation: ID-d's reset e-mail for members; a new invitation for a lost mailbox.
3. **An indirect admin password path remains unless ID-e is approved.**
4. **Neutrality can break on edge paths:** the flag-off 409, the two web toasts, the code mismatch and the suspended-member rule. Each is a proof class (§2.7).
5. **End-to-end fixtures cannot read invitation links.** Mitigation: the guarded fixture (§2.5).
6. **None of the population's people went through onboarding**, because the generator wrote them directly. The population and the cert2c snapshot are unaffected; the D-ID-1 evidence creates its own identities.
7. **CERT-2 proofs need a new setup**, and some checks become superseded. They are recorded as superseded, and CERT-2 is not reopened.
8. **The gates of the two doors could drift apart.** Mitigation: one gate, plus mutation M6.
9. **The API contract breaks for mobile and other clients.** Mitigation: documented.
10. **Anyone holding a forwarded link creates the account.** This is inherent to e-mail onboarding. Links already expire after 7 days, are single use and are superseded by a re-invite.
11. **The unmerged branch `feat/platform-superadmin-v1`** has its own copy of the users route and service. It is checked against D-ID-1 when it merges.
12. **The billing seat suite becomes slower:** one bcrypt acceptance per member. This is expected, not a regression.

### 2.7 Proof and mutation checks

**The proof.** `scripts/cert/cert3/d-id-1-invitation-only-proof.js` (assumed name) runs in process (`CERT_INPROCESS=1`) on the certification database, so it can read the links.
- The inviting workspace is company 052, which already has two suspended members.
- It also uses a personal workspace made by self-registration **(assumption: registration is open outside production)**.
- The number of checks is fixed before the first run. The proof removes its own fixture rows.

| Check | What it proves |
|---|---|
| C1 Same answer | Seven e-mail classes go through both doors: new; existing in one company; existing in several companies (for example `user.c@multi`); closed with another home; former member here; closed with this workspace as home; suspended elsewhere. Status, body keys and values must be identical, apart from id, timestamps and the e-mail. Active and suspended members here get the identical `409 ALREADY_MEMBER`. The personal workspace gets the identical `409 PERSONAL_WORKSPACE_CONVERT_REQUIRED` for new and existing e-mails. |
| C2 Nothing before acceptance | No User row for the new e-mail. No membership, team or party row for any class. No route returns the `existingUser` flag. |
| C3 Password refused | The 400 is identical for every class and writes nothing (invitation count unchanged). In process with `AUTH_MEMBERSHIP_WRITE=false` passed explicitly, every C1 answer is unchanged. |
| C4 No admin password path | The reset route answers 404 for every role. `PATCH` with `email` is refused (ID-e). `password` and `passwordHash` in a `PATCH` are ignored or refused. Every touched person's password-hash fingerprint is the same before and after. The reset-e-mail route answers `202 {sent:true}` for a member and an unknown e-mail alike, and carries no token. |
| C5 Acceptance | A new identity sets its own name and password and can sign in. A second use, a revoked link and a superseded link are refused. An existing identity: the link alone gives 401; its own session works; it gets exactly the offered role. A party guest has a membership only after acceptance. A closed home account reopens only through the link. |
| C6 Invitation management | The list shows pending invitations without any account-existence field. A revoked link is refused and the revoke is audited. A resend supersedes the earlier link. |
| C7 Seat race at acceptance | Two acceptances compete for one free personal-workspace seat. Exactly one wins, and no orphan identity is left for the loser. This replaces `organisation-lifecycle.live.test.js:565-595`. |
| C8 One gate | A template granting `user_management:create` without `user.invite` gets 403 on both doors. |
| C9 Web | A static source check: the add dialog has no password field and shows one toast. |

**Mutations.** Each mutation must turn the proof red:

| Mutation | Must fail |
|---|---|
| M1 restore the direct-create branch | C1, C2 |
| M2 restore the reset route | C4 |
| M3 restore the flag-off 409 | C3 |
| M4 refuse `password` only after the e-mail lookup | C3 |
| M5 write the membership at invitation time | C2 |
| M6 gate `POST /users` by `create` only | C8 |
| M7 allow the admin e-mail change | C4 |
| M8 create the new identity outside the acceptance lock | C7 |

**Regression.**
- `l38-invitation-proof.js`: 54 checks minus those recorded as superseded.
- Every CERT-2 proof that creates people passes again after the helper change.
- A short CERT-2 sentinel: leaks 0, writes accepted 0, 5xx 0, census 0, realtime 117/117.

### 2.8 Review steps
1. Codex reviews this design as an adversary. Each finding is adjudicated in `C:\Temp\octapm-cert\scratch\did1-adjudication.md`.
2. Implement the server, then the proof and mutations M1–M8.
3. Change the web, docs, scripts and fixtures.
4. Codex reviews the diff. Fix what it confirms, then Codex checks the fixes. Stop when no CRITICAL or HIGH finding is open, at most three rounds, then escalate to you.
5. Run `/code-review` (high) on the final diff.
6. Run OpenAPI validation, the backend unit suites, web typecheck, lint and source checks, and mobile typecheck.
7. Commit and push on the certification branch, under its standing rules (no merge of `main`). Update the journal and register: D-ID-1 Fixed.
8. Run the PR Review Toolkit before D-ID-1 reaches the integration branch. The uncommitted generated change to `frontend/src/routeTree.gen.ts` in the worktree stays out of every CERT-3 commit unless a route change needs it.

### 2.9 Recorded outside D-ID-1
- **CERT-7:** D-SSO-1; the account-existence leak through registration (`auth.service.js:351-357`) and sign-in timing; D-SEC-1.
- **CERT-3 identity leftovers:** D-ID-2 (P3) and D-ID-3 (P3) are assessed in WP-0. They are fixed only if reproduction shows P1.
- **CERT-6:** the fake-success bulk invite, activate and deactivate actions (P2).

---

## 3. Representative deep companies

### 3.1 Choice (from `docs/certification/OCTAPM_100_COMPANY_MATRIX.md` and `scripts/cert/lib/spec.js`)

| | D1: **087** Oakmont Constructors | D2: **052** Summit General Contractors | D3: **011** Granite Peak Construction |
|---|---|---|---|
| Size / people | large / 51 active, 1 not | medium / 15 active, 2 suspended | small / 4 |
| Roles | all 9 | all 9 | 4 (PM, site, QS, finance) |
| Plan | enterprise / active / 100 seats | business / active / 25 | individual / active / 5 |
| Project limit / existing | none / 10 (2 archived) | 25 / 10 (1 archived) | 3 / 2 |
| Currency / time zone | EGP / Africa/Cairo | USD / America/Chicago (daylight saving) | INR / Asia/Kolkata (+05:30) |
| Owner | finance (n % 6 = 3) | cost controller (n % 6 = 4) | PM |
| Company administration | PM persona | PM persona and the finance persona (n % 3 = 1) | PM (the owner) |
| Certified lifecycle | yes; its PHASE21 project stays read only | no | no |
| Role in CERT-3 | full depth, every work package | second instance of the core chains, and home of the D-ID-1 proof | reduced lane: four people run the main path |
| Outsider for 404 probes | PM of 088 | PM of 054 | PM of 017 |

**Why these three.** Together they cover:
- all three sizes and three active plans;
- three owner roles and three ways of holding company administration;
- three kinds of time zone: daylight saving, none, and a half-hour offset;
- certified and non-certified companies.

All three bill in two-decimal currencies. KWD and JPY raise minor-unit questions that belong to CERT-5.

**Alternatives:** 093 for 087; 059 or 067 for 052; 007 for 011 (KWD, so CERT-5 questions).

### 3.2 What each must contain (new projects only)

**D1, company 087**

| Project | Dates | Serves | Contents |
|---|---|---|---|
| **087-SCH** "CERT3 Programme" | Starts Monday 2026-01-05, five-day calendar | WP-1, WP-2 | **Programme:** XER file F1 with the 14-activity stage-2 network in hours, three WBS branches, M900 with equal early start and finish, and `phys_complete_pct` 40 on A200. Revision file F1b (A110 = 160 h) for supersede, mapping, one retirement and rollback. **BOQ:** six priced rows in m2/m3. Five are allocated (A110 60,000; A120 30,000; A130 90,000; A310 135,000 = 900 m2; A320 72,000 over two items); one row is optional and one not applicable, and one 72,000 row stays unallocated until the baseline step covers it. **Progress methods:** A110 percent; A120 percent with evidence required; A310 quantity, one item; A320 quantity, two items; A210 weighted milestones 20/30/50; A230 inspection; A300 and A330 not configured. **People and records:** the site engineer is assigned to every activity except A330; a form ITP template with a hold item and an instance on A130; an uploaded photo document; quantity entries in every state; a daily log with a quantities row; a replayed `clientRequestId`; commitment SOV, stock receipt/issue/return, IPC item and payment lines on A310's BOQ item, so all six quantity figures are non-zero; a progress file. **Last:** a tail activity ending in 2027, added only after the CPM and baseline checks, with its own derived figures. |
| **087-IMP** "CERT3 Import parity" | Scratch | WP-1 | F2: rounding, lag and negative-float rows. F3: a start-to-start predecessor that drives the finish (A 80 h, SS + 16 h, then B 24 h), activated. F4: an XER with two projects. F5: Windows-1252 names. F6: a second calendar id. The F1 programme also as P6 XML, MSPDI and xlsx with a calendar column. |
| **087-EV** "CERT3 Earned value" | Starts 2026-01-05 | WP-3 | The F1 programme activated. Approved cost loadings: 60,000 on 01-23, 30,000 on 01-28, 90,000 on 02-13, 135,000 on 03-20, 72,000 on 04-10. Approved progress: A110 100, A120 50, A130 25. Direct costs: A110 50,000 on 01-20 and 10,000 on 09-30; A130 20,000 on 02-10; later 30,000 on A120 on 10-01. A budget revision of +13,000 effective 03-01. Reporting periods 2026-01, 2026-02 and one with a future cutoff; one locked normally and one locked with a PM override. Finally, a 5,000 cost on A140 and then a revision that retires A140. Steps run in answer-book order. |
| **087-COM** "CERT3 Commercial" | Created **without** `defaultRetentionRate` | WP-4, WP-5, WP-6, WP-7 (claims) | Contract value established. A BOQ workbook of at least 130 rows in at least 3 sections. Cost codes and lines for all eight cost types. Commitments: a subcontract with required insurance, one executed on a PM override, and a PO commitment, with commitment COs in every state. Pay applications in every state, including a revoked and re-certified one, a paid one and a final one at the closeout gate. Change events with RFQs to two vendors on one line. Prime COs in every state: one with a split budget allocation, one with allocation links on a split BOQ row, one from an RFI. At least four IPC periods: paid with retention released; part-paid; submitted; draft; PM override; materials on site with a deduction. A retention cap, an advance with recovery, and tax. Cash flow: client, subcontract and direct-cost payments in different months, manual rows and an advance receipt. EOT claims in every state, two of them approved, one linked to a weather delay; `ldRatePerDay` set. A bid package with three bidders, awarded to one who is not the lowest on an override, plus a late bid and a withdrawal. POs in every status: part-delivered then closed short, fully received then closed, acknowledged before delivery, cancelled, and one raised from the award. Two warehouses with bins and a serial item. Receipts with damage and rejection. Issues to an activity and to a cost code only. Reservations, quarantine, transfers (full, short, damaged), returns, and material plan rows linked to PO lines. Direct costs of every type and state. Supplier invoices with a price variance, an over-invoiced service line, one approved before its receipt, and one voided after approval. Approved progress on the allocated activities, for the IPC and pay-application caps. |
| **087-COM-B** | — | WP-4, WP-5 | Project retention 10%, prime contract 7.5%; `PO-00001` collides with 087-COM. |
| **087-COM-C** | — | WP-4 | Contract value only from the BOQ fallback, for the certify gate. |
| **087-FLD** "CERT3 Field & quality" | Relative to the run date | WP-7 (weather), WP-8 | At least 8 activities, with separate ones for a pending, a failed, a voided and a retroactive hold, and a plain one. Locations. `weatherAllowanceDays` 20, set explicitly. A subcontractor party company and a party user brought in by **invitation and acceptance** (the D-ID-1 helper), plus a supplier. Crews of 3 or more workers with different rates and overtime multipliers, one of them 0.5. Timesheets in every variant. 7 days of daily logs covering all six sections, internal and party entries and quantity rows, with one day approved straight from open. Delay entries of 2 h, 6 h and 10 h promoted to weather delays. Manual delays reaching exactly 13 and then 14 contractual days of 20, including half-days, plus one 10-day non-contractual delay. A daily report with equipment on a hold-point activity. A form ITP with 2 hold points and a required inspector signature, with instances in every state, including a closed one later hit by a template edit. Legacy ITPs: failed, waived, passed. NCRs: 2 major and 3 minor across every state (score 21), plus a 6-major variant. Punch items in every state, with a final approver. Observations of every type. Safety: an open near miss, a closed LTI with lost days, an archived near miss. RFIs in every state, including one overdue only by `responseRequiredBy` and one answered after `dueDate`. Submittals: one direct, and one on a 2-step template (QS 3 days, Planner 4 days). Drawing S-1 revisions A to F. A transmittal citing a revision and an activity. A contractual notice letter linked to a weather delay. A meeting with `createTask` action items and a change event raised from an action item. |
| **087-EXC** "CERT3 Controls" | Starts about 2026-06-01, five-day calendar | WP-9 | **BOQ and quantities:** Q1 100 m3 allocated to X10 (quantity method); approved entries 60 + 45, later 113; a CO link of +10 m3. **Money:** L1 10,000 against executed SC-1 10,500; L2 with a typed forecast of 23,000; an IPC certified above earned value on an override; two approved COs with the same description and activity impact; a budget revision linked to `VO-999`. **Periods and cost:** one past and locked, one past and unlocked for more than 7 days, one future; cost loadings so PV > 0; costs on both sides of a cutoff. **Schedule:** a locked baseline and a later revision. **Change and risk:** change events raised from an exception, voided and converted; risks in every state, including overdue and archived, with activity links. |
| **087-HLT** "CERT3 Health" | Past-dated; cutoff 2026-08-31 | WP-9 | PV 90,000, EV 75,000 and AC 80,000 at the cutoff. 1 major NCR (closed) and 1 minor. 1 legacy ITP failed and 1 form ITP failed. An LTI (closed), an open incident, and an incident archived while open. An overdue open RFI, an overdue answered RFI, pending submittals, and no drawings (a variant has IFC and non-IFC drawings). CO1 with `scheduleImpact` 4 and CO2 with link days 6. An at-risk long-lead item. A 50-working-day activity whose calendar-day and working-day finishes fall on either side of today. |
| **087-OTH** "CERT3 Other" | — | WP-9 notifications | A QS, a cost controller, a finance officer, a site engineer and a procurement officer, all staff, assigned **only** here **(assumption: 087 has staff in these roles; confirm from `spec.js`)**. |

Also in 087:
- Permission templates: one member denied `boq:read`; one member with `cost:export` but denied `risk:read`.
- A party guest on 087-EXC with no procurement or change-order read.
- One QS with the commercial notification category switched off.
- Report definitions (private, project and organisation), with a schedule sent to someone other than its owner.
- One fresh certified-lifecycle run (WP-0) **(assumption: the runner makes a fresh project on each full run, as its header says)**.

**D2, company 052**
- **052-SCH-EV:** the F1 programme through to baseline. The core gates of WP-2 (T1, T3, T4 hold point, quantity T2/T3) and WP-3 T1–T4, with the same figures in USD. The reporting zone (America/Chicago) is asserted through `reporting.timeZoneSource`.
- **052-COM:** IPC I1, I3, I4 and I8; pay applications P3 and P4; change events E1 and E2; commitments C1 and C2; PO O2.
- **052-FLD:** quality 21; safety 75; weather 65% then 70%; labour 650.00.
- **Purpose:** the drivers take the company as a parameter. The same answers under a different owner and administration structure show that the answers are not tied to 087's people. The D-ID-1 proof also runs here.

**D3, company 011** (one new project; individual plan limit 3)
- **011-LITE:** the F1 programme, which the PM imports, submits, approves, activates and baselines (there is no planner). A 5-row BOQ with allocations. The site engineer submits progress and the QS approves it. WP-3 T1 figures. One CO. One IPC certified by the QS or PM and paid by finance (the retention-default case). One daily log, one NCR and one RFI.
- **What it shows:** the PM can take every step a missing role would take.
- **Plan gates:** a 402 from a plan-gated module is recorded under CERT-4 **(assumption: the individual plan opens the modules this lane uses)**.

### 3.3 How the companies are built
- **Drivers.** New drivers in `scripts/cert/cert3/build/` (assumed path) use the API only. They sign in as the population personas with `CERT_PASSWORD`. The party user is brought in by invitation and acceptance; the link is read in process or from `CERT_API_LOG`.
- **Every creation is asserted:** status and key fields. A build step that only notes a failure counts as a failed build.
- **Resumable.** Created ids go to `C:\Temp\octapm-cert\state\cert3\<code>.json`, and a resumed run skips what already exists. A killed loader must never create duplicates (learned on 2026-10-02).
- **Generated files.** The XER, P6 XML, MSPDI, xlsx and BOQ workbooks are generated from the answer book, so the files cannot drift from their answers.
- **Order:**
  1. Stop the API.
  2. Restore `cert2c`.
  3. Start the API.
  4. Run the D-ID-1 proof, which removes its own rows.
  5. Run the builders (detached, with the watchdog).
  6. Take the 97-company fingerprint, compared against the one taken before the build.
  7. Take snapshot **`cert3d`**.
- **Time.**
  - Every transaction is dated on or before the run date.
  - Approvals carry real timestamps. A cutoff before the run date therefore sees no approval; WP-3 T3 relies on this deliberately.
  - Rules that depend on the clock are tested in process with an injected `now`, `asOf` or cutoff.
- **No job worker on :5190.** The AI BOQ job, report rendering and the exception jobs run in process by calling their handlers. Drawing-set processing goes to CERT-6.

---

## 4. Work packages, in priority order

**Order and why.** Dependencies come first: the schedule, then progress, then earned value. Money and contract exposure come next: commercial, then supply chain. Then the remaining CLAUDE.md rules and modules. The read-back layer comes last, because it consumes everything else. WP-0 is preparation and runs alongside item 1.

Each work package ends with a "confirm first" list: suspected defects that are reproduced before anything is fixed. Each is classified CONFIRMED, PARTIAL, REJECTED, EXPECTED BEHAVIOUR or TEST GAP. "→ HR-x" means fixing it needs a §5 decision. The severities given are proposals, set after reproduction.

### WP-0 Foundations, and the weak checks of the certified lifecycle (medium)
- **Answer book.** `scripts/cert/cert3/answers.js` (assumed path): every expected figure, with its derivation.
- **Harness rules for every CERT-3 proof.** `check()` only; codes asserted; money in cents. Exit 0 means pass, 2 means a defect is present, 1 means a setup error. Results go to `C:\Temp\octapm-cert\results\cert3\`.
- **Permission probe matrix.** For every transition used in WP-1 to WP-9, the expected allow or deny for each role is read from `shared/permissions.json`. It is probed with the nine personas of 087 on throwaway records.
  - It also probes whether company administration grants module rights; 052's finance persona is a company admin **(assumption: it grants none)**.
  - Any mismatch is a finding.
- **Weak lifecycle checks.**
  - **Read-only verifier.** `cert3/lifecycle-posthoc-verifier.js` reads the 14 certified projects. The database fingerprint must be the same before and after.
  - **Stage edits.** The stage scripts are edited to assert the same things on future runs; no EXPECTED figure changes. The edits are proven by one fresh lifecycle run in 087 with 0 failures.

  | Stage | Asserted (known answer) |
  |---|---|
  | stage2:154 | A140 TF 47 (EF 34, LF 81); A300 TF 20 (EF 61, LF 81); M900 EF 81. With A110 = 20: M900 EF 91, floats unchanged; restored to 81. |
  | stage3:109 | No allocation on B-003; allocations 60,000 / 30,000 / 90,000 / 135,000 / 72,000 = 387,000.00; unallocated 72,000.00 |
  | stage4:167, :170 | PO-A and PO-B lines carry A130 and cost code 02-100; PO-A 1,000.00 and PO-B 650.00, read from a named field that must exist. Changing the unit cost 10 → 10.5 must fail the check (1,050.00). |
  | stage5:82-204 | Commitment goes pending → approved → executed. Pay application submitted → under review → approved, each answering 200. Payment 201 with paid 54,000.00, status paid. Cash outflow 54,000.00. A 409 is accepted only when the record is already past that step. |
  | stage9:135, 153, 218 | Each approval answers 200 with status approved. Official progress: A110 100, A120 50, A130 25. EV from constants: 75,000.00, then 97,500.00. A failed EV report fails the stage. |
  | stage1:86, stage14:56 | Company name matches, type external, and the directory returns the same 4 ids. Location code `<stamp>-GRID-AD`, kind zone, and the RFI points to it. |
- **Identity leftovers.** D-ID-2 and D-ID-3 are reproduced and classified.

### WP-1 Schedule: import, revisions, activation, CPM, baseline, status (high)
**Workflows.** XER, P6 XML, MSPDI and xlsx imports are staged as draft revisions. A revision is submitted, approved or rejected, activated with mapping and retirement, superseded, and rolled back. CPM runs. The baseline is locked. Activities and milestones are created and edited. The project start date and calendar change. Activity status is derived.

**Rules certified.**
- **Conversion.** Hours / 8 with `Math.round`, clamped at 0. Lags rounded the same way. FS, SS, FF and SF links.
- **Imports are staged, never applied.** Out-of-range figures are refused with `SCHEDULE_FIGURE_OUT_OF_RANGE`.
- **Revision state codes:** `INVALID_REVISION_STATUS`, `REVISION_NOT_CURRENT`, `SCHEDULE_NOT_READY`, `REJECTION_REASON_REQUIRED`, `MAPPING_CONFIRMATION_REQUIRED`, `UNMAPPED_REMOVAL_REASON_REQUIRED`, `REVISION_ALREADY_ACTIVE`.
- **Activation.** CPM runs inside the activation transaction.
- **CPM invariants.** TF = LF − EF and TF ≤ 0 means critical. A cycle is refused (`CPM_DEPENDENCY_CYCLE`) with no write.
- **Baseline gates:** `BOQ_REQUIRED_FOR_BASELINE`, `BOQ_VALUE_…`, `BOQ_SCOPE_…`, `REVISION_NOT_ACTIVATED`, and full coverage. The baseline equals the early dates.
- **Roles.** Planner submits; PM approves, activates and baselines; the site engineer and an outsider are refused.

**Evidence.** `cert3/schedule-*.js` runs against the live API on 087-SCH, 087-IMP and 052, plus pure `calculateCpm` in process.

- **T1 (F1, start 2026-01-05).** Every activity must match this table:

  | | A100 | A110 | A120 | A130 | A140 | A200 | A210 | A220 | A230 | A300 | A310 | A320 | A330 | M900 |
  |---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
  | ES / EF | 0/5 | 5/15 | 15/18 | 18/30 | 30/34 | 30/38 | 38/44 | 44/51 | 51/59 | 51/61 | 59/68 | 68/75 | 75/81 | 81/81 |
  | LS / LF | 0/5 | 5/15 | 15/18 | 18/30 | 77/81 | 30/38 | 38/44 | 44/51 | 51/59 | 71/81 | 59/68 | 68/75 | 75/81 | 81/81 |
  | TF | 0 | 0 | 0 | 0 | 47 | 0 | 0 | 0 | 0 | 20 | 0 | 0 | 0 | 0 |

  Exactly 12 activities are critical. TF = LF − EF on every row. A100 ends 2026-01-12; M900 finishes 2026-04-28 (early and late).
- **T2.** A110 at 20 days: M900 EF 91, dated 2026-05-12; floats and ids unchanged. Restored: 81, dated 2026-04-28.
- **T3 and T4 (pure calculation, and live in 087-IMP).**
  - A(10) SS + 2 → B(3): A is critical with TF 0, and B is (2, 5, 7, 10) with TF 5. **This fails today.**
  - FS − 8 variant: B ES 2.
  - FF: B ES clamped at 0, EF 15, A TF 5.
  - SF: B ES 6, EF 10.
- **Cycle and mixed calendar.** A cycle is refused and an `updatedAt` fingerprint shows no change. A seven-day successor of a five-day predecessor must start on or after 2026-01-12 (today it is dated Saturday 2026-01-10).
- **Conversion.** 40 h → 5, 80 → 10, 12 → 2, 20 → 3, 4 → 1, 3 → 0. Lags +16 h → 2, −16 → −2, +12 → 2, −12 → −1. Total float of −80 h → 0.
  - Parity: P6 XML, MSPDI and xlsx stage the same durations, links and lags.
  - An MSP task with negative slack must be critical.
  - A two-project XER is refused, or asks which project.
  - An xlsx dry run writes nothing.
  - The site engineer gets 403; an outsider gets 404 `PROJECT_NOT_FOUND`.
- **Revisions.**
  - Planner and site engineer approval: 403. PM approval: approved.
  - Rejecting an approved revision: 409. Rejecting without a reason: 400.
  - Activation without mapping: 400; with an unmapped activity and no reason: 400 naming it.
  - Full mapping: active. The activation record shows the updated, new and retired counts and dependency count 13. Mapped ids keep their approved progress.
  - Activating again: 409. An older revision: 409. A second import supersedes only the open draft.
  - XER `A100` must map onto the hand-built `A100` by activity code.
- **Baseline.**
  - Refused in this order: no BOQ, zero-rated rows, all rows out of scope, not activated, 72,000 unallocated.
  - Once covered: 14 activities locked, with baseline equal to early dates (A300 51/61, M900 81/81) and one `BASELINE_LOCKED` audit event. The planner gets 403.
  - After A110 = 20: EF 91 against a baseline of 81. A second baseline supersedes the first.
- **Dates and status.**
  - Renaming M900 after CPM: expected 200 (today 400).
  - Readiness date check with M900: expected to pass (today it fails).
  - Start moved to 2026-01-12: per HR-S6.
  - `deriveActivityStatus` at its boundaries, with now = 2026-06-01T00:00Z. An end date equal to now is not delayed.
  - Live statuses agree across `/activities`, `/schedule`, the XLSX export, the report source, search, lookahead and assistant retrieval.
  - A200's file percent of 40, never approved, must show as 0 everywhere (fails today).
  - An unapproved 60 changes nothing.

**Mutations.** `tf <= 0` changed to `< 0`; the SS branch of the backward pass dropped; the BOQ baseline gate dropped; `REVISION_NOT_ACTIVATED` dropped; a staged import writing activities directly.

**Existing evidence reused.** `cpm.service.test.js` and `activity-status.test.js` (pure functions, so valid); stage2 and the snapshot (12 critical); the revision states in `drivers/structure.js`. The PC-4 live suites on the development database are not counted.

**Confirm first.**
- **Milestones block approval and baseline:** CPM stores start = end, the readiness date check fails it, and every later PATCH answers 400. Proposed P1 (D-FUN-2 generalised) → HR-S2.
- **LF is not capped** at the project finish → HR-S1.
- **A staged revision is judged on the file's own float** → HR-S3.
- **Activation sets `activityCode` to null and the budget to 0**, and mapping matches by name only (L118-related). Proposed P1, data loss on re-import. This is a defect fix.
- **L124:** a hand-built programme cannot be approved or baselined → HR-S8.
- **The imported file percent leaks out** as progress → HR-P5.
- **A start or calendar change does not recompute CPM**, and the baseline moves with it → HR-S6.
- **Mixed calendars** → HR-S5.
- **Two-project files are merged; files are read as UTF-8 only; rounding** → HR-S4.
- **Concurrent activations** are not serialised (low).

### WP-2 Progress (PC-6): gates, ITP hold points, quantity method, bulk and import (high)
**Workflows.** Progress is submitted, approved and rejected through the single writer. The evidence gate, the hold-point gate and the method lock apply. Quantity entries are made, bundled and approved. Daily-log quantity rows create entries. Bulk progress is one transaction. Progress import acts under the importer's own authority. Daily-report approval runs through the progress gates. Form ITPs are completed, reopened and voided.

**Rules certified.**
- **Single writer.** `progress.service.js:2171` is the only writer of official progress, and earned value reads approved progress only.
- **Submit.** Allowed to PM, planning engineer, site engineer and quality engineer, with an assignment unless PM or planner (`ACTIVITY_PROGRESS_ASSIGNMENT_REQUIRED`).
- **Approve.** Allowed to PM, planning engineer and QS. Approvals are serialised per activity and idempotent. Other refusals: `PROGRESS_NOT_APPROVABLE`, `APPROVED_PROGRESS_LOCKED`.
- **Gates:** `PROGRESS_EVIDENCE_REQUIRED` at submit and approval; `ITP_HOLD_POINT_OPEN`; `PROGRESS_METHOD_LOCKED` and `PROGRESS_METHOD_MISMATCH`.
- **Quantities:**
  - entry refusals: `QUANTITY_INVALID`, `QUANTITY_NEGATIVE`, `QUANTITY_UNIT_MISMATCH`, `QUANTITY_ITEM_NOT_ALLOCATED`;
  - lifecycle: entries locked or bundled after use; `QUANTITY_ENTRIES_REQUIRED`; `QUANTITY_NO_ENTRIES_TO_BUNDLE`;
  - the `QUANTITY_BELOW_OFFICIAL` warning; replay by `clientRequestId`;
  - the six quantity figures (installed, committed, received, issued, certified, paid) are kept apart per unit and withheld without `boq:read`.

**Evidence.** Proofs run on 087-SCH and 052. The setup's EV is 0. Allocations: A110 60,000; A120 30,000; A130 90,000; A310 135,000 (900 m2); A320 72,000.

- **T1.** The site engineer submits A110 at 40%. Official progress stays 0 and the EV report is byte-identical. Site approval: 403. QS approval: official 40, **EV 24,000.00**. Approving again: 200, still one row. Rejecting the approved one: 400 `APPROVED_PROGRESS_LOCKED`.
- **T2.** Site on A330: 403. Planner override: 200. Random id: 404. Outsider: 404 `PROJECT_NOT_FOUND`.
- **T3 (A120 with evidence required).** Submitted without evidence: 400, nothing written. As a draft: 200. Approving that draft: 400. With an uploaded document: **EV 39,000.00**.
- **T4 (hold point on A130).** Submit 25%. Approval: 409 with one hold point, state pending; EV byte-identical; `/forms/hold-points` shows 1 open.
  - Answer "fail" and complete: approval 409, state failed.
  - The quality engineer reopens with a reason, answers "pass" and completes: approval 200, **EV 61,500.00**.
  - Void with a reason releases the hold. Void without a reason: 400 `FORM_REASON_REQUIRED`. Site engineer void: 403.
  - Rule probes, recorded: an in-progress instance answered "pass", and an "na" answer.
  - The retroactive template edit, the required signature (`FORM_INCOMPLETE`) and the weekly recurrence (D + 7).
- **Daily-report approval** with an open hold: 409, the report stays submitted and official progress is unchanged. After the hold is released: approved.
- **T5 method lock.** A110 to quantity: 409. A110 to percent: 200.
- **T6 and T7, rule probes.** Approving an older, lower submission. A quantity submission on an unconfigured activity that already has approved percent progress. Approving on an activity retired by activation.
- **Quantities (A310).**
  - Refusals, each leaving EV byte-identical: typed 0 → 400 `QUANTITY_INVALID`; a bare percent → 400 `QUANTITY_NO_ENTRIES_TO_BUNDLE`; the percent method → 409 `PROGRESS_METHOD_MISMATCH`.
  - Typed 450: 50%, one entry created, **EV(A310) 67,500.00**. Typed again: 409.
  - A 90 m2 entry bundled: installed 540, 60%, **81,000.00**.
  - Entry refusals: m3, −5 and an item not allocated to A310 are refused. PATCH of an approved entry: 409. Replay: `replayed:true`, same id.
  - Daily log with 30 m2: exactly one entry. Bundled and approved: 570, 63.333%, **85,500.00**.
- **Quantities (A320).** 50 of 600 = 8.333%. Typed 40 then warns `QUANTITY_BELOW_OFFICIAL` (official 50, typed 40); after approval 6.667%.
- **Quantity view for A310's item.** Installed 570, committed 900, received 1,000, issued 550 (600 issued, 50 returned), certified 500, paid 250. A member without `boq:read` gets `QUANTITY_FIGURES_WITHHELD`.
- **Bulk and import.**
  - A mixed batch: 409 with `details.batch {index:1, written:0}`. A random id: 404 with its index. Site including A330: 403, nothing written.
  - Progress XER uploaded by the site engineer: submissions only, EV byte-identical, the A310 row refused. Uploaded again: `already_pending`.
  - The same file uploaded by the PM is approved through the writer; the open hold point keeps its row pending.

**Mutations.** Remove the hold-point check (`progress.service.js:2086-2098`); remove the evidence check at approval; make the submit-permission check return early; drop the idempotent return for an already-approved submission; drop the method-stands check; make `openHoldPoints` return `[]`; remove the negative-quantity guard; split the bulk transaction.

**Existing evidence reused.** Stage9 and the snapshot (EV 97,500). The PC-6 live suites on the development database are a reference only; they run in the release carry. `drivers/progress.js` notes are leads.

**Confirm first.**
- **A hold point is released by the answer alone**, "na" counts as passing, and any scheduled ITP blocks the activity → HR-Q1. Template edits act retroactively → HR-Q2. Proposed P1 (quality-gate bypass).
- **Approving a lower figure lowers progress silently** → HR-P1.
- **The method lock can be bypassed** on unconfigured activities → HR-P2.
- **Approval on retired activities** → HR-S9.
- **Text-only evidence** → HR-X1. PUT on the progress method resets omitted fields → HR-P3.
- **Self-approval** → HR-P4.
- **Replay with a different payload** returns the stored entry (low).

### WP-3 Earned value, reporting periods, forecast (high)
**Workflows.** The EV report (ad hoc and per period), creating and locking periods (normal and with an override), the default period, cost-loading approval, budget revisions and forecast.

**Rules certified.**
- **PV** comes from approved loadings up to the cutoff date.
- **EV** is the approved allocation times the latest progress approved by the cutoff instant.
- **AC** follows the L34 question.
- **The formulas:** SPI, CPI, EAC, SV, CV, ETC. Alerts fire below 0.9 only. The cutoff is the end of the reporting date in the project's time zone.
- **Periods.** Code and date refusals. Lock roles: PM and finance, with `REPORTING_READINESS_BLOCKED` and `…OVERRIDE_FORBIDDEN`. A PM override is audited. A locked period is served from its snapshot and never recomputed. Locking again returns the stored snapshot. Loadings in a locked period are refused (409).

**Evidence.** Proofs run on 087-EV and 052, plus in process.

- **T1 (cutoff today).** BAC 387,000.00, PV 387,000.00, EV 97,500.00, AC 80,000.00. SPI 0.251938 (alert); CPI 1.21875 (no alert). EAC 317,538.46; SV −289,500.00; CV 17,500.00; ETC 237,538.46.
- **T2.** Add 30,000 on A120 dated 2026-10-01: AC 110,000, CPI 0.886364 (alert), EAC 436,615.38.
- **T3 (L34).** Cutoff 2026-02-28: PV 180,000.00 and EV 0. AC is **expected 70,000.00**; the product gives 20,000.00. This stays red until L34 is fixed.
- **T4 (in process).** SPI 0.9 gives no alert. CPI 0.9 gives no alert and EAC 430,000.00. AC 100,001 gives an alert. EV 0 with AC > 0 gives CPI 0 and EAC = BAC with its basis stated. PV 0 gives SPI null and no alert.
- **T5.** A budget revision of +13,000 gives BAC 400,000.00. Deleting it (L112) is expected to be refused or audited.
- **T6 (L118).** Cost on A140 and then retiring it: record AC against the ledger.
- **T7.** Draft, submitted and rejected submissions leave the report byte-identical (hash of the JSON without `asOfDate`).
- **Periods.**
  - Duplicate code: 409. End before start: 400.
  - Lock as planner: 403. Finance while blocked: 409. Finance with an override: 403. PM with a reason: snapshot equal to the open report (PV 180,000.00; AC per L34) and one OVERRIDDEN audit event.
  - After the lock: a back-dated cost and a new approval leave the period report byte-identical, while the cutoff-date report changes. Locking again gives the same snapshot id and lock time. A loading in the locked period: 409.
  - In process, the default period: on 2026-03-05 it is 2026-02; on 2026-04-01 it is 2026-03.
  - A lock before the cutoff (L113) is recorded.
- **Forecast (in process).**
  - An activity at 20% with as-of 2026-06-01: projected finish 2026-10-03, slip 125 days.
  - SPI 0.5 with planned finish 2026-07-01: the EV-based finish is 2026-07-31.
  - L106: budget lines expected `[]`.
  - The site engineer sees no money fields.

**Mutations.** `< 0.9` changed to `<= 0.9`; a locked period recomputed instead of served from its snapshot; the readiness gate skipped on lock; EV reading non-approved progress.

**Existing evidence reused.** Stage9 (EV, CPI) and the snapshot (97,500); the L34 lead script (exits 2 today).

**Confirm first.**
- **L34**, confirmed P1 → HR-E1.
- **L118** → HR-S9.
- **L112:** approved budget revisions can be edited or deleted without audit.
- **L113** → HR-E2.
- **L106:** the forecast reads `revised`, a field the register does not emit. Defect fix.
- **Low:** concurrent locks; the actor role recorded on cost loadings.
- **EAC at CPI 0** → HR-E3.
- **No alert beyond the report flag** → HR-E4.

### WP-4 Commercial core: change, commitments, IPC, pay applications, cash flow (high)
**Workflows and rules.**
- **Change events:** open → pricing → priced → converted, closed or void. Converting creates a prime CO and commitment COs.
- **Prime COs:** draft only at creation; submit and approve need impact summaries, an activity and a document; an approved CO is locked; approval writes BudgetRevision `BR-<ref>` and the budget-line changes.
- **Commitments:** the state machine; insurance and executed-agreement gates; the SOV is locked after approval; committed cost posts only when executed; commitment COs.
- **IPC:** items come from approved allocations; caps by approved progress and variation; the certify gate needs an established contract value; a PM override needs a reason; certification settles retention, the cap, advance recovery, deductions and tax; the invoice, payment and retention release; the transitions; client money never posts to the cost ledger.
- **Pay applications:** one open application per commitment; caps; the gross posts to the ledger with revision keys; revoking writes mirror entries; the payment ceiling.
- **Cash flow:** rebuilt from payments, automatically after a payment.

**Evidence.** Proofs run on 087-COM, -B, -C and 052; figures are in cents.

- **Change.**
  - E1: lines of 6,000 + 4,000; A's RFQ is quoted 9,500 and accepted; the event converts to a draft CO of **9,500.00**. Converting again, PATCH and void are refused with their codes.
  - E2: two concurrent converts give one 2xx, one 409, one CO, and a pending value of +9,500.00 (not 19,000.00). A refusal midway leaves no orphan CO.
  - E3: the refusal codes; reject, reopen and archive; archiving a pending CO lowers the pending value by 40,000.00.
  - E4: a split of 6,000 and 4,000; a split that adds up to the wrong total is refused with `CHANGE_ORDER_ALLOCATION_MISMATCH`.
  - E5: pending 40,000.00, approved 125,000.00, revised 2,125,000.00.
  - E6: a deductive CO is refused today → HR-C13.
- **Commitments.**
  - C1: every refusal code.
  - C2: committed 100,000.00; a CO of +10,000 counts only once approved (110,000.00).
  - C3: a project with no default and no commitment rate gives 5; a project at 7.5 gives 7.5.
  - C4 (L108): PO commitment cost lands on two different lines.
  - C5 (L116): retention cannot be released.
- **IPC.**
  - I1: certifying 40,000 should give retention 2,000 and net 38,000 (today 0 and 40,000).
  - I2: the contract rate of 10 gives net 36,000.00.
  - I3: the A130 limit should be 600 / 90,000.00 (today 650 / 97,500).
  - I4: the state-machine refusals.
  - I5: the certify gate.
  - I6: the over-certification override; the overage is 7,500.00.
  - I7: the cap gives 8,500.00 and net 89,000.00; advance recovery gives net 78,000.00.
  - I8: payments, release, and cash flow without a manual rebuild.
  - I9: statement and receivables must agree.
  - I10: gross − retention = net (102,500 − 9,750 = 92,750).
  - I11: no route back from submitted.
  - I12: PM cannot record a payment (L211).
- **Pay applications.**
  - P1: the gates.
  - P2: over-claim 10,000.00; exceeds the schedule.
  - P3: approval posts +50,000.00; revoking writes −50,000.00; re-approval posts under suffix r1; a revoke by the QS gives 403.
  - P4: the payment ceiling; cash outflow +20,000.00 without a rebuild.
  - P5: compliance; P6: final application closeout; P7: reject and reopen.
- **Cash flow.**
  - CF1: 2026-08 outflow 8,500.00; 2026-09 inflow 80,000.00 and outflow 54,000.00; net 17,500.00.
  - CF2: advance receipts (L115).
  - CF3: manual rows; deleting a system row.
  - CF4: concurrent rebuilds.
  - CF5: roles.

**Mutations.** The retention-default null guard; the variation-scope match; the convert lock; the one-open pay-application rule; the pay-application payment ceiling; the lock on approved COs.

**Existing evidence reused.** Stages 5, 8, 10 and 14 and the snapshot: CO budget effects, gross, retention and net, receivables. Driver CHECK notes (variation 325/325, paid status 245, statement vs receivables 245) are leads.

**Confirm first.**
- **Retention null → 0%** (proposed P1) → HR-C1. L114 → HR-C1.
- **Variation allowance leaks across allocations** (proposed P1) → HR-C2.
- **Non-atomic convert** (L199; proposed P1, duplicate COs): defect fix. Two accepted quotes, and events stuck after their CO is archived → HR-C12.
- **"Paid" is one-way; no route back from submitted; empty periods** → HR-C3.
- **Statement vs receivables; invoice gross** → HR-C4 (CERT-5).
- **A commitment CO on a voided parent** can still be approved: defect.
- **L116, L199** → HR-C13. L108: defect. L115, L120 and legacy valuations → CERT-5.

### WP-5 Supply chain: bids, award, PO, goods receipt, inventory, direct costs, three-way match (high)
**Workflows and rules.**
- **Bid packages:** draft → open → closed → awarded or cancelled; prequalification gates; late bids refused; withdraw and resubmit; award confirmation creates the commitment; an order is raised from the award.
- **Purchase orders:** the lifecycle and its refusals; closing short with force and a reason.
- **Goods receipt (both doors):** the refusal codes; stock valued at the receipt price; rejected quantity never stocked.
- **Inventory:**
  - issues need an activity or cost code and use available stock, at the weighted average;
  - reservations, quarantine, adjustments with notes, transfers with shortfall write-off;
  - returns are bounded (L36);
  - material plan usage is bounded by the issued quantity.
- **Direct costs:** the state machine; one posting per line key; void writes mirror entries; payments are capped by the balance; the three-way match verdict.

**Evidence.**
- **Bids, award and order.**
  - R1: package and portal states.
  - R2: two concurrent award confirmations give one commitment and one 409.
  - R3: ordering twice from one award should give 409 (today a second PO).
  - R4: the order's lines keep the cost code, budget line and BOQ item.
  - R5: prequalification limits.
- **Purchase orders and receipts.**
  - O1: transition refusals.
  - O2: 100 ordered, 60 received, status partial. Close: 409 with outstanding lines. Force without a reason: 400. With a reason: **expected 200 closed**, then receiving more gives 409 `PO_NOT_ISSUED`. A fully received order closes without force (both fail today).
  - O3: cancel after a delivery gives 409 `PO_CANCEL_AFTER_DELIVERY`.
  - O4: receipt codes; 10 accepted and 2 rejected gives stock +10 and rejected 2.
  - O5: the receivable list is {issued, acknowledged, partial}.
  - O6: two projects with `PO-00001`: 409 or `projectId` required.
  - O7: fields the procurement door ignores.
- **Inventory.**
  - N1: issue codes; reserve 50, then issue 41 gives 409 and 40 succeeds.
  - N2 (L36): a return never issued gives 4xx and stock stays 100 / 1,000.00.
  - N3 (X-FINANCE-1): credit 50.00, activity 50.00, stock 15 / 190.00.
  - N4: transfer of 10 at 11: 7 received and 1 damaged; value conserved, 110.00 = 77.00 + 33.00 written off.
  - N5: quarantine.
  - N6: material plan: issued 60, usage 50 accepted, usage 70 gives 409 (today every usage is refused).
  - N7: adjustment and damage codes.
- **Direct costs and the ledger.**
  - D1: states.
  - D2: lines of 1,000, 2,000 and 3,000 give +6,000.00 in three keyed entries; concurrent approval posts once; void writes −6,000.00.
  - D3: payments; cash flow without a rebuild.
  - D4 (L35): invoice before receipt: ledger expected 1,000.00.
  - D5 and D6: the match gate (HR-C5).
  - D7: after every test, reconciliation balanced and projections equal to the ledger.

**Mutations.** The new PO-close transitions; the award lock; `RECEIPT_OVER_ORDER`; `INV_INSUFFICIENT_AVAILABLE`; the one-posting idempotency of direct costs.

**Existing evidence reused.** Stages 4, 7, 11 and 12 and the snapshot: on hand 90 at 11 = 990; the three-way-match variance; the RFQ ranking 69,000 / 74,400 / 71,400.

**Confirm first.**
- **Non-atomic award confirmation** (proposed P1, two commitments): defect.
- **A second order from one award**: defect.
- **Award orders lose their coding**: defect.
- **A PO cannot be closed after any delivery** (D-FUN-1) → HR-C8.
- **The receivable list**: defect.
- **The reference scan crosses projects** (proposed P1, authorisation within the company) → HR-C9.
- **Ignored fields; the issued quantity is never raised** → HR-C7.
- **L35, L36, X-FINANCE-1** → HR-C6 (CERT-5).
- **Stock issues have no idempotency key** (L199).
- **The match is advisory, and mixed lines downgrade the verdict** → HR-C5.
- **L107, L119.**
- **Deleting an activity cascades PO lines** without recomputing the order value (D-FUN-1).

### WP-6 BOQ, allocations, budgets and cost codes (medium)
**Workflows and rules.**
- **BOQ upload:** dry run, import and re-upload; BOQ revisions are reviewed and locked; uploads after the lock are `comparison_only`; the AI breakdown job; the over-60-row rule.
- **Allocations:** the allocation state machine, capacity, mapping rules, bulk and mapping-file import, coverage.
- **Budgets:** cost codes and budget lines; derived actuals; the Original-budget lock; transfers; line revisions; the budget-revision register.

**Evidence.**
- **Upload.**
  - U1: a dry run of the stage-3 rows (total 459,000.00) writes no rows, revisions, documents or jobs, and leaves the AI usage count unchanged.
  - U2: import, then B-002 changed to 160: total 467,000.00. Omitting B-005 → HR-C14.
  - U3: `MISSING_COLUMNS`; nothing written.
  - U4: after the lock, `comparison_only`, and PATCH gives 409.
  - U5: the pure chunker gives [60, 60, 10], [50, 50, 30], [60, 55], 1 batch for 60 rows and [60, 1] for 61. After the L131 fix, the AI job against the recorder stub makes 3 calls of at most 60 rows each.
  - U6: L121.
  - U7: roles.
- **Allocations.**
  - A1: exact codes.
  - A2: the state machine.
  - A3: coverage: allocated 387,000.00, unallocated 72,000.00, 84.31% by amount.
  - A4: bulk: 1 created, 2 failed with their codes.
  - A5: mapping import dry run, apply and undo.
  - A6: mapping-rule warnings.
- **Budgets.**
  - B1: seven typed lines totalling 28,000.00; reconciliation balanced.
  - B2: guards.
  - B3: transfers: 100,000.01 gives 409; 20,000 moves 80,000 / 120,000.
  - B4: line revision.
  - B5 (L109).
  - B6: budget-revision running totals in effective-date order: BR-B 2,005,000.00, then BR-A 2,015,000.00.
  - B7 (L110).

**Mutations.** Dry run writes; the capacity check; `BUDGET_TRANSFER_EXCEEDS`; the Original lock.

**Existing evidence reused.** Stage3 (5 rows, 459,000.00; 7 lines; 1,700,000.00), stage8 and the snapshot.

**Confirm first.**
- **L131, L121, L130 and the missing section column** → HR-C14.
- **Running totals out of order** on 222 companies: defect fix.
- **L109–L112.**
- **Rejected allocations cannot be resubmitted** → HR-C17.
- **Seven or eight cost categories** → HR-C18.

### WP-7 Contract time: EOT and the weather 70% rule (high)
**Rules certified.**
- **EOT transitions** go only through the workflow actions. Proof is required: at least one affected activity and one document.
- **Rejection** needs a reason.
- **Approval** records cumulative approved days and a recommended revised completion date.
- **Weather:** allowance = `weatherAllowanceDays` (or 20); consumed % = contractual days / allowance; warning at 70% or more.
- **Promotion from the daily log** (WP-8) feeds these rows.

**Evidence.** EOT on 087-COM; weather on 087-FLD and 052-FLD.
- **EOT states (T1)**, every code.
- **T2.** Completion 2027-06-30 and 10 days approved: recommendation 2027-07-10, cumulative 10. A planner PATCH to 30 is **expected 409** (today 200).
- **T3.** Plus 5 days: cumulative 15, recommendation 2027-07-15.
- **T4.** Two zero-float activities on one chain: impact expected 10 and LD 0.00 (today 20 and 10,000.00).
- **T5.** Float 4 against a 10-day delay: impact 6 and LD 6,000.00.
- **Weather boundaries:**

  | Allowance | Below the line | At the line |
  |---|---|---|
  | 20 | 6 + 7 = 13 → 65%, no warning, 7 remaining | 14 → 70%, warning, 6 remaining |
  | 30 | 20 → 66.67%, no warning | 21 → 70%, warning |
  | 10 | 6 → no warning | 7 → warning |

  A non-contractual 10 days adds nothing.
- **Fractional days.** 28 delays of 0.5 day should give 70% and a warning (today 0%). 1.5 should be stored as 1.5 (today 1).
- **Allowance 0** should mean 0 (today it is treated as 20).

**Mutations.** `>= 70` changed to `> 70`; the approved-EOT lock.

**Existing evidence reused.** None that asserts these rules. 558 driver notes record the truncation of half-days. Lifecycle logs record 0.25 days stored as 0.

**Confirm first.**
- **Fractional days truncated** (proposed P1) → HR-C11.
- **Approved claims stay editable; LD is summed over activities; the project date never moves** → HR-C10.
- **Allowance 0 treated as 20; the warning is only a flag** → HR-C11.

### WP-8 Field, quality and documents (medium/high)
**Workflows.** Daily logs and reports, timesheets and crews, NCRs and the quality score, punch items and observations, safety, RFIs, submittals, drawings, transmittals, correspondence, meetings and tasks. Hold points are in WP-2.

**Evidence.** Proofs on 087-FLD and 052-FLD; each figure is derived on paper.

- **Daily logs.**
  - Weather promotion of 2 h, 6 h and 10 h gives 0.5, 1.0 and 1.5 days. Promoting twice: 409.
  - An approved day: PATCH, entry add and entry delete each give exactly 409 `DAILY_LOG_APPROVED`.
  - Manpower: 5 × 8 internal plus 3 × 10 submitted party hours, with 2 × 8 rejected, gives Steelfixer 40, Carpenter 30, Labourer absent, total 70 man-hours and 8 workers.
  - Party lock: 409 `DAILY_LOG_SUBMITTED`. Rejecting without a reason: 400.
  - The timesheet week summary for A130 and the manpower report agree at 40.
  - Approving from open (recorded).
- **Timesheets.**
  - 8 h regular + 2 h overtime + 1 h double at 50 gives **650.00**, booked to labour from source timesheet.
  - A multiplier of 0.5 gives 100.00 for 2 h of overtime.
  - Reopening a 2,000.00 sheet reverses it exactly with 5 mirror entries; re-approval leaves one posting.
  - Reject, edit and approve gives **1,750.00**.
  - 25 h: 400. Crew prefill gives 3 × 8 h. The same crew and date twice: 409.
  - A rate change between submit and approval (recorded).
- **Quality.**
  - **21** on the quality dashboard, health and the workspace dashboard. 6 major gives **0**. Closing a major NCR leaves 21.
  - Reject and reopen codes.
  - Probes (recorded): a severity downgrade after closure (21 → 33); evidence wiped before approval; text-only evidence; a legacy ITP moved from failed to passed (+15); hard deletes.
- **Punch items.**
  - The final-approver gate and its bypass.
  - The known mix gives open defects 6 (drafts are counted) and open observations 2.
  - The full illegal-transition table.
- **Safety.**
  - Health 75 (today 70), the workspace dashboard 75, the quality dashboard 2 incidents with 1 open.
  - A fatality gives 0.
  - An LTI edited after closure (recorded).
- **RFIs.**
  - Rewriting the official response after closure should give 409 (today 200).
  - Reopen: revision +1.
  - The overdue basis on each surface.
  - A schedule impact of 3 days reaches the activity link.
- **Submittals.**
  - Submit-by dates 2027-01-04 and 2027-01-11.
  - Impact days = ceil((reviewedOn + 14 days − need-by) / 1 day).
  - PM approval while steps are pending (recorded).
  - Response code reset on a new cycle.
- **Drawings.**
  - The storeman's revisions are exactly ['B'].
  - Approving without review, approving out of order, approving a superseded revision (409), and superseding without a reason (400).
- **Transmittals, correspondence, meetings and tasks.**
  - The transmittal's activity link and revision.
  - The distribute bypass through PATCH (recorded).
  - Action-item identity across edits; a duplicate task from `createTask`.
  - L213.

**Mutations.** Quality weights (8 → 10 must give 15); dropping the clamp (−20); the manpower status filter (86); the double-time multiplier (600.00); the punch final-approver check; the `isLatest` revision filter; the review-days term in submit-by (2027-01-11); the archived filter in the quality dashboard.

**Existing evidence reused.** Stages 13 to 18 and the snapshot (quality 65, labour 2,000.00, 40 man-hours, document control). Driver notes on 271/325 safety runs and 558 weather runs are leads.

**Confirm first.**
- **Fractional promotion** → HR-C11.
- **Approval from open or of an empty day; reopen without a reason; contractual weather delays created by site staff** → HR-F4.
- **The promotion is not one transaction** (two writes outside one transaction): defect.
- **Timesheet hour cap, rate timing, inactive workers** → HR-F5.
- **NCR and safety edits after closure** → HR-Q5. Evidence → HR-X1. Hard deletes and legacy ITP status → HR-Q4.
- **Punch final-approver bypass** → HR-F3.
- **Health counts archived incidents**: a metric aligned with the other dashboards, not a rule change.
- **RFI official response editable after closure**: defect.
- **Health's RFI overdue basis** → HR-K1.
- **Submittal step bypass** → HR-F1. A stale lead-time link: defect (P2).
- **Drawing order** → HR-F2.
- **Meetings** → HR-F6. Distribution rows always say "sent": P2.
- **L213, L146, D-VAL-1** (P3).

### WP-9 Controls and reporting (high)
**Workflows.** Exception evaluation and handling, notices, workflow notifications, the two 7-dimension health views, the project XLSX export, the report builder, audit history, the risk register and schedule history.

**Evidence.** Exception proofs run in process with explicit environment objects. The shared certification API keeps the engine off.

- **T1 (dry run over the 14 certified projects; writes nothing).**
  - `errors []`, `skipped []`, zero rows of the quantity kinds.
  - Exactly 3 `budget_truths_disagree` rows:

    | Pair | Measured gap | Paper derivation |
    |---|---|---|
    | Register vs EV BAC | 1,313,000.000 | Register revised 1,829,500 = 1,700,000 + 125,000 + 4,500; EV BAC 516,500 = 387,000 + 129,500 |
    | Register vs contract | 300,000.000 | Contract 2,129,500 = 2,000,000 + 129,500 |
    | EV BAC vs contract | 1,613,000.000 | — |

  - The 14 plans are identical apart from ids.
- **T2 and T2b (087-EXC).**
  - Quantity: 105 against 100 is a warning; 113 is critical. A CO link of +10 m3 brings it back to a warning.
  - `committed_over_budget` 10,500 against 10,000: warning. `forecast_over_revised` (L2): critical.
  - One duplicate-CO row (measured 2, limit 1). One orphan link.
  - A second run opens nothing. Switching the method resolves the row as `not_comparable`.
- **T2c.** Stale progress at 15 days against a limit of 14. A period unlocked 8 days against a limit of 7.
- **T3 (slip from the data date).** Measured 7. A dismissal made through the API should hold; today the row reopens.
- **T4.** Concurrent evaluations.
- **The switch** is on only for exactly `true`.
- **Must-not invariants.** A fingerprint covers COs, budget lines, reconciliation, CPM figures, progress counts, and counts of change events, audit, history, outbound events, notifications and jobs. An evaluation changes only exception rows. Mutation: a budget-line write inside the plan.
- **Handling.** Review, snooze bounds, dismiss and reopen with `reopenedFrom`, raise (201, then 409 `EXCEPTION_IN_CHANGE`), void releases the exception, convert, two concurrent converts, BOQ withholding.
- **Notices.**
  - A critical opening notifies exactly the assigned PM and QS.
  - Escalation gives 4 notices; the site engineer without `boq:read` gets 0.
  - A row that escalates while snoozed gets 0 (recorded).
  - Trigger spy counts follow the trigger rules.
- **Workflow notifications.**
  - `commitment.executed` reaches exactly {creating QS, assigned cost controller, assigned finance}; the staff on 087-OTH get 0 (today they are notified).
  - The same scope for pay applications and drawing sets.
  - Progress fan-out; ITP failure notices; preference opt-out.
- **Health (087-HLT).**
  - SPI 0.8333 gives a schedule score of 60; CPI 0.9375 gives a cost score of 80.
  - Commercial: 91 on the project card against 94 on the workspace dashboard.
  - Quality: 42 by rule against 57 in code.
  - Safety: 75 against 70. Document control: 90 against 100. Delayed: 0 against 1. Workspace schedule with an overdue risk: 55.
  - The party guest sees supply-chain top risks (recorded).
- **Export.**
  - 6 sheets; 14 rows; 12 critical. WBS: 5 activities / 34 days, 4 / 29, 5 / 32.
  - A retired activity and an archived risk must be excluded (today both appear).
  - A gate for each sheet.
  - XER round trip: A110 80 h = 10 days.
- **Report builder (certified project, read only).**
  - 14 activities: complete 1, in progress 2, todo 11; total duration 95.
  - Original 1,700,000.00, actual 71,160.00, committed 100,000.00.
  - XLSX totals equal the preview; the PDF says "Rows 14".
  - Scheduled delivery: the recipient's download should give 200 (today 403).
  - Visibility.
- **Audit, risk and schedule history.**
  - Audit completeness per entity. A period lock writes 1 event (today 0). The best-effort mutation.
  - The risk state machine and its summary.
  - Activation and rollback keep ids; rollback refusal codes.

**Mutations.** The engine switch; the engine's must-not invariants; notification project scope after its fix; the report download rule.

**Existing evidence reused.** Snapshot quality 65. The PC-7b live suites are a reference only. The CERT-2 audit and people proofs cover visibility.

**Confirm first.**
- **Role-addressed notifications reach staff not on the project** (proposed P1, disclosure within the company) → HR-K4.
- **Two health formulas** → HR-K1.
- **Delayed counted in calendar days** → HR-K2.
- **Form ITPs not in the quality score** → HR-Q3.
- **Health has no module permission check** (recorded; the same pattern as N3).
- **Export content and gate** → HR-K7.
- **Scheduled delivery gives 403** → HR-K6.
- **The "CPI" column in reports** → HR-K8.
- **Convert drops budget lines** → HR-C12.
- **Dismissal and the episode key** → HR-K3.
- **Evaluation reads outside the lock**: defect.
- **Missing triggers** (P2).
- **Best-effort audit writes** → HR-K9.

---

## 5. High-risk rule decisions (owner first)

No fix that changes one of these rules starts before your decision. Each row has a recommendation, so a group can be approved as a whole.

**Schedule and progress**

| ID | Decision | Today | Recommendation |
|---|---|---|---|
| HR-S1 | Late pass when the finish is driven through SS/SF links or leads | LF is not capped at the project finish; there can be no critical path, and readiness blocks the baseline | Cap LF at the project finish. Floats change at the next recalculation. |
| HR-S2 | Zero-duration activities and milestones | Start = end fails the readiness date check and every PATCH | Start = end is valid when duration is 0; end < start is still refused |
| HR-S3 | Readiness of a staged revision | Judged on the file's float; MSP negative slack is not critical | Run CPM on the snapshot; critical means TF ≤ 0 for every format |
| HR-S4 | Schedule-file conversion | Half-up rounding (−12 h → −1, +12 h → +2; 1–3 h → 0); two-project files merged; UTF-8 only; calendars ignored | Symmetric rounding; a task with hours never becomes 0 days unless it is a milestone; refuse two-project files without a project choice; detect Windows-1252; calendars recorded as P2 |
| HR-S5 | Mixed calendars | A successor can be dated before its predecessor finishes | Refuse an activity calendar that differs from the project's (400) until CPM handles calendars (P2) |
| HR-S6 | Changing the start date or calendar after scheduling or baseline | No CPM recalculation; the "locked" baseline dates move | Recalculate on change; refuse the change after a baseline lock (409) unless re-baselined |
| HR-S7 | Finish-date convention | Exclusive: a P6 finish shows one working day later | Document it for Phase 1; your call whether to show inclusive finishes |
| HR-S8 | Hand-built programmes (L124) | Cannot be approved or baselined | Phase 1: a baseline needs an import or AI generation, and the UI says so; an in-product revision is P2 |
| HR-S9 | Activities retired by activation | Pending submissions can still be approved; AC and EV drop out (L118) | Refuse approval (409); keep their AC and EV in project totals (AC itself is CERT-5) |
| HR-P1 | Lowering official progress | Silent: an older approval, an inspection "failed" or a manual figure all win | A lower figure needs a reason and returns a warning; approving an older submission after a newer approved one is refused (409) |
| HR-P2 | Method-lock scope | Only a configured method is locked | Lock the effective method once progress is approved |
| HR-P3 | PUT on the progress method | Omitted fields are reset, which switches evidence off | Partial update |
| HR-P4 | Segregation of duties | PM and planner approve their own progress; PM approves their own timesheets | Keep for Phase 1 (CLAUDE.md: PM has all access); self-approvals visible in audit |
| HR-P5 | Displayed progress basis | Search, lookahead, export and assistant show the file's percent | Approved progress only, everywhere |

**Quality and evidence**

| ID | Decision | Today | Recommendation |
|---|---|---|---|
| HR-Q1 | Releasing a hold point | An answer alone ("pass" or "na") releases it, even on an in-progress instance; any scheduled ITP blocks the activity | Release only on a completed or closed instance with the hold item passed; "na" on a hold item needs the approver; keep "any open ITP blocks" for Phase 1 |
| HR-Q2 | Hold-point template version | Gates read the current template | Gate on the instance's own template version |
| HR-Q3 | Which ITP model counts | The legacy register drives the score; form ITPs drive the gate | Form ITPs count in both; the legacy register keeps counting until it is retired |
| HR-Q4 | Quality-score inputs | Closed NCRs count for ever; legacy ITP status changes freely; NCR and ITP hard delete | Keep closed NCRs counting (literal CLAUDE.md, as already certified); an ITP status change needs a reason and is audited; delete becomes archive, and archived and void records are excluded |
| HR-Q5 | Changes after closeout | NCR severity and safety type and lost days can be edited; approval does not re-check evidence | Freeze them after submit; approval re-checks evidence |
| HR-X1 | What counts as evidence (progress, NCR, safety, CO L149, L129) | A file name, a URL or a text note | At least one stored project document. This affects mobile clients that send URLs. |

**Field and documents**

| ID | Decision | Recommendation |
|---|---|---|
| HR-F1 | PM approval of a submittal while review steps are pending | Refuse (409) unless a PM override with a reason |
| HR-F2 | Drawing approval without review, or out of order | Approve only from review; refuse a revision older than the current approved one unless it supersedes with a reason |
| HR-F3 | Reassigning the punch final approver | Only the PM or the current final approver may change it once the item is open |
| HR-F4 | Daily log: approve without submit or when empty; reopen without a reason; contractual weather delays created by site staff | Approve only submitted days; reopen needs a reason; promotion needs `eot:create`, otherwise it creates a non-contractual delay |
| HR-F5 | Timesheets: 24 h cap per sheet only; rate read at approval; inactive workers accepted | Cap per worker per day across all sheets; take the rate at submission; refuse inactive workers |
| HR-F6 | Meetings: status set by PATCH; drafts distributed; minutes editable after distribution; action items re-created on each edit | Status changes only through finalize and distribute; distribution needs a finalized meeting; lock after distribution; update action items in place |

**Commercial and supply chain**

| ID | Decision | Today | Recommendation |
|---|---|---|---|
| HR-C1 | IPC retention basis | A null project default gives 0%; the contract rate is never used | Contract rate, else the project default, else 5% |
| HR-C2 | Variation allowance scope | Raises every allocation of the BOQ row | Only the linked allocation |
| HR-C3 | IPC states | No return from submitted; "paid" is one-way; empty periods can be certified | Add submitted → draft (QS or PM, with a reason, audited); status follows payment; refuse empty periods |
| HR-C4 | Definition of "invoiced"; invoice gross excludes materials | Statement and receivables disagree | CERT-5 decides; CERT-3 records |
| HR-C5 | Supplier invoice against the three-way match | Blocking flags are advisory | A blocking verdict refuses approval unless the PM or finance overrides with a reason; fix the verdict downgrade |
| HR-C6 | Stocked-material cost (L35, L36, X-FINANCE-1) | Open | CERT-5, unless you pull them into CERT-3 |
| HR-C7 | Material plan usage | The issued quantity is never raised; fields are ignored | An issue to an activity raises the issued quantity of linked plan rows; ignored fields are refused (400) |
| HR-C8 | PO after delivery (D-FUN-1) | Cannot be closed short or closed at all; cancel gives the wrong code | Partial → closed with force and a reason; received → closed; cancel after a delivery gives 409 `PO_CANCEL_AFTER_DELIVERY` |
| HR-C9 | PO reference scan | Searches the whole organisation and picks any project | Require `projectId`, or answer 409 ambiguous. This is a mobile contract change. |
| HR-C10 | EOT | Approved claims editable; impact summed over activities; the project date is not moved | Lock approved claims (409); impact = delay − the least float along the named activities; keep the project date manual |
| HR-C11 | Fractional days; zero allowance; the 70% warning | Days are integers (1.5 → 1); 0 becomes 20; the warning is only a flag | Store half-days (a migration to decimal for weather and EOT days), or refuse non-integers; 0 means 0; keep the flag (your call on adding a notice) |
| HR-C12 | Change events | Two accepted quotes; an event stuck after its CO is archived; conversion drops the lines' budget lines | One accepted quote per line; archiving the CO returns the event to priced; carry each line's budget line and cost code into the CO split (atomic conversion is a separate defect fix) |
| HR-C13 | New capabilities | No deductive prime CO (L199); no subcontractor retention release (L116) | Your call for Phase 1. Without L116, every subcontract closeout needs an override. |
| HR-C14 | BOQ import | No section column; one AI prompt for all rows; dropped rows stay active; a non-AI import uses AI quota; the AI job runs after the baseline | Optional section column; AI job in batches of at most 60 by section; dropped rows flagged, not deactivated; quota only for the AI job; AI job refused after the baseline |
| HR-C15 | Budget-revision register | Running totals out of order; the register starts from the contract value | Recalculate in effective-date order (defect fix); the baseline definition goes to CERT-5 |
| HR-C16 | Cash flow: advance receipts (L115), legacy unpaid valuations | — | CERT-5 |
| HR-C17 | Allocation lifecycle | A rejected allocation cannot be resubmitted | Rejected → draft → submit; withdrawal only through a BOQ revision |
| HR-C18 | "7-category breakdown" against 8 cost types | — | Keep 8 types and show "other" separately; you confirm which seven the dashboard reports |

**Earned value, controls and reporting**

| ID | Decision | Recommendation |
|---|---|---|
| HR-E1 | Official AC (L34) | Ledger entries dated by `incurredOn`. You decide: CERT-3 (before any lock is trusted) or CERT-5 (the default). |
| HR-E2 | Period lock before its cutoff; unlock; audit | Refuse before the cutoff (409 `CUTOFF_NOT_REACHED`); no unlock; audit every lock |
| HR-E3 | EAC when CPI = 0 | Keep BAC, labelled |
| HR-E4 | SPI or CPI below 0.9 "triggers alert" | The report flag, plus an exception kind when the engine is on; no new notice |
| HR-K1 | Two 7-dimension health formulas | One shared service using the workspace definitions: archived excluded, answered RFIs not overdue, `responseRequiredBy` first, overdue submittals counted, no IFC offset |
| HR-K2 | Delayed activities on dashboards | `deriveActivityStatus` with the working-day finish |
| HR-K3 | Exception engine: what reopens a dismissal; episode key for slips; register vs contract pair; thresholds | Reopen only when the exceedance grows; an episode key for slips; drop the register-vs-contract pair; keep the thresholds |
| HR-K4 | Who receives role-addressed notifications | Project members, plus the PM across the organisation |
| HR-K5 | A row that escalates while snoozed | Notify when the snooze ends if the row is critical |
| HR-K6 | Scheduled report delivery | Render for each recipient with their own permissions |
| HR-K7 | Project XLSX export gate and content | One permission per sheet; exclude retired activities and archived risks |
| HR-K8 | The "CPI (budget / actual)" report column | Rename it "Budget / actual" |
| HR-K9 | Audit writes made outside the transaction (81) | Inside the transaction for actions that move the ledger and for approvals; the rest recorded |
| HR-K10 | Risk severity not derived from probability and impact | Record only |

**Defect fixes that are not rule changes.** These go ahead after reproduction if they confirm as P1, unless you object:
- activation keeps the activity code and budget, and suggests mapping by code;
- atomic, idempotent change-event conversion;
- atomic award confirmation and one order per award; award orders keep their coding;
- a commitment-CO approval checks that its parent is still live;
- the receivable PO list;
- budget-revision running totals;
- the RFI official response is frozen after closure;
- weather promotion in one transaction;
- health excludes archived incidents;
- L106;
- the exception evaluation reads inside its lock;
- the rollback stamp is written in the same transaction.

P2/P3 defects are recorded, not fixed, under the scope freeze.

---

## 6. Exit criteria, evidence and review gates

### 6.1 Exit criteria (measurable)

| # | Criterion |
|---|---|
| E1 | **D-ID-1.** The proof passes every check (the count is fixed before the first run). 8 of 8 mutations are caught. Codex has no CRITICAL or HIGH finding open. OpenAPI validation passes. The CERT-2 proofs that create people pass after the helper change, except the checks recorded as superseded. The short CERT-2 sentinel shows leaks 0, writes accepted 0, 5xx 0, census 0 and realtime 117/117. |
| E2 | **Deep population.** Three companies are built and every creation is asserted (builder exit 0). The 97 other companies' fingerprint is unchanged. Snapshot `cert3d` is taken. |
| E3 | **Known answers.** Every CERT-3 check either passes or is linked to a register row that you have dispositioned (fixed, deferred to a named checkpoint, or accepted). Unexplained failures: 0. Checks that only note a value: 0. |
| E4 | **CLAUDE.md rules.** 10 of 10 have a passing known-answer check, or a register row carrying your decision. |
| E5 | **Severity.** P0 open: 0. P1 open in main workflows: 0, except rows you have assigned elsewhere; expected: L34, L35 and L36 to CERT-5, L37 to CERT-4, L11 to CERT-6. |
| E6 | **Mutations.** Every guard in §6.2 is caught (100%). No mutation is ever committed. |
| E7 | **Lifecycle.** None of the listed weak checks remain. The read-only verifier passes on 14 of 14 projects with no writes. The fresh lifecycle run in 087 has 0 failures. `snapshot.js` still passes on 14 of 14 (it is read only). |
| E8 | **Personas.** The permission probe matrix matches `shared/permissions.json`, or each mismatch is registered. |
| E9 | **Suites** (on a quiet machine, reported exactly as run). The backend unit suites pass, except the six :55432 suites (release carry) and D-TEST-1 (tracked). OpenAPI passes. Web typecheck, lint and source checks pass. Mobile typecheck, lint and unit tests pass. |
| E10 | **Reports.** `docs/certification/OCTAPM_WORKFLOW_CERTIFICATION.md` is written (rule → evidence → result for each work package). The register, the journal and the CERT-3 row of the programme document are updated. |
| E11 | **Reviews.** Every high-risk diff has a Codex review and an adjudication file. Every batch has had a code review. The PR Review Toolkit passes before the merge into integration. |

### 6.2 Guards that need a caught mutation
- **D-ID-1:** M1 to M8.
- **WP-1:** TF ≤ 0; the SS backward branch; the BOQ baseline gate; `REVISION_NOT_ACTIVATED`; staged imports do not write.
- **WP-2:** the hold-point check; the evidence check at approval; the submit permission; idempotent approval; the method-stands check; `openHoldPoints`; the negative-quantity guard; the bulk transaction.
- **WP-3:** the 0.9 alert boundary; the locked-period snapshot; the readiness gate on lock; EV reads approved progress only.
- **WP-4:** retention default; variation scope; the convert lock; one open pay application; the pay-application payment ceiling; the lock on approved COs.
- **WP-5:** PO close transitions; the award lock; `RECEIPT_OVER_ORDER`; `INV_INSUFFICIENT_AVAILABLE`; one posting per direct-cost line.
- **WP-6:** dry runs write nothing; allocation capacity; transfer limit; the Original lock.
- **WP-7:** the 70% boundary; the approved-EOT lock.
- **WP-8:** quality weights and clamp; the manpower status filter; overtime multipliers; the punch final approver; the latest-revision filter; review days in submit-by; the archived filter.
- **WP-9:** the engine switch; the engine's must-not invariants; notification scope; the report download rule.

### 6.3 Evidence artefacts
- **Code (on the branch):** `scripts/cert/cert3/` (proofs, reproductions, builders, `answers.js`, the read-only verifier; assumed paths) and the edited `scripts/phase21/stage*.js`.
- **Run results:** `C:\Temp\octapm-cert\results\cert3\` (each proof's JSON, the mutation logs and `cert3-tally.json`).
- **State and snapshot:** `C:\Temp\octapm-cert\state\cert3\` (build state) and snapshot `cert3d`.
- **Reviews:** adjudication files in `C:\Temp\octapm-cert\scratch\`.
- **Documents:** the register rows, the journal entries and the workflow certification report.

### 6.4 Review gates
- **Codex:**
  - an adversarial plan review before each high-risk batch: D-ID-1 first, then each set of HR fixes;
  - a diff review of every high-risk diff: identity, gates, financial figures, migrations (HR-C11), notification scope;
  - each finding adjudicated as CONFIRMED, PARTIAL, REJECTED, EXPECTED BEHAVIOUR or TEST GAP and never applied blindly;
  - stop when nothing CRITICAL or HIGH is open, at most 3 rounds, then escalate to you.
  - If Codex's usage limit blocks a review, the high-risk batch waits; a re-run is scheduled for the next window.
- **Code review:** `/code-review` (high) on each work-package batch before it is committed.
- **PR Review Toolkit:** before CERT-3 work reaches the integration branch. It checks for the intended diff only, no mutation leftovers, no secrets, reviewed migrations, green tests, aligned docs, and no generated churn (for example `routeTree.gen.ts`).
- **Ralph Loop, only with explicit stop conditions:**
  - moving the end-to-end specs to the new fixture: stop when web typecheck and lint pass and the affected specs pass in the E2E environment, or after 5 iterations;
  - fixing one confirmed defect: stop when its proof is green, its mutation is caught and no unit suite regresses, or after 3 iterations, then escalate.
  - Never for open-ended defect hunting.

---

## 7. Sequencing, and what runs detached

| Step | What | How it runs |
|---|---|---|
| 0 | You review this plan and the D-ID-1 decisions. In parallel, Codex reviews the D-ID-1 design and the §5 list as an adversary; you get the adjudication as a delta. | In session |
| 1 | Stop the API, restore `cert2c`, start the API. D-ID-1: implement, prove, run mutations, Codex diff review, code review, move scripts and fixtures, re-run the CERT-2 proofs that create people, run the short sentinel. | Proofs in session; the CERT-2 proof re-run and the sentinel **detached** if they could pass 1.5 h |
| 2 | WP-0: answer book, builders, permission matrix, read-only verifier over the 14 projects. Build 087, 052 and 011, fingerprint, take snapshot `cert3d`. One fresh lifecycle run in 087. | Builders **detached with the watchdog**; the lifecycle run detached if its length is unknown |
| 3 | Confirm-first sweep: every reproduction script runs on `cert3d`, giving a classification table. You get one delta report: the confirmed defects with proposed severities, and any HR item whose reproduction changes the picture. | In session (each script is short) |
| 4 | WP-1 → WP-9 in order. For each: proofs (red where a defect is confirmed), fixes for confirmed P0/P1 and approved rules, green, mutations, Codex diff review (high risk), code review, commit and push, journal. `cert3d` is restored before a package whose proofs need a clean state **(assumption: restore is quick enough; otherwise proofs use fresh records)**. | In session; any batch over 1.5 h detached |
| 5 | Exit run on the final code: restore `cert2c`, rebuild the deep companies, run every CERT-3 proof, the fresh lifecycle run in 087, `snapshot.js` on the 14 projects, and a short CERT-2 sentinel; then the tally. | **Detached with the watchdog**; progress in `C:\Temp\octapm-cert\logs\cert3\status.txt` |
| 6 | Suites on a quiet machine. The workflow certification report, register and journal. The PR Review Toolkit. Your acceptance. | In session; the full backend suite never runs at the same time as proofs, builds or Codex |

**Rules for detached runs:**
- They start through `C:\Temp\octapm-cert\start-detached.ps1` and run under `scripts/cert/run-with-watchdog.js`, which replaces the API if its database engine wedges (OPS-1).
- Background tasks are killed at 2 hours, so anything longer must be detached.
- A loader is never killed in the middle of a driver; the builders resume from their state file.
- Only one writer uses the certification database at a time.
- No Codex run or full suite runs during a detached build or exit run, because the machine runs out of memory (OPS-1).
- Mutation runs that put a storing defect back are cleaned up, then followed by a census.

**Carried to final release, unchanged by CERT-3:**
- the six :55432 suites, plus the development-database live tests that D-ID-1 changes;
- D-TEST-1;
- production e-mail working (ID-h);
- the C0-3 key rotation.

---

## Assumptions to confirm
- **A1** The company choice uses the matrix as of 2026-10-05. 087 has staff in the roles 087-OTH needs (confirm from `spec.js`).
- **A2** The individual plan opens the modules that 011's lane uses. A 402 is recorded under CERT-4.
- **A3** Builders and proofs can read invitation links in process (`latestInvitationToken`, `CERT_API_LOG`).
- **A4** Self-registration is open on the certification API (not production), which proof C7 needs for a personal workspace.
- **A5** There is no self-service e-mail change with verification today (the consequence of ID-e).
- **A6** The lifecycle runner makes a fresh project on each full run.
- **A7** Restoring a snapshot is quick enough to do between work packages.
- **A8** A project's own time zone cannot be set (L117, L126). The reporting zone is the company's and is asserted through `reporting.timeZoneSource`. The answer book avoids cutoffs that fall on daylight-saving change dates.
- **A9** Company administration grants no module rights (probed in WP-0).
- **A10** Every expected figure here comes from the area maps and is derived again in the answer book. A disagreement is settled on paper, never by editing the expected value.
- **A11** The script and proof paths under `scripts/cert/cert3/` are proposals.
- **A12** The development PostgreSQL on :55432 stays unavailable during CERT-3.