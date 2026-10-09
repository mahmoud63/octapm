# OctaPM multi-tenant architecture (ENT-0 target model)

Status: architecture decision record for the enterprise programme. Written against HEAD a19ea99 on `feat/p0-foundations-sprint1`, schema `backend/prisma/schema.prisma` (8,272 lines, 239 models), Prisma 6.19.3 (`backend/package.json:31,45`), local database `octapm_verify` (23 organisations, 46 users, 432 projects, 1,352 project assignments — read-only probe 2026-09-26).

Convention used throughout: **[C]** = confirmed by reading the code at the cited line; **[I]** = inferred from the code or the data; **[D]** = decision taken in this document.

---

## 0. What the platform is today (one paragraph)

Tenancy is derived, never chosen. A `User` belongs to exactly one `Organisation` (`User.orgId String` non-null, `User.email @unique`, `schema.prisma:159-161`) and carries one global `role` and one `isCompanyAdmin` flag (`:163-164`) [C]. The access JWT is minted from that row (`backend/src/utils/tokens.js:49-57`) and `authenticate` refuses it unless the row's `orgId` still equals the token's (`backend/src/middleware/auth.js:48-61`) [C]. Everything below the org resolves through `Project.orgId`: 80 nested routers sit behind `requireProjectAccess` (`backend/src/routes/projects.js:33-37, 266-509`), which calls `assertProjectAccess` with `where: { id, orgId, <assignment|party|org-wide> }` and answers 404 outside the org, 403 inside it (`backend/src/services/project-authorization.service.js:106-158`) [C]. There is no Prisma middleware, no row-level security, no composite foreign key and no trigger that ties a denormalised `orgId` to its project's `orgId` (`backend/src/config/db.js`, migrations grep) [C]; the live data is nevertheless consistent — 0 disagreements across the 90 tables that carry both columns [C].

---

## 1. Target model (§6-§12)

```
User ──< OrganizationMembership >── Organisation ──< Project ──< ProjectAssignment >── User
 (identity)   (role, isAdmin, isOwner,   (kind: personal|company)      (role within project;
               status, per company)                                    orgId denormalised)
                                                    Project ──< ProjectParty ──< ProjectPartyMember >── User
                                                              (external company on a project)   (guest membership)
```

### 1.1 User = identity only [D]

| Field | Today | Target |
|---|---|---|
| `email @unique` (`:161`) | one login, one org | **kept**: one person, one login, platform-wide. Duplicate-identity rules in `OCTAPM_MEMBERSHIP_AND_RBAC.md` §5. |
| `orgId` (`:159`) | the tenant | becomes `legacyOrgId String?` during M4-M8, dropped in M9. Never read after M6. |
| `role` (`:163`) | global role | moves to `OrganizationMembership.role`. Column kept nullable until M9. |
| `isCompanyAdmin` (`:164`) | global flag | moves to `OrganizationMembership.isAdmin` (+ new `isOwner`). |
| MFA / SSO columns (`:168-177`) | per user | stay per identity. `ssoSubject`/`ssoProvider` gain a per-membership link table only if a second IdP is ever configured (see §11 of the membership doc). |
| `status` | active/inactive | stays: identity-level suspension. Membership has its own status. |

### 1.2 Organisation = workspace (personal or company) [D]

Additive columns on `Organisation` (`schema.prisma:11-27`):

- `kind String @default("company")` — `personal | company`.
- `slug String @unique` — URL-safe handle for deep links (§107); backfilled from `name` with a numeric suffix because `Organisation.name` is not unique (13 local orgs are named "Other Corp Contracting" [C]).
- `createdByUserId String?` — who created the workspace; ownership itself lives on the membership.

A **personal workspace is an Organisation with `kind = 'personal'`** and a `Subscription.plan = 'individual'` (`Subscription` is one per org with plans trial/individual/business/enterprise, `schema.prisma:4530-4557` [C]). Every table that today hangs off `orgId` works unchanged for a personal workspace. There is no separate workspace model and no data copy on conversion.

### 1.3 OrganizationMembership (new) [D]

Full definition, uniques, statuses and ownership rules are in `OCTAPM_MEMBERSHIP_AND_RBAC.md` §1. Summary: `@@unique([orgId, userId])`, `role` is a catalogue role id (`shared/permissions.json` roles, unchanged), `isAdmin`, `isOwner`, `kind member|guest`, `status invited|active|suspended|left`. **`CompanyMembership` (`schema.prisma:405-425`) is NOT reused**: it is an org-scoped directory link between a user and a vendor/party `Company`, written only as a side effect of party membership (`backend/src/services/company-party.service.js:583-601, 687-706`), never read for authorisation, and empty in the local DB [C].

### 1.4 Project and ProjectAssignment

- `Project` is unchanged except `@@unique([id, orgId])`, which is what makes composite foreign keys possible (§4).
- `ProjectAssignment` (`schema.prisma:698-709`) gains `orgId` (denormalised, backfilled from `Project.orgId`) and two composite FKs: `(projectId, orgId) → Project(id, orgId)` and `(orgId, userId) → OrganizationMembership(orgId, userId)`. The second one is the database-level statement of "you can only be assigned to a project of a company you belong to", which nothing enforces today (0 cross-org rows exist only because `User.orgId` is single [C]).
- `ProjectUserPermission` (`:6600-6620`) already carries `orgId`; it gets the same two composite FKs.
- `ActivityAssignment`, `RfiAssignee`, `WorkflowStepAssignment.userId` (bare string, `:7425`) stay as they are: they are reachable only through a project-nested route that has already resolved the project, and their `userId` is validated by the service against project assignments. Adding an `orgId` to them is not needed for isolation and is deferred.

### 1.5 Personal → company conversion path (§13-§14) [D]

`POST /api/v1/organisations/:id/convert` (owner only):

1. Refuse unless `kind = 'personal'` and the caller's membership `isOwner`.
2. Set `kind = 'company'`, `name`, `slug`, `Subscription.plan` (`individual → business` via the existing billing path, `backend/src/routes/billing.js`). *As shipped (ENT-6): the label `Organisation.plan` moves `individual → standard`, the slug is kept, and `Subscription` is left alone so a conversion never re-prices billing — see the ownership doc, "Personal → company, as shipped".*
3. Nothing else moves: projects, BOQs, cost codes, warehouses, templates, ledger entries all already carry the same `orgId`. Ledger idempotency (`CostLedgerEntry @@unique([orgId, sourceKey])`, `schema.prisma:8190`) is untouched because `orgId` does not change.
4. Record `AuthAuditEvent` `organisation.converted` (§113 event list). *As shipped: `workspace.converted`.*
5. Personal workspaces may hold only one `member`-kind membership (the owner) plus guests; the first invitation from a personal workspace prompts the conversion (UI rule; server refuses `POST /users/invite` with `409 WORKSPACE_IS_PERSONAL` until converted). *As shipped: `409 PERSONAL_WORKSPACE_CONVERT_REQUIRED`, on every path that would seat a member. Since D-ID-1 (2026-10-05) the paths are `POST /users/invitations` and its deprecated alias `POST /users` (both answer with an invitation, never a user; nobody is added except by invitation), checked again under the organisation lock at acceptance; a party (guest) invitation is not refused. See `OCTAPM_MEMBERSHIP_AND_RBAC.md` §5.*

The reverse (company → personal) is not offered.

---

## 2. Server tenant context — one mechanism (§15, §31-§34)

### 2.1 How orgId is established per request [D]

Exactly one path, in `backend/src/middleware/auth.js`:

1. Bearer JWT → `verifyAccessToken`. Claims become `{ sub, orgId, mid (membershipId), role, isAdmin, isOwner, kind, email, name, type:'access' }` (replacing `{ sub, orgId, role, email, name, isCompanyAdmin }` at `tokens.js:49-57`).
2. `authenticate` re-reads **the membership**, not the user: `organizationMembership.findFirst({ where: { id: payload.mid, userId: payload.sub, orgId: payload.orgId, status: 'active' }, include: { user: { select: { status } }, org: { select: { kind, slug } } } })`. Refuse with `401 USER_INACTIVE` if missing, if the user is not `active`, or if the org is archived. This keeps the CX21-485 property that a demoted or removed person loses authority immediately (`auth.js:44-47` comment) [C].
3. `req.user = { id, orgId, membershipId, role, isCompanyAdmin: isAdmin || isOwner, isOwner, orgKind, orgSlug, email, name }`. The property name `isCompanyAdmin` is kept so the 40+ read sites listed in the identity audit keep working unchanged [D].
4. *Added by D-ID-1 (2026-10-05):* the token's `cep` claim must equal the identity's current `credentialEpoch`, otherwise `401 SESSION_REVOKED` (a token minted before a password reset, identity close or admin MFA reset). The same check runs on refresh, workspace switching and the socket handshake. See `OCTAPM_MEMBERSHIP_AND_RBAC.md` §5.2.
4. API keys: `ApiClient` is already bound to `(orgId, userId)` (`schema.prisma:7572-7595`) and refused when the owner's org differs (`backend/src/services/api-client.service.js:140-145`) [C]. Target: `ApiClient.membershipId` (backfilled), and `authenticateApiKey` resolves the membership the same way as step 2. A key acts as one person in one workspace.
5. Sockets: `backend/src/realtime/socket.js:64-102` mirrors step 2 with the membership lookup.
6. Refresh: `RefreshSession` gains `membershipId`; `auth.service.js:496-507` binds `session.membershipId === payload.mid` and re-mints from the membership row, not from `session.user`.

**There is no client-chosen orgId on any authenticated request.** Today the only client-supplied orgId is `POST /auth/sso/start` (`backend/src/routes/auth-security.js:37`), which picks the IdP [C]; that stays. Workspace choice happens only at token-issue time: `POST /auth/workspaces/:orgId/session` (see `OCTAPM_WORKSPACE_SWITCHING.md` §2), which requires a valid session for the same `sub` and an active membership in the target org, and returns a new access+refresh pair bound to that membership.

### 2.2 How project → org is verified

Unchanged: `assertProjectAccess({ orgId: req.user.orgId, projectId, userId, role, isCompanyAdmin })` with `where: { id: projectId, orgId, ...getProjectAccessWhere }` (`project-authorization.service.js:148-158`) [C]. Two additions [D]:

- `getProjectAccessWhere` adds `orgId` to the assignment predicate: `assignments: { some: { userId, orgId } }` (`:31-36`). Redundant once the composite FK exists, kept as defence in depth and so the predicate is correct before M7.
- The party predicate (`:38-52`) is unchanged; a party member is a `guest` membership in the host org (§6 below), so the org filter is satisfied by the JWT.

### 2.3 What the three middlewares become

| Middleware | Today | Target |
|---|---|---|
| `requireOrganizationMembership` | does not exist; `authenticate` implies it | Explicit middleware used by every org-level router (`app.js:113-133` mounts 18) that asserts `req.user.membershipId` and, with option `{ kind: 'member' }`, refuses `guest` memberships (`403 GUEST_FORBIDDEN`). `authenticate` already guarantees an active membership, so this is an assertion plus the guest gate — not a second lookup. |
| `requireProjectAccess` (`backend/src/middleware/project-access.js:9-38`) | as above | Signature unchanged. Reads `req.user.orgId` (membership-derived). `attachTemplateContext` unchanged. |
| `requirePermission` / `hasPermission` (`backend/src/middleware/rbac.js:44-68`) | decision order API-key scope → company-admin modules → template → catalogue role OR party | **Unchanged order.** `getEffectiveRole` (`rbac.js:18-19`) still reads `req.projectAccess.role || req.user.role`; `req.user.role` is now the membership role. `isCompanyAdmin(req)` reads the membership-derived flag. |
| `requireCompanyAdmin` (`rbac.js:188-209`) | `isCompanyAdmin OR effective role pm` | `isAdmin OR isOwner`. The `pm` shortcut is retired in ENT-2 (see membership doc §4 for why this is safe on the live data and the one org that needs a rule). |

Nothing else in the authorisation chain changes: `permission-template.service.js` (`resolveTemplateContext` chain ProjectUserPermission → party template → catalogue, `:32-34, 401-440`), `config/permissions.js` `can`/`canParty`, and `shared/permissions.json` are untouched. **No parallel permission engine is introduced.**

### 2.4 What stays as is

- The 80-router `nestedProjectAccess` mounting pattern (`routes/projects.js:33-37`).
- Service-layer `where: { orgId }` / `where: { id, projectId }` discipline; the 542 id-keyed lookups audited (465 constrained, 77 safe-by-caller, 0 cross-tenant) [C].
- Storage keys `orgs/{orgId}/projects/{projectId}/{prefix}/` (`backend/src/services/file-storage.service.js:477-485`) and `getDocumentByPublicKey` [C].
- `CostLedgerEntry @@unique([orgId, sourceKey])` and every certified financial rule.
- The four below-tenancy tables (`socket_io_attachments`, `AuthThrottle`, `RateLimitBucket`, `ReferenceCounter`; comment at `schema.prisma:8223-8229`) [C].

---

## 3. Org context on the non-request surfaces (§42-§47)

| Surface | Today [C] | Target [D] |
|---|---|---|
| **Search** | `listAccessibleProjects` where `{ orgId, ...getProjectAccessWhere }` (`search.service.js:770-808`); omits `isCompanyAdmin` at `:792, :806` so admins search narrower than REST | Pass `isCompanyAdmin` (one-line fix, ENT-3). No other change: search is already org-bounded by the token. |
| **Files** | every download route project-nested; object keys embed org and project; presigned 5-min URLs (`file-storage.service.js:879-905`) | Unchanged. |
| **Realtime** | rooms `org:{orgId}` (never emitted to), `user:{userId}`, `project:{id}`; routing by `recipientUserIds` → user rooms (`socket.js:21-22, 154-161, 234-235`); `disconnectUser` drops every socket (`:201-207`) | User room becomes `member:{membershipId}` so a user-addressed event reaches only sockets connected in that workspace; `user:{userId}` is kept for identity-level nudges (badge counts across workspaces); `org:{orgId}` starts carrying org-level events (membership changes, workspace renamed). `disconnectMembership(membershipId)` replaces `disconnectUser` at `routes/users.js:134,178`. Event routing reads `event.orgId` (already serialised at `:176-187`) to pick the member room. |
| **Event bus** | `bus.publish` refuses events without `orgId`; `OutboundEvent` stores `orgId, projectId, recipientUserIds` (`events/bus.js:77-95, 136-155`) | Unchanged shape. Recipients stay user ids; the socket layer maps `(userId, event.orgId)` → member room. |
| **Notifications** | row carries `orgId`, `recipientUserId`, `actionUrl` = `/projects/:id/...` (`utils/record-links.js:88-102`); preferences unique `(userId, category)` (`schema.prisma:4170+`); push unique by `endpoint`, `orgId` overwritten on re-register (`push.service.js:120-124`) | `actionUrl` gains the workspace segment `/o/{slug}/...` (single builder `recordWorkspacePath`). Push payload gains `orgId` + `orgSlug`; `PushSubscription.orgId` becomes informational (device belongs to the identity; fan-out iterates memberships). `NotificationPreference` stays per identity (assumption, listed for the PO). Email links use the same builder. |
| **Jobs** | `BackgroundJob.orgId` required, no FK (`schema.prisma:6623`); handlers mostly re-check `job.orgId`; three trust payload/row (`boq.service.js:1063-1105`, `accounting.service.js:399`, `webhook.service.js:349-352`) [C] | Rows keep `orgId` with **no FK** (431 orphan rows of deleted orgs exist; adding an FK is destructive) and gain `membershipId?` for "run as". `enqueueJob` requires `orgId` (already) and the worker passes `{ orgId, projectId, membershipId }` into every handler; the three handlers are changed to load their subject `where: { id, orgId: job.orgId }`. Orphan rows of deleted orgs are removed by a retention sweep (dry-run script), not by a migration. |
| **Schedulers** | leader process; per-org ticks (portfolio, weather, accounting, due scan) and row-scoped scans [C] | Unchanged; per-org ticks iterate `Organisation where status active`. Billing reminder recipient becomes "an owner membership" instead of "first user with role pm" (`billing-scheduler.js:80-85`); resolution is `membership.service findBillingRecipient`: a future organisation billing contact (e.g. `Organisation.billingContactEmail`) → owner membership → legacy earliest pm (ownership doc, "Billing recipient"). |
| **AI** | one platform provider (`ai-provider.service.js:21-27`); retrieval bounded by `globalSearch({orgId,userId,role})` and `{orgId, projectId}` document hits (`retrieval.service.js:59-136`); conversations `{orgId, userId}` [C] | Unchanged mechanism; `orgId` comes from the membership token. `AssistantConversation` stays per `(orgId, userId)`, i.e. per workspace. `rfi-assistant.similar` (`:135-138`) stays org-wide by design. Per-org provider keys are out of scope (PO decision list). |
| **Caches** | compiled template cache keyed by `templateId` (`permission-template.service.js:341-395`); rate-limit keys `user:{orgId}:{userId}` (`rate-limit.js:16-27`) [C] | Unchanged (template ids are global uuids; rate limits per workspace are acceptable). Any new membership cache follows the `updatedAt` invalidation pattern. |
| **Email** | one sender; links `WEB_APP_URL + path` (`email.service.js:28-43`) [C] | Links go through `recordWorkspacePath`; invitation copy names the workspace and its kind. Per-company branding out of scope. |
| **Inbound email** | org derived from the record's project; sender matched by email within org (`inbound-email.service.js:287-331`) [C] | Sender match becomes "user by email AND active membership in the record's org". |

---

## 4. The §36 composite-FK decision

**Decision [D]: adopt composite foreign keys `(projectId, orgId) → Project(id, orgId)` on every table that carries both columns, in batches, after M3.** Do not add `orgId` to the 68 project-only tables (§35 in the matrix doc).

Feasibility checked:

- **Prisma.** Multi-field relations are supported on PostgreSQL: `project Project @relation(fields: [projectId, orgId], references: [id, orgId], onDelete: Cascade)` requires the referenced side to have `@@unique([id, orgId])`, which is added to `Project` (trivially valid since `id` is the primary key). Prisma 6.19.3 is in use (`backend/package.json:31,45`). The scalar `orgId` may participate in two relations (the composite one to `Project` and the existing one to `Organisation`); Prisma then generates only the *unchecked* create/update inputs for the model — the codebase already writes scalar ids everywhere: **0 occurrences** of `project: { connect` or `org: { connect` in `backend/src` (grep, this session) [C], so no service needs rewriting.
- **Postgres.** `ALTER TABLE ... ADD CONSTRAINT ... FOREIGN KEY ("projectId","orgId") REFERENCES "Project"("id","orgId")` is standard; validated against the live data by the probe (0 disagreements across all 90 tables). Use `NOT VALID` + `VALIDATE CONSTRAINT` to avoid a long lock on `AuditEvent` (22,677 rows) and `OutboundEvent` (22,689 rows).
- **Migrations** are produced with `prisma migrate diff` and dated after the future-dated existing ones (last: `20261003090000_user_mfa_last_totp_step`), per the schema-drift rule in the team memory.

Which tables get it (90 = 24 in the first half + 66 in the second, per the matrix doc): all PROJECT+ORGANIZATION rows with both columns non-null. Nullable-project tables (`InventoryItem`, `Warehouse`, `StockTransaction`, `Notification`, `InvitationToken`, `AuditEvent`, `RecordHistorySnapshot`, `AuthAuditEvent`, the nine "null = company library" tables) get a composite FK only where `projectId` is non-null — Postgres `MATCH SIMPLE` semantics skip the check when any column is NULL, so the same constraint works.

Explicitly excluded (no FK, ever, by this programme): `BackgroundJob`, `OutboundEvent`, `AuditEvent`, `RecordHistorySnapshot` on the **org** side, because 431 / 7,205 / 7,335 live rows belong to deleted organisations [C] and an FK would force deletion. They keep a composite FK to `Project` only where the project exists — i.e. they are excluded from the project-side batch too, and are handled by the retention sweep.

The 14 relation-less tables (`Signature`, six `DailyLog*`, `NotificationDeliveryAttempt`, six `Bid*`, `AssistantMessage`, `PrequalCriterion`, `EvaluationCriterion`) get ordinary relations to `Organisation` and `Project` (or the composite one) in the same batch; 0 mismatches exist [C].

---

## 5. §35 — direct orgId vs inherited (rule)

A table carries its own `orgId` when at least one of these holds; otherwise it inherits through `Project` (full list in `OCTAPM_TENANT_MODEL_MATRIX.md` §3):

1. It can exist without a project (org masters, "null = company library", inventory).
2. It is queried org-wide without a project in the path (Task list, Notification, Inventory, DocumentText full-text, Conversation, CostLedgerEntry idempotency).
3. It is an access/membership row (`OrganizationMembership`, `ProjectAssignment`, `ProjectUserPermission`, `ApiClient`).
4. It addresses its subject polymorphically (`AuditEvent`, `Attachment`, `Comment`, `WorkflowInstance`) so the project is not always resolvable from a typed FK.

The BOQ/schedule/cost/commercial core (`BoqItem`, `Activity`, `ActivityBoqAllocation`, `CostRecord`, `ChangeOrder`, `IpcCertificate`, `ProcurementOrder`, `Rfi`, `Submittal`, …) matches none of these: every access path resolves the project first. **Adding `orgId` there is not done** — it touches certified financial tables for no isolation gain.

---

## 6. §99 external collaboration extension point [D]

Today an external collaborator is a `ProjectPartyMember` on a `ProjectParty` (a `Company` on a project with a role and optional permission template, `schema.prisma:637-696`), and the user row lives in the host org [C].

Target, in this programme: the same person is a **`guest`-kind membership** in the host organisation (`OrganizationMembership.kind = 'guest'`, `role = 'external_party'` — the effective role that `assertProjectAccess` already derives at `:167` [C] but never stores). A guest:

- is refused by `requireOrganizationMembership({ kind: 'member' })` on org-level routers (users, company workspace, inventory, portfolio, reports, permissions);
- reaches only projects where an active `ProjectParty` has them as an active member — exactly the party predicate at `project-authorization.service.js:38-52` [C];
- is invited through the existing `InvitationToken` (`orgId + projectId + companyId + projectPartyId`, `schema.prisma:759-798`) [C].

Extension point for later (not built now): `Company.linkedOrgId String?` — when the subcontractor is itself an OctaPM company, its people are invited by membership in *their* org and appear on the host's party through the link, so the host never holds their identity. Everything above (guest membership, party predicate, invitation token) is designed so that adding `linkedOrgId` is additive.

---

## 7. Isolation guarantees after the programme (summary)

| Guarantee | Mechanism |
|---|---|
| A token acts in one workspace | `mid` claim + membership re-read per request (§2.1) |
| A project is only reachable inside its org | `where { id, orgId }` in `assertProjectAccess` (existing) |
| A row's `orgId` can never disagree with its project's | composite FK (§4) |
| A person can only be assigned to projects of companies they belong to | `ProjectAssignment (orgId,userId) → OrganizationMembership` FK |
| Org masters referenced from project rows belong to the same org | service checks stay (e.g. `company-party.service.js:385`); a composite FK `(costCodeId, orgId) → CostCode(id, orgId)` is added for `BudgetLine`, `ProjectCostCode`, `CommitmentSovLine`, `TimeEntry`, `ChangeEventLine`, `DirectCostLine` in ENT-3 (0 mismatches today) |
| No client-supplied tenant | only `POST /auth/sso/start` takes an orgId, pre-authentication (existing) |
| Certified money stays certified | ledger, register, commitment and certification code paths are not touched by ENT waves |
