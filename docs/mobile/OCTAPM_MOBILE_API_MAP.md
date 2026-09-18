# OctaPM Mobile — API and Rules Map

**Audience:** the mobile team and anyone reviewing what the field app may and may not do.
**Status:** verified against the backend source on 2026-09-18 (nine subsystem surveys, consolidated). Every claim names the file it was checked in; "absent" means the code was searched and nothing exists. Where a row says "+ cookie", a native client (request header `X-OctaPM-Client: mobile`) receives the refresh token in the response body instead; section 1.2 explains the two channels.
**Companion documents:** [Architecture](OCTAPM_MOBILE_ARCHITECTURE.md), [Feature matrix](OCTAPM_MOBILE_FEATURE_MATRIX.md), [Offline policy](OCTAPM_MOBILE_OFFLINE_POLICY.md), [Permission matrix](OCTAPM_MOBILE_PERMISSION_MATRIX.md), [Implementation plan](OCTAPM_MOBILE_IMPLEMENTATION_PLAN.md).

Two conventions the map assumes everywhere:

- **Request ids.** Every request may carry `X-Request-Id` (4–80 characters of letters, digits, dot, underscore or hyphen); the server keeps it, otherwise mints a UUID, echoes it in the `X-Request-Id` response header and puts it in `error.requestId` on every error envelope. The app shows it as the support reference. `backend/src/middleware/request-id.js`
- **Error envelope.** `{ success:false, error:{ code, message, details?, requestId } }`. The app maps it to its own error model (see the Architecture document); it never shows a raw server message when the message looks technical.

## 1. Authentication and session model

### 1.1 Endpoints

| Method | Path | Purpose | Permission | Notes |
|---|---|---|---|---|
| POST | `/auth/register` | Create org + first user (role `pm`, `isCompanyAdmin:true`) | none (authLimiter 80/15 min per IP on whole `/auth` router) | `{ orgName?, name, email, password(min 8), phone? }` → 201 `{ organisation, user, tokens:{accessToken,tokenType:'Bearer',expiresIn} }` + `Set-Cookie pmc_refresh_token`. 409 `EMAIL_ALREADY_EXISTS`. `backend/src/routes/auth.js:93`, `auth.service.js:240-277` |
| POST | `/auth/login` | Password login, step 1 | none (loginLimiter 12/15 min per IP+email; in-process abuse backoff) | `{ email, password }` → `{ user, tokens }` + cookie, **or** `{ mfaRequired:true, mfaToken, methods }` with no cookie. 401 `INVALID_CREDENTIALS`, 403 `USER_INACTIVE`, 403 `SSO_REQUIRED`, 429 `LOGIN_BACKOFF` / `LOGIN_TEMPORARILY_LOCKED`. `user.mfaEnrollmentRequired` set when org requires MFA. `auth.js:110-131`, `auth.service.js:303-399` |
| POST | `/auth/mfa/verify` | Login step 2 | none (loginLimiter) | `{ mfaToken(>=20, JWT type 'mfa', 5 min), code(6-12) }` → `{ user, tokens }` + cookie. 401 `MFA_CHALLENGE_EXPIRED` / `MFA_CHALLENGE_INVALID` / `MFA_CODE_INVALID`. `auth-security.js:18-28`, `mfa.service.js:147-164` |
| GET | `/auth/mfa` | Caller MFA status | auth only | `{ enabled, enrolledAt, backupCodesRemaining, pending, required, enrollmentRequired, ssoLinked }`. `auth-security.js:30` |
| POST | `/auth/mfa/setup` / `/enable` / `/disable` / `/backup-codes` | TOTP enrolment/management | auth + `noApiKey` (403 `API_KEY_FORBIDDEN`) | enable `{ code(6-8) }` → `{ enabled:true, backupCodes[10] }`; disable `{ password, code }` (403 `MFA_REQUIRED_BY_ORG` for non-admins); backup-codes `{ code }`. `auth-security.js:31-34` |
| GET | `/auth/sso/lookup?email=` | Whether email signs in via SSO | none | `{ sso, required, orgName\|null }`. `auth-security.js:37` |
| POST | `/auth/sso/start` | Build OIDC authorization URL (PKCE server-side) | none (loginLimiter) | `{ email? \| orgId?, redirectTo?(<=500) }` → `{ authorizationUrl, orgName }`. 404 `SSO_NOT_CONFIGURED`. `auth-security.js:38` |
| GET | `/auth/sso/callback` | IdP redirect target | none | 302 to `WEB_APP_URL/sso/complete?ticket=…` (default `http://localhost:5173`; ticket 2 min single-use). Web origin only. `auth-security.js:39-45`, `sso.service.js:22,51` |
| POST | `/auth/sso/complete` | Exchange ticket for session | none (loginLimiter) | `{ ticket(20-200) }` → `{ user, tokens }` + cookie. 401 `SSO_TICKET_INVALID`. `auth-security.js:46-54` |
| POST | `/auth/forgot-password` | Email reset link | none | `{ email }` → `{ sent:true }` always. `auth.js:133-143` |
| POST | `/auth/reset-password` | Set new password | none | `{ token(>=20), password(>=8, lowercase+digit) }` → `{ reset:true }`. Revokes ALL refresh sessions. `auth.js:145-165`, `auth.service.js:681` |
| GET | `/auth/invitations/:token` | Preview invitation | none | `{ email, role, org, project, company, projectParty, expiresAt, existingUser, requiresPassword }`. `auth.js:167-176` |
| POST | `/auth/invitations/accept` | Accept invitation + session | none | `{ token, name(required), password?(>=8, lowercase+digit; required unless active user exists), phone? }` → `{ user, tokens }` + cookie. 400 `INVITATION_PASSWORD_REQUIRED`. `auth.js:178-202` |
| POST | `/auth/refresh` | Rotate refresh session, mint access token | none (refreshLimiter 30/5 min per IP) | Browser: reads ONLY `Cookie: pmc_refresh_token`; the body is ignored. Native (`X-OctaPM-Client: mobile`): reads ONLY `{ refreshToken }` from the JSON body (400 `VALIDATION_ERROR` if malformed) and never falls back to the cookie. 401 `REFRESH_SESSION_REQUIRED` / `INVALID_REFRESH_TOKEN` / `REFRESH_TOKEN_EXPIRED` / `REFRESH_TOKEN_REUSED` / `REFRESH_TOKEN_CHANNEL_MISMATCH`. Reuse and channel mismatch revoke the whole session family, outside the transaction that found them. `backend/src/routes/auth.js`, `auth.service.js refresh()` |
| POST | `/auth/logout` | Revoke the presented refresh session | none | Browser: cookie, then the cookie is cleared. Native: `{ refreshToken }` in the body; no cookie is touched. → `{ revoked:boolean }` (`false` when the token belongs to the other channel). Access token stays valid until expiry (15 min). `backend/src/routes/auth.js` |
| GET | `/auth/me` | Profile | auth only | `{ id, orgId, name, email, phone, role, isCompanyAdmin, status, lastLogin, mfaEnabled, ssoLinked, createdAt, updatedAt }`. `auth.js:228-239` |
| GET | `/auth/me/settings` | User settings | auth only | `auth.js:241-252` |
| GET | `/auth/me/permissions?projectId=` | **Effective permission matrix** | auth only (+ `assertProjectAccess` with projectId → 404 `PROJECT_NOT_FOUND` / 403 `PROJECT_ACCESS_DENIED`) | `{ orgId, projectId, userId, isCompanyAdmin, source:'org'\|'assignment'\|'party'\|'template'\|'party_template', role, partyRoles[], template:{id,name}\|null, modules:{<module>:{label, level, visible, actions[], transitions[]}} }`. `auth.js:259-288`, `permission-template.service.js:515-571` |
| PATCH | `/auth/me/profile` / `/account` / `/appearance` / `/display` | Settings updates | auth only | profile `{ username(2-30), bio?(<=160), urls?[<=10] }`; account `{ name(2-30), dob?, language }`; appearance `{ theme, font }`; display `{ items[](min 1) }`. `auth.js:290-372` |
| GET | `/billing/subscription` | Org subscription/trial state (what 402 is based on) | auth + billingLimiter | `billing.js:24-30` |

### 1.2 Token model

- **Access token**: JWT (`JWT_SECRET`), payload `{ sub, orgId, role, email, name, isCompanyAdmin, type:'access' }`, `JWT_EXPIRY` default **15m**; login reports `tokens.expiresIn` in seconds. Sent as `Authorization: Bearer <jwt>`. `backend/src/utils/tokens.js:5-6, 49-87`
- **Refresh token**: JWT (`JWT_REFRESH_SECRET`), payload `{ sub, orgId, role, type:'refresh', cli:'web'|'mobile' }`, `jti` = `RefreshSession.id`, `JWT_REFRESH_EXPIRY` default **7d**; only its SHA-256 is stored. **Browser channel**: delivered only as the httpOnly cookie `pmc_refresh_token`, `path=/api/v1/auth`, `secure` + `sameSite=none` in production (else `lax`); every JSON body is stripped of `refreshToken`/`refreshTokenExpiresAt`. **Native channel** (request header `X-OctaPM-Client: mobile`): delivered in the body as `tokens.refreshToken` + `tokens.refreshTokenExpiresAt`, no cookie is set, and the token must come back in the body of `/auth/refresh` and `/auth/logout`. The `cli` claim binds a token to the channel that issued it: a native token presented as a cookie, or a cookie token presented in a body, is refused with 401 `REFRESH_TOKEN_CHANNEL_MISMATCH` and its family revoked. Tokens minted before the claim existed are treated as browser tokens. The header selects the delivery channel and nothing else: authorization runs on the access token, through the same middleware, for both channels. `backend/src/utils/tokens.js`, `backend/src/routes/auth.js`, `auth.service.js`
- **Rotation**: each refresh creates a new `RefreshSession`, marks old `revokedAt` + `replacedBySessionId`. Presenting an already-rotated token → 401 `REFRESH_TOKEN_REUSED` and the whole family is revoked. `auth.service.js:155-238, 452-458`
- **Per-request re-read**: `authenticate` re-loads the user on every request; 401 `USER_INACTIVE` unless `status==='active'` and `account.orgId===payload.orgId`; `req.user.role`/`isCompanyAdmin` come from DB, not the token. Errors: `AUTH_REQUIRED` (no/invalid Bearer), `TOKEN_EXPIRED`, `INVALID_TOKEN`. A Bearer starting with `octapm_` is an API key (`req.apiClient`; 401 `API_KEY_INVALID` / `API_KEY_EXPIRED`). `backend/src/middleware/auth.js:19-80`
- **Tenancy**: orgId bound at login; no org switching; `User.email` globally unique. `schema.prisma:157-161`
- **MFA**: `mfaRequired` login branch must complete via `/auth/mfa/verify` within 5 min; 10 single-use backup codes. Org `mfaRequired` only sets `user.mfaEnrollmentRequired` (not enforced server-side). `mfa.service.js:18-19`, `auth.service.js:394-395`
- **SSO**: org-level OIDC + PKCE done server-side; callback redirects to `WEB_APP_URL/sso/complete?ticket=`; unverified IdP email refused (`SSO_EMAIL_UNVERIFIED`). Users of an `ssoRequired` org get 403 `SSO_REQUIRED` on password login unless company admin. `sso.service.js:20-22, 51, 183, 233`

### 1.3 Revocation behaviour

| Event | Effect | Where |
|---|---|---|
| Password reset (self or admin `POST /users/:id/reset-password`) | ALL active refresh sessions revoked | `auth.service.js:681`, `user.service.js:305-321` |
| Refresh reuse | Family revoked (`REFRESH_TOKEN_REUSED`) | `auth.service.js:215-238, 456` |
| User deactivated (`PATCH /users/:id/deactivate`) | `status='inactive'`; all `ProjectAssignment` + `ActivityAssignment` deleted; access token refused next request (401 `USER_INACTIVE`); refresh refused; sockets disconnected; `RefreshSession` rows NOT revoked | `user.service.js:229-247` |
| Role / admin change (`PATCH /users/:id`) | Sockets disconnected; next request uses new role | `users.js:110-137` |
| Removed from project (`DELETE /projects/:projectId/team/:userId`) | `ProjectAssignment` + `ProjectUserPermission` deleted; tokens valid; next project request → 403 `PROJECT_ACCESS_DENIED` | `permission-template.service.js:1151-1178` |
| Logout | Only the presented session; no logout-all | `auth.service.js:492-511` |

### 1.4 Rate limits (fixed window; Redis when `REDIS_URL` else memory; 429 code **`RATE_LIMITED`** with `details { bucket, retryAfterSeconds }` and `RateLimit-*` + `Retry-After` headers)

| Bucket | Limit | Scope |
|---|---|---|
| `api` | 3000 / 15 min per IP | all `/api/v1` (carrier NAT shares it) |
| `auth` | 80 / 15 min per IP | whole `/auth` router |
| `auth-login` | 12 / 15 min per IP+email | `/auth/login`, `/auth/mfa/verify`, `/auth/sso/start`, `/auth/sso/complete` |
| `auth-refresh` | 30 / 5 min per IP | `/auth/refresh` |
| `upload` | 40 / hour per project+user | multipart routes |
| `ai-generation` | 8 / hour per project+user | AI/BOQ generation |
| `billing` | 60 / hour per user | `/billing` |
| in-process abuse tracker | backoff after 3 failures/email, lock 15 min after 5; per IP 15/30 | 429 `LOGIN_BACKOFF` / `LOGIN_TEMPORARILY_LOCKED` (`auth-abuse.service.js:3-8`) |

`backend/src/middleware/rate-limit.js:40-167`. Env overrides `RATE_LIMIT_*_MAX` / `_WINDOW_MS`.

### 1.5 What a mobile client must do

| Response | Action |
|---|---|
| 401 `TOKEN_EXPIRED` | POST `/auth/refresh` replaying the stored `pmc_refresh_token` cookie (cookie jar scoped to `/api/v1/auth`); retry once |
| 401 `REFRESH_SESSION_REQUIRED` / `INVALID_REFRESH_TOKEN` / `REFRESH_TOKEN_EXPIRED` / `REFRESH_TOKEN_REUSED` / `USER_INACTIVE` | Discard session, force sign-in |
| 401 `AUTH_REQUIRED` / `INVALID_TOKEN` | Force sign-in |
| 403 `FORBIDDEN` (details `{ module, action, transition, source:'template'\|'role' }`) | Hide/disable the action; do not retry |
| 403 `PROJECT_ACCESS_DENIED` / 404 `PROJECT_NOT_FOUND` | Drop project from local list |
| 403 `SSO_REQUIRED` | Open a web view on `/auth/sso/start` → IdP → `WEB_APP_URL/sso/complete`; hand ticket to POST `/auth/sso/complete` |
| 403 `API_KEY_FORBIDDEN` / `API_KEY_SCOPE` / `API_KEY_PROJECT` | Never use `octapm_` keys as a device credential |
| 402 `SUBSCRIPTION_REQUIRED` (non-GET on `/projects`, `/users`, `/permissions`, `/company`, `/companies`, `/tasks`, `/search`) / `PROJECT_LIMIT_REACHED` / `AI_LIMIT_REACHED` | Surface billing state (GET `/billing/subscription`); reads still work |
| 403 `CLOUDFRONT_ORIGIN_REQUIRED` | The app hit the origin; use the public host (`https://octapm.com/api/v1`) |
| 429 | Honour `Retry-After`; never re-login instead of refreshing |

Gate UI with `GET /auth/me/permissions?projectId=` (`modules[m].visible`, `actions[]`, `transitions[]`, `level` none/read_only/standard/admin). A project permission template, when attached, is **decisive** (no role fallback). `permission-template.service.js:364-408`

---

## 2. Conventions

- **Envelope**: `{ success:true, data }` or `{ success:false, error:{ code, message, details? } }`; `details` only when `NODE_ENV !== 'production'`. Unknown route → 404 `NOT_FOUND`. Validation → 400 `VALIDATION_ERROR` with `details [{ field, message, location }]`. Status defaults when no code: 400 `VALIDATION_ERROR`, 401 `AUTH_REQUIRED`, 402 `SUBSCRIPTION_REQUIRED`, 403 `FORBIDDEN`, 404 `NOT_FOUND`, 409 `CONFLICT`, 422 `UNPROCESSABLE_ENTITY`, 429 `RATE_LIMIT_EXCEEDED` (default only; limiters emit `RATE_LIMITED`), 500 `INTERNAL_ERROR`. `backend/src/utils/api-response.js`, `error-codes.js`, `middleware/error-handler.js`
- **Money**: every Prisma Decimal is converted to a JS number by `normalizeMoneyTree`; request money fields via `moneyBody` (min 0, max 9999999999999999.99). `utils/money.js`
- **Pagination**: cursor convention `?cursor(uuid)&limit(default 25, max 100)&sortBy&sortDir&search` → `{ rows|items, pagination:{ limit, nextCursor|null } }`. Only **14 route files** declare `query('cursor')`: audit, bim, comments, companies, conversations, cost, meetings, notifications, photos (limit ≤200), projects, rfi, submittals, tasks, users. Every other list returns the whole set (some with caps: attachments 500, punch/forms limit ≤1000, inventory items 500, PO list 500). `utils/list-query.js`
- **Project routing**: every module is mounted as `router.use('/:projectId/<module>', [param('projectId').isUUID(), validate, requireProjectAccess('projectId')], subRouter)` under `/projects` with router-level `authenticate` + `subscriptionGate` (`projects.js:20-21, 34-38, 266-510`). `req.projectAccess = { id, orgId, role, assignmentRole, partyAccess[], isCompanyAdmin, scope:'assignment'|'party'|'org' }` then a template is attached. pm/super_admin/isCompanyAdmin open any org project; others need `ProjectAssignment` or active `ProjectParty` membership.
- **Authorization order** (`rbac.js:16-68, 138-165`): no user → false; API key must have scope (`scopeAllows`); `isCompanyAdmin` auto-passes ONLY `user_management` and `project_parties`; attached template decides; else `can(effectiveRole, module, action, transition) || canParty(partyRole)`. `effectiveRole = req.projectAccess.role || req.user.role`. A named transition **replaces** the action's role list (`config/permissions.js:44-53`). `requirePermissionOr` adds record-level allowances (never for API keys). `requireRoles(...)` (projects create/update/delete, BOQ, billing, change orders, equipment, long-lead, `notifications/scan-due`) is template- and API-key-aware. `requireCompanyAdmin` = `isCompanyAdmin || effective role 'pm'`, API keys refused. `personal()`/`noApiKey` refuse API keys on `/notifications`, `/conversations`, MFA management, org assistant.
- **Policy roles** (`shared/permissions.json:3-30`): `pm, planning_eng, qs, cost_controller, procurement, warehouse, site_engineer, quality_engineer, finance`; party roles `owner, consultant, contractor, subcontractor`; actions `read, create, update, delete, submit, approve, certify, baseline, export`. Aliases normalised (`project_manager`→`pm`, …). `super_admin` honoured for org-wide access only, not a policy role.
- **Uploads**: multipart via multer diskStorage; field `files` on multi-file routes (attachments 25 MB×20, site-reporting 8 MB×10 images only, workflow/uploads 25 MB×10), field `file` on single-file routes (boq 50 MB, import 50 MB, schedule/generate 50 MB, drawing set 250 MB, sheet revision 100 MB, bim 300 MB, doc-control/commitments/bid-portal 25 MB); `daily-logs/ai/transcribe` uses field `audio` (25 MB). Extension vs MIME and magic-byte checks, EICAR check, then S3 or local disk. No presigned direct-to-S3 PUT. `file-storage.service.js:372, 855`
- **Downloads**: always an authenticated API URL; on S3 the API answers **302 to a SigV4 presigned GET valid 300 s** (`FILE_PRESIGNED_URL_TTL_SECONDS`), on local disk it streams. `url/fileUrl/downloadUrl` fields are API-relative. Follow the 302 **without forwarding the Authorization header**; never cache the presigned URL. `file-storage.service.js:15, 698, 1040-1070`
- **CORS / origin**: requests with no `Origin` header bypass CORS; browser origins must be in `CORS_ALLOWED_ORIGINS`/`FRONTEND_URL`. In production every request except `/api/health` must carry `X-CloudFront-Secret` (403 `CLOUDFRONT_ORIGIN_REQUIRED`) — including `/api/v1/openapi.json` and `/api/v1/docs`. `config/security.js`, `middleware/cloudfront-origin.js`. Body limit 10 MB JSON. `trust proxy` = `TRUST_PROXY_HOPS`.
- **Concurrency**: **absent** client-side — no ETag, If-Match, If-None-Match, Idempotency-Key, expectedVersion, updatedAt precondition anywhere in `backend/src`. Server-side protection is `SELECT … FOR UPDATE` in transactions with status re-checks answering 409 (`PO_STATE_CHANGED`, `PO_LOCKED`, `TRANSFER_STATE`, `INV_INSUFFICIENT_*`, commitment/sub-valuation locks). Ordinary PATCHes are last-write-wins; refetch after any 409.
- **Idempotent replay**: per record via body `clientRequestId` (≤120) on **attachments** (`{ items, replayed:true }`), **daily-reports** (returns existing), **daily-log entries** (`replayed:true`), **forms** instances, **punch** items (single + bulk `items[].clientRequestId`, `replayed:true`), **timesheets** (`replayed:true`); **site-diaries** store it but no replay lookup was found. Daily reports also store `clientCreatedAt`, `deviceId`. No generic Idempotency-Key header. `attachment.service.js:333-341`, `daily-report.service.js:476-482`, `daily-log.service.js:747-750`, `form.service.js:851-855`, `punch.service.js:414-448`, `timesheet.service.js:472-474`
- **OpenAPI**: `GET /api/v1/openapi.json` (unauthenticated, not rate limited; Swagger UI at `/api/v1/docs` and `/api/docs`): OpenAPI 3.0.3, 735 paths, 952 operations, 334 schemas, 52 tags, operationId + `x-permissions` on every operation; security 925 bearerAuth / 26 none / 1 refreshCookie; servers `/api/v1`, `http://localhost:5000/api/v1`, `https://octapm.com/api/v1`. Plain JSON → openapi-typescript/orval run, but ≥289 of 952 operations return `GenericObject` at the top level. Gaps: `/transmittals` router and legacy `/drawings` DrawingRecord CRUD undocumented. `backend/src/openapi/spec.js`, `route-coverage.js`
- **Health**: `GET /api/health` (not under `/api/v1`) → `{ success:true, data:{ status:'ok', timestamp } }`.
- **Public (token) routers**: `/public/bids/:token`, `/public/rfqs/:token`, `/public/inbound-email/:provider`, `/webhooks/stripe`. `app.js:75-87, 114-115`

---

## 3. Needs You, notifications, realtime, audit

### 3.1 Needs You / open items

| Method | Path | Purpose | Permission | Notes |
|---|---|---|---|---|
| GET | `/projects/:projectId/assignments/mine?limit(1-500, default 200)` | Caller's open items on ONE project (assigned + derived ball-in-court) | auth + project access | `{ items:[{ recordType, label, recordId, ref, title, status, projectId, projectName, roles:[owner\|reviewer\|approver\|assignee\|ballInCourt], ballInCourt, derived?, dueDate, overdue, updatedAt, target:{ projectId, module, child, recordType, source?, recordId } }], summary:{ total, overdue, ballInCourt, byType } }`. Assigned types: risk, ncr, itp, defect, safety_incident, material_test, rfi, submittal, drawing, transmittal, correspondence. Derived (role-based): purchase_order (source `procurement_order`), commitment, sub_pay_app, bid_package only. Sort: ballInCourt → overdue → dueDate. `assignments.js:17-30`, `record-assignment.service.js:367-579` |
| GET | `/projects/workspace-dashboard` | Cross-project dashboard incl. `myOpenItems` | auth + subscriptionGate | Calls `listMyOpenItems` **without role** → derived PO/commitment/pay-app/bid items are absent here. Also `officialKpis`, `pendingReview`, `healthDimensions`, `workflowQueues`, `projectHealth`. `workspace-dashboard.service.js:796` |
| GET | `/projects/:projectId/subscriptions/mine?limit(1-500)` | Records the caller follows | auth + project access | `subscriptions.js:33-45` |
| GET | `/projects/:projectId/subscriptions?recordType&recordId` | Follow state + subscribers | read on record's module | `{ recordType, recordId, following, subscription, subscribers[], count }` |
| PUT | `/projects/:projectId/subscriptions` | Follow/unfollow | read on record's module | `{ recordType, recordId, follow:boolean }`; unfollow = `muted:true`. `comment.service.js:437` |
| GET | `/projects/:projectId/assignments/unresolved` | Backfill report | requireCompanyAdmin | admin only |
| POST | `/projects/:projectId/assignments/resolve` | Map a record's assignee | requireCompanyAdmin | `{ recordType, recordId, field, userId?, companyId? }` |
| GET | `/workflows/my-steps` | Cross-project workflow inbox | `requirePermission('workflow','read')` | `{ items:[{ assignmentId, instanceId, projectId, project, tool, toolLabel, recordId, recordRef, recordTitle, path, template, stepKey, stepName, responses, dueAt, overdue, escalatedAt, createdAt }] }`; actionable only while `instance.currentStepKey === stepKey` and status running. `workflow-inbox.js:12-17` |
| GET | `/projects/:projectId/workflows/my-steps` | Same, one project | `workflow.read` | `workflows.js:65-69` |
| POST | `/projects/:projectId/workflows/instances/:instanceId/respond` | Answer my step | `requirePermission('workflow','submit',{transition:'workflow.respond'})` (every role and party); override needs `workflow.update` + `workflow.manage` | `{ response(non-empty), comment?(<=4000) }` |
| GET | `/projects/:projectId/workflows/instances?tool&recordId&status&limit(<=200)` / `/instances/:instanceId` / `/tools` / `/templates` | Workflow reads | `workflow.read` | Templates/instances writes need `workflow.update` + `workflow.manage` (pm) |

Register lists accept `?ballInCourtUserId=me` on `/rfi`, `/submittals`, `/punch`, `/forms` (route rewrites `me` → `req.user.id`). `GET /tasks?assignee=me` for tasks. `GET /projects/:projectId/jobs?status&type&limit` for background jobs (per-job module read).

### 3.2 Notifications (all `authenticate + personal()` — API keys 403 `API_KEY_FORBIDDEN`; `notifications.js:13-18`)

| Method | Path | Purpose | Request / Response |
|---|---|---|---|
| GET | `/notifications` | Inbox | `?cursor(uuid)&limit(1-100)&status(active\|all\|unread\|read\|archived)&category&projectId` → cursor page of notifications (≤3 deliveryAttempts each); `actionUrl` is a web path |
| GET | `/notifications/summary` | Badge | `{ unread, read, archived, recent[] }` |
| GET | `/notifications/:notificationId` | One | recipient only |
| PATCH | `/notifications/:notificationId/read` | Read/unread | `{ read?:boolean (default true) }` |
| PATCH | `/notifications/:notificationId/archive` | Archive | no un-archive route |
| POST | `/notifications/mark-read` | Mark ALL read | no body (takes no ids) |
| GET / PUT | `/notifications/preferences` | Per-category prefs | PUT `{ preferences:[{ category, inAppEnabled?, emailEnabled?, pushEnabled?, digestEnabled?, dueSoonDays?(1-30), quietHoursStart?, quietHoursEnd? }] }`; quiet hours/digest/dueSoonDays stored but unconsumed |
| POST | `/notifications/deliveries/retry` | Process pending emails | `{ limit?(1-100, default 25) }` |
| POST | `/notifications/:notificationId/retry-email` | Retry one email | 202; `MAX_EMAIL_ATTEMPTS` 3 |
| POST | `/notifications/scan-due` | Due-date scan | `requireRoles('pm','planning_eng')`; `{ projectId?, horizonDays?(1-30, default 3) }` → 201 |
| GET | `/notifications/push/public-key` | Web Push VAPID key | `{ configured, publicKey\|null }` |
| GET | `/notifications/push/subscriptions` | Caller’s push devices | `{ configured, expoEnabled, publicKey, items[{ id, provider(web|expo), endpoint, userAgent, platform, failureCount, lastUsedAt, createdAt }] }` |
| POST | `/notifications/push/subscriptions` | Register a device | Browser: `{ endpoint(https, 10-2048), keys:{ p256dh, auth } }`; field app (M9): `{ provider:"expo", token(ExponentPushToken[…]), platform(ios|android), deviceName? }` → 201, upserts on the endpoint or token; bad token → `PUSH_TOKEN_INVALID`, bad platform → `PUSH_PLATFORM_INVALID`. Expo rows are sent through Expo’s push API without VAPID keys; a token Expo reports unregistered is removed. |
| DELETE | `/notifications/push/subscriptions` | Unregister | body `{ endpoint }` or `{ token }` |
| POST | `/notifications/push/test` | Test push | 503 `PUSH_NOT_CONFIGURED` without VAPID keys |

Creation rules: per-category preferences respected; actor never notifies self; `dedupeKey` unique; push attempted when `pushEnabled !== false` and a `PushSubscription` exists; endpoints answering 404/410 or 5 consecutive failures are deleted; flushed 750 ms after creation and hourly. `notification.service.js:58, 639, 708`, `push.service.js:15-18, 116-125`

### 3.3 Realtime (socket.io on the API host, `backend/src/realtime/socket.js`)

- Handshake: `auth.token` or `Authorization: Bearer <ACCESS JWT>` (API keys not accepted; `verifyAccessToken` only). `connect_error` codes: `AUTH_REQUIRED`, `TOKEN_EXPIRED`, `INVALID_TOKEN`, `USER_INACTIVE`, `AUTH_UNAVAILABLE`. No in-band token refresh: reconnect with a fresh token.
- On connect: auto-join `user:{id}` and `org:{id}`; server emits `realtime.ready { userId, orgId, connectedAt }`.
- Client emits `project:join { projectId }` (ack `{ ok, projectId, code? }`, runs `assertProjectAccess`) and `project:leave { projectId }`.
- Server emits `domain.event { id, type, orgId, projectId, entityType, entityId, action, actorId, occurredAt, payload }`. For project-room events `payload.summary` is **stripped** → refetch; user-addressed events keep payload. Types published: `record.changed` (audit + comments), `approval.decided`, `notification.created`, `job.progress`, conversation events.
- Sockets are dropped on deactivation/role change. CORS uses the HTTP allowlist.
- Inventory and goods receipt emit **nothing** (poll).

### 3.4 Audit / record history

| Method | Path | Permission | Request | Response |
|---|---|---|---|---|
| GET | `/projects/:projectId/audit` | `requirePermission('audit','read')` (all roles) | `?entityType(<=80)&entityId(<=120)&action(<=80)&source=all\|audit\|approval\|status\|comment&cursor(<=120)&limit(1-100, default 50)&order=asc\|desc` | `{ events[], nextCursor }`; cursor honoured **only when `source=audit`**. `audit.js:14-44`, `audit.service.js:641-654, 707` |

Every audited mutation writes `AuditEvent` + `OutboundEvent` in the same transaction and publishes `record.changed` after commit. No REST reader of `OutboundEvent` (no offline catch-up). No per-record `/history` route; no end-user auth-audit listing.

### 3.5 Comments (`backend/src/routes/comments.js`)

| Method | Path | Permission | Notes |
|---|---|---|---|
| GET | `/projects/:projectId/comments?recordType&recordId&cursor(<=120)&limit(1-200)&order` | read on `moduleForRecordType(recordType)` + record visibility | `{ items:[{ id, recordType, recordId, parentId, body, author, authorId, mentions[], editedAt, deletedAt, createdAt, updatedAt, canEdit, canDelete }], pagination }` |
| POST | `/projects/:projectId/comments` | read on module (API keys need update/create scope) | `{ recordType, recordId, body(1-5000), parentId?, mentionUserIds[](<=20) }` → 201; commenter auto-follows |
| PATCH | `/projects/:projectId/comments/:commentId` | author only (service) | `{ body?, mentionUserIds? }` |
| DELETE | `/projects/:projectId/comments/:commentId` | author / pm / company admin | soft delete |

Commentable record types (`comment.service.js:43-97`): risk, ncr, itp, defect, punch_item, form_instance, material_test, safety_incident, rfi, submittal, commitment, sub_pay_app, drawing, drawing_set, sheet, sheet_revision, transmittal, correspondence, document, task.

### 3.6 Conversations (`conversations.js`; `authenticate + noApiKey`)

`GET /conversations?projectId&filter(all|unread|starred|archived)&q(<=120)&limit(<=200)`, `GET /conversations/unread`, `GET /conversations/people`, `POST /conversations { kind, projectId?, title?, memberUserIds[], recordType?, recordId?, message? }` (`conversation.create`), `GET/PATCH /conversations/:conversationId`, `POST /:conversationId/members`, `DELETE /:conversationId/members/:userId`, `PATCH /:conversationId/me { starred, muted }`, `POST /:conversationId/read`, `GET /:conversationId/messages?cursor&limit(<=200)`, `POST /:conversationId/messages { body, mentionUserIds[] }` (`conversation.update`), `PATCH|DELETE /:conversationId/messages/:messageId`.

---

## 4. Per module

### 4.1 RFI (`backend/src/routes/rfi.js`; module `rfi`)

| Method | Path | Purpose | Permission | Notes |
|---|---|---|---|---|
| GET | `/projects/:projectId/rfi` | List (cursor) | `rfi.read` | `?cursor&limit(1-100)&status(draft\|open\|answered\|closed\|archived)&includeArchived&priority(low\|normal\|high\|urgent)&activityId&owner&ownerPartyId&partyId&managerUserId&assigneeUserId&ballInCourtUserId(uuid\|me)&locationId&overdue&search(<=120)&dueAfter&dueBefore&sortBy(created\|updated\|dueDate\|raisedDate\|responseRequiredBy\|answeredDate\|priority\|status\|ref)&sortDir` → `{ rows[], summary:{draft,open,answered,closed,archived,scheduleImpactDays}, pagination }`. Drafts visible only to createdBy/managerUserId; party viewers see only RFIs routed to their party |
| POST | `/projects/:projectId/rfi` | Create (`RFI-nnn`) | `rfi.create` | `{ subject*, priority, status(draft\|open\|answered\|closed, default open), question(<=20000), discipline, managerUserId, assigneeUserIds[<=20], distributionUserIds[<=20], specSection, locationId, costImpact, costImpactAmount, scheduleImpactFlag, scheduleImpact, owner/ownerPartyId, reviewer/reviewerPartyId, approver/approverPartyId, *UserId refs, activityId\|activityIds\|activityLinks[], attachments/attachmentRefs, raisedDate, dueDate, responseRequiredBy }` → 201. No idempotency key |
| GET | `/projects/:projectId/rfi/:rfiId` | Detail | `rfi.read` | adds `manager, location, activity, assignees[], distribution[], responses[], officialResponse, isOverdue, path`; 404 `RFI_NOT_FOUND` for invisible drafts |
| GET | `/projects/:projectId/rfi/:rfiId/export.pdf` | PDF | `rfi.export` | |
| PUT | `/projects/:projectId/rfi/:rfiId/people` | Replace manager/assignees/distribution | `rfi.update` | `{ managerUserId?, assigneeUserIds?[<=20], distributionUserIds?[<=20] }`; 404 `USER_NOT_FOUND` |
| GET | `/projects/:projectId/rfi/:rfiId/responses` | Thread | `rfi.read` | `{ items[], officialResponseId, revision }` |
| POST | `/projects/:projectId/rfi/:rfiId/responses` | Add response | `rfi.submit`; if `isOfficial===true` also `hasPermission('rfi','submit',{transition:'rfi.answer'})` | `{ body(1-20000), isOfficial? }`; 409 `RFI_ALREADY_CLOSED` |
| PATCH | `/projects/:projectId/rfi/:rfiId/responses/:responseId` | Edit | `rfi.submit` | author or pm (403 `RFI_RESPONSE_NOT_YOURS`) |
| DELETE | `/projects/:projectId/rfi/:rfiId/responses/:responseId` | Remove | `rfi.submit` | 409 `RFI_RESPONSE_OFFICIAL` |
| POST | `/projects/:projectId/rfi/:rfiId/responses/:responseId/official` | Promote to official answer | `rfi.submit` + `rfi.answer` | |
| POST | `/projects/:projectId/rfi/:rfiId/submit` | draft→open / answered→open | `rfi.submit` + `rfi.submit` | `{ comment? }` |
| POST | `/projects/:projectId/rfi/:rfiId/answer` | → answered | `rfi.submit` + `rfi.answer` | `{ response*, answeredBy?, answeredDate?, attachments/attachmentRefs, revision/projectDocumentId…, comment? }` |
| POST | `/projects/:projectId/rfi/:rfiId/approve` | answered→closed | `rfi.approve` + `rfi.approve` | 409 `RFI_NOT_READY_FOR_APPROVAL` |
| POST | `/projects/:projectId/rfi/:rfiId/close` | any non-closed→closed | `rfi.approve` + `rfi.close` | `{ comment* }` |
| POST | `/projects/:projectId/rfi/:rfiId/reopen` | closed/answered→open | `rfi.approve` + `rfi.reopen` | `{ reason* }`; revision +1 |
| POST | `/projects/:projectId/rfi/:rfiId/reject` / `/disapprove` | answered→open | `rfi.approve` + `rfi.reject` | `{ reason* }` |
| POST | `/projects/:projectId/rfi/:rfiId/convert-to-change` | Create change order | `change_order.create` (pm, qs) | `{ description?, category?(default 'rfi'), value? }` → 201 `{ changeOrder, rfi }`; 409 `RFI_ALREADY_CONVERTED` |
| PATCH | `/projects/:projectId/rfi/:rfiId` | Edit | `rfi.update` | status may move among draft/open/answered/closed bypassing guards (not archived: 400 `RFI_ARCHIVE_ACTION_REQUIRED`); 409 `RFI_ARCHIVED` |
| DELETE | `/projects/:projectId/rfi/:rfiId` | Archive | `rfi.delete` | `{ id, status:'archived', archived:true, deleted:false, archivedAt }` |
| POST | `/projects/:projectId/rfi/ai/draft` | AI draft | `assistant.read` + `rfi.create` | `{ prompt(1-4000), specSection?, discipline?, activityId?, locationId? }` |
| GET | `/projects/:projectId/rfi/ai/similar?q(3-300)&limit(1-10)&excludeRfiId` | Similar RFIs | `assistant.read` + `rfi.read` | |
| POST | `/projects/:projectId/rfi/:rfiId/ai/response` / `/ai/summary` | AI suggestion / summary | `assistant.read` + `rfi.submit` / `rfi.read` | nothing is posted |

**State machine**: draft →(submit, `rfi.submit`) open →(answer / official response, `rfi.answer`) answered →(approve, `rfi.approve`) closed | →(reject/disapprove, `rfi.reject`, reason) open; any non-closed →(close, `rfi.close`, comment) closed; closed/answered/draft →(reopen, `rfi.reopen`, reason) open; any →(DELETE, `rfi.delete`) archived.

**Transition permissions** (`shared/permissions.json`): read → all 9 roles + all 4 party roles; create/update → pm, planning_eng, site_engineer, quality_engineer + contractor, subcontractor; submit → same + owner, consultant, contractor, subcontractor; `rfi.submit` → pm, planning_eng, site_engineer, quality_engineer + contractor, subcontractor; `rfi.answer` → pm, planning_eng, site_engineer, quality_engineer + owner, consultant; `rfi.close`, `rfi.reopen`, `rfi.approve`, `rfi.reject` → pm only; export → pm, planning_eng, qs, cost_controller.

**Rules**: ballInCourt derived server-side (draft → createdBy||manager; open → first assignee||assigneeUserId||manager; answered → manager||approver||createdBy; closed → null). `isOverdue` = status in draft/open/answered and `(responseRequiredBy||dueDate) < now`. One official response per revision. Closing with `scheduleImpactFlag && scheduleImpact>0 && activityId` upserts `WorkflowActivityLink schedule_impact`.

**MOBILE — do**: list with `ballInCourtUserId=me`, `overdue`, cursor; create with status `open` or `draft`; post thread responses (`isOfficial` only when the user holds `rfi.answer`); use action routes; attach via POST `/attachments` (`recordType:'rfi'`, `clientRequestId`) or POST `/workflow/uploads` then reference document ids. **Must not**: set `ballInCourtUserId`; change status via PATCH (bypasses guards/notifications); attempt approve/close/reopen/reject unless pm; treat `path` as an API URL; expect a replay key on RFI create (absent).

### 4.2 Documents, drawings, submittals, search

#### Document control (`doc-control.js`; module `document_control`)

| Method | Path | Purpose | Permission | Notes |
|---|---|---|---|---|
| GET | `/projects/:projectId/doc-control/dashboard` | Metrics | `document_control.read` | `{ metrics:{ rfiOpen, rfiOverdue, avgRfiTurnaroundDays, submittalPending, submittalResubmit, drawingsActive, drawingsSuperseded, transmittalPendingAck, contractualNotices, dueAlerts, overdue } }` |
| GET | `/projects/:projectId/doc-control/register?recordType&folder&category&status&search` | Document register | `document_control.read` | `{ rows[], folders[], summary }`; not paginated; site_engineer/warehouse see only `isLatest && approved` revisions |
| POST | `/projects/:projectId/doc-control/:recordType/:recordId/revisions` | Register revision from uploaded doc | `document_control.submit` + `document.revision.upload` | recordType rfi\|submittal\|drawing\|transmittal; `{ revision*(<=40), projectDocumentId\|documentId\|storageKey\|key*, title, fileName, documentNumber, category, folderPath, discipline, confidentiality, reviewDueAt, status(uploaded\|submitted\|approved), issuedBy, issuedAt, notes }`; 409 `DOCUMENT_REVISION_EXISTS` |
| POST | `/projects/:projectId/doc-control/:recordType/:recordId/revisions/upload` | Multipart upload + register | same + uploadLimiter | field `file` (25 MB) + body above → 201 `{ revision, document }` |
| POST | `/projects/:projectId/doc-control/revisions/:revisionId/submit-review` | uploaded→submitted | `document_control.submit` + `document.revision.submit_review` | `{ comment?, reviewDueAt? }` |
| POST | `/projects/:projectId/doc-control/revisions/:revisionId/approve` | → approved + isLatest | `document_control.approve` + `document.revision.approve` | supersedes other isLatest; 409 `WORKFLOW_RUNNING` |
| POST | `/projects/:projectId/doc-control/revisions/:revisionId/supersede` | → superseded | `document_control.approve` + `document.revision.supersede` | `{ reason*(<=2000) }` |
| GET | `/projects/:projectId/doc-control/revisions/:revisionId/download` / `/preview` | File | `document_control.read` | 302 presigned (5 min) or bytes; 403 `DOCUMENT_REVISION_HISTORY_FORBIDDEN` for site_engineer/warehouse on non-latest |

Revision status: uploaded → submitted → approved → superseded; unique `(recordType, recordId, revision)`; superseded rows read-only (409 `DOCUMENT_REVISION_SUPERSEDED_READ_ONLY`). Roles: `document.revision.upload` / `submit_review` → pm, planning_eng, site_engineer, quality_engineer + consultant, contractor, subcontractor; `document.revision.approve` / `supersede` → pm; `drawing.publish` → pm, planning_eng; `document_control.update` → pm, planning_eng; `delete` → nobody.

#### Drawing sets / sheets / markups / pins

| Method | Path | Purpose | Permission | Notes |
|---|---|---|---|---|
| GET | `/projects/:projectId/drawings/sets?status` | List sets | `document_control.read` | status omitted → excludes archived; `all` → everything |
| POST | `/projects/:projectId/drawings/sets` | Upload multi-page PDF (≤250 MB), enqueue detection | `document_control.submit` + `document.revision.upload` + uploadLimiter | field `file` + `name, description, discipline, purpose(IFC\|IFT\|IFA\|AS_BUILT\|TENDER\|SHOP\|RECORD\|OTHER), receivedAt, issuedAt` → 202 `{ jobId }` |
| GET / PATCH / DELETE | `/projects/:projectId/drawings/sets/:setId` | Detail / edit / delete | read / `document_control.update` | 409 `DRAWING_SET_PROCESSING`, `DRAWING_SET_HAS_PUBLISHED_SHEETS` |
| POST | `/projects/:projectId/drawings/sets/:setId/reprocess` | Re-run detection | `document_control.update` | 202 |
| GET / PATCH | `/projects/:projectId/drawings/sets/:setId/revisions` | Page revisions / review grid | read / `document_control.submit` + `document.revision.upload` | PATCH `{ updates[1-500]{ id, number?, title?, revision?, discipline?, status?(pending_review\|rejected) } }` |
| POST | `/projects/:projectId/drawings/sets/:setId/publish` | Publish pending pages | `document_control.update` + `drawing.publish` | `{ revisionIds?[<=1500] }` → `{ published, skipped, remaining, results[], set }`; all-or-nothing |
| GET | `/projects/:projectId/drawings/sheets?discipline&locationId&search&status(current\|obsolete\|all)&setId` | Sheets (site view) | `document_control.read` | `currentRevision.fileUrl` = `/api/v1/projects/:id/attachments/documents/:documentId` (whole source PDF; `pageNumber`); not paginated |
| GET | `/projects/:projectId/drawings/sheets/offline-manifest` | Offline cache manifest | `document_control.read` | `{ generatedAt, items[{ sheetId, number, title, discipline, revisionId, revision, documentId, pageNumber, fileUrl, fileName, sizeBytes, sha256, publishedAt }], totals }` |
| POST | `/projects/:projectId/drawings/sheets/revisions/:revisionId/publish` | Publish one | `document_control.update` + `drawing.publish` | |
| GET / PATCH | `/projects/:projectId/drawings/sheets/:sheetId` | Detail / edit | read / `document_control.update` | superseded revisions visible only with `document_control.update` |
| GET | `/projects/:projectId/drawings/sheets/:sheetId/qr.svg` | Printable QR | `document_control.read` | encodes `WEB_APP_URL/projects/:id/quality/defects?source=sheet_qr&recordId=:sheetId` |
| GET / POST | `/projects/:projectId/drawings/sheets/:sheetId/revisions` | History / upload single-sheet PDF (≤100 MB) | read / `document_control.submit` + `document.revision.upload` (+ `drawing.publish` if `publish:true`) | POST field `file` + `revision*(<=20), title?, pageNumber?(1-1500), publish?` |
| GET | `/projects/:projectId/drawings/sheets/:sheetId/markups` | Markup layers | `document_control.read` | |
| GET / PUT | `/projects/:projectId/drawings/sheets/:sheetId/markups/mine` | Personal layer | `document_control.read` | PUT `{ shapes[<=500], name?, sheetRevisionId? }` |
| PATCH / DELETE | `/projects/:projectId/drawings/sheets/:sheetId/markups/:markupId` | Edit / delete | `document_control.read` (ownership / `document_control.update` in service) | |
| POST | `/projects/:projectId/drawings/sheets/:sheetId/markups/:markupId/publish` | Publish to team | `document_control.create` | |
| GET / POST | `/projects/:projectId/drawings/sheets/:sheetId/pins` | Pins on a sheet / drop a pin | `document_control.read` (+ `create` on target module when `create{}` given) | `{ x(0-1), y(0-1), recordType, recordId? \| create?{}, sheetRevisionId?, label?(<=80), color?(<=9) }`. PIN_TARGETS: punch_item→punch (create), defect→ncr (create), ncr, safety_incident, itp→ncr, form_instance→inspection (link only) |
| GET | `/projects/:projectId/drawings/pins?recordType&recordId` | Pins for a record | `document_control.read` | |
| DELETE | `/projects/:projectId/drawings/pins/:pinId` | Remove pin | `document_control.read` (author / canManage) | |
| GET | `/projects/:projectId/drawings/ai/status` | AI availability | `document_control.read` | plus `/ai/sets/:setId/read` (client-rendered page images ≤3 MB, ≤12), `/ai/sets/:setId/references`, `/ai/sheets/:sheetId/references`, `/ai/sheets/:sheetId/compare` |
| GET / POST / PATCH / DELETE | `/projects/:projectId/drawings` / `/:drawingId` | Legacy DrawingRecord CRUD (`DWG-nnn`) | read / `document_control.create` / `update` / `update` | DELETE hard-deletes; not in OpenAPI |
| GET / POST / PATCH / DELETE | `/projects/:projectId/transmittals` / `/:transmittalId` | Transmittals (`TRM-nnn`) | read / create / update / update | acknowledgement = PATCH `status:'acknowledged'` + `acknowledgedOn`; hard delete; not in OpenAPI |
| GET / POST / PATCH / DELETE | `/projects/:projectId/correspondence` / `/:correspondenceId` | Correspondence | read / create / update / update | |
| GET | `/projects/:projectId/specifications?q&division&documentId` | Spec sections | `document_control.read` | plus `/status`, `/documents`, `POST /index` (update), `/scope-gaps`, `POST /scope-gaps/explain` (assistant), `/:sectionId?maxChars`, `POST /:sectionId/conflicts` (assistant), `POST /:sectionId/rfi` (`rfi.create`; returns `{ record:{id,ref,status}, url }`) |

Set/sheet model: DrawingSet `draft|processing|review|published|archived|failed`; SheetRevision `pending_review|published|superseded|rejected`; Sheet `current|obsolete` with `currentRevisionId`. Server thumbnails exist only for Photo rows — no per-page rasterisation.

#### Submittals (`submittals.js`; module `submittal`)

| Method | Path | Purpose | Permission | Notes |
|---|---|---|---|---|
| GET | `/projects/:projectId/submittals` | List (cursor) | `submittal.read` | `?cursor&limit(1-100)&packageId&managerUserId&workflowTemplateId&ballInCourtUserId(uuid\|me)&responseCode&overdue&status(pending\|under_review\|approved\|resubmit\|rejected\|archived)&includeArchived&activityId&owner&ownerPartyId&partyId&search&dueAfter&dueBefore&sortBy&sortDir` → `{ rows, summary, pagination }` |
| POST | `/projects/:projectId/submittals` | Create (`SUB-nnn`, revision 'A') | `submittal.create` | `{ title*, status?, packageId, workflowTemplateId, leadTimeWeeks(0-104), reviewDays(0-365), requiredOnSite, managerUserId, distributionUserIds[<=20], discipline, specRef, revision, party/user refs, activity links, attachments, revisions, comment, submittedOn, dueDate, reviewedOn }`; `submitBy = requiredOnSite − leadTimeWeeks×7 − reviewDays` |
| GET | `/projects/:projectId/submittals/:submittalId` | Detail with review steps | `submittal.read` | `reviewSteps[], currentRevisionSteps[], activeStep, lateSteps, responseCodeLabel, submitBy, isLate, path` |
| POST | `/projects/:projectId/submittals/:submittalId/submit` | pending\|resubmit\|rejected → under_review | `submittal.submit` + `submittal.submit` | needs revision evidence (400 `SUBMITTAL_REVISION_REQUIRED`) |
| POST | `/projects/:projectId/submittals/:submittalId/decide` | Reviewer decides active step | `submittal.submit` + `submittal.review` | `{ decision(approve\|reject), responseCode(approved\|approved_as_noted\|revise_resubmit\|rejected\|custom), responseCodeLabel, comment(required on reject) }`; 403 `SUBMITTAL_NOT_ASSIGNED` unless pm |
| POST | `/projects/:projectId/submittals/:submittalId/review` | Comment while under_review | `submittal.submit` + `submittal.review` | `{ comment*, remarks?, reviewedOn? }` |
| POST | `/projects/:projectId/submittals/:submittalId/resubmit` | under_review (pm only) → resubmit; or pending\|resubmit\|rejected → under_review | `submittal.submit` + `submittal.resubmit` | |
| POST | `/projects/:projectId/submittals/:submittalId/approve` | under_review → approved | `submittal.approve` + `submittal.approve` | 409 `WORKFLOW_RUNNING` |
| POST | `/projects/:projectId/submittals/:submittalId/reject` / `/disapprove` | under_review → rejected | `submittal.approve` + `submittal.reject` | `{ reason* }` |
| PUT | `/projects/:projectId/submittals/:submittalId/people` | Manager + distribution | `submittal.update` | |
| PATCH / DELETE | `/projects/:projectId/submittals/:submittalId` | Edit / archive | `submittal.update` / `submittal.delete` | |
| GET / POST | `/projects/:projectId/submittals/packages` | Packages (`PKG-nnn`) | read / `submittal.create` | POST `{ name*, description, activityId, requiredOnSite, managerUserId, submittalIds[<=200] }` |
| GET / PATCH | `/projects/:projectId/submittals/packages/:packageId` | Detail / edit | read / `submittal.update` | |
| POST / DELETE | `/projects/:projectId/submittals/packages/:packageId/items` / `/items/:submittalId` | Add / remove | `submittal.update` | |
| POST | `/projects/:projectId/submittals/packages/:packageId/submit` / `/decide` | Bulk submit / decide | `submittal.submit` + `submittal.submit` / `submittal.review` | `{ package, results[] }` |
| GET / POST / PATCH / DELETE | `/projects/:projectId/submittals/workflow-templates(/:templateId)` | Review-route templates | read / `submittal.update` | steps[≤12]{ name, mode(sequential\|parallel), days, assignees[≤20] } |

Roles: `submittal.submit`/`submittal.resubmit` → pm, planning_eng, site_engineer, quality_engineer + contractor, subcontractor; `submittal.review` → pm, planning_eng, qs + consultant; `submittal.approve`/`submittal.reject` → pm + consultant; create/update → pm, planning_eng, site_engineer, quality_engineer + contractor, subcontractor.

#### Search and document text

| Method | Path | Purpose | Permission | Notes |
|---|---|---|---|---|
| GET | `/search?q\|search(<=120)&type\|types(csv)&projectId&status\|statuses&dateFrom\|from&dateTo\|to&includeArchived&limit(1-50)` | Org-wide global search | auth + subscriptionGate (per-project module reads applied in service) | `{ query, items:[{ id, type, typeLabel, module, projectId, projectName, title, subtitle, identifier, status, date, url(legacy web path), metadata, score }], groups, filters, meta }` |
| GET | `/projects/:projectId/documents/search?q(1-200)&limit(1-50)&semantic` | Full-text/hybrid document search | `document_control.read` | |
| GET | `/projects/:projectId/documents/index-status` / `POST /reindex` / `GET /:documentId/text?maxChars(200-200000)` / `POST /:documentId/extract` | Index status / reindex / extracted text / extract | read / update / read / update | |
| GET | `/projects/:projectId/attachments/search?q(<=120)&limit(1-100, default 40)` | Evidence search | auth + project access (viewer filter) | |

#### Attachments (generic, `attachments.js`)

| Method | Path | Permission | Notes |
|---|---|---|---|
| GET | `/projects/:projectId/attachments?recordType*&recordId` | read on `moduleForRecordType(recordType)` (55 RECORD_TYPES) | `{ items[{ id, recordType, recordId, documentId, role, caption, sortOrder, source, uploadedBy, createdAt, document{}, photo\|null, fileName, fileUrl, mimeType, sizeBytes }] }` (≤500); 404 `ATTACHMENT_RECORD_NOT_FOUND` |
| POST | `/projects/:projectId/attachments` | any of update\|submit\|create on the module + uploadLimiter | multipart `files[]` (≤20 × 25 MB; images/PDF/Word/Excel/CSV/text, else 400 `UNSUPPORTED_ATTACHMENT`) + `recordType*, recordId*, role(attachment\|evidence\|photo\|reference), caption(<=500), locationId, tags, documentIds, clientRequestId(<=120)` → 201 `{ items[], replayed? }`; images get a Photo row with EXIF (takenAt, latitude, longitude, altitude, camera, width/height) |
| GET | `/projects/:projectId/attachments/documents/:documentId` | auth + `documentReadableToViewer` | 302 presigned / bytes; 404 `FILE_NOT_FOUND`, 409 `FILE_NOT_AVAILABLE` |
| DELETE | `/projects/:projectId/attachments/:attachmentId` | update\|submit\|create on module | unlinks only |
| POST / GET | `/projects/:projectId/workflow/uploads` / `/uploads/:key` | auth + project access only (no requirePermission) + uploadLimiter | `files[]` ≤10 × 25 MB → 201 `[{ documentId, key, storageKey, url, fileUrl, downloadUrl, fileName, mimeType, sizeBytes, scanStatus, … }]` |

Module map (`attachment.service.js:35-92`): rfi→rfi; submittal→submittal; drawing/drawing_set/sheet/sheet_revision/markup/pin/transmittal/correspondence/document→document_control; ncr/itp/defect/material_test→ncr; punch_item→punch; form_template/form_instance/form_response→inspection; safety_incident→safety; daily_report/site_diary/daily_log/progress_submission→progress; task→task; timesheet→timesheet; activity→schedule; risk→risk.

**MOBILE — do**: sheets list + `offline-manifest` (sha256) for caching; fetch source PDF via `/attachments/documents/:documentId`, render `pageNumber` client-side; personal markups; drop pins (create punch/defect in place); submittal list with `ballInCourtUserId=me`, `/submit`, `/decide`, `/review`; use `/attachments` (`clientRequestId`) for evidence. **Must not**: attempt revision approve/supersede or `drawing.publish` unless pm (planning_eng for publish); expect superseded/non-latest revisions as site_engineer/warehouse; cache presigned URLs >5 min; expect per-page images (absent). Handle 409 `WORKFLOW_RUNNING` by sending the user to `/workflows/my-steps`.

### 4.3 Quality — inspections/forms, NCR, punch/observations, safety, material tests, legacy ITP/defects

#### Dashboards

| Method | Path | Permission | Response |
|---|---|---|---|
| GET | `/projects/:projectId/quality/dashboard` | auth + project access (no module guard; `quality.js:8-18`) | `{ metrics:{ qualityScore, majorNcrs, minorNcrs, failedItps, openDefects, testsPassed, testsFailed, safetyIncidents, safetyOpen, observationsOpen, safetyObservationsOpen, observationsByType{}, dueAlerts, overdue }, trend:{…} }` |
| GET | `/projects/:projectId/health` | auth + project access (no module guard; `health.js:126`) | 7 dimensions incl. quality, safety |

Quality score = `max(0, 100 − major×20 − minor×8 − failedLegacyITPs×15)` over NcrRecord (non-archived/void) + legacy ItpRecord failed. FormInstance outcomes, punch, defects, tests, safety do not affect it. `quality.service.js:38-51`

#### Inspections / forms (`forms.js`, `form-templates.js`; module `inspection`)

| Method | Path | Purpose | Permission | Notes |
|---|---|---|---|---|
| GET | `/projects/:projectId/forms` | List instances | `inspection.read` | `?status(csv)&type(inspection\|itp\|form\|talk)&templateId&activityId&locationId&sheetId&assigneeUserId&assigneeCompanyId&ballInCourtUserId(uuid\|me)&outcome(pass\|fail)&overdue&from&to&search&limit(1-1000)` → `{ items[], summary }`; no cursor |
| POST | `/projects/:projectId/forms` | Create from template (`INS-/ITP-/FRM-/TBT-nnn`) | `inspection.create` | `{ templateId*(uuid), title(<=200), activityId, locationId, sheetId, assigneeUserId, assigneeCompanyId, inspectorUserId, approverUserId, scheduledFor, dueDate, recurrence{}, startNow, clientRequestId(<=120), clientCreatedAt, deviceId(<=120) }` → 201 full instance; 409 `FORM_TEMPLATE_INACTIVE` / `FORM_TEMPLATE_EMPTY` |
| GET | `/projects/:projectId/forms/hold-points?activityId*` | Open ITP hold points | `inspection.read` | `{ activityId, open, holdPoints[{ instanceId, ref, title, itemId, label, state(pending\|failed), status }] }` |
| GET | `/projects/:projectId/forms/:instanceId` | Detail + checklist | `inspection.read` | `sections[].items[].response/signature, signatures[], holdPoints[]` |
| GET | `/projects/:projectId/forms/:instanceId/export.pdf?includePhotos` | PDF | `inspection.export` | |
| PATCH | `/projects/:projectId/forms/:instanceId` | Edit scheduling | `inspection.update` | scheduled\|in_progress only (409 `FORM_INSTANCE_LOCKED`) |
| DELETE | `/projects/:projectId/forms/:instanceId` | Delete unanswered scheduled | `inspection.delete` (pm, planning_eng) | 409 `FORM_INSTANCE_NOT_DELETABLE` |
| POST | `/projects/:projectId/forms/:instanceId/start` | scheduled → in_progress | `inspection.submit` + `inspection.start` | |
| PUT | `/projects/:projectId/forms/:instanceId/responses` | Save answers | `inspection.submit` + `inspection.start` | `{ responses[1-500]{ itemId, value, note(<=2000) } }` → instance (response ids = recordId for photo attachments) |
| POST | `/projects/:projectId/forms/:instanceId/complete` | → complete (outcome pass\|fail) | `inspection.submit` + `inspection.complete` | 400 `FORM_INCOMPLETE` with `details.problems[]` |
| POST | `/projects/:projectId/forms/:instanceId/close` | complete → closed | `inspection.approve` + `inspection.close` | `{ reason? }` |
| POST | `/projects/:projectId/forms/:instanceId/reopen` | complete\|closed → in_progress | `inspection.approve` + `inspection.reopen` | `{ reason }` (service-required) |
| POST | `/projects/:projectId/forms/:instanceId/void` | → void | `inspection.approve` + `inspection.void` (pm, quality_engineer) | `{ reason }` |
| POST | `/projects/:projectId/forms/:instanceId/signatures` | Drawn signature | `inspection.submit` + `inspection.sign` | `{ role(inspector\|approver\|subcontractor\|witness\|attendee), image(PNG data URL, 30-600000 chars), signerName(<=200), signerCompany(<=200), itemId? }` → 201 `{ signature, instance }` |
| POST | `/projects/:projectId/forms/:instanceId/items/:itemId/deficiency` | Checklist item → punch item / observation | `inspection.submit` + `inspection.complete` AND `punch.create` | `{ target(punch_item\|observation), observationType?, hazard?, … }` → 201 `{ record, instance }`; 409 `FORM_DEFICIENCY_EXISTS` |
| GET | `/projects/:projectId/forms/templates?scope&type&status&includeArchived&search` | Templates (project + company) | `inspection.read` | |
| POST / PATCH / DELETE | `/projects/:projectId/forms/templates(/:templateId)` | Project template CRUD | `inspection.update` + `inspection.template_admin` | `{ name*(<=200), description, trade, type, status, settings{}, sections[<=100]{ title, items[<=500] }, sourceTemplateId }` |
| POST | `/projects/:projectId/forms/templates/:templateId/duplicate` | Copy into project | `inspection.update` + `inspection.template_admin` | `{ name? }` |
| GET | `/company/form-templates(/:id)` | Company templates | auth + subscriptionGate (no admin guard) | |
| POST / PATCH / DELETE / `/starters` / `/:id/duplicate` | `/company/form-templates…` | Company template admin | requireCompanyAdmin | |

State machine: scheduled →(start \| first PUT responses \| first signature) in_progress →(complete) complete →(close) closed; reopen complete\|closed → in_progress; void scheduled\|in_progress\|complete. Completion gate: required items answered; photo/photoRequired items need ≥1 Attachment `recordType:'form_response'`, `recordId`=response id; signature items need a Signature; `settings.requireSignatures` roles need form-level signatures. Outcome fail when any failed/deficient (pass_fail='fail', yes_no='no', number outside min/max). Recurrence creates the next instance on completion. ITP hold points block progress approval (409 `ITP_HOLD_POINT_OPEN`).

Roles: create/update/submit (start, complete, sign) → pm, planning_eng, site_engineer, qs, quality_engineer; approve (close, reopen) → pm, planning_eng, quality_engineer; `inspection.void` → pm, quality_engineer; `inspection.template_admin` → pm, planning_eng, qs, quality_engineer; delete → pm, planning_eng. Parties: owner read/export; consultant read/create/submit/approve/export; contractor read/create/update/submit/export (+template_admin); subcontractor read/submit/export.

#### NCR (`ncr.js`; module `ncr`)

| Method | Path | Purpose | Permission | Notes |
|---|---|---|---|---|
| GET | `/projects/:projectId/ncr` | List all (no filters, no pagination) | `ncr.read` | `{ rows[], summary:{ open, submitted, closed, major, minor, overdue } }` |
| POST | `/projects/:projectId/ncr` | Raise (`NCR-nnn`) | `ncr.create` | `{ severity(major\|minor), status:'open' only, description, disposition, responsible, owner/reviewer/approver, *UserId refs, assigneeCompanyId, dueDate, activityId\|activityIds\|activityLinks, attachments\|attachmentRefs, comment }` |
| PATCH | `/projects/:projectId/ncr/:ncrId` | Edit open NCR | `ncr.update` | status only 'open' (400 `NCR_WORKFLOW_ACTION_REQUIRED`); `attachmentRefs` replaces WorkflowAttachment set |
| POST | `/projects/:projectId/ncr/:ncrId/submit` | open → submitted | `requirePermissionOr('ncr','submit',{transition:'ncr.submit'}, isNcrAssignee)` | `{ closureComment\|comment\|statusComment*, responsible, dueDate (required if unset), attachmentRefs[] (≥1 evidence) }`; 400 `NCR_CLOSEOUT_REQUIRED_FIELDS` / `NCR_CLOSEOUT_EVIDENCE_REQUIRED`; 409 `NCR_NOT_READY_FOR_CLOSEOUT` |
| POST | `/projects/:projectId/ncr/:ncrId/close` | **Alias of submit** (lands on submitted) | `requirePermissionOr('ncr','submit',{transition:'ncr.close'}, isNcrAssignee)` | `ncr.service.js:745` |
| POST | `/projects/:projectId/ncr/:ncrId/approve` | submitted → closed | `ncr.approve` + `ncr.approve` | `{ comment? }` |
| POST | `/projects/:projectId/ncr/:ncrId/reject` / `/disapprove` | submitted → open | `ncr.approve` + `ncr.reject` | `{ reason* }` |
| POST | `/projects/:projectId/ncr/:ncrId/reopen` | closed → open | `ncr.approve` + `ncr.reopen` | `{ reason* }` |
| DELETE | `/projects/:projectId/ncr/:ncrId` | Hard delete | `ncr.delete` (pm) | |

Evidence for closeout counts ONLY `WorkflowAttachment` rows from `attachmentRefs` (contract: POST `/workflow/uploads` → send `{ fileName, fileUrl|url, storageKey|key, mimeType, sizeBytes }` items as `attachmentRefs`); unified POST `/attachments` uploads do NOT count. Roles: create/update/submit → pm, planning_eng, site_engineer, quality_engineer; approve → pm, quality_engineer; delete → pm; **no party role has ncr access**. No GET `/ncr/:id`.

#### Safety (`safety.js`; module `safety`)

| Method | Path | Purpose | Permission | Notes |
|---|---|---|---|---|
| GET | `/projects/:projectId/safety?status(open\|investigating\|submitted\|closed\|archived)&includeArchived` | List | `safety.read` | `{ rows[], summary:{ open, investigating, submitted, closed, archived, lti, nearMiss, lostDays, overdue } }` |
| POST | `/projects/:projectId/safety` | Report (`SAF-nnn`) | `safety.create` | `{ incidentType*(near_miss\|first_aid\|lti\|fatality), title*, severity, date, dueDate, closedDate, lostDays, status(open\|investigating), responsible, investigation, closureComment, owner/reviewer/approver, *UserId refs, activity links, attachments\|attachmentRefs, comment }` |
| PATCH | `/projects/:projectId/safety/:incidentId` | Edit | `safety.update` | status only open\|investigating; 409 `SAFETY_INCIDENT_ARCHIVED` |
| POST | `/projects/:projectId/safety/:incidentId/submit` / `/close` (alias) | open\|investigating → submitted | `requirePermissionOr('safety','submit',{transition:'safety.submit'\|'safety.close'}, isIncidentAssignee)` | same closeout contract as NCR (`SAFETY_CLOSEOUT_*`) |
| POST | `/projects/:projectId/safety/:incidentId/approve` | submitted → closed | `safety.approve` + `safety.approve` | |
| POST | `/projects/:projectId/safety/:incidentId/reject` / `/disapprove` | submitted → investigating | `safety.approve` + `safety.reject` | `{ reason* }` |
| POST | `/projects/:projectId/safety/:incidentId/reopen` | closed → investigating | `safety.approve` + `safety.reopen` | `{ reason* }` |
| DELETE | `/projects/:projectId/safety/:incidentId` | Archive (soft) | `safety.delete` (pm) | |

Roles: create/update/submit → pm, site_engineer, quality_engineer; approve → pm, quality_engineer; no party access. No GET `/safety/:id`.

#### Punch list / observations (`punch.js`; module `punch`)

| Method | Path | Purpose | Permission | Notes |
|---|---|---|---|---|
| GET | `/projects/:projectId/punch` | List | `punch.read` | `?kind(punch\|observation\|all, default punch)&observationType&status(csv)&assigneeCompanyId&assigneeUserId&managerUserId&finalApproverUserId&ballInCourtUserId(uuid\|me)&locationId&sheetId&trade&priority(low\|normal\|high\|urgent)&overdue&search(<=120)&limit(1-1000)` → `{ items[], summary:{ total, open, overdue, byStatus, byCompany, byTrade, byType } }`; party viewers see only own company/own items |
| GET | `/projects/:projectId/punch/export.pdf?groupBy&includePhotos` / `/export.csv` | Exports | `punch.export` | |
| POST | `/projects/:projectId/punch` | Create (`PL-nnn` / `OBS-nnn`) | `punch.create` | `{ title*(1-200), description(<=4000), priority, kind(punch\|observation), clientRequestId(<=120), observationType(safety\|quality\|commissioning\|work_to_complete\|environmental), hazard(<=120), contributingCondition(<=2000), sourceRecordType, sourceRecordId, trade, locationText, locationId, sheetId, activityId, assigneeCompanyId, assigneeUserId, managerUserId, finalApproverUserId, dueDate, status(draft\|open), activityIds\|activityLinks, attachmentRefs }` → 201 (`replayed:true` on replay) |
| POST | `/projects/:projectId/punch/bulk` | ≤100 items | `punch.create` | `{ items[1-100]{ title*, clientRequestId?, … }, defaults{} }` |
| POST | `/projects/:projectId/punch/distribute` | Email/notify list | `punch.submit` + `punch.distribute` | `{ itemIds[<=1000] \| (companyIds[<=50] + kind), userIds[<=200], message(<=2000) }` |
| GET / PATCH | `/projects/:projectId/punch/:itemId` | Detail / edit | `punch.read` / `punch.update` | 409 `PUNCH_ITEM_LOCKED` when closed/void |
| POST | `/projects/:projectId/punch/:itemId/transition` | State change | `hasPermission('punch', action, {transition})` per action | `{ action(open\|ready_for_review\|close\|reopen\|dispute\|resolve_dispute\|void), reason(<=2000) }` |
| DELETE | `/projects/:projectId/punch/:itemId` | Delete draft | `punch.delete` (pm) | 409 `PUNCH_ITEM_NOT_DRAFT` |

Transition map (`punch.js:19-27`): open → submit/`punch.open`; ready_for_review → submit/`punch.ready_for_review`; close → approve/`punch.close`; reopen → submit/`punch.reopen`; dispute → submit/`punch.dispute`; resolve_dispute → submit/`punch.reopen`; void → approve/`punch.void`. State machine: draft →open→ ready_for_review → closed (close also from open); reopen closed\|ready_for_review → open; dispute open\|ready_for_review → in_dispute; resolve_dispute → open; void from draft\|open\|ready_for_review\|in_dispute. `finalApproverUserId` set → only that user may close (403 `PUNCH_FINAL_APPROVER_ONLY`). Ball-in-court derived: draft→createdBy\|manager; open→assignee\|manager; ready_for_review→finalApprover\|manager; in_dispute→manager\|createdBy.

Roles: create → pm, planning_eng, site_engineer, qs, quality_engineer; update/submit → pm, planning_eng, site_engineer, quality_engineer; approve (close, void) → pm, quality_engineer; delete → pm. Parties: owner read/export; consultant read/create/submit/approve/export (open, close, reopen); contractor read/create/update/submit/export (open, ready_for_review, dispute, distribute); subcontractor read/update/submit/export (ready_for_review, dispute).

#### Legacy ITP / defects / material tests (no workflow, hard delete, no idempotency)

| Path | Permission (list / create / patch / delete) | Notes |
|---|---|---|
| `/projects/:projectId/itp(/:itpId)` | `inspection.read` / `inspection.create` / `inspection.update` / `inspection.delete` | `{ title*, pointType(hold\|witness\|review), status(pending\|passed\|failed\|waived), inspector, notes, dueDate, inspectionDate, … }`; `ITP-nnn`; status failed counts against quality score |
| `/projects/:projectId/material-tests(/:testId)` | `inspection.read` / `create` / `update` / `delete` | `{ testType*, result(pass\|fail\|pending), specValue, actualValue, labName, millCertRef, notes, dueDate, testDate, … }`; `MTEST-nnn` |
| `/projects/:projectId/defects(/:defectId)` | `punch.read` / `punch.create` / `punch.update` / `punch.delete` | `{ title*, severity(minor\|major\|critical), status(open\|in_progress\|closed), trade, location, assignee, notes, dueDate, targetCloseBy, … }`; `DEF-nnn`; superseded by PunchItem |

#### Photos (`photos.js`; module `document_control`)

| Method | Path | Permission | Notes |
|---|---|---|---|
| GET | `/projects/:projectId/photos?from&to&locationId&tag&recordType&recordId&search&cursor&limit(1-200)` | `document_control.read` | `{ items[{ id, documentId, locationId, location, caption, tags, takenAt, latitude, longitude, altitude, cameraMake, cameraModel, width, height, orientation, thumbnailStatus, uploadedBy, document, records[] }], pagination, summary{ total, tags[] } }` |
| PATCH | `/projects/:projectId/photos/:photoId` | `document_control.create` | `{ caption(<=500), tags, locationId, takenAt }` (no lat/long) |
| GET | `/projects/:projectId/photos/:photoId/file` / `/thumbnail` | `document_control.read` | 302/bytes |
| GET | `/projects/:projectId/photos/ai/status` | `document_control.read` | |
| POST | `/projects/:projectId/photos/ai/analyze` | `assistant.read` + `document_control.create` | `{ photoIds[<=40], from, to, uncaptionedOnly, force, limit(1-40) }` |
| GET / POST | `/projects/:projectId/photos/:photoId/ai` / `/ai/analyze` | read / `assistant.read` + `document_control.create` | |
| POST | `/projects/:projectId/photos/:photoId/ai/apply` | `document_control.create` | `{ caption(<=300), tags[<=10], locationId, overwrite }` |
| POST | `/projects/:projectId/photos/:photoId/ai/observation` | `punch.create` | `{ hazard*(<=120), description, severity, contributingCondition, trade, locationId, assigneeCompanyId, dueDate }` → 201 observation |

#### Custom fields (`custom-fields.js`)

`GET /projects/:projectId/custom-fields/schema?recordType`; `GET /custom-fields/values?recordType&recordIds(csv ≤500)` (read on module); `GET /custom-fields/values/:recordType/:recordId`; `PUT /custom-fields/values/:recordType/:recordId { values{}, recordTypeKey?, partial, context{} }` (update on module). Record types incl. punch_item→punch, form_instance→inspection, ncr→ncr, material_test→ncr, safety_incident→safety.

**MOBILE — do**: `/punch` (`ballInCourtUserId=me`, `clientRequestId`, bulk, transition), `/forms` (`clientRequestId`/`clientCreatedAt`/`deviceId`, PUT responses, signatures, complete, deficiency, hold-points), `/attachments` with `recordType:'form_response'` for checklist photos and `'punch_item'` for punch photos, `/photos` gallery, comments/subscriptions, custom fields, sheet pins. NCR/safety closeout: `/workflow/uploads` → `attachmentRefs` → `/submit` (or `/close`, which only submits). **Must not**: set statuses via PATCH; compute quality score/health; expect GET by id for ncr/safety/itp/defects/material-tests (absent); assume concurrency protection; treat party users as able to reach ncr/safety.

### 4.4 Inventory (`backend/src/routes/inventory.js`, org-level `/inventory`; module `inventory`; `req.projectAccess` never set → org role only)

| Method | Path | Purpose | Permission | Notes |
|---|---|---|---|---|
| GET | `/inventory/items?projectId&search(<=120)&category(<=80)&status(active\|archived)&lowStock` | Item master + derived stock | `inventory.read` | `{ items[{ id, projectId, sku, barcode, qrCode, name, unit, category, manufacturer, model, unitCost, averageCost, lastPurchasePrice, reorderLevel, minStock, maxStock, leadTimeDays, isSerialised, isBatched, status, onHand, reserved, available, inTransit, damaged, quarantined, value, belowReorder }] }`; cap 500 |
| GET | `/inventory/items/scan/:code` | Resolve scanned barcode/QR/SKU | `inventory.read` | exact equality on `barcode` OR `qrCode` OR `sku` → `{ item, stock:[{ warehouseId, warehouse, warehouseCode, locationId, location, locationCode, onHand, reserved, available, damaged, quarantined }] }`; 404 `ITEM_NOT_FOUND`; items only (not bins/POs) |
| GET | `/inventory/items/:itemId` | Item + balances | `inventory.read` | |
| POST | `/inventory/items` | Create | `inventory.create` + `item.manage` | `{ sku*(<=60), name*(<=200), unit*(<=20), barcode?(<=120), qrCode?(<=120, defaults to sku), category, manufacturer, model, specification, description, notes, preferredSupplierId, projectId, unitCost, reorderLevel, minStock, maxStock, leadTimeDays, isSerialised, isBatched, status }`; 409 `ITEM_SKU_TAKEN` |
| PATCH | `/inventory/items/:itemId` | Update/archive | `inventory.update` + `item.manage` | no DELETE |
| GET | `/inventory/warehouses?projectId` | Warehouses | `inventory.read` | `{ items[{ id, code, name, kind, projectId, address, managerId, manager, status, notes, locationCount }] }` |
| POST | `/inventory/warehouses` | Create | `inventory.create` + `warehouse.manage` | `{ code*(<=30), name*, kind(central\|project\|site\|temporary\|equipment_yard), projectId, managerId, address, notes }`; 409 `WAREHOUSE_CODE_TAKEN` |
| PATCH | `/inventory/warehouses/:warehouseId` | Update/archive | `inventory.update` + `warehouse.manage` | code immutable |
| GET / POST | `/inventory/warehouses/:warehouseId/locations` | Bins/zones | read / `inventory.create` + `warehouse.manage` | `{ code*(<=40), name*, kind(zone\|aisle\|rack\|shelf\|bin), parentId, sortOrder }`; 409 `LOCATION_CODE_TAKEN`; no PATCH/DELETE; no bin barcode |
| POST | `/inventory/stock/receive` | Direct goods-in (not vs PO); moves weighted average | `inventory.create` + `stock.receive` | `{ itemId*, warehouseId*, quantity*(>0), locationId, unitCost, damagedQty, poLineId, receiptLineId, expiryDate, batchNo(<=80), serialNo(<=80), reference(<=200), notes(<=2000), projectId/activityId/costCodeId/boqItemId/commitmentId }` → 201 StockTransaction; 400 `INV_DAMAGE_EXCEEDS_RECEIPT`; no ledger post; does not update PO |
| POST | `/inventory/stock/issue` | Goods out to activity/cost code → project cost | `inventory.submit` + `stock.issue` | `{ itemId*, warehouseId*, quantity*(>0), locationId, projectId, activityId, costCodeId, boqItemId, locationRefId, commitmentId, batchNo, serialNo, reference, notes }` → 201 `{ movements[], costPosted, costNote? }`; 400 `INV_NO_COST_TARGET` (needs activityId or costCodeId), `INV_PROJECT_MISMATCH`; 409 `INV_INSUFFICIENT_STOCK` / `INV_INSUFFICIENT_AVAILABLE`; posts `material_issue` ledger entry when projectId resolves |
| POST | `/inventory/stock/reserve` | Reserve (+) / release (−) | `inventory.submit` + `stock.issue` | `{ itemId*, warehouseId*, quantity*(signed, non-zero), locationId, reference, notes }` → `{ itemId, warehouseId, locationId, onHand, reserved, available, reservedBy }`; no transaction row; 409 `INV_NO_STOCK_HERE` / `INV_RESERVATION_OVER_STOCK` / `INV_RESERVATION_NEGATIVE` |
| POST | `/inventory/stock/return` | Back from site (negative `material_issue`) | `inventory.update` + `stock.return` | requires activityId or projectId (400 `INV_NO_COST_SOURCE`) |
| POST | `/inventory/stock/adjust` | Signed correction | `inventory.update` + `stock.adjust` | `notes*` (400 `INV_ADJUST_REASON`); may consume reserved; no cost |
| POST | `/inventory/stock/damage` / `/quarantine` / `/release` | Write-off / quarantine / release | `inventory.update` + `stock.adjust` | quantity>0; release needs the bin holding quarantine; no cost |
| GET | `/inventory/stock/transactions?itemId&warehouseId&projectId&activityId&type&limit(1-500, default 100)` | Movement ledger | `inventory.read` | newest first; no cursor; types receipt\|issue\|return\|transfer_out\|transfer_in\|adjust\|count\|damage\|quarantine\|release\|reverse |
| GET | `/inventory/transfers?status(draft\|in_transit\|received\|cancelled)` | Transfers | `inventory.read` | cap 200 |
| POST | `/inventory/transfers` | Draft transfer (`TRF-nnnnn`) | `inventory.create` + `stock.transfer` | `{ fromWarehouseId*, toWarehouseId*, lines*[{ itemId*, quantity*(>0), batchNo?, serialNo?, notes? }], ref?, reason?(<=500) }`; 400 `TRANSFER_SAME_WAREHOUSE` / `TRANSFER_EMPTY`; no cancel route |
| POST | `/inventory/transfers/:transferId/dispatch` | draft → in_transit | `inventory.update` + `stock.transfer` | 409 `TRANSFER_STATE` |
| POST | `/inventory/transfers/:transferId/receive` | in_transit → received | `inventory.update` + `stock.transfer` | `{ lines?[{ id, receivedQty?, damagedQty? }] }`; 400 `TRANSFER_OVER_RECEIPT` |
| GET | `/inventory/purchase-orders?projectId&scope(receivable\|all)` | Receivable POs (warehouse view) | `inventory.read` | cap 100; `scope=receivable` filters draft\|issued\|partial (mismatch with `RECEIVABLE_STATUSES` issued\|acknowledged\|partial\|received) → use `scope=all` and filter client-side |
| GET | `/inventory/purchase-orders/:ref` | PO by ref (`PO-nnnnn`) or uuid | `inventory.read` | 404 `PO_NOT_FOUND` |
| POST | `/inventory/goods-receipt` | GRN against a PO | `inventory.create` + `stock.receive` | `{ orderId*, warehouseId*, receiptNumber?(<=40, auto `GRN-nnnnn`), deliveryNote?(<=200), notes?, lines*[{ poLineId*, acceptedQty?, rejectedQty?, unitCost?, locationId?, inventoryItemId?, batchNo?, serialNo?, expiryDate?, notes? }] }` → 201 `{ receiptId, receiptNumber, movements, warehouse, order:{ id, ref, status, fullyReceived }, lines[] }`; 409 `PO_NOT_ISSUED` (order must be issued\|acknowledged\|partial\|received), `RECEIPT_OVER_ORDER`, `RECEIPT_ALREADY_POSTED` (details `{ receiptNumber, receiptId, orderId }`); 400 `RECEIPT_DUPLICATE_LINE` / `RECEIPT_EMPTY`; auto-creates InventoryItem (`sku = itemCode || 'PO-'+lineid8`); no notification/socket |
| GET | `/inventory/match/order/:orderId` / `/match/invoice/:directCostId` | Three-way match | `inventory.read` | verdict matched\|check\|review(\|unmatched); flags `invoiced_more_than_received`, `price_variance` (0.5%), `received_more_than_ordered`, `rejected_on_delivery`, `short_delivered`, `no_purchase_order`, `lines_without_order` |
| GET | `/inventory/summary?projectId` | Tiles | `inventory.read` | `{ totalValue, itemCount, lowStock, outOfStock, overstock, slowMoving, damaged, quarantined, byWarehouse[], issuedValue, receivedValue }` |
| GET | `/inventory/analytics?projectId` | Dashboard | `inventory.read` | lists capped 25 rows; includes `byWarehouse`, `usageByActivity` |

**Rules**: cost ledger posts only for `issue` (+) and `return` (−) as `material_issue` at weighted average under item lock; weighted average moves only on `receipt` with `unitCost`; pessimistic row locks (item → balance; transfers, PO, PO lines `FOR UPDATE`); ledger idempotent per StockTransaction, but **inventory mutations are not idempotent** (a retried issue double-posts); only goods receipt has a natural key (`receiptNumber` unique per project). Reservation respected only by issue and transfer_out. Identifiers: `InventoryItem.sku` (unique org), `barcode` (unique org, nullable), `qrCode` (defaults sku); `Warehouse.code`; `WarehouseLocation.code` (no barcode); PO ref `PO-nnnnn`; `StockTransfer.ref TRF-nnnnn`; `DeliveryReceipt.receiptNumber GRN-nnnnn`. serialNo/batchNo/expiryDate are free text, unenforced.

**Transition roles**: `stock.receive` → pm, procurement, warehouse; `stock.issue` (issue, reserve), `stock.return` → pm, warehouse, site_engineer, quality_engineer; `stock.transfer`, `stock.adjust`, `warehouse.manage` → pm, warehouse; `item.manage` → pm, procurement, warehouse; `inventory.read` → all nine roles. Company-admin status does NOT widen inventory access.

**MOBILE — do**: scan → `/items/scan/:code`; GRN flow (`/purchase-orders?scope=all` → `/purchase-orders/:ref` → `/goods-receipt` with client-generated `receiptNumber`, treating 409 `RECEIPT_ALREADY_POSTED` as success); issue/return/reserve/damage/quarantine/release per role; ledger via `/stock/transactions`; transfers dispatch/receive; poll `/summary` (no realtime). **Must not**: compute/post cost; retry `/stock/*` blindly (double-post); assume stock counts, movement reversal, transfer cancel, receipt listing, bin barcodes, or material usage recording exist.

### 4.5 Procurement — requirements, packages, bids, award, PO, deliveries, long lead

| Method | Path | Purpose | Permission | Notes |
|---|---|---|---|---|
| GET | `/projects/:projectId/procurement` | Overview | `procurement.read` | `{ suppliers, packages(+procurementRisk, requiredOnSiteDate, latestOrderDate), orders, alerts, summary }` |
| GET / POST | `/projects/:projectId/procurement/suppliers` | Suppliers | read / `procurement.create` + `supplier.manage` (pm, procurement) | POST `{ companyId? \| name*, code, contactName, email, phone, address, tradeCategories[], status(approved\|pending\|on_hold\|blocked), leadTimeReliability(0-100), notes }`; no PATCH/DELETE |
| GET / POST | `/projects/:projectId/procurement/packages` | Packages | read / `procurement.create` + `package.manage` (pm, planning_eng, procurement) | POST `{ packageNumber*, title*, description, supplierId, activityId, status(planning\|tendering\|awarded\|in_delivery\|closed\|cancelled), buyer, plannedAwardDate, requiredOnSiteDate, requiredTiming(activity_start\|activity_finish), needOffsetDays, leadWeeks, bufferDays, notes }`; no PATCH/DELETE |
| POST / GET | `/projects/:projectId/procurement/packages/:packageId/quotes` | Request quotes (creates linked bid package) / list rounds | `bid.create` / `bid.read` | `{ title?, description?, instructions?, dueAt?, currency?(3), boqSections?[] }` → 201 bid package |
| POST | `/projects/:projectId/procurement/packages/:packageId/order` | Raise PO from confirmed award | `procurement.create` + `po.issue` | `{ ref?, leadWeeks?, requiredBy?, notes? }` → 201 (status planned); `PROCUREMENT_NO_AWARD` / `PROCUREMENT_AWARD_INCOMPLETE` / `PROCUREMENT_AWARD_NOT_SCHEDULE_LINKED` |
| GET | `/projects/:projectId/procurement/purchase-orders` | Legacy PO list with line risk | `procurement.read` | |
| POST | `/projects/:projectId/procurement/purchase-orders` | Create PO with lines | `procurement.create` + `po.issue` (pm, procurement) | `{ ref?(auto PO-nnnnn), item, activityId, packageId, supplierId, commitmentId, supplier, status(planned\|draft only), leadWeeks, requiredTiming, needOffsetDays, bufferDays, currency, orderDate, requiredBy, promisedDate, deliveryDate, buyer, notes, lines*[{ lineNumber?, activityId*, costCodeId, budgetLineId, boqItemId, activityMaterialId, materialMasterId, packageId, supplierId, itemCode, description*, spec, unit*, orderedQty*(≥0.001), unitCost*, leadWeeks, requiredTiming, needOffsetDays, bufferDays, requiredDate, promisedDate, notes }] }`; 400 `PO_STATUS_NOT_PLANNABLE`, `PROCUREMENT_ACTIVITY_REQUIRED`; lines immutable afterwards |
| POST | `/projects/:projectId/procurement/purchase-orders/:orderId/receipts` | Record delivery (same writer as `/inventory/goods-receipt`) | `procurement.submit` + `receipt.post` (pm, procurement, warehouse) | `{ receiptNumber*, receivedAt?, receivedBy?, warehouseId?, deliveryNote?, dailyReportId?, notes?, lines*[{ poLineId*, acceptedQty*(≥0.001), rejectedQty?, dailyReportId?, notes? }] }`; `warehouseId` auto-resolved (400 `WAREHOUSE_REQUIRED_FOR_RECEIPT` with `details.warehouses[]`); `issueToActivity` / `issuedQty` validated but ignored; no GET receipts |
| GET | `/projects/:projectId/procurement/lead-time-alerts?status(open\|acknowledged\|resolved)` | Alerts | `procurement.read` | auto-created/resolved on PO create and goods receipt |
| PATCH | `/projects/:projectId/procurement/lead-time-alerts/:alertId` | Legacy status setter | `procurement.update` + `alert.acknowledge` | body `status` accepts ONLY `'acknowledged'` (else 400 `PROCUREMENT_ALERT_WORKFLOW_ENDPOINT_REQUIRED`) |
| PATCH | `/projects/:projectId/procurement/lead-time-alerts/:alertId/acknowledge` / `/resolve` | Acknowledge / resolve | `procurement.update` + `alert.acknowledge` / `alert.resolve` (pm, planning_eng, procurement, warehouse) | `{ note? }`; 409 `PROCUREMENT_ALERT_ALREADY_RESOLVED` |
| GET | `/projects/:projectId/purchase-orders?status&supplierId` | Commercial PO register | `procurement.read` | `{ items[{ id, ref, item, status, warehouseStatus, invoiceStatus, lifecycleStatus, lifecycleLabel, ballInCourt, supplierId, supplier, commitmentId, currency, subtotal, taxRate, taxAmount, value, invoicedAmount, uninvoiced, deliveryLocation, requiredBy, promisedDate, submittedAt, approvedAt, acknowledgedAt, cancelledAt, closedAt, lines[], receipts[], invoices[] }], summary }`; cap 500 |
| GET / PATCH | `/projects/:projectId/purchase-orders/:orderId` | Detail / edit header | read / `procurement.update` + `po.issue` | editable only planned\|draft\|pending_approval (409 `PO_LOCKED`) |
| POST | `/projects/:projectId/purchase-orders/:orderId/submit` | → pending_approval | `procurement.submit` + `po.submit` (pm, procurement, planning_eng) | needs lines, supplier, requiredBy (`PO_NO_LINES`, `PO_SUPPLIER_REQUIRED`, `PO_REQUIRED_DATE`); 409 `PO_TRANSITION_INVALID` / `PO_STATE_CHANGED` |
| POST | `/projects/:projectId/purchase-orders/:orderId/approve` / `/reject` | pending_approval → approved / draft | `procurement.approve` + `po.approve` (pm) | reject `{ reason* }` |
| POST | `/projects/:projectId/purchase-orders/:orderId/issue` | approved → issued | `procurement.update` + `po.issue` | receipts become possible |
| POST | `/projects/:projectId/purchase-orders/:orderId/acknowledge` | issued → acknowledged | `procurement.update` + `po.acknowledge` | `{ reason?, acknowledgedRef?(<=120) }` |
| POST | `/projects/:projectId/purchase-orders/:orderId/cancel` | → cancelled | `procurement.delete` + `po.cancel` | `{ reason* }`; 409 `PO_CANCEL_AFTER_DELIVERY` |
| POST | `/projects/:projectId/purchase-orders/:orderId/close` | issued\|acknowledged → closed | `procurement.update` + `po.close` | `{ reason?, force? }`; 409 `PO_CLOSE_OUTSTANDING` |
| GET | `/projects/:projectId/long-lead` | Long-lead register | auth + project access only (no permission guard) | derived fields when linked to a package |
| POST | `/projects/:projectId/long-lead` | Create | `requireRoles('pm','planning_eng','procurement')` | `{ item*, activityId, procurementPackageId, leadWeeks, requiredTiming, needOffsetDays, bufferDays, orderBy, expectedDeliveryDate, deliveredAt, warehouseStatus(not_received\|partial\|received\|issued), criticality, risk, status(not_ordered\|ordered\|delivered), supplier }`; 400 `PROCUREMENT_ACTIVITY_REQUIRED` (critical/high or ≥12 weeks); 409 `LONG_LEAD_FIELD_DERIVED` |
| PATCH | `/projects/:projectId/long-lead/:id` | Update | `requireRoles('pm','planning_eng','procurement','warehouse')` | |
| DELETE | `/projects/:projectId/long-lead/:id` | Delete | `requireRoles('pm','planning_eng')` | |
| GET / POST | `/projects/:projectId/activities/:activityId/materials` | Material requirements | `procurement.read` / `procurement.create` + `material.plan` (pm, planning_eng, procurement) | POST `{ name*, unit*(TON\|KG\|M3\|M2\|M\|PCS\|L\|BAG\|SHEET\|ROLL\|LOAD), qty*(>0), code, spec, supplierId, supplierName, supplierContact, procurementPackageId, plannedQty, requiredDate, requiredTiming, needOffsetDays, leadWeeks, bufferDays, orderByDate, notes }` |
| PATCH / DELETE | `/projects/:projectId/activities/:activityId/materials/:materialId` | Update / delete | `procurement.update` + `material.plan` / `procurement.delete` | status free-set; `issuedQty` not accepted; 409 `MATERIAL_HAS_PROCUREMENT_ACTIVITY` |
| POST | `/projects/:projectId/activities/:activityId/materials/:materialId/usage` | Record consumption | `procurement.submit` + `material.use` | `{ usedQty*(≥0.001), wasteQty?, usageDate?, poLineId?, receiptLineId?, dailyReportId?, installedLocation?, notes? }`; **always refused** (409 `MATERIAL_USAGE_EXCEEDS_ISSUED_QTY`) because nothing writes `issuedQty` |
| GET | `/projects/:projectId/bids?status(draft\|open\|closed\|awarded\|cancelled)` | Bid/RFQ packages | `bid.read` (pm, planning_eng, qs, cost_controller, procurement, finance — NOT warehouse/site_engineer/quality_engineer) | siblings: `/boq-sections`, POST `/` (`bid.create`), GET/PATCH/DELETE `/:packageId`, lines (`/lines/from-boq`, `/lines`, `/lines/:lineId`), invitations (+`/resend`), `/publish\|/close\|/reopen` (`bid.submit` + `bid.publish` → pm, procurement), `/addenda`, `/questions/:questionId/answer` (`bid.answer` → pm, qs, procurement), `/bids`, `/leveling`, `/leveling.xlsx` (`bid.export`) |
| POST | `/projects/:projectId/bids/:packageId/award` / `/award/revoke` | Soft award | `bid.approve` + `bid.award` (pm) | `{ bidId* }` |
| POST | `/projects/:projectId/bids/:packageId/award/confirm` | Confirm award → Commitment (subcontract\|purchase_order), package awarded | `bid.approve` + `bid.award` (pm) | `{ bidId?, title?, retentionRate?(0-100), startDate?, endDate?, prequalOverrideReason? }`; 409 `BID_PACKAGE_LOCKED` |
| GET … | `/public/bids/:token` (+ `/documents/:documentId`, POST `/questions`, PUT `/bid`, POST `/bid/submit`, `/bid/withdraw`, `/decline`, `/upload`) | Supplier bid portal | none (token) | |
| GET / PUT / POST | `/public/rfqs/:token` / `/quote` / `/decline` | Vendor quote portal (change events) | none (token) | |

**PO state machine** (`purchase-order.service.js:115-124`): planned→draft\|pending_approval\|cancelled; draft→pending_approval\|cancelled; pending_approval→approved\|draft(reject)\|cancelled; approved→issued\|draft\|cancelled; issued→acknowledged\|closed\|cancelled; acknowledged→closed\|cancelled; partial/received set by goods receipt. PO transitions write audit + `approvalWorkflowService.recordTransition` (workflow notifications).

**MOBILE — do**: read packages/POs/long-lead; receive deliveries via `/procurement/purchase-orders/:orderId/receipts` or `/inventory/goods-receipt` (warehouse/procurement/pm); acknowledge/resolve alerts. **Must not**: set PO status directly (only planned\|draft on create); set derived long-lead fields; call `/materials/:id/usage` (always refused); expect PATCH/DELETE on suppliers/packages or PO line edits.

### 4.6 Schedule / progress / lookahead / milestones / EV

| Method | Path | Purpose | Permission | Notes |
|---|---|---|---|---|
| GET | `/projects/:projectId/activities` | All activities (no filters, no pagination) | `schedule.read` | `{ id, name, activityCode, p6ActivityId, wbsCode, category, earlyStart/Finish, lateStart/Finish, totalFloat, dependencies[], baseline*, startDate, endDate, duration, budget, isMilestone, isCritical, sortOrder, pctComplete (approved only), actualCost, actualStart, actualFinish, progressMethod, progressMethodConfig, pendingProgress, progressApprovalStatus(draft\|submitted\|approved\|missing), status(todo\|in_progress\|complete\|delayed), assignedEngineers[] }` |
| POST / GET / PATCH / DELETE | `/projects/:projectId/activities(/:id)` | CRUD (re-runs CPM) | `schedule.create` / `read` / `update` / `delete` | `{ name*, category, activityCode, wbsCode, startDate, endDate, …, dependencies[]{ predecessorId\|predecessorActivityId\|predecessorRef, relationshipType(FS\|SS\|FF\|SF), lagDays }, isCritical, budget, isMilestone, sortOrder, engineerIds[] }` |
| POST | `/projects/:projectId/activities/bulk-progress` | Submit many | `progress.submit` + `submission.submit` | `{ updates[]{ activityId, pctComplete(0-100), actualCost, progressMethod\|method, status(draft\|submitted), source(manual\|import\|mobile\|daily_report), quantityComplete, quantityPlanned, quantityUnit, inspectionStatus, notes, evidence{}, milestones[] } }` → `{ submitted, submissions[] }`; unknown ids silently skipped; no replay key |
| GET | `/projects/:projectId/activities/progress-submissions?status` / `/activities/:id/progress-submissions?status` | Submissions | `progress.read` | |
| GET / PUT | `/projects/:projectId/activities/:id/progress-method` | Method config | `progress.read` / `progress.update` + `method.configure` (pm, planning_eng) | `{ method(percent\|quantity\|weighted_milestone\|inspection\|manual), plannedQuantity, quantityUnit, milestoneWeights[]{ id, name, weight }, inspectionRequired, evidenceRequired, notes }` |
| POST | `/projects/:projectId/activities/:id/progress` | Submit one (status draft\|submitted, `source:'mobile'`) | `progress.submit` + `submission.submit` | 403 `ACTIVITY_PROGRESS_ASSIGNMENT_REQUIRED` unless assigned or role in pm/planning_eng; 400 `PROGRESS_EVIDENCE_REQUIRED`, `PLANNED_QUANTITY_REQUIRED` |
| POST | `/projects/:projectId/activities/:id/progress-submissions/:submissionId/approve` / `/reject` | Approve (→ ActivityProgress) / reject | `progress.approve` + `submission.approve` / `submission.reject` (pm, planning_eng, qs) | 409 `ITP_HOLD_POINT_OPEN`; reject `{ reason* }`; 400 `APPROVED_PROGRESS_LOCKED` |
| GET | `/projects/:projectId/schedule` | Full schedule (Gantt) | `schedule.read` | `Cache-Control: no-store` |
| GET | `/projects/:projectId/schedule/revisions(/:revisionId, /readiness, /mapping)` | Revisions | `schedule.read` | status draft\|under_review\|approved\|rejected\|baselined\|superseded |
| POST | `/projects/:projectId/schedule/revisions/:revisionId/submit-review` | draft\|rejected → under_review | `schedule.submit` + `revision.submit_review` (pm, planning_eng) | `{ comment }` |
| POST | `…/revisions/:revisionId/approve` / `/reject` | under_review → approved / rejected | `schedule.approve` + `revision.approve` / `revision.reject` (pm) | reject `{ reason* }` |
| POST | `…/revisions/:revisionId/baseline` and `/schedule/baseline` | approved → baselined | `schedule.baseline` + `revision.baseline` | |
| POST | `…/revisions/:revisionId/activate` | Activate approved revision | `schedule.approve` + `revision.activate` (pm) | `{ mappings[]{ oldActivityId, newActivityKey }*, unmappedRemovals[], comment }` |
| POST | `…/revisions/:revisionId/rollback` | Roll back | `schedule.approve` + `revision.rollback` (pm) | target approved\|baselined\|superseded |
| POST | `/projects/:projectId/schedule/generate` | AI schedule from BOQ (async) | `schedule.create` + aiGenerationLimiter + uploadLimiter | multipart `file` (≤50 MB) → 202 `{ jobId }`; poll `/schedule/job/:jobId`; `/job/:jobId/retry` (`schedule.update`) |
| GET | `/projects/:projectId/schedule/resources` / `/layouts` (+POST/PATCH/DELETE) | Resource plan / saved Gantt layouts | `schedule.read` | |
| GET / POST | `/projects/:projectId/lookaheads?status(draft\|published\|archived)` | Lookaheads | `lookahead.read` / `lookahead.create` (pm, planning_eng, site_engineer, quality_engineer + contractor) | POST `{ startDate*, weeks(2-6), weekStartDay(0-6), title, notes, filter{ wbsPrefixes[], categories[], activityIds[], onlyCritical }, seed }` |
| GET | `/projects/:projectId/lookaheads/constraints` | Open constraints | `lookahead.read` | |
| GET / PATCH / DELETE | `/projects/:projectId/lookaheads/:lookaheadId` | Detail / edit / delete draft | read / `lookahead.update` / `lookahead.delete` (pm, planning_eng) | 409 `LOOKAHEAD_LOCKED`, `LOOKAHEAD_NOT_DRAFT` |
| POST | `…/:lookaheadId/refresh` / `/publish` / `/archive` / `/roll-forward` | Refresh / publish / archive / next period | `lookahead.update` / `lookahead.submit` + `lookahead.publish` / `lookahead.update` + `lookahead.archive` (pm, planning_eng) / `lookahead.create` | 400 `LOOKAHEAD_EMPTY` |
| GET | `…/:lookaheadId/export.xlsx` | XLSX | `lookahead.export` | |
| POST / PATCH / DELETE | `…/:lookaheadId/items(/:itemId)` | Items | `lookahead.update` | fields `name, activityId, wbsCode, plannedStart, plannedFinish, crewId, companyId, assigneeUserId, locationId, quantity, unit, status, pctComplete, varianceReason, constraint, constraintStatus(none\|open\|cleared), constraintOwnerUserId, constraintDueDate, notes, sortOrder`; 403 `LOOKAHEAD_ITEM_FORBIDDEN` for other companies' items |
| POST | `…/:lookaheadId/items/:itemId/status` | Field status update | `lookahead.update` + `lookahead.item_status` (only lookahead write a subcontractor holds) | `{ status*(planned\|in_progress\|done\|not_done), varianceReason(required when not_done: design\|material\|labour\|equipment\|weather\|prerequisite\|permit\|space\|other), pctComplete(0-100), notes(<=4000) }` |
| GET | `/projects/:projectId/health` | 7-dimension health (SPI/CPI from official EV) | auth + project access only | `{ generatedAt, dataFreshness{cutoffDate}, kpiSourceRules, overallScore, dimensions[{ key(schedule\|cost\|commercial\|supplyChain\|quality\|safety\|docControl), score, target{ module, child, status, source }, detail{ spi\|cpi } }], pendingReview{ total, metrics[] } }` |
| GET | `/projects/:projectId/reports/ev` | Official EV report (PV/EV/AC/SPI/CPI) | `cost.read` (pm, planning_eng, qs, cost_controller, finance) | site/quality engineers use `/health` |
| GET / POST | `/projects/:projectId/reports/periods` (+ `/:periodId/lock`) | Reporting periods | `cost.read` / `cost.create` / `cost.approve` + `reporting_period.lock` (pm, finance) | |
| GET / POST / PATCH / POST | `/projects/:projectId/reports/cost-loading(/:id, /submit, /approve, /reject)` | Cost loading | `cost.read` / `create` / `update` / `submit` / `approve` | not a field surface |
| GET / POST / PATCH / DELETE | `/projects/:projectId/weather-delays(/:weatherId)` | Weather-delay register | `eot.read` / `eot.create` / `eot.update` | |
| GET | `/projects/:projectId/equipment` (+ `/usage` `cost.read`; POST/PATCH/DELETE `requireRoles('pm','planning_eng')`) | Equipment register | auth + project access | |
| GET / POST / PATCH / … | `/projects/:projectId/locations(/:id, /reorder, /:id/archive, /:id/restore)` | Location tree | `location.read` / `create` / `update` / `location.delete` + `location.archive`/`location.restore` | |

**Milestones**: represented as `isMilestone` on activities and the `milestones` sub-tab; no dedicated endpoint in the maps. **Critical path**: `isCritical`/`totalFloat` fields; filter client-side.

**Rules**: activity status derived (pct≥100 complete; endDate<now delayed; pct>0 in_progress; else todo) from latest APPROVED ActivityProgress; pct derivation by method (quantity clamps to 100; weighted_milestone; inspection passed→100/failed→0). Progress submissions have no edit/withdraw. Approval blocked by open ITP hold points and missing required evidence. Health/EV use only approved data; `pendingReview` reported separately.

**MOBILE — do**: activities list/detail; `/activities/:id/progress` with `source:'mobile'`; read progress-method; lookahead item status; `/health` for dashboards. **Must not**: approve/reject submissions, activate/baseline/rollback revisions, write cost; treat `pctComplete` as anything but approved; expect pagination or delta sync on activities; expect a replay key on progress.

### 4.7 Daily logs and photos (`daily-logs.js`, `daily-reports.js`, `site-diaries.js`, `site-reporting.js`; module `progress`)

| Method | Path | Purpose | Permission | Notes |
|---|---|---|---|---|
| GET / PUT | `/projects/:projectId/daily-logs/settings` | Settings | `progress.read` / `progress.approve` + `daily_log.configure` (pm) | `{ latitude, longitude, timezone, weatherFeedEnabled, thresholds{}, distributionRoles[], distributionEmails[], autoDistributeAt, copySections[] }` |
| GET | `/projects/:projectId/daily-logs/manpower-report?from&to&groupBy(company\|trade\|company_trade\|activity)` | Manpower rollup | `progress.read` | |
| GET | `/projects/:projectId/daily-logs?from&to` | Days in range (YYYY-MM-DD) | `progress.read` | no cursor; `DAILY_LOG_RANGE` when too wide; party viewers see own party entries |
| GET | `/projects/:projectId/daily-logs/:date` | One day (`exists:false` when empty) | `progress.read` | `{ id, exists, projectId, date, status(open\|submitted\|approved), weather, weatherSource, summary, submittedAt/By, approvedAt/By, distributedAt, pdfDocumentId, sections{ manpower[], equipment[], deliveries[], visitors[], delays[], notes[] }, totals, path }`; entry `{ id, section, partyId, party, status(draft\|submitted\|approved\|rejected), createdBy, clientRequestId, …, activity, location, equipment, manHours }` |
| PATCH | `/projects/:projectId/daily-logs/:date` | Summary/weather | `progress.update` + `daily_log.update` (NOT parties) | `{ summary(<=8000), weather{} }`; 409 `DAILY_LOG_APPROVED` / `DAILY_LOG_SUBMITTED` |
| GET | `/projects/:projectId/daily-logs/:date/export.pdf` | PDF | `progress.export` (pm, planning_eng, qs, cost_controller) | |
| POST | `…/:date/weather/refresh` | Pull weather | `progress.update` + `daily_log.update` | `WEATHER_FEED_DISABLED` / `WEATHER_COORDINATES_REQUIRED` |
| POST | `…/:date/copy-previous` | Copy manpower/equipment | `progress.submit` + `daily_log.submit` | `{ sections[] ⊂ manpower\|equipment }` |
| POST | `…/:date/submit` / `/approve` / `/reopen` | open→submitted / →approved / →open | `progress.submit` + `daily_log.submit` / `progress.approve` + `daily_log.approve` (pm) ×2 | 400 `DAILY_LOG_EMPTY`; reopen `{ reason }` |
| POST | `…/:date/distribute` | Email/notify PDF | `progress.submit` + `daily_log.distribute` | `{ roles[], userIds[], emails[], note }` |
| POST | `…/:date/entries/:section` | Add entry (manpower\|equipment\|deliveries\|visitors\|delays\|notes) | `progress.submit` + `daily_log.submit` | `{ clientRequestId, partyId, companyId, companyName, trade, workers, hours; equipmentId, name, count, hoursOperated, hoursIdle; supplierName, description, quantity, unit, poRef, receivedBy, deliveredAt; company, purpose, arrivedAt, leftAt; type, hoursLost; kind, text; activityId, locationId, notes, status(draft\|approved) }` → 201 full log; party entries forced to submitted; internal entries approved immediately |
| PATCH / DELETE | `…/:date/entries/:section/:entryId` | Edit / delete | `progress.submit` + `daily_log.submit` | 403 `DAILY_LOG_ENTRY_FORBIDDEN` |
| POST | `…/:date/entries/:section/:entryId/review` | Approve/reject entry | `progress.approve` + `daily_log.entry_review` (pm, planning_eng, site_engineer, quality_engineer) | `{ decision(approve\|reject), reason }` |
| POST | `…/:date/entries/delays/:entryId/weather-delay` | Promote to weather-delay register | `progress.update` + `daily_log.update` | `{ delayDays(0-365), contractual, description, activityIds[] }` |
| GET / POST | `/projects/:projectId/daily-logs/ai/status` / `/ai/transcribe` | AI status / voice transcription | `progress.read` / `assistant.read` + `progress.submit` + `daily_log.submit` | transcribe multipart `audio` (≤25 MB) |
| POST | `…/:date/ai/draft` / `/ai/apply` | AI draft / apply | `assistant.read` + `progress.update` + `daily_log.update` | |
| GET | `/projects/:projectId/daily-reports?activityId&status&date&from&to` | Activity daily reports | `progress.read` | no pagination |
| POST | `/projects/:projectId/daily-reports` | Create (offline-capable) | `progress.submit` + `daily_report.submit` | `{ activityId*, date*, engineerId, shift(day\|night\|swing), pctProgress, weather{}, manpower[], materials[], equipment[], issues[], photos[{ url, key, filename, originalName, mimeType, size, storage, caption, takenAt, uploadedAt }], notes, clientRequestId(<=100), clientCreatedAt, deviceId, status(draft\|submitted), progress{…} }` → 201; replay returns existing; photo keys must be site-reporting uploads; creates linked ProgressSubmission (assignment rule applies) |
| GET / PATCH | `/projects/:projectId/daily-reports/:reportId` | Detail / edit (draft\|rejected) | `progress.read` / `progress.update` + `daily_report.update` (not parties) | 400 `DAILY_REPORT_NOT_EDITABLE` |
| POST | `…/:reportId/submit` / `/approve` / `/reject` / `/review` | Workflow | `progress.submit` + `daily_report.submit` / `progress.approve` + `daily_report.approve` (pm) / `daily_report.reject` / `daily_report.review` | approve also approves linked progress |
| GET / POST | `/projects/:projectId/site-diaries?status&date&from&to` | Site diaries (project-level) | `progress.read` / `progress.submit` + `site_diary.submit` | POST `{ date*, engineerId, shift, weather, weatherDetails{}, workers, visitors, workDone, issues, issueItems[], instructions, manpower[], materials[], equipment[], photos[], notes, clientRequestId, clientCreatedAt, deviceId, status }` |
| GET / PATCH | `/projects/:projectId/site-diaries/:diaryId` | Detail / edit | read / `progress.update` + `site_diary.update` | |
| POST | `…/:diaryId/submit` / `/approve` / `/reject` | Workflow | `site_diary.submit` / `progress.approve` + `site_diary.approve` (pm) / `site_diary.reject` | |
| POST | `/projects/:projectId/site-reporting/uploads` | Site photo upload | `progress.submit` + `site_reporting.upload` + uploadLimiter | `files[]` (≤10 × 8 MB; JPEG/PNG/WebP/HEIC/HEIF; 400 `UNSUPPORTED_SITE_PHOTO`) → 201 `[{ documentId, key, storageKey, url, fileUrl, downloadUrl, filename, fileName, originalName, mimeType, size, sizeBytes, storage, scanStatus, retentionExpiresAt, uploadedBy, uploadedAt }]`; **no Photo row, no EXIF/GPS**; not in `/photos` gallery |
| GET | `/projects/:projectId/site-reporting/uploads/:key` | Fetch | `progress.read` | |

Photos with EXIF GPS come only from POST `/attachments` (section 4.2); gallery in section 4.3. Documented for mobile in `docs/api/mobile-site-reporting.md`.

**MOBILE — do**: daily-log day + entries with `clientRequestId`; daily reports/site diaries with `clientRequestId`/`clientCreatedAt`/`deviceId`; site-reporting uploads for report `photos[]`; `/attachments` for gallery photos. **Must not**: PATCH day summary/report/diary as a party user (no `progress.update`); approve anything; send coordinates (no field accepts them).

### 4.8 Tasks (`tasks.js`; module `task`; mounted at `/tasks` and `/projects/:projectId/tasks`)

| Method | Path | Permission | Notes |
|---|---|---|---|
| GET | `/tasks?cursor&projectId&limit(1-100, default 25)&status&priority&assignee=me&assigneeId&overdue&includeArchived&search&sortBy(created\|updated\|due\|priority\|status)&sortDir` | `task.read` | `{ rows[], pagination{ limit, nextCursor }, summary{ open, overdue } }`; only pm/planning_eng see all tasks, others own/assigned |
| POST | `/tasks` (projectId in body) | `task.create` + `task.assign` (pm, planning_eng, site_engineer, quality_engineer + contractor, subcontractor) | `{ title*(<=255), description(<=4000), label(action\|field\|procurement\|quality\|safety\|commercial\|document), priority(low\|medium\|high\|critical), status(todo\|in_progress\|blocked\|done\|canceled), dueDate, projectId, activityId, assigneeId, comment, attachments[] }` |
| GET / PATCH / DELETE | `/tasks/:id` | `task.read` / `task.update` / `task.delete` (pm, planning_eng) | done/canceled stamps closedAt |
| POST | `/tasks/:id/close` | `task.update` + `task.close` | `{ comment }` |
| POST | `/tasks/:id/comments` | `task.submit` + `task.comment` (every role and party) | `{ body(1-4000) }` |
| POST | `/tasks/:id/attachments` | `task.update` | `{ attachments[] }` |

**MOBILE — do**: `?assignee=me`, cursor paging, close/comment. Web deep link `/tasks?recordId=<id>`.

### 4.9 Meetings (`meetings.js`; module `meeting`)

| Method | Path | Permission | Notes |
|---|---|---|---|
| GET | `/projects/:projectId/meetings?cursor&limit&status&meetingType&activityId&includeArchived&search&sortBy&sortDir` | `meeting.read` | cursor page + summary |
| POST | `/projects/:projectId/meetings` | `meeting.create` | `{ title*, activityId, chairId, meetingType(coordination\|progress\|commercial\|quality\|safety\|design\|client\|other), status(draft\|finalized\|distributed), location, objective, minutesText(<=20000), scheduledAt, startedAt, endedAt, nextMeetingAt, attendees[<=200], agendaItems[<=200], decisions[<=200], actionItems[<=200]{ title, description, ownerId\|ownerName, ownerEmail, dueDate, priority, status(open\|in_progress\|closed\|canceled), taskId, createTask } }` → 201 (`createTask` default true creates Task) |
| GET / PATCH / DELETE | `/projects/:projectId/meetings/:id` | `meeting.read` / `meeting.update` / `meeting.delete` | DELETE archives |
| POST | `/projects/:projectId/meetings/:id/distribute` | `meeting.submit` + `meeting.distribute` (pm, planning_eng + consultant) | `{ message, includeAttendees, recipientUserIds[], projectPartyIds[], recipients[] }` → status distributed |
| POST | `/projects/:projectId/meetings/:id/comments` | `meeting.submit` + `meeting.comment` | `{ body*, activityId }` |

State: draft → finalized → distributed → archived. No standalone action-item endpoints (edit via PATCH `actionItems[]`; linked Task is the per-person surface).

### 4.10 Change events vs change orders

**Change event** = pre-contract record (`change-events.js`; module `change_event`; statuses open\|pricing\|priced\|converted\|closed\|void).

| Method | Path | Permission | Notes |
|---|---|---|---|
| GET | `/projects/:projectId/change-events?status&type&origin&q(<=200)` | `change_event.read` (excludes warehouse; subcontractor party none) | |
| POST | `/projects/:projectId/change-events` | `change_event.create` (pm, planning_eng, qs, site_engineer, quality_engineer + contractor) | `{ title*, description, type(owner_change\|design_change\|site_condition\|error_omission\|allowance\|value_engineering\|other), origin(manual\|rfi\|submittal\|daily_log\|observation\|meeting\|other), sourceRecordType, sourceRecordId, activityId, locationId, romAmount, scheduleImpactDays, ownerChange, notes, lines[<=200]{ description*, costCodeId, budgetLineId, activityId, commitmentId, quantity, unit, unitCost, romAmount, notes } }` |
| GET / PATCH / DELETE | `/projects/:projectId/change-events/:changeEventId` | read / `change_event.update` (pm, qs, planning_eng + contractor) / `change_event.delete` (pm, qs) | 409 `CHANGE_EVENT_LOCKED`; delete only open with no RFQs |
| POST | `…/:changeEventId/rfqs` | `change_event.submit` + `change_event.rfq_send` (pm, qs, procurement + contractor) | `{ recipients[1-50]{ commitmentId, vendorCompanyId, companyName, contactName, contactEmail }, dueDate, instructions, lineIds[] }` → 201; vendors answer via `/public/rfqs/:token` |
| POST | `/projects/:projectId/change-events/rfqs/:rfqId/remind` / `/cancel` | same | 409 `RFQ_NOT_OPEN` |
| POST | `/projects/:projectId/change-events/rfqs/:rfqId/accept` / `/reject` | `change_event.approve` + `change_event.quote_accept` (pm, qs) | accept `{ createCommitmentChangeOrder }`; 409 `RFQ_NOT_QUOTED` |
| POST | `…/:changeEventId/convert` | `change_event.approve` + `change_event.convert` (pm, qs) | `{ value, description, includeCommitmentChangeOrders }` → 201 `{ changeEvent, changeOrder{ id, ref, status, value, path }, commitmentChangeOrders[] }` |
| POST | `…/:changeEventId/close` / `/void` | `change_event.approve` + `change_event.close` / `change_event.void` (pm) | void `{ reason* }`; converted cannot be voided |

**Change order** = contract instrument (`change-orders.js`; module `change_order`; statuses draft\|pending\|approved\|rejected\|archived).

| Method | Path | Permission | Notes |
|---|---|---|---|
| GET | `/projects/:projectId/change-orders?status&includeArchived` | `change_order.read` (pm, planning_eng, qs, cost_controller, finance; owner/consultant/contractor read; subcontractor none) | |
| POST | `/projects/:projectId/change-orders` | `requireRoles('pm','qs')` (template-aware) | `{ description*, activityId, budgetLineId, budgetAllocations[<=50]{ budgetLineId, amount } (must sum to value), activityLinks[], affectedActivityIds[], allocationLinks[], correspondenceIds[], attachmentRefs[], supportingDocumentIds[], documentIds[], category, value, status(draft only), scheduleImpact, scheduleImpactSummary, costImpactSummary, submittedDate, raisedBy, approvalComment }` |
| PATCH | `/projects/:projectId/change-orders/:id` | `requireRoles('pm','qs')` | `APPROVAL_LOCKED_FIELDS` frozen once approved; `CHANGE_ORDER_ALLOCATION_MISMATCH` |
| POST | `…/:id/submit` | `change_order.submit` + `change_order.submit` | draft → pending |
| POST | `…/:id/approve` | `change_order.approve` + `change_order.approve` (pm) | pending → approved; writes BudgetRevision; refused while workflow instance running |
| POST | `…/:id/reject` / `/disapprove` | `change_order.approve` + `change_order.reject` | `{ reason*(<=2000) }` → rejected |
| POST | `…/:id/reopen` | `change_order.submit` + `change_order.reopen` | rejected → draft |
| DELETE | `…/:id` | `requireRoles('pm')` | draft\|pending\|rejected → archived |

Also: `POST /projects/:projectId/rfi/:rfiId/convert-to-change` (`change_order.create`).

**MOBILE — do**: raise change events (site/quality engineers, contractor party); read change orders where permitted. **Must not**: create/update change orders (pm/qs only); approve anything; expect subcontractor parties to see change events.

### 4.11 Approvals — commitments, pay apps, IPC certification, budget

**Commitments** (`commitments.js`; module `commitment`): `GET/POST /projects/:projectId/commitments`, `GET/PATCH /:commitmentId`, `PUT /:commitmentId/lines`, `/insurance`, `POST /submit|/approve|/return|/execute (multipart file 25 MB, commitment.approve + commitment.execute)|/close`, `DELETE` (void), change-orders sub-resource with `/submit|/approve|/reject|/void`, scope, closeout, evaluation, `agreement.pdf`, `export.pdf`. Row-locked transitions with 409 re-checks (`commitment.service.js:517-851`).

**Subcontractor pay applications** (`sub-pay-apps.js`; module `sub_pay_app`; read → pm, qs, cost_controller, procurement, finance; parties see own commitments)

| Method | Path | Permission | Notes |
|---|---|---|---|
| GET | `/projects/:projectId/pay-apps?commitmentId&status(draft\|submitted\|under_review\|approved\|paid\|rejected\|void)&includeVoid` | `sub_pay_app.read` | |
| POST | `/projects/:projectId/pay-apps` | `sub_pay_app.create` | `{ commitmentId*, periodLabel*, periodStart, periodEnd, retentionRate(0-100), waiverRequired, notes }` → 201 draft seeded from SOV; 409 `SUB_PAY_APP_COMMITMENT_NOT_EXECUTED` / `SUB_PAY_APP_NO_LINES` / `SUB_PAY_APP_OPEN_EXISTS` |
| GET / PATCH | `/projects/:projectId/pay-apps/:payAppId` | read / `sub_pay_app.update` | PATCH `{ periodLabel, periodStart/End, retentionRate, backCharges(+Note), otherDeductions(+Note), taxRate, waiverRequired, waiverDocumentId, notes, lines[]{ sovLineId*, thisPeriodAmount \| thisPeriodPct, materialsOnSite, notes } }`; 400 `SUB_PAY_APP_EXCEEDS_SCHEDULED`; 409 `SUB_PAY_APP_LOCKED` |
| DELETE | `…/:payAppId` | `sub_pay_app.delete` + `sub_pay_app.void` (pm) | from draft\|rejected\|approved |
| POST | `…/:payAppId/submit` | `sub_pay_app.submit` + `sub_pay_app.submit` (contractor/subcontractor hold it) | draft → submitted; 409 `SUB_PAY_APP_EMPTY`; 400 `SUB_PAY_APP_OVER_CLAIM` (details.lines with capAmount/approvedPct) |
| POST | `…/:payAppId/review` | `sub_pay_app.submit` + `sub_pay_app.review` (pm, qs) | → under_review |
| POST | `…/:payAppId/approve` | `sub_pay_app.approve` + `sub_pay_app.approve` (pm) | `{ complianceOverrideReason, overClaimOverrideReason }`; posts cost; 409 `SUB_PAY_APP_COMPLIANCE` |
| POST | `…/:payAppId/reject` | `sub_pay_app.submit` + `sub_pay_app.reject` | `{ code(OVER_APPROVED_PROGRESS\|MISSING_COMPLIANCE\|INCORRECT_QUANTITIES\|DUPLICATE_PERIOD\|BACK_CHARGE_DISPUTE\|OTHER), reason* }` |
| POST | `…/:payAppId/reopen` | `sub_pay_app.update` (+ approve permission to revoke an approved one) | `{ reason }`; reverses cost; blocked once paid |
| POST | `…/:payAppId/payments` | `sub_pay_app.certify` + `sub_pay_app.pay` (pm, finance) | `{ amount*(>0), paidAt, method, reference, note }` → 201; auto → paid when fully paid |
| GET | `…/:payAppId/export.pdf` | `sub_pay_app.export` | |

State machine (`sub-pay-app.service.js:743-755`): submitted←draft; under_review←submitted; approved←submitted\|under_review; rejected←submitted\|under_review; draft←rejected\|approved (reopen); void←draft\|rejected\|approved; paid auto. Legacy `/projects/:projectId/sub-valuations`: read-only; POST always 409 `SUB_VALUATION_RETIRED`.

**IPC certification** (`ipc.js`; module `ipc`; read → pm, qs, cost_controller, finance; owner party read)

| Method | Path | Permission | Notes |
|---|---|---|---|
| GET / POST | `/projects/:projectId/ipc` | `ipc.read` / `ipc.create` + `period.create` | POST `{ period? }` → 201; 400 `IPC_PERIOD_EXISTS` |
| GET | `/projects/:projectId/ipc/:period` | `ipc.read` | |
| PATCH | `/projects/:projectId/ipc/:period/items/:id` | `ipc.update` + `item.update` | `{ qty, rate, retentionRate, certDate }` (status refused: `IPC_ITEM_STATUS_DIRECT_UPDATE_FORBIDDEN`); caps `IPC_ALLOCATION_QTY_EXCEEDED`, `IPC_ALLOCATION_AMOUNT_EXCEEDED`, `IPC_APPROVED_PROGRESS_EXCEEDED`, `IPC_APPROVED_PROGRESS_REQUIRED` |
| PATCH | `/projects/:projectId/ipc/:period/adjustments` | `ipc.update` + `item.update` | `{ materialsOnSite, materialsAtCost, deductions, deductionsNote(<=500) }` |
| POST | `/projects/:projectId/ipc/:period/submit` | `ipc.submit` + `period.submit` (pm, qs) | draft → submitted |
| POST | `/projects/:projectId/ipc/:period/certify` | `ipc.certify` + `period.certify` (pm, finance) | `{ comment, overrideReason }`; over-earned needs pm + reason (`IPC_PM_OVERRIDE_REQUIRED`) |
| POST | `/projects/:projectId/ipc/:period/invoice/issue` | `ipc.approve` + `invoice.issue` (pm, finance) | `{ invoiceNumber, invoiceDate, dueDate }` → 201 |
| POST | `/projects/:projectId/ipc/:period/payments` | `ipc.approve` + `payment.record` (finance) | `{ amount*, paymentReference, paymentDate, paymentMethod, notes }` → 201; `IPC_PAYMENT_EXCEEDS_PAYABLE_BALANCE` |
| POST | `/projects/:projectId/ipc/:period/retention-release` | `ipc.approve` + `retention.release` (finance) | `{ amount*, releaseReference, releaseDate, reason }` |

State: draft → submitted → certified → paid; no delete/reject transition.

**Budget** (`budget.js`; module `cost`): `GET /projects/:projectId/budget/cost-codes` (auth + project only); `PUT /budget/cost-codes`, `PUT /budget/lines/:lineId/allocations`, `PUT /budget/change-orders/:changeOrderId/line` (`cost.update`); `GET /budget/lines(/:lineId, /:lineId/allocations/suggest)`, `/budget/reconciliation`, `/budget/snapshots(/:snapshotId)` (`cost.read`); `POST /budget/lines`, `/budget/lines/import` (`cost.create`); `PATCH|DELETE /budget/lines/:lineId` (`cost.update` / `cost.delete`); `POST /budget/transfers { fromLineId, toLineId, amount>0, note? }`, `/budget/snapshots`, `/budget/lines/:lineId/revisions` (`cost.approve`). Cost: `GET /projects/:projectId/cost?cursor&limit(1-100)&activityId&category&search&sortBy&sortDir` (cursor), `/cost/summary`, `/cost/burn-rate` (`cost.read`); `POST /cost/burn-rate` (`burn_rate.create`); `POST /cost/activity/:activityId` (`activity_cost.upsert`); `PATCH /cost/:id` (`activity_cost.update`); `/cost/reconciliation(/explain?budgetLineId&activityId&limit(1-500), /migration)` (`cost.read`); `POST /cost/reconciliation/migrate|recompute` (`cost.approve`). Direct costs (`direct-costs.js`): `GET /projects/:projectId/direct-costs?status&type&vendorCompanyId&from&to&q`, `POST` (`cost.create`), `GET/PATCH/DELETE /:id`, `POST /:id/submit` (`direct_cost.submit` → pm, qs, cost_controller), `/approve` (`cost.approve` + `direct_cost.approve` → pm, finance; lines bound to stocked items are capitalised), `/reject`, `/void` (`direct_cost.void`), `/payments` (`direct_cost.pay`).

**Workflow-engine lock**: while an instance runs on change_order, commitment, sub_pay_app, ipc_certificate, budget_revision, submittal, correspondence or document_revision, direct approve/reject → 409 `WORKFLOW_RUNNING` (details `{ instanceId, templateId, currentStepKey }`); decide via `/workflows/instances/:id/respond`.

**MOBILE — do**: read pay apps/IPC where role permits; submit pay apps as contractor/subcontractor party; answer workflow steps. **Must not**: approve, certify, record payments/retention, transfer budget, migrate/recompute ledger.

### 4.12 Timesheets (`timesheets.js`; module `timesheet`)

| Method | Path | Permission | Notes |
|---|---|---|---|
| GET / POST / POST / PATCH | `/projects/:projectId/timesheets/workers(?q&companyId&status)` / `/workers/import` / `/workers/:workerId` | `timesheet.read` / `timesheet.create` + `timesheet.worker_admin` (pm, site_engineer, cost_controller, quality_engineer + contractor, subcontractor) / same / `timesheet.update` + `worker_admin` | POST `{ name*, companyId, userId, employeeNumber, trade, classification, hourlyRate, overtimeMultiplier(1-5), status, notes }`; import `{ rows[1-1000] }`; 409 `WORKER_NUMBER_EXISTS` |
| GET / POST / PATCH / DELETE | `/projects/:projectId/timesheets/crews(/:crewId)` | `timesheet.read` / `create` / `update` / `delete` (pm, site_engineer, quality_engineer) | `{ name*, companyId, partyId, foremanUserId, defaultCostCodeId, defaultActivityId, status, workerIds[<=500] }`; 409 `CREW_NAME_EXISTS`, `CREW_IN_USE` |
| GET | `/projects/:projectId/timesheets/week?weekStart*` / `/productivity?from&to` / `/export.xlsx?from&to&status` | `timesheet.read` / read / `timesheet.export` | |
| GET | `/projects/:projectId/timesheets?from&to&status(draft\|submitted\|approved\|rejected)&crewId&companyId` | `timesheet.read` | `{ items[], summary{ count, regularHours, overtimeHours, totalCost, byStatus } }`; no cursor; party scoped |
| POST | `/projects/:projectId/timesheets` | `timesheet.create` | `{ date*(YYYY-MM-DD), crewId, companyId, notes, defaultHours(0-24), clientRequestId(<=120), entries[<=500]{ workerId*, activityId, costCodeId, locationId, timeType(regular\|overtime\|double), hours*(0-24), startTime, endTime(<=5 chars), notes } }` → 201 (`replayed:true` on replay); crew without entries seeded with defaultHours (8); 409 `TIMESHEET_EXISTS` (one per crew per date); 400 `TIMESHEET_HOURS_EXCEEDED` |
| GET / PATCH / DELETE | `/projects/:projectId/timesheets/:timesheetId` | read / `timesheet.update` / `timesheet.delete` | PATCH draft\|rejected only (409 `TIMESHEET_LOCKED`); DELETE draft only |
| POST | `…/:timesheetId/submit` | `timesheet.submit` + `timesheet.submit` | draft\|rejected → submitted; 400 `TIMESHEET_EMPTY`, `TIMESHEET_ENTRY_ACTIVITY_REQUIRED` |
| POST | `…/:timesheetId/approve` | `timesheet.approve` + `timesheet.approve` (pm, cost_controller) | posts labour cost per entry |
| POST | `…/:timesheetId/reject` | `timesheet.approve` + `timesheet.reject` | `{ reason*(1-1000) }` |
| POST | `…/:timesheetId/reopen` | `timesheet.approve` + `timesheet.reopen` | `{ reason(<=500) }`; reverses cost |

**MOBILE — do**: create/submit with `clientRequestId`; manage own company's workers/crews as a party user. **Must not**: approve/reject/reopen; expect clock-in/out or GPS punch (absent).

---

## 5. Deep-link URL map (web app; from `backend/src/utils/record-links.js` RECORD_WORKSPACE and `frontend/src/features/projects/lib/project-modules.ts`)

Canonical form: `/projects/:projectId/<module-slug>[/<child>]?recordId=<id>&source=<recordType>` (optional `status=`, `pin=<pinId>`, `date=YYYY-MM-DD`, `new=rfi|change_order|direct_cost`). Legacy form (search hits, some notifications): `/projects/:id?module=<slug or key>&child=&recordId=&source=` (redirected by the web router). Module slugs: capture, schedule, site-reporting, cost, commercial, procurement, quality, doc-control, meetings, activities, equipment, locations, photos, team, reports, overview, boq, bim. `/projects/:id` → `/projects/:id/schedule/gantt`.

| Record type(s) | Web URL pattern |
|---|---|
| risk | `/projects/:id/schedule/risks?recordId=&source=risk` |
| activity | `/projects/:id/activities?recordId=&source=activity` (web has no selection handling) |
| progress_submission | `/projects/:id/schedule/progress` |
| daily_report, site_diary, daily_log (recordId may be YYYY-MM-DD), timesheet | `/projects/:id/site-reporting` |
| lookahead | `/projects/:id/schedule/lookahead` |
| schedule_revision | `/projects/:id/schedule/revisions` |
| procurement_package, delivery_receipt | `/projects/:id/schedule/longLead` |
| ncr | `/projects/:id/quality/ncr` |
| itp, form_instance, form_template | `/projects/:id/quality/itp` |
| defect, punch_item | `/projects/:id/quality/defects` |
| observation | `/projects/:id/quality/observations` |
| material_test | `/projects/:id/quality/tests` |
| safety_incident | `/projects/:id/quality/safety` |
| rfi | `/projects/:id/doc-control/rfi` |
| submittal | `/projects/:id/doc-control/submittals` |
| drawing, drawing_set, sheet (+`pin=`), sheet_revision, markup, pin, document, document_revision | `/projects/:id/doc-control/drawings` |
| transmittal | `/projects/:id/doc-control/transmittals` |
| correspondence | `/projects/:id/doc-control/correspondence` |
| spec_section | `/projects/:id/doc-control/specifications` |
| inbound_email | `/projects/:id/doc-control/emails` |
| change_order | `/projects/:id/commercial/change-orders` |
| change_event, rfq | `/projects/:id/commercial/change-events` |
| ipc, ipc_certificate, ipc_item | `/projects/:id/commercial/ipc` |
| sub_valuation | `/projects/:id/commercial/sub-valuations` |
| commitment, commitment_change_order | `/projects/:id/commercial/commitments` |
| sub_pay_app | `/projects/:id/commercial/pay-apps` |
| bid_package | `/projects/:id/commercial/bids` |
| eot, eot_claim | `/projects/:id/commercial/eot` |
| weather_delay | `/projects/:id/commercial/weather` |
| meeting, meeting_action | `/projects/:id/meetings` |
| procurement_order | `/projects/:id/procurement/purchase-orders` |
| cost_record | `/projects/:id/cost/activity` |
| direct_cost | `/projects/:id/cost/direct-costs` |
| burn_rate_entry | `/projects/:id/cost/burn` |
| boq_item, boq_revision | `/projects/:id/boq` |
| bim_model, bim_element | `/projects/:id/bim` |
| equipment | `/projects/:id/equipment` |
| location | `/projects/:id/locations` |
| photo | `/projects/:id/photos` |
| project | `/projects/:id/overview` |
| conversation | `/messages?conversationId=` |
| task | `/tasks?recordId=` (task notifications emit `/projects/:id?module=tasks&taskId=`, which the web router cannot resolve — map to `/tasks?recordId=<taskId>`) |
| sheet QR | `WEB_APP_URL/projects/:id/quality/defects?source=sheet_qr&recordId=<sheetId>` |

Structured targets `{ module, child, status, source, recordId }` come only from `/projects/workspace-dashboard`, `/projects/:id/setup-readiness`, `/projects/:projectId/health` and `/projects/:projectId/assignments/mine` (legacy module keys such as `docControl`, child keys such as `longLead`, `change-orders`, `critical`, `progress`). Global pages: `/` (Workspace Control), `/projects`, `/portfolio`, `/inventory?tab=&orderRef=`, `/reports?reportId=&runId=`, `/tasks`, `/messages`, `/users`, `/company/*`, `/settings/*`, `/sign-in`, `/sign-up`, `/forgot-password`, `/reset-password`, `/otp`, `/accept-invite`, `/sso/complete`, `/bid/:token`, `/rfq/:token`.

---

## 6. Product vocabulary (exact labels)

- **Modules**: Capture, Schedule, Site Reporting, Cost Control, Commercial, Procurement, Quality, Doc Control, Meetings, BOQ, BIM, Activities, Equipment, Locations, Photos, Team, Reports, Overview. Primary order: Overview, Schedule, Site Reporting, Cost Control, Commercial, Procurement, Quality, Doc Control, Meetings, BOQ, BIM; rest under "More". Mobile drawer "Project modules", placeholder "Search modules…".
- **Schedule tabs**: Gantt, Activities (n), Progress, Lookahead, Critical Path (n), Earned Value, Forecast, Milestones (n), Resources, Risks, WBS, Long Lead, Revisions.
- **Cost Control tabs**: Overview, By Activity, By Phase, Equipment, Burn Rate, Budget, Direct Costs.
- **Commercial tabs**: Client Billing, Change Events, Change Orders, Commitments, Pay Applications, Bids, IPC, Sub Valuations (legacy), Budget Revisions, Cash Flow, EOT, Weather Delays, Contract.
- **Procurement tabs**: Packages, Purchase Orders, Suppliers.
- **Quality tabs**: NCR, Inspections (ITP / form_instance), Punch list (punch_item / defect), Observations, Safety, Material Tests.
- **Doc Control tabs**: RFI, Submittals, Drawings, Specifications, Transmittals, Correspondence, Emails, Search.
- **Global**: Dashboard (heading "Workspace Control"), Projects, Portfolio, Inventory & warehouse, Reports, Tasks, Messages, People (route `/users`), Company, Settings, Help Center.
- **Records**: Change Orders / Change Events, Purchase Orders, Pay Applications, Commitments, Bids, IPC, Punch list, Inspections, Observations, Material Tests, Safety, NCR, RFI, Submittals, Drawings, Specifications, Transmittals, Correspondence, Emails, Site Reporting (daily_log / site_diary / daily_report / timesheet), Long Lead, Goods in, Direct Costs, Budget, Earned Value, Lookahead, Risks, Meetings, Tasks, Messages.
- **Health dimensions**: Schedule, Cost, Commercial, Supply Chain, Quality, Safety, Doc Control. Pending-review labels: Progress submissions, IPC submissions, Change orders, Submittal reviews.
- **Ref prefixes**: RFI-nnn, SUB-nnn, PKG-nnn, DWG-nnn, TRM-nnn, NCR-nnn, SAF-nnn, PL-nnn / OBS-nnn, INS-/ITP-/FRM-/TBT-nnn, MTEST-nnn, DEF-nnn, PO-nnnnn, TRF-nnnnn, GRN-nnnnn.

---

## 7. Test infrastructure

- **E2E organisation reset/seed**: `backend/scripts/e2e/reset-e2e-org.js` deletes only organisations named `E2E_ORG_NAME` (default `OctaPM E2E`) or matching `/\bE2E\b/`, then reseeds with `SEED_ORG_NAME` / `SEED_EMAIL_DOMAIN` (default `octapm-e2e.test`). No npm alias exists. It counts/deletes inventory items/warehouses but seeds no inventory fixtures.
- **Users / personas**: `frontend/e2e/support.ts` PEOPLE has 8 personas — pm, planner, qs, cost, procurement, warehouse, site, finance — at `@octapm-e2e.test`, password `DemoPassw0rd!`, API `http://localhost:5000/api/v1`. The quality persona (`quality_engineer`) is seeded but not in PEOPLE.
- **Playwright**: `frontend/playwright.config.ts` serial (`fullyParallel:false`, `workers:1`, `retries:0`), single `desktop` project 1440×900; no mobile/device project.
- **Read-only / demo projects**: clean demo project Riverside (`cb4f705c`) and greenfield certification project `0ce999f2` (Phase 21/22 evidence under `docs/`); Phase 22B uses a dedicated E2E org with global setup and a quality role.
- **Smoke / UAT**: `backend/scripts/smoke.js` (permission-negative checks: anonymous GET `/projects/:id` → 401 `AUTH_REQUIRED`; site engineer assigned elsewhere → 403; other org → 403/404; warehouse POST `/rfi` → 403 `FORBIDDEN`); `e2e/uat/run-uat-regression.mjs` certifies the transitions listed in §4 (RFI submit→answer→approve→close; document revision submit-review→approve; submittal submit→review→approve; bulk-progress→approve; daily report submit→approve; IPC create→item→submit→certify→invoice→payments; NCR submit→approve closed; safety submit→approve closed; meeting distribute; audit `status_changed`). `backend/scripts/phase21/` holds harness.js, rbac-audit.js, run-all.js, snapshot.js, stage*.js (no `final-recon.js`).
- **Reconciliation method**: cost ledger vs projections via `GET /projects/:projectId/cost/reconciliation` (`{ ledger, budget, activity, balanced }`), `/reconciliation/explain`, `/reconciliation/migration`; corrections via `POST /cost/reconciliation/migrate|recompute` (`cost.approve`). Evidence tier rule (memory): mocked-Prisma Jest proves nothing; drive the live API or Playwright and mutate the fix away to prove a test has teeth.
- **Local env**: `backend/.env` raises `RATE_LIMIT_LOGIN_MAX` / `RATE_LIMIT_AUTH_MAX` for test runs; design for production defaults.
- **OpenAPI checks**: `backend/src/openapi/__tests__/openapi.test.js`, `backend/scripts/validate-openapi.js`, `route-coverage.js`.
- **Mobile app**: `mobile/` (Expo SDK 57, RN 0.86, openapi-fetch, expo-secure-store, jest-expo) generates its types from `backend/src/openapi/spec.js` and copies `shared/permissions.json` (`mobile/scripts/generate.mjs`). It signs in through the native channel described in section 1.2, which the backend implements and tests (`backend/src/routes/__tests__/auth-native-client.test.js`, `backend/src/services/__tests__/auth-native-channel.service.test.js`).

---

## 8. ABSENT CAPABILITIES (backend work if the mobile brief needs them)

### Session / auth
1. ~~Refresh token in a JSON body~~ — implemented for native clients (section 1.2). Still absent: a header-carried refresh token, and any way for a browser to obtain the refresh token.
2. Session/device listing and per-session revoke; logout-all (only password reset revokes all sessions).
3. Change password while signed in (no `/auth/me/password`, `currentPassword`).
4. Email verification on registration.
5. Organisation switching / multi-org membership; endpoint to remove a user from an org (only deactivate/activate).
6. Mobile/app-scheme SSO callback — callback 302s to `WEB_APP_URL/sso/complete` only; no client-side PKCE.
7. Revocation of refresh sessions on deactivation or role change.
8. Server-enforced MFA enrolment block (only `mfaEnrollmentRequired` flag).
9. Long-lived/offline access tokens (single `JWT_EXPIRY`); distributed login-abuse lockout (per-process Maps).
10. `super_admin` as a policy role; `quality_engineer` in SSO `defaultRole` enum, in `POST /projects/:projectId/team` role enum, and in `ROLE_ALIASES`.
11. API-key auth on socket.io.

### Push / realtime / sync
12. Native push registration (Expo push token, FCM, APNs, deviceToken) — only Web Push VAPID `PushSubscription { endpoint(https), keys.p256dh, keys.auth }`.
13. Delta / incremental sync (`since`, `updatedSince`, `changedSince`, sync token) on any list; REST reader of `OutboundEvent` for offline catch-up.
14. Bulk offline-batch endpoint carrying many queued records of mixed types.
15. Socket token refresh in-band; app-scheme / universal deep links (`octapm://`, `/.well-known`).
16. Realtime or push events for inventory (receipt posted, low stock, transfer dispatched).
17. Enforcement of `quietHoursStart/End`, `digestEnabled`, per-user `dueSoonDays`; notification filters by priority/entityType; per-project or per-category unread counts; bulk archive/un-archive/delete; batch mark-read by ids.
18. Single cross-project Needs You including derived items (workspace-dashboard omits role-derived PO/commitment/pay-app/bid items); quick-actions endpoint; per-record `/history` endpoint (audit cursor only with `source=audit`); end-user auth-audit listing.

### Concurrency / idempotency
19. Optimistic concurrency: no ETag, If-Match, If-None-Match, expectedVersion, updatedAt precondition anywhere; last write wins.
20. Generic `Idempotency-Key` header; `clientRequestId` replay on RFI, submittal, RFI response, comment, NCR, safety, ITP, defect, material test, meeting, progress submission, `bulk-progress`, site diaries (stored, no lookup), and all inventory mutations (`/stock/*`, `/transfers/*`; goods receipt has only the `receiptNumber` natural key).
21. Presigned direct-to-S3 upload URLs (all uploads through multer on the API).

### Pagination / typing
22. Cursor pagination outside the 14 route files (absent on activities, progress-submissions, daily-logs, daily-reports, site-diaries, timesheets, lookaheads, change-events, ipc, pay-apps, ncr, safety, itp, defects, material-tests, doc-control register, drawings, transmittals, correspondence, sheets, sets, packages, templates, attachments, all inventory lists, procurement lists).
23. Fully typed OpenAPI responses (≥289/952 top-level `GenericObject`); OpenAPI coverage of `/transmittals` and legacy `/drawings` DrawingRecord CRUD; a mobile-scoped OpenAPI subset; generated client in repo.
24. Query-filtered `GET /projects/:projectId/activities` (whole programme returned); critical-path-only endpoint.

### Documents / drawings
25. Per-page rasterised sheet images, tiles or thumbnails (only source PDF + `pageNumber`; thumbnails only for Photo rows).
26. RFI reassignment/forward endpoint separate from `PUT /people`; bulk RFI actions; RFI submission edit/withdraw.
27. `GET /projects/:projectId/doc-control/uploads/:key` (URL built by file-storage but no route); DocumentRevision delete/archive (`document_control.delete` has no roles); transmittal acknowledge transition endpoint.

### Quality
28. Automatic NCR creation from a failed inspection or material test.
29. `GET` single-record endpoints for `/ncr/:id`, `/safety/:id`, `/itp/:id`, `/defects/:id`, `/material-tests/:id`.
30. Server-side filtering on `/ncr`, `/itp`, `/defects`, `/material-tests` (safety: status + includeArchived only).
31. Counting unified `/attachments` uploads as NCR/safety closeout evidence (must be `attachmentRefs` from `/workflow/uploads`).
32. Dedicated safety-observation record (observations are `PunchItem kind='observation'`); injured-person/body-part/witness/root-cause/regulatory fields on SafetyIncident; NCR root cause/corrective action/cost impact/location/trade fields (custom fields only).
33. State machine on legacy ITP/defect/material-test; party-role access to `ncr`/`safety`; batch punch transition; signature capture on NCR/safety/punch; quality-score contribution from forms/punch/defects/tests/safety; module permission guard on `/quality/dashboard`, `/health`, `/workflow/uploads`.

### Inventory / procurement
34. Stock count / cycle count endpoints (schema has `InventoryCount`/`InventoryCountLine`, `stock.count` transition exists in permissions.json, but no route/service).
35. Movement reversal/void route (`reverse` type + `reversesId` column unreachable); transfer cancel/edit.
36. Delivery receipt list/detail endpoints (only POST `…/purchase-orders/:orderId/receipts`; receipts embedded in PO detail).
37. Location (bin) barcodes/QR; scan resolution of bins, warehouses or POs by barcode.
38. PATCH/DELETE for warehouse locations, items (archive only), procurement suppliers and packages; PO line add/edit/delete after creation.
39. Serial/batch/expiry enforcement (free text only); receive-and-issue in one step (`issueToActivity`/`issuedQty` ignored); any writer of `ActivityMaterial.issuedQty` / `ProcurementPoLine.issuedQty` (so `/materials/:id/usage` is always refused).
40. Photos/attachments on goods receipt, damage, quarantine or stock movements; cost-ledger list endpoint (only `/cost/reconciliation/explain`); project-level material requirements list; reservation records with owner/expiry; low-stock alert entity; permissions.json coverage of long-lead routes (`requireRoles`); company-admin override for inventory/procurement/bid/cost; inventory E2E fixtures.

### Schedule / site / commercial
41. Client-supplied GPS/EXIF on upload or annotation (`PATCH /photos/:id` accepts caption/tags/locationId/takenAt only); EXIF/Photo rows from `/site-reporting/uploads`.
42. Standalone meeting action-item endpoints; timesheet clock-in/out or GPS punch; IPC period delete or reject/return-to-draft; separate certify step on pay apps; quantity-overrun flag on activity progress (clamped to 100).
43. Change-order create/update for party users (`requireRoles('pm','qs')`); `change_event` module for subcontractor parties; progress/daily-log entry review by any party.
44. Dedicated official-KPIs endpoint (only inside `/projects/workspace-dashboard`).

### Web / links / test
45. Frontend deep-link helper; notifications page route; workflow-inbox route; `capture` module outside the project workspace; `/people` URL (`/users`); inventory and activity record deep-link handling; web handling of the task notification link `?module=tasks&taskId=`; record-opening for observation, form_instance, progress_submission, schedule_revision, boq_item, photo, equipment, meeting_action, cost_record, burn_rate_entry, commitment_change_order, ipc_item, eot_claim, sub_valuation, spec_section, document_revision, sheet_revision, markup, pin, bim_element sources; `procurement/packages` link target (procurement_package → schedule/longLead).
46. `GET /users/invitations`; `POST /users/:id/deactivate|activate` (they are PATCH); company-admin guard on `/company/*` GET registries.
47. Committed native-mobile/device test suite; Playwright quality_engineer persona; npm alias for E2E reset; `final-recon.js`; offline-replay tests in E2E/UAT runners; client/owner and subcontractor external logins (scope decision).
