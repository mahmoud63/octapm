# OctaPM Platform Superadmin — discovery (V1)

Date: 2026-10-04. Branch `feat/platform-superadmin-v1`, worktree
`.claude/worktrees/platform-admin`, branched from the integration head
`fbc0f76` (`feat/p0-foundations-sprint1`). The certification branch
`cert/full-saas-certification` (`f16c14f`, 54 commits ahead of `fbc0f76`,
CERT-2 in progress with uncommitted work) was inspected read-only and not
touched; it changes nothing under `backend/prisma`.

Isolation used for this work:

- Own Prisma client: `backend/node_modules` in this worktree is a real folder
  (junctions for every package except `@prisma/client` and `.prisma`, which are
  copies), so `prisma generate` here cannot change the client the cert or
  integration processes load.
- Own database: `octapm_platform_admin` on the dev cluster `:55432`, created
  from empty with `migrate deploy` + `db:seed`. Not `octapm_verify`, and not
  the cert cluster `:55433` / `octapm_cert`.

## What exists

| Area | Finding | Class |
|---|---|---|
| Platform-wide authorisation | None. No env var, claim or role grants access across organisations. `User.role` mentions `super_admin` only in a schema comment; it was removed from `ORG_WIDE_PROJECT_ACCESS_ROLES` and is refused as a membership role. | MISSING |
| `User.role = super_admin` | Dead value; reviving it would let a membership/catalogue role carry platform power. | DO NOT USE |
| Company Admin (`isAdmin` / `isOwner` / `isCompanyAdmin`) | Per-organisation administration on `OrganizationMembership`. | DO NOT USE for platform access |
| `authenticate` (`middleware/auth.js`) | Verifies the JWT, re-reads the membership every request; identity tokens only on `GET /auth/me`; API keys act as their owner. | REUSE (token verification only) — platform guard adds its own DB check and refuses API keys |
| `requireOrganizationMembership` | Org-scoped gate. | DO NOT USE (platform routes are not org-scoped) |
| Organisation | `id, name, plan (workspace label, deprecated), status, kind (personal/company), slug, defaultTimezone, createdAt` | REUSE |
| OrganizationMembership | `role, kind, isAdmin, isOwner, status (invited/active/suspended/left), joinedAt, lastActiveAt` — `lastActiveAt` is never written. | REUSE (counts); `lastActiveAt` DO NOT USE |
| User | `email, status, lastLogin (written at login + SSO), mfaEnabled, createdAt`; secrets on the same row (`passwordHash`, `mfa*Enc`, backup codes). | REUSE with an explicit `select` allowlist |
| Project | `orgId, name, status, archivedAt, createdAt`; commercial columns (`contractValue`, `ldRatePerDay`, …) | REUSE metadata only; commercial columns DO NOT USE |
| ProjectAssignment | project membership counts | REUSE |
| InvitationToken | `status, expiresAt, acceptedAt, revokedAt` | REUSE (pending counts; never `tokenHash`) |
| RefreshSession | session rows per workspace; `tokenHash`, `ipAddress` | REUSE as an activity signal only (row `createdAt` per org/user, counted); `tokenHash` / `ipAddress` DO NOT USE; not a session-length model |
| Subscription + `serializeSubscription` | canonical billing state (`plan, status, seats, trial*, currentPeriodEnd, cancelAtPeriodEnd, canceledAt`, Stripe ids). `getCurrentSubscription` *creates* a row when missing. | EXTEND (read rows + reuse `serializeSubscription`/`isExpired`; never call `ensureSubscription`); Stripe ids shown only as present/absent |
| Invoice | `status paid/failed` | REUSE (payment-issue indicator) |
| AuditEvent | org-scoped, customer-visible record trail (`entityType, action, actorId, occurredAt`), summaries carry content. No `occurredAt`-only index. | REUSE as the record-activity source (counts of `entityType`/`action` only, never summaries); EXTEND with an `occurredAt` index; DO NOT USE for platform-admin audit (requires `orgId`, customers read it) |
| AuthAuditEvent | identity events, `orgId` optional; no successful-login row. | REUSE for engagement where present; not the platform audit sink (mixes customer-visible auth history) |
| BackgroundJob | statuses queued/running/succeeded/failed/cancelled, `errorCode`, `heartbeatAt`, `runAfter`; per-project routes only. | REUSE (failed/stuck/queue depth by aggregate; never `payloadJson`/`errorMessage`) |
| WebhookDelivery | `status pending/delivered/failed/dead`, `responseStatus` | REUSE (counts; never `payloadJson`/`responseBody`/`error`) |
| NotificationDeliveryAttempt | channel/status/errorCode — the email/push delivery record | REUSE (counts by channel/status/errorCode) |
| Storage | `ProjectDocument.sizeBytes` per org | REUSE (sum) |
| Error persistence | None: 5xx go to stderr as one redacted JSON line; `res.locals.errorCode` is set by the error handler; no metrics endpoint, no Sentry. | MISSING → add count-only `PlatformErrorEvent` |
| Product telemetry | None (no posthog/segment/track). | MISSING → add `ProductEvent` + one service |
| Health / release | `/api/health`, `/ready` (SELECT 1 with timeout), `getRelease()` | REUSE |
| Schedulers | leader-elected, no heartbeat record | MISSING (reported "not available", not invented) |
| OpenAPI / error catalogue | every `/api/v1` route documented (validator + jest); new codes in `error-codes.js` and the spec `ErrorCode` enum | EXTEND |
| Live test kit | `createLiveOrg`, `createLiveUser`, `mintAccessToken`, `dropLiveOrg`; `.env` → this worktree's own DB | REUSE |
| Frontend | TanStack Router file routes, `_authenticated` guard via `/auth/me`, top-nav shell (no sidebar), `apiClient` with workspace re-binding, shadcn ui, Recharts directly, no DataTable wrapper | REUSE; new pathless `_platform` layout so the console has no workspace shell |

## Decisions taken from this

1. Platform access is a separate table `PlatformUserAccess` (one row per user,
   role `platform_superadmin`, active/revoked, reason, grantedBy), granted and
   revoked only by a CLI script — there is no API to grant it. V1 implements one
   role; SUPPORT / ANALYST are not built.
2. `/api/v1/platform-admin/*` has its own guard; it never calls org-scoped
   services, and no ordinary service gains an `isSuperAdmin` branch.
3. Platform-admin audit goes to its own `PlatformAuditEvent` table, one row per
   request including reads.
4. Product analytics = **record activity** from the existing `AuditEvent`
   (counts by entity type/action — available for all history) + **tracked
   usage** from the new `ProductEvent` (screen opens etc. — starts empty; the
   UI says so rather than showing zeros as facts).
5. Error analytics = new count-only `PlatformErrorEvent` written from the same
   response-finish hook; message/stack stay in the log only.
6. Every number on the console is a query over canonical rows. Where a signal
   does not exist (scheduler heartbeat, queue worker liveness, sessions) the
   page says "not available".
