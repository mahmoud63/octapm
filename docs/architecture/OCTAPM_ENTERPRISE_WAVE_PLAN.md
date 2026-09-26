# OctaPM enterprise wave plan (ENT-0 + PC-0)

Migration strategy M1-M9 (§48), waves ENT-0..ENT-6, PC-0..PC-8 and CERT (§132), with scope, file ownership for parallel worktrees, proving tests, logical commits (§133) and §134 stop conditions. [C] = confirmed at the cited line, [D] = decision.

---

## 0. Current-state audit summary

| Area | State (evidence) |
|---|---|
| Identity | one User = one org: `User.orgId` non-null, `email @unique` (`schema.prisma:159-161`); four refusal sites block a second org (`auth.service.js:304-314, 899-905, 970-976`; `user.service.js:189-194, 398-404`; `sso.service.js:235-236`) [C] |
| Role / admin | global `User.role` and `User.isCompanyAdmin` read at ~40 sites; `requireCompanyAdmin` also passes any `pm` (`rbac.js:199`); a PM can grant admin to anyone incl. self (`users.js:110-135`, `user.service.js:292-294`) [C] |
| Tenant context | JWT `orgId` cross-checked against the User row per request (`auth.js:48-61`); 80 nested routers behind `requireProjectAccess`; `assertProjectAccess` `where {id, orgId}` 404/403 (`project-authorization.service.js:106-158`); no client-chosen orgId except `POST /auth/sso/start` (`auth-security.js:37`) [C] |
| Schema | 239 models: 146 with orgId (82 P+O, 14 of them relation-less), 71 project-only, 15 via parent, 6 system, 1 unowned (`ExtraServicesConfig`, read unfiltered `boq-calculation.service.js:5`); 0 composite FKs, 0 triggers/CHECKs on tenancy, 0 RLS [C] |
| Data consistency | 0 orgId/projectId disagreements across all 90 dual-column tables; 0 cross-org assignments/parties; orphan rows of deleted orgs: BackgroundJob 431/1,138, OutboundEvent 7,205/22,689, AuditEvent 7,335 [C] |
| Async surfaces | rooms `user:{id}` (identity-keyed), org room unused; notification links `/projects/:id/...`; push unique by endpoint with org overwritten; three job handlers trust payload/row [C] |
| Clients | no workspace state; cache cleared on `user.id` change only; outbox without owner (web) / owner = userId (mobile); SW cache by URL 24 h [C] |
| Structure | no WBS model; Location not on Activity/BOQ/allocation; BoqItem has no cost code; units free text; BOQ revisions never approved/locked; `BoqActivity` dead; no work package [C] |
| Money | ledger certified and idempotent; `originalBudget` PATCH-able (`budget.service.js:303, 321, 359`); two committed definitions; three EACs; three budget truths; S-curve EV flat; no installed-quantity ledger; change intelligence unwired (4 manual events, 0 lines) [C] |
| Tests | only live cross-tenant proof is `backend/scripts/phase21/stage7-security.js` (13 + 5 probes); Jest route tests mock Prisma [C] |

---

## 1. Migration strategy M1-M9 (§48)

Every step: additive or dual-path; a script under `backend/scripts/enterprise/` with `--dry-run` (default) and `--apply`, printing counts before/after and a validation block; idempotent (re-run produces 0 changes); reversible as stated. Migrations are produced with `prisma migrate diff` and dated after `20261003090000_user_mfa_last_totp_step` (schema-drift rule).

| Step | Change | Backfill script | Validation | Reversal |
|---|---|---|---|---|
| **M1** schema, additive | `Organisation.kind/slug?/createdByUserId`; `OrganizationMembership`; `Project @@unique([id, orgId])`; `ProjectAssignment.orgId?`; `RefreshSession/SsoTicket/ApiClient/InvitationToken/Notification/BackgroundJob.membershipId?`; `ExtraServicesConfig.orgId` (0 rows → non-null with `@@unique([orgId,label])`); `CostCode/PermissionTemplate/FormTemplate/CustomFieldset @@unique([id, orgId])` | none | `prisma migrate diff` clean; row counts unchanged | drop columns/table (no data yet) |
| **M2** memberships | 1:1 from User (membership doc §7 owner rule) | `backfill-memberships.js` | §50 report: 46 = 46, ≥1 owner per org, roles in catalogue, UAT-Fixtures promotion listed | `DELETE FROM "OrganizationMembership"` (User columns untouched) |
| **M3** slugs + assignment orgId + ApiClient/RefreshSession membershipId | slug from name with suffix; `ProjectAssignment.orgId = Project.orgId`; membershipId from (orgId,userId) | `backfill-tenant-columns.js` | 23 distinct slugs; 1,352/1,352 assignments filled; 38/38 keys; sessions filled or revoked | null the columns |
| **M4** dual-read | `authenticate`, sockets, API keys, refresh read the membership; fall back to User columns when `mid` is absent (old tokens for their remaining lifetime) | — | live login for every persona; old token still works until expiry | feature flag `AUTH_MEMBERSHIP_READ=false` |
| **M5** dual-write | user.service, invitation accept, SSO provision, provisionOrganisation write membership **and** User columns | — | §50 report clean after a day of use | flag `AUTH_MEMBERSHIP_WRITE=false` |
| **M6** cut-over reads | rbac/authorization/services read only `req.user` (membership-derived); remove the four refusal sites; `requireCompanyAdmin` = admin/owner; self-elevation guard; `super_admin` dropped from five sets | — | §51 persona logs into both orgs with different roles; stage7 + §53 matrix green | flag back to M5 behaviour |
| **M7** constraints | `ProjectAssignment.orgId NOT NULL`; composite FKs `(projectId, orgId)` in batches of ~15 tables, `NOT VALID` then `VALIDATE`; FK `(orgId,userId) → OrganizationMembership` on ProjectAssignment and ProjectUserPermission; relations on the 14 relation-less tables; MFKs to org masters; partial uniques for StockBalance/InventoryCountLine | `validate-composite-fks.js` (counts mismatches per table before adding) | 0 mismatches per table (already 0); constraints listed in `pg_constraint` | drop constraints (no data change) |
| **M8** stop writing User columns | `User.orgId/role/isCompanyAdmin` nullable, no longer written; `legacyOrgId` rename | `null-user-tenant-columns.js` | §50 report clean; no reader left (grep gate in CI: `req.user.role` allowed, `user.role`/`user.orgId`/`isCompanyAdmin` on Prisma User selects refused) | restore from membership (script `restore-user-columns.js`) |
| **M9** drop | drop the three User columns and `BoqActivity` (after production count = 0 verified) | — | post-CERT only | not reversible — last step, after CERT |

Orphan rows (BackgroundJob / OutboundEvent / AuditEvent / RecordHistorySnapshot of deleted orgs) are **not** migrated: `sweep-orphan-tenant-rows.js --dry-run` reports counts per table and per missing orgId; `--apply` deletes only rows older than the retention window (PO decision 2). No FK is added to those tables.

---

## 2. Waves

Conventions: each wave is a worktree branch off `feat/p0-foundations-sprint1`; a wave owns the files listed and may add tests anywhere under its own `__live__`/`e2e` names; shared files (`schema.prisma`, `shared/permissions.json`, `routes/projects.js`, `app.js`) are edited only by the wave that lists them, others queue behind. Live tests run against the real database on `:55432` (never mocked Prisma), Playwright against `:5173`/`:5000`, mobile web on `:8081`.

### ENT-0 — architecture (this wave)
Scope: the twelve documents. Owns `docs/architecture/*`, `docs/project-controls/*`. Test: none. Commit: `docs(enterprise): multi-tenant architecture and project-controls model`.

### ENT-1 — schema and backfill (M1-M3)
- Scope: M1 migration; `OrganizationMembership`; backfill scripts and the §50 report; re-seed system templates for the three orgs lacking them (`seedDefaultTemplates` idempotent by name).
- Owns: `backend/prisma/schema.prisma` (identity/tenancy sections only), `backend/prisma/migrations/2026100409*`, `backend/scripts/enterprise/backfill-memberships.js`, `backfill-tenant-columns.js`, `validate-membership-backfill.js`, `backend/src/services/membership.service.js` (read helpers only).
- Tests: `backend/src/services/__live__/membership-backfill.live.test.js` — run backfill on the live DB twice, assert identical counts, assert the report is clean, mutate one membership role away and assert the report fails.
- Commits: `feat(schema): organisation membership and workspace kind (additive)`, `feat(scripts): membership backfill with validation report`.
- §134 stops: "PMcopilots UAT Fixtures" has no admin — resolved by the documented owner rule; **stop** only if the report finds a role outside the catalogue or a duplicate email (0 today).

### ENT-2 — auth, membership and RBAC (M4-M6)
- Scope: JWT `mid`, `authenticate`/socket/API-key membership read, `POST /auth/workspaces/:orgId/session`, login 0/1/many, invitations to a second workspace, direct-create-for-existing-identity, SSO membership provisioning, `requireOrganizationMembership`, `requireCompanyAdmin` = admin/owner, self-elevation/last-owner guards, audit events, `GET /auth/me` memberships, guest kind for party members, `super_admin` removal.
- Owns: `backend/src/middleware/auth.js`, `rbac.js`, `project-access.js` (guest gate), `backend/src/utils/tokens.js`, `backend/src/services/auth.service.js`, `user.service.js`, `sso.service.js`, `api-client.service.js`, `membership.service.js`, `project-authorization.service.js` (orgId in assignment predicate; super_admin), `backend/src/routes/auth.js`, `auth-security.js`, `users.js`, new `routes/workspaces.js`, `backend/src/realtime/socket.js` (auth part only), `conversation/meeting/task/search.service.js` (super_admin lines only).
- Tests: live `auth-workspaces.live.test.js` (persona §51: same email in org A as `qs`, org B as `pm`; switch; token A on B project → 404; suspended membership → 401; last owner demotion → 409); stage7 re-run; Jest route tests updated but not counted as proof.
- Commits: `feat(auth): access tokens bound to an organisation membership`, `feat(auth): workspace session issue and login with many workspaces`, `feat(users): invitations and direct adds for existing identities`, `fix(rbac): company administration requires admin or owner`.
- §134 stops: dropping the four refusal sites before M2 has run would let a second membership exist without the backfill — ordering enforced by the wave sequence; the `pm` shortcut retirement is PO decision 1 (default: retire).

### ENT-3 — tenant hardening (M7, jobs, search, masters)
- Scope: composite FKs in batches; FKs on the 14 relation-less tables; MFKs to org masters; `ExtraServicesConfig` per org; the three job handlers re-check `job.orgId`; `search.service` passes `isCompanyAdmin`; `direct-cost.service.js:270` company lookup scoped; `ReferenceCounter` purge by prefix on org/project delete; orphan sweep script; `WebhookSubscription.secret` encryption check; partial uniques for nullable-location stock uniques.
- Owns: `schema.prisma` (relations/uniques only, after ENT-1 merges), migrations `2026100410*`, `backend/scripts/enterprise/validate-composite-fks.js`, `sweep-orphan-tenant-rows.js`, `backend/src/services/boq.service.js` (parse handler `:1063-1105` only), `accounting.service.js:399`, `webhook.service.js:349-352`, `search.service.js:792, 806`, `direct-cost.service.js:270`, `boq-calculation.service.js`, `utils/reference-number.js`.
- Tests: §52 fixture `backend/scripts/enterprise/fixture-100-companies.js` (100 orgs × 3 projects × 4 members, deterministic ids, idempotent); §53 matrix `backend/scripts/enterprise/tenant-leak-matrix.js` extending stage7 to every row of the §53 table (files, search, reports, exports, portfolio, inventory, notifications, conversations, realtime join, bid/RFQ portals, inbound email, API keys, jobs) — each probe from org B against org A's ids expecting 403/404 and identical answers for real vs non-existent ids; a constraint-teeth test that inserts a mismatched `(projectId, orgId)` row raw and expects the FK error.
- Commits: `feat(schema): composite tenant foreign keys, batch 1..n`, `fix(jobs): handlers load their subject inside the job's organisation`, `fix(search): company admins search every project they can open`, `feat(schema): extra services config owned per organisation`.
- §134 stops: any table with a non-zero mismatch count in `validate-composite-fks.js` → stop that batch (0 today); the orphan sweep is destructive and runs only after PO decision 2.

### ENT-4 — web workspace switching
- Scope: `/o/$orgSlug` route tree, workspace state, switch sequence, outbox owner key, SW cache drop, `joinedProjects` reset, header IA (workspace switcher, + Create), legacy link redirect via `resolve`, L1 Home, personal-workspace UI states, conversion prompt.
- Owns: `frontend/src/routes/**` (new `_authenticated/o/$orgSlug/*` tree; legacy redirect), `frontend/src/stores/auth-store.ts`, `frontend/src/main.tsx` (identity/membership change subscription, outbox start gate), `frontend/src/lib/offline/outbox.ts`, `frontend/src/sw.ts`, `frontend/src/lib/realtime.ts`, `frontend/src/components/layout/top-navbar.tsx`, `project-switcher.tsx`, new `workspace-switcher.tsx`, `create-menu.tsx`, `frontend/src/features/home/*`, `frontend/src/lib/permissions.ts` (role source), `frontend/src/services/auth/*`; backend `backend/src/utils/record-links.js`, `routes/workspaces.js` (`resolve`), `services/notification.service.js` (links only), `email.service.js` (links only).
- Tests: Playwright `e2e/40-workspace-switch.spec.ts`, `41-deep-links-across-workspaces.spec.ts` (switching doc §8), plus the existing suites re-run under `/o/{slug}` URLs (the E2E org keeps one project — memory rule).
- Commits: `feat(web): workspace-scoped routes and switcher`, `feat(web): offline queue owned per workspace`, `feat(web): home across workspaces`, `feat(notifications): links carry the workspace`.
- §134 stops: none destructive; the outbox owner change must ship with a one-time migration of existing IndexedDB items to `ownerKey = current user:org` on first load (client-side, idempotent).

### ENT-5 — mobile switching, realtime and push
- Scope: mobile workspace state, switch sequence, per-workspace cache/outbox owner, project validation on hydrate, deep links with `orgId`, `/open` switch, push payload `orgId`, `member:{membershipId}` rooms, `disconnectMembership`, org room events, push fan-out per identity.
- Owns: `mobile/src/auth/*`, `mobile/src/projects/store.ts`, `mobile/src/offline/*`, `mobile/src/navigation/*`, `mobile/app/(app)/_layout.tsx`, `open.tsx`, `projects.tsx`, `more.tsx`, `mobile/src/notifications/*`, `mobile/src/realtime/*`; backend `backend/src/realtime/socket.js` (rooms/routing; after ENT-2), `backend/src/services/push.service.js`, `notification.service.js` (fan-out), `routes/users.js:134,178`.
- Tests: mobile Jest (`deepLinks.test.ts`, `push.test.ts`, `outbox.test.ts`, `store.test.ts`); live realtime test: two sockets for one identity in two workspaces, a notification in A reaches only the A socket; Playwright on `:8081` for the switch sheet.
- Commits: `feat(mobile): workspace switching with per-workspace queue and cache`, `feat(realtime): rooms keyed by membership`, `feat(push): payloads carry the workspace`.
- §134 stops: `PushSubscription` rows keep their `orgId`; no row is deleted; `NotificationPreference` unique is unchanged (PO decision 6).

### ENT-6 — personal workspaces and conversion
- Scope: register creates a personal workspace (`kind='personal'`, plan individual) — public registration policy unchanged (`config/registration.js:138-143`); `POST /organisations` (create workspace while signed in); `POST /organisations/:id/convert`; personal-workspace limits; billing recipient = owner; L2 dashboard personal variant.
- Owns: `backend/src/services/auth.service.js` (`provisionOrganisation` only, after ENT-2), new `organisation.service.js`, `routes/organisations.js`, `backend/src/jobs/billing-scheduler.js`, `frontend/src/features/dashboard/*` (personal variant), `frontend/src/features/company/*` (convert flow), `mobile` none.
- Tests: live `organisation-lifecycle.live.test.js` (register → personal → create project → convert → invite → second member; assert no row changed `orgId`, ledger counts unchanged, templates present); Playwright `42-personal-to-company.spec.ts`.
- Commits: `feat(workspaces): personal workspaces`, `feat(workspaces): convert a personal workspace to a company`.
- §134 stops: none.

### PC-0 — project-controls model (this wave, documents)

### PC-1 — structure
- Scope: `WbsNode`, `UnitOfMeasure` + org seed, `Activity.wbsNodeId/locationId`, `BoqItem.wbsNodeId/locationId/costCodeId/unitCode/mappingRule`, `ActivityBoqAllocation.locationId/unitCode`, `ProgressSubmission.locationId`; WBS upsert at revision activation; calendar mapping; Structure page.
- Owns: `schema.prisma` (structure section; after ENT-3), migrations `2026100501*`, `backend/src/services/wbs.service.js` (new), `uom.service.js` (new), `location.service.js` (no change expected), `schedule.service.js` (activation `:2481-2860` only), `import.service.js`, `cpm.service.js` (calendar map), `backend/src/routes/structure.js` (new, mounted in `routes/projects.js` — one-line edit owned here), `frontend/src/features/controls/structure/*`, `frontend/src/features/schedule/components/wbs-tree.tsx`.
- Tests: live `pc-1-structure.js` (XER import → activation creates nodes; move a node re-paths children; unit normalisation warns and never rewrites `unit`); Playwright `53-structure-editor.spec.ts`.
- Commits: `feat(controls): WBS nodes populated from schedule imports`, `feat(controls): unit of measure master and normalisation`, `feat(controls): locations and cost codes on BOQ rows and activities`.
- §134 stops: activities and dependencies are never rewritten or deleted (238 wbsCode rows, 282 dependencies, 161 approved allocations) — activation only sets `wbsNodeId`; the 10 `baselineLocked` seed items keep their derived lock.

### PC-2 — BOQ revisions and imports
- Scope: BOQ revision approval workflow and explicit lock; upload columns (section, wbs_code, location_code, cost_code, mapping_rule); BOQ templates (company library); locations xlsx import; schedule xlsx parser; dry-run reports.
- Owns: `backend/src/services/boq.service.js` (revision + upload paths), `services/boq/excel-parser.js`, `services/boq/template.js`, new `boq-template.service.js`, `parsers/schedule-xlsx-parser.js`, `backend/src/routes/boq.js`, `company-workspace.js` (templates), `frontend/src/features/boq/components/boq-page.tsx`, `boq-editable-grid.tsx`, `revision-*`, `frontend/src/features/company/boq-templates/*`.
- Tests: live `pc-2-boq-revisions.js` (upload twice → one revision each, comparison; approve; lock; third upload → `comparison_only`; unlock refused); fixtures `docs/Construction_BOQ.xlsx`, `docs/bill_of_quantities.xlsx`, `docs/boq-fail.xls` (must fail cleanly).
- Commits: `feat(boq): revision approval and explicit baseline lock`, `feat(boq): structured upload columns with dry-run`, `feat(boq): company BOQ templates`, `feat(schedule): xlsx schedule import`.
- §134 stops: the BOQ lock derivation from the baselined ScheduleRevision changes IPC/EV behaviour on the 10 seed items if altered — PC-2 writes the explicit lock **in addition**, never removes the derived rule.

### PC-3 — mapping
- Scope: allocation fields (`basis`, `suggestedBy`, `confidence`, `importBatchId`, `supersededByAllocationId`), N/A rules, validation rules §70-§72, coverage group-bys and cutoff, matrix UI, mapping import/undo, suggestion service, `BoqActivity` retirement (drop deferred to M9).
- Owns: `backend/src/services/activity-boq-allocation.service.js`, new `mapping-suggestion.service.js`, `mapping-import.service.js`, `backend/src/routes/allocations.js` (or the existing allocation routes file), `project-setup-readiness.service.js:353-387` (N/A exclusion only), `schedule.service.js:314-585` (allocations check N/A exclusion only), `frontend/src/features/controls/mapping/*`, `frontend/src/features/boq/components/boq-allocation-panel.tsx`.
- Tests: `pc-3-mapping-rules.js`; Playwright `51-mapping-matrix.spec.ts`; invariant check `BOQ total = allocated + unallocated + N/A` on every E2E project.
- Commits: `feat(mapping): mapping rules and validation`, `feat(mapping): coverage by structure`, `feat(mapping): matrix view and bulk import`, `feat(mapping): suggestions with provenance`.
- §134 stops: the partial unique index stays the uniqueness truth; capacity rules unchanged.

### PC-4 — setup flow
- Scope: `structure_setup` and `boq_approval` steps, per-item detail, new warnings, gates unchanged; wizard detail UI; Overview landing (L3) with the controls strip.
- Owns: `backend/src/services/project-setup-readiness.service.js` (except the two lines PC-3 owns — sequence PC-3 before PC-4), `frontend/src/features/projects/components/project-setup-wizard.tsx`, `project-detail.tsx` (landing + strip), `routes/_authenticated/.../projects/$projectId/index.tsx`.
- Tests: `pc-4-setup-flow.js`; Playwright `52-setup-wizard-detail.spec.ts`.
- Commits: `feat(readiness): structure and BOQ approval steps with per-item detail`, `feat(projects): overview landing with controls summary`.
- §134 stops: no soft check becomes hard.

### PC-5 — progress measurement
- Scope: `QuantityProgressEntry`, `DailyLogQuantity`, quantity-method planned = approved allocation quantities, approval bundling, mobile daily-log quantities, installed/certified/paid/committed/forecast quantity views.
- Owns: `schema.prisma` (progress section), migrations `2026100502*`, `backend/src/services/progress.service.js`, new `quantity-progress.service.js`, `daily-log.service.js`, `routes/progress.js`, `routes/daily-logs.js`, `frontend/src/features/progress/*`, `mobile/src/components/ProgressSheet.tsx`, mobile daily-log screens (`mobile/app/(app)/site/*`), `mobile/src/offline/senders.ts` (new kind).
- Tests: `pc-5-quantity-progress.js`; §122 financial tenant test (two orgs); Playwright on `:8081` offline daily-log quantities.
- Commits: `feat(progress): installed quantity entries with approval authority`, `feat(daily-log): quantities installed contribute to progress`, `feat(controls): installed, certified, paid, committed and forecast quantities`.
- §134 stops: `ActivityProgress` rows are never rewritten; EV reads them unchanged.

### PC-6 — three truths, snapshots, guards
- Scope: `originalBudget` immutability guard; period locking as a reporting action (`EvPeriodSnapshot`/`BudgetSnapshot`); S-curve from snapshots; EAC basis labels; PO "order value (not committed)" rename; allocation summary `cutoffDate`; provenance labels in payloads; roll-ups by WBS/location/cost code on the cost cockpit (derived only).
- Owns: `backend/src/services/budget.service.js` (guard `:298-371`), `earned-value.service.js` (snapshot read path and S-curve `:368-395`; formulas untouched), `cost.service.js` (labels only), `forecast.service.js` (labels; dataQuality read path), `purchase-order.service.js:325-345` (rename), `activity-boq-allocation.service.js` (cutoff param — coordinate with PC-3: PC-3 first), `frontend/src/features/cost/*`, `reports/components/ev-report.tsx`, `forecast/components/forecast-panel.tsx`, `schedule/components/ev-dashboard.tsx` (label as prototype or remove).
- Tests: live `pc-6-three-truths.js` — lock two periods, S-curve has two distinct EV points; PATCH `originalBudget` after a change → 409; §139 delta 0.00 script (`Σ ledger = Σ BudgetLine.actual = Σ CostRecord.actual`; `register committed = Σ executed SOV + approved CCO`; `BOQ total = allocated + unallocated + N/A`) on the certification project.
- Commits: `fix(budget): original budget is immutable once changed or projected`, `feat(reports): locked period snapshots drive the S-curve`, `feat(cost): every figure labelled source, derived or projection`.
- §134 stops: **certified rules unchanged** — any test showing a changed revised/committed/actual figure on the certification project stops the wave; the 12 `legacy_opening_balance` ledger entries (12,568,290.33) must be present after every run (`cost-reconciliation.service.js:233-250` guard) [C].

### PC-7 — change intelligence
- Scope: `ProjectException` + engine + triggers; typed source FKs on `ChangeEvent`; `ChangeOrder.locationId/wbsNodeId`; `Rfi.changeOrderId` relation; handoff endpoint prefill; "Raise change event" actions on RFI/daily log/NCR/punch/drawing; forecast consumes approved CO links; data-quality kinds; `@@unique([projectId, ref])` on ChangeOrder/Risk/NcrRecord/ProcurementOrder after dedupe dry-run; exceptions page and dashboard tile.
- Owns: `schema.prisma` (change section), migrations `2026100503*`, new `exception-engine.service.js`, `exception-rules/*.js`, `backend/src/services/change-event.service.js`, `change-order.service.js` (links only; approval side-effects untouched), `forecast.service.js` (impact list), `events/bus.js` subscribers (new file `exception-triggers.js`), `jobs/schedulers.js` (one tick), `routes/change-events.js`, `routes/exceptions.js`, `frontend/src/features/controls/exceptions/*`, `change-events/*`, `workspace-dashboard.service.js` (tile), `frontend/src/features/dashboard/*` (tile).
- Tests: `pc-7-exceptions.js`; §122 under two orgs; Playwright `54-exception-handoff.spec.ts`.
- Commits: `feat(controls): exception engine with overrun and data-quality rules`, `feat(change): typed traceability from source records to change events`, `feat(change): handoff from exceptions and site records`.
- §134 stops: the `@@unique([projectId, ref])` additions stop if the dedupe dry-run finds duplicates (report, do not rewrite refs).

### PC-8 — Project Controls navigation and detail views
- Scope: sidebar group, BOQ Detail, Activity Detail, grouped BOQ grid, drill-downs; permission gating via existing modules.
- Owns: `frontend/src/components/layout/data/sidebar-data.ts`, `frontend/src/features/controls/*` (shell), `frontend/src/features/boq/components/boq-detail-drawer.tsx`, `frontend/src/features/schedule/components/activity-detail-drawer.tsx`, backend `routes/boq.js` (`/items/:id/detail`), `routes/activities.js` (`/:id/detail`), new `controls-detail.service.js` (read-only composition of existing services).
- Tests: Playwright `50-controls-navigation.spec.ts`; the §138 scenario spec `e2e/60-project-controls-end-to-end.spec.ts` (greenfield project: setup → BOQ → schedule import → mapping → baseline → daily-log quantities → progress approval → commitment → pay-app certification → direct cost → change event from an overrun → change order approval → locked period → reports) asserting the summary strip and §139 delta 0.00 at the end.
- Commits: `feat(controls): project controls navigation`, `feat(controls): BOQ and activity detail views`.
- §134 stops: none.

### CERT — certification (§132)
- Scope: run everything on a clean database: M1-M8 on a copy of production-shaped data (the §52 100-company fixture plus the E2E org), the §50 report, the §53 matrix, §51 persona, §122 financial tenant test, §138 end-to-end with §139 delta 0.00, all Playwright suites, mobile Jest, `stage7-security.js`, `rbac-audit.js`. Then M9.
- Owns: `backend/scripts/enterprise/certify.js` (orchestrator), `docs/architecture/OCTAPM_ENTERPRISE_CERTIFICATION.md` (report).
- Exit: every check green twice in a row (Codex-style repeat rule from the team memory); defects fixed in their owning wave's files, not in CERT.
- Commits: `chore(cert): enterprise certification run <n>`, `feat(schema): drop legacy user tenant columns (M9)`.

---

## 3. Parallelism

Independent from the start: ENT-1 (schema) ∥ PC-2 (BOQ upload/revisions, no schema) ∥ PC-8 shell ∥ ENT-4 route tree scaffolding (behind a flag). After ENT-1 merges: ENT-2 ∥ PC-1 (different schema sections; PC-1 rebases after ENT-3's relation batch touches the same models — to avoid conflicts PC-1 adds columns only, ENT-3 adds relations only). After ENT-2: ENT-3 ∥ ENT-4 ∥ ENT-5 ∥ ENT-6 (ENT-6 after ENT-2's `provisionOrganisation` change). PC-3 → PC-4 → PC-5 → PC-6 → PC-7 sequentially on the backend (shared services), with their frontends in parallel. CERT last.

---

## 4. §134 stop conditions found (consolidated)

1. `ExtraServicesConfig` unowned and read for every tenant — resolved by M1 (0 rows, no data decision).
2. `User.email @unique` + `User.orgId` — resolved by M1-M8 without touching uniqueness or merging identities (0 duplicates).
3. 90 dual-column tables with no constraint — resolved by M7 (0 mismatches; constraints only).
4. Orphan rows of deleted orgs in BackgroundJob/OutboundEvent/AuditEvent/RecordHistorySnapshot — **no FK; sweep is destructive → PO decision 2.**
5. UAT-Fixtures org with no admin; PM-without-flag admin power — owner rule + PO decision 1.
6. `PushSubscription` org overwritten; `NotificationPreference` per identity — no row changes; PO decision 6 only if per-workspace preferences are wanted.
7. `disconnectUser` drops all workspaces' sockets — replaced by `disconnectMembership` (ENT-5).
8. Web outbox has no owner; mobile cache/outbox keyed by userId — owner key migration on first load (ENT-4/5), non-destructive.
9. Structure rows (BoqItem, Activity, allocations, revisions) without orgId — kept inherited by decision; never re-keyed.
10. CostCode/vendor identities keyed to the org; moving a project between companies — **not supported**, stated in the ownership doc.
11. `BoqActivity` dead table — dropped only in M9 after a production count of 0.
12. Heterogeneous `wbsCode` values, 238 activities / 282 dependencies / 161 approved allocations — WBS is additive; nothing rewritten.
13. 10 `baselineLocked` seed items + 74 baseline-dated activities — explicit lock added beside the derived rule.
14. 12 `legacy_opening_balance` ledger entries — preserved; the reconciliation guard stays.
15. Free-text cross-record references (`ChangeEvent.sourceRecordType/Id`, `WorkflowActivityLink`, `Rfi.changeOrderId`, `BudgetRevision.linkedChangeOrder`) — typed FKs added beside them; the free-text pair is kept.
16. Three budget truths — never reconciled by rewriting; surfaced as a data-quality exception.
17. `originalBudget` PATCH-able against the certified rule — guard added in PC-6 (enforces, does not change, the rule).

---

## 5. Decisions that need the product owner

1. **Retire the "any PM administers the company" shortcut** (`rbac.js:199`) when membership admin/owner lands? Default taken: yes — every current admin is a PM and the only admin-less org gets its PM promoted; future PMs will need `isAdmin`.
2. **Purge rows of deleted organisations** in BackgroundJob (431), OutboundEvent (7,205), AuditEvent/RecordHistorySnapshot (7,335) after a retention window? Default taken: keep until you decide; no FK is added either way.
3. **Work package = a flagged WBS node** (with owner party and commitment links) rather than a new entity? Default taken: flagged node.
4. **Workspace URLs** `/o/{slug}/...` on the web (legacy `/projects/:id` links redirected)? Default taken: yes — it is what makes Back and shared links correct.
5. **Personal workspaces hold exactly one member** (the owner) plus guests; the first invitation converts to a company? Default taken: yes.
6. **Notification preferences and push devices stay per identity**, not per workspace? Default taken: per identity (device gets every workspace's pushes, each labelled).
7. **Per-company AI provider keys / opt-out** — out of scope for this programme unless required.

Everything else in these documents takes a sensible default and says so inline with **[D]**.
