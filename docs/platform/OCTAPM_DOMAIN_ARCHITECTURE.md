# OctaPM domain architecture

Status: **authoritative** (owner instruction, 2026-10-11). The codebase is domain-ready; no DNS,
certificate, CDN or production change has been made. Activation needs the owner's explicit approval.

## Canonical domains

| Domain | Product | Primary users |
|---|---|---|
| octapm.com | OctaPM Public Website | Visitors / Prospects |
| app.octapm.com | OctaPM Application | Contractor / Company Users |
| portal.octapm.com | External Collaboration Portal | Consultants / External Project Parties |
| admin.octapm.com | OctaPM Platform Administration | OctaPM Internal Platform Admins |
| market.octapm.com | OctaMarket | Marketplace Users / Providers |

No other product subdomains: **no** `consultant.`, `owner.`, `engineer.` hosts. Owners, engineers,
architects, subcontractors and suppliers will join `portal.octapm.com`; role + party + project
permissions decide what each sees. **The Owner Portal is deferred**; when built it lives on
`portal.octapm.com`, not on an owner subdomain.

`www.octapm.com` should answer with a **301 to `https://octapm.com`** (to be set at the CDN when the
public site is activated). Every host is **HTTPS only**; HTTP should redirect to HTTPS and send HSTS.

## The one rule

**A hostname selects the experience; it never grants anything.** Every API request is authorized by
the server — tenant, project, party and platform checks — whatever host the page was loaded from. A
consultant who types `app.octapm.com` gets no contractor permission; a company admin who types
`admin.octapm.com` gets a 403; a contractor who opens `portal.octapm.com` gets no external-party
standing. The redirects and shells below are conveniences on top of that.

## Configuration (one place per runtime)

The same five URLs, read in exactly one module each:

| Surface | Backend env (`backend/src/config/domains.js`) | Frontend build env (`frontend/src/lib/domains.ts`) |
|---|---|---|
| public | `PUBLIC_SITE_URL` (falls back to `BRAND_PUBLIC_URL`, then the app) | `VITE_PUBLIC_SITE_URL` |
| app | `WEB_APP_URL` (existing; `FRONTEND_URL` / `PUBLIC_APP_URL` still read) | `VITE_APP_URL` |
| portal | `PORTAL_URL` (unset → the app's URL) | `VITE_PORTAL_URL` |
| admin | `ADMIN_URL` (unset → the app's URL) | `VITE_ADMIN_URL` |
| market | `MARKET_URL` (unset → no market links) | `VITE_MARKET_URL` |

Unset portal/admin/public values mean **one host serves everything** — today's behaviour, local
development and the current single-host Terraform shape. Production validation refuses a value that
is set but is not a public `https` origin, and refuses a CORS wildcard such as `https://*.octapm.com`.
No secret is in either file; the frontend values are public hostnames only.

Other related settings: `PLATFORM_ADMIN_SESSION_MAX_HOURS` (1–24, default 12),
`AUTH_COOKIE_SAMESITE` (`strict` | `lax` | `none`), `CORS_ALLOWED_ORIGINS` (exact hosts).

## Per domain

### octapm.com — public website
- **Users:** visitors, prospects. **Surface:** the landing, privacy and terms pages of the web app.
- **Behaviour:** `/` → `/landing`; sign-in, invitations and every application path are sent to
  `app.octapm.com` (the platform console to `admin.octapm.com`). The Login action therefore lands on
  the application; the admin console is never advertised here.
- **Indexing:** the only host search engines should index.
- **Auth:** none. Not in the API's CORS allowlist (it does not call the authenticated API).

### app.octapm.com — OctaPM application
- **Users:** contractors and every company role (PM, planning, QS, cost, procurement, warehouse,
  site, quality, finance, company admins).
- **Surface:** the existing workspace application under `/o/{organizationSlug}/…`, unchanged.
- **Behaviour:** `/platform-admin` is sent to `admin.octapm.com`. Signed-out visitors go to sign-in.
  Links from the API to the contractor (internal invitations, contractor notifications, reports, QR
  codes, daily logs, punch lists, accounting callbacks) are built on this host.
- **Indexing:** `noindex` (meta tag on every page; `X-Robots-Tag` on the API).

### portal.octapm.com — External Collaboration Portal
- **Users:** consultants today; owners, engineers, architects, external reviewers, subcontractors and
  suppliers later — all as project parties.
- **Surface:** the same frontend with its own shell (portal header: brand, project, notifications,
  account — no contractor company navigation). `/o/{org}` is the person's review home; with one
  project it opens straight into **My Review Workspace**. Company pages (portfolio, inventory, company
  settings…) are sent back to the review home; `/platform-admin` to the admin host.
- **Links built here:** project-party (consultant) invitations, review notifications to consultants
  (deep link `…/projects/{projectId}/reviews?recordId={submissionId}`), password resets requested on
  the portal, SSO started on the portal, bid (`/bid/{token}`) and RFQ (`/rfq/{token}`) pages.
- **Security:** a contractor opening a project on the portal is told it is not shared with them as an
  external party and linked to the application; the API's party-scoped authorization is unchanged
  (internal notes, unauthorized BOQ / cost / procurement and other companies' data stay refused).
- **Indexing:** `noindex`.

### admin.octapm.com — Platform Administration
- **Users:** explicitly provisioned OctaPM platform staff only (`PlatformUserAccess`, granted only by
  `backend/scripts/platform/platform-access.js`). Company admins, owners, PMs, consultants and every
  catalogue role are refused.
- **Surface:** the platform console (`/platform-admin/*`), branded "OctaPM Admin — Platform
  Administration". Every other path on this host is sent to the console; sign-in pages are served.
- **Session (higher privilege):** the console requires a session that **proved the second factor
  itself** within `PLATFORM_ADMIN_SESSION_MAX_HOURS` (token claim `mfa`, set only by the MFA sign-in,
  carried — never renewed — through refresh and workspace switches). A password-only application
  session, a company-SSO session or an invitation-acceptance session never opens it, on any host; a
  stale proof or a token from before the identity's last credential event (reset, closure) is refused.
  Platform access, audit and the no-impersonation rule are unchanged; an API key is refused.
- **Entry point:** "Platform Administration" appears in the account menu only for platform operators
  (`/auth/me` → `platformOperator`), linking to this host.
- **Indexing:** `noindex`; never linked publicly.

### market.octapm.com — OctaMarket
- **Users:** suppliers, contractors, trades, service providers.
- **Surface:** its own application (not in this repository). OctaPM links to it with `MARKET_URL`; this
  web app serves nothing on that host (it redirects away). Not in the core API's CORS allowlist; no
  shared sign-in, database or payments in this phase.

## Security model

| Concern | Implementation |
|---|---|
| Authorization | Server-side only; hosts never read for authorization. |
| CORS | Exact allowlist: `CORS_ALLOWED_ORIGINS` (+ `FRONTEND_URL`) plus `PORTAL_URL` and `ADMIN_URL` origins. Never the market or public site; wildcards refused in production. Same list for Socket.IO. |
| CSRF / origin | `/api/v1/auth/*` refuses any state-changing browser request whose `Origin` is not an approved application origin (`403 ORIGIN_NOT_ALLOWED`): no login CSRF, logout CSRF or session rotation from another site. Requests without `Origin` (mobile app, servers) proceed to the normal checks. |
| Session cookie | One refresh cookie, **host-only on the API host** (no `Domain`), `HttpOnly`, `Secure` in production, path `/api/v1/auth`. Never `Domain=.octapm.com`; app/portal/admin/market pages never receive it. `SameSite` defaults to `None` in production and can be set to `Strict` once the API is on octapm.com. Access tokens live in page memory per host. |
| Admin isolation | Fresh second-factor proof per session (above); platform grant + MFA enrolment; denials audited. |
| Open redirects | Sign-in `redirect`, SSO `redirect`, the workspace `/switch` `next`, notification links and push links accept only a path in this application (no `//host`, `/\host`, scheme or control characters). The SSO return host is one of OctaPM's own surfaces carried in the signed state. Reset links return to the surface they were requested from (`app`, `portal`, `admin` only). |
| Unknown hosts | Any production host that is not a configured surface gets the plain application shell — never the admin console or the portal shell. |
| Indexing | API: `X-Robots-Tag: noindex, nofollow`. Web: `noindex, nofollow` meta on every page except the public pages; `robots.txt` allows only `/`, `/landing`, `/privacy`, `/terms`. |
| CSP | The API keeps helmet's restrictive defaults. The web app's CSP is a CDN response-header policy to set at activation, per host with exact origins (admin strictest: self + the API origin only). |
| Realtime | Socket.IO uses the same exact CORS list; every socket authenticates with an access token and every channel is authorized server-side — the portal host gains no internal channel. |

## Local development

Unchanged: `http://localhost:5300` (web) and `http://localhost:5200` (API) serve everything.
Optional previews without DNS or a hosts file (browsers resolve `*.localhost` to this machine):
`http://portal.localhost:5300` (portal shell) and `http://admin.localhost:5300` (admin shell). Add
them to `CORS_ALLOWED_ORIGINS`; set `PORTAL_URL` / `ADMIN_URL` to those values only to see e-mailed
links use them. On a preview host a full page reload asks for sign-in again (the refresh cookie
belongs to the API's own host, which is another site from `*.localhost`; production hosts share
octapm.com and are not affected).

## API host: same-origin `/api` (owner decision, 2026-10-11)

**There is no `api.octapm.com`.** Each application host carries the one OctaPM API under its own
`/api/*`:

```
https://app.octapm.com/api/*     ─┐
https://portal.octapm.com/api/*  ─┼─ CloudFront behaviour /api/* ─▶ ALB ─▶ ECS Fargate API tasks
https://admin.octapm.com/api/*   ─┘   (everything else ─▶ S3 static web build)
```

- The web build uses `VITE_API_URL=/api/v1` (relative), so every surface calls its own host: browser
  requests are same-origin, the refresh cookie (host-only, path `/api/v1/auth`) is set per surface —
  an app session's cookie is never sent to `admin.octapm.com` — and CORS is not needed for the web
  surfaces (the allowlist stays for development and the mobile web target).
- The host still grants nothing: tenant, project, party and platform authorization stay in the API.
- `API_BASE_URL` (OAuth/SSO redirect URIs) is the app host: `https://app.octapm.com`.
- Mobile: `EXPO_PUBLIC_API_ORIGIN=https://app.octapm.com` (`/api/v1` on the app host).
- CloudFront `/api/*` behaviour: all methods, caching **disabled** (managed policy CachingDisabled),
  origin request policy forwarding the `Authorization` header, all query strings and only the cookie
  the API uses (`pmc_refresh_token`), plus `X-OctaPM-Client`; viewer protocol HTTPS only; the origin
  adds `X-CloudFront-Secret` (`CLOUDFRONT_SHARED_SECRET`, `TRUST_PROXY_HOPS=2`) and the ALB security
  group admits only CloudFront's origin-facing prefix list. Socket.IO (`/socket.io/*`) gets the same
  uncached behaviour with WebSocket upgrade. Static behaviours forward no cookies or auth headers.

## Deployment and DNS readiness (nothing changed)

- **Terraform today (`infrastructure/terraform`, `deploy.yml`):** Route 53 hosted zone for
  `octapm.com`, an apex A-alias to one CloudFront distribution (SPA from S3, `/api/*` to a single EC2
  instance — already same-origin), ACM certificate for `octapm.com` and `*.octapm.com`. To be rewritten
  for ECS Fargate behind an ALB (docs/deployment/OCTAPM_AWS_MULTITASK_READINESS.md), keeping the
  same-origin `/api/*` behaviour.

What activation will need (**targets to be determined during AWS deployment** — no values exist yet):

| Host | Record type (expected) | Target | Also needed |
|---|---|---|---|
| octapm.com | Route 53 A/AAAA **alias** (zone apex) | CloudFront distribution — TBD | ACM cert (apex covered); `www` → 301 to apex |
| www.octapm.com | Route 53 alias or CNAME | the same distribution / redirect function — TBD | 301 to `https://octapm.com` |
| app.octapm.com | Route 53 A/AAAA alias (or CNAME) | CloudFront distribution — TBD | add to CloudFront `aliases`; `/.well-known` files for the mobile app |
| portal.octapm.com | Route 53 A/AAAA alias (or CNAME) | CloudFront distribution (same SPA) — TBD | add to `aliases`; `PORTAL_URL`, `VITE_PORTAL_URL` |
| admin.octapm.com | Route 53 A/AAAA alias (or CNAME) | CloudFront distribution — TBD | add to `aliases`; WAF; `ADMIN_URL`, `VITE_ADMIN_URL` |
| market.octapm.com | per OctaMarket's own hosting — TBD | — | `MARKET_URL` |

Plus: SES domain identity with SPF/DKIM/DMARC for `@octapm.com` mail; CloudFront response-header
policies (HSTS, CSP, `X-Robots-Tag: noindex` on app/portal/admin, `Disallow: /` robots on them).

## Admin host recommendations (production)

AWS WAF on the admin distribution (managed rule groups, rate-based rule on `/api/v1/auth`), alerting
on platform-audit denials and on `PLATFORM_MFA_SESSION_REQUIRED` spikes, security logging of every
console view (already audited in `PlatformAuditEvent`), short `PLATFORM_ADMIN_SESSION_MAX_HOURS`.
Optional: an identity-aware gateway in front of `admin.octapm.com`, or an IP allowlist — not required
by this code and not implemented.

## Mobile

The mobile app's associated domains are `app.octapm.com` and `octapm.com`; invitation, reset and SSO
links are handed to the browser. Portal links (`portal.octapm.com`) are not claimed by the app, so
they open in the browser — the intended consultant experience. Universal Links / App Links for the
portal and the `/.well-known` files are deferred to activation.
