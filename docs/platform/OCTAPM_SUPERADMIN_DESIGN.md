# OctaPM Platform Superadmin V1 — design

Read-only platform operations console for trusted OctaPM staff. Not Company
Admin. Discovery: `OCTAPM_SUPERADMIN_DISCOVERY.md`.

## 1. Scope

Delivered: platform authorisation, Overview, Companies (+ detail), Users,
Projects, Subscriptions, Product Adoption, System Health (+ API errors),
Audit, AI Usage placeholder.

Not delivered by design: impersonation / "log in as", any edit of customer
data, billing mutation, support-access to customer content, AI activation,
support tickets, CRM, production deployment.

## 2. Authorisation

- `PlatformUserAccess` (one row per user): `role` (`platform_superadmin`
  only — CHECK constraint), `status` active/revoked (CHECK; revokedAt must
  match), required `reason`, `grantedBy`.
- Granted / revoked **only** by `backend/scripts/platform/platform-access.js`
  (`--list | --grant | --revoke`, dry run unless `--apply`, refuses a
  non-local database unless `ALLOW_DATA_SCRIPT` names it exactly). Each change
  is written to `PlatformAuditEvent`. There is no API to grant access.
- `middleware/platform-admin.js` `requirePlatformAdmin` on every
  `/api/v1/platform-admin/*` route. Fails closed:
  - no / bad / expired token → 401;
  - public API key → 403 `PLATFORM_ACCESS_REQUIRED` (keys act for a company);
  - inactive account → 401 `USER_INACTIVE`;
  - no active access row → 403 `PLATFORM_ACCESS_REQUIRED` — company owners,
    admins, PMs, every catalogue role and membership included; no
    organisation standing is read;
  - MFA not enrolled → 403 `PLATFORM_MFA_REQUIRED`. Required everywhere
    unless `PLATFORM_ADMIN_REQUIRE_MFA=false`, which is ignored when
    `NODE_ENV` or `APP_ENV` is production.
- Access is re-read on every request: a revocation takes effect on the next
  request. Workspace-bound and identity tokens are both accepted — platform
  access belongs to the person, not a workspace — and `req.user` is not set:
  platform handlers have no tenant.
- Ordinary routes are unchanged: no service gained an `isSuperAdmin` branch,
  and an operator has exactly their own memberships' access to customer data.
- The web console route (`/platform-admin`, pathless `_platform` layout, not
  under `/o/{slug}`) asks `GET /platform-admin/session` and shows 403 when
  refused; the API is the authority either way.

## 3. Audit

`PlatformAuditEvent` — one row per console request, reads included, plus one
per refusal of a signed-in person (`platform.access_denied.*`) and per grant /
revoke. Written **before** the handler runs; if it cannot be written the
request answers 503 `PLATFORM_AUDIT_UNAVAILABLE` and nothing is served. The
final status is filled in when the response finishes. Stored: actor id/email/
role, action, target (organisation id where applicable), method, redacted
path, query parameter **names** (never values), status, request id, time.
Kept apart from `AuditEvent` (org-scoped, customer-visible).

## 4. Read models (`services/platform/`)

- Platform metadata only: names, statuses, dates, counts. Never record content
  (RFI text, documents, messages), commercial figures (contract value,
  budgets, costs), credentials (password hash, MFA material, token hashes) or
  provider ids (Stripe ids → booleans).
- Subscriptions are read from the `Subscription` rows through the billing
  service's own `serializeSubscription` / `isExpired`; `ensureSubscription`
  (which creates a row) is never called.
- "Last activity" = latest `AuditEvent` change, `ProductEvent`, or
  `RefreshSession` issue/refresh (counted only), within a 90-day bound.
- Every list is paged (`page`, `pageSize` ≤ 100); every cross-company figure
  is one grouped query; per-row enrichments (storage, errors, members) are
  one query for the page's ids. Sorts and filters are allow-listed; all SQL is
  parameterised.
- Cross-company counts include only organisations that exist and are active
  (`AuditEvent` / `ProductEvent` have no FK and outlive deleted orgs) — the
  same population as the "active companies" denominator.

## 5. Product analytics

Two labelled sources:

1. **Record activity** — `AuditEvent` counts by module (entity type → module
   map) and action; history from day one.
2. **Tracked events** — `ProductEvent`, written by one service
   (`telemetry.service.js`): bounded in-memory buffer (5,000 rows/table),
   batched `createMany` every 2 s, never awaited by a request, failures counted
   (dropped / failed flushes / last code shown on System Health) and logged
   once to stderr, never retried, never thrown.
   - Server events: `middleware/platform-telemetry.js` matches successful
     responses against `SERVER_EVENT_RULES` (project created, BOQ imported,
     schedule imported/generated/baselined, mapping imported/approved,
     progress submitted/approved/imported, daily report/log, RFI
     created/submitted/answered/closed, submittal, change event/order, NCR,
     punch, inventory received/issued, report generated, search executed).
   - Client events: `<module>.opened` screen opens, `POST /api/v1/telemetry/events`
     (≤ 20 per call, catalogue names only, project ids outside the caller's
     workspace dropped). Web: `useScreenOpenTracking` in the signed-in layout,
     derived from the existing `/projects/$projectId/$module/$child` slugs,
     5-minute de-duplication, 10-second batches.

Privacy: a `ProductEvent` row has no free-text column and no metadata blob;
DB CHECKs restrict names/modules/actions to lower-case catalogue words and
platform/source to fixed values. Error rows hold status, a code (only if it is
code-shaped), method, a normalised route (ids, dates, numbers and any non-word
segment → `:id`) and the tenant.

Pages report behaviour only ("Product Adoption", never "liked"): module
usage, share of active and of eligible companies, DAU/WAU/MAU (activity-based
— no session model exists, so no session counts), returning people,
sign-up series, last sign-in distribution, repeat use (≥ 2 active days), and
funnels from the records' own current statuses (project setup, RFI, progress,
daily reports).

## 6. System health

DB `SELECT` latency/size/connections/long queries; background jobs by status,
queue ready/scheduled/running/stuck (no heartbeat 5 min), recent failures
(type, error code — never message/payload); worker liveness inferred from job
heartbeats; scheduler leader = the advisory lock (class 918273) **in this
database**; webhook and notification delivery counts; release identity;
telemetry pipeline counters. API errors: totals, top codes, by module, by
company, top 5xx routes, 14-day series, spikes (≥ 10 and > 3× median).
Messages and stacks stay in the redacted server log (find by request id).

## 7. AI usage (future)

Page reserved, shows no numbers. Planned source: one AI-request record per
call written by the AI service layer — feature, model, input/output tokens,
cost (tokens × price table of the day), latency, outcome/error code, feedback;
identifiers and counts only, never prompts or answers.

## 8. Database (migrations `20261005070000_platform_admin`, `20261005070100_audit_event_occurred_at_idx`)

070000 (one transaction): `PlatformUserAccess`, `PlatformAuditEvent`,
`ProductEvent`, `PlatformErrorEvent`. 070100 (single statement, outside a
transaction): `CREATE INDEX CONCURRENTLY "AuditEvent_occurredAt_idx"` for
cross-company time windows — writes to AuditEvent continue during the build;
no `IF NOT EXISTS`, so a retry after an interrupted build fails loudly instead
of keeping an INVALID index. No existing column, constraint or row changes.
Preflight, scale test and recovery procedure:
`OCTAPM_SUPERADMIN_MIGRATION_PREFLIGHT.md`; after deploy run
`node scripts/db/check-invalid-indexes.js`.

## 9. Known limits (V1)

- Retention: `ProductEvent` / `PlatformErrorEvent` / `PlatformAuditEvent`
  grow without a purge job yet.
- Mobile app does not send screen-open events yet (its API calls still produce
  server events tagged `mobile`).
- Offset paging (`page`/`pageSize`) rather than cursors; adequate for the
  organisation counts in view, revisit past ~10k rows per list.
- Telemetry counters on System Health are per API process.
