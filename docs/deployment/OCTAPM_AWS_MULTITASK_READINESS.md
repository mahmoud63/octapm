# OctaPM on AWS — multi-task readiness

**Status:** the thirteen application blockers found in AWS-0 are fixed and proven on this branch (`feat/p0-foundations-sprint1`). Nothing has been deployed and no AWS resource exists yet; provisioning waits on AWS access (see *What is still needed*).

**Target shape.** Several identical API tasks on ECS Fargate behind an Application Load Balancer (`api.octapm.com`), one worker task from the same image, RDS PostgreSQL, a private S3 bucket reached only through presigned URLs, SES for mail, secrets from Secrets Manager as environment variables, and IAM task roles instead of stored AWS keys.

**The one decision that shaped the rest.** Everything that must be shared between tasks lives in **Postgres**, not Redis: socket.io fan-out (`@socket.io/postgres-adapter`, LISTEN/NOTIFY), scheduler ownership (a session advisory lock), rate-limit counters (an UNLOGGED table) and login lockout. RDS is already on the critical path, so this adds no new failure domain; it could be proven on a development machine that has no Redis; and ElastiCache drops out of the cost plan (about $11 a month per environment). A Redis rate-limit store is still used if `REDIS_URL` is set.

Local development is unchanged: with no new variables, every shared store is in memory, registration is open, mail goes to the API log, files go to local disk, and requests are logged by morgan as before.

---

## The blockers, what was found, and what changed

Each claim from the AWS-0 audit was re-checked against the code before anything changed; all thirteen were real, and two were worse than the audit said.

| # | Blocker | What the code actually did | What it does now | Proof (fails with the fix removed) |
|---|---|---|---|---|
| 1 | S3 on Fargate | Credentials only from env keys or EC2 instance metadata, which Fargate does not have: every upload and download would fail, each after a one-second timeout, as a raw 500. | One credential chain (`utils/aws-credentials.js`): env keys → the ECS container endpoint (allow-listed hosts, token or token file) → IMDSv2 → `AWS_CREDENTIALS_UNAVAILABLE`. One fetch shared by concurrent callers, refreshed before expiry, stale-but-valid fallback. One SigV4 signer (`utils/aws-sigv4.js`) checked against AWS's published vectors. Storage failures answer 503 `FILE_STORAGE_UNAVAILABLE`. | `aws-sigv4.vectors`, `aws-credentials.container.live`, `file-storage.s3-fargate.live` (real app + real Postgres + a fake S3 that verifies the signature and token independently) |
| 2 | Realtime across tasks | In-memory socket.io adapter and an in-process event bus: an event raised on one task never reached sockets on another; the worker registered no subscribers; a deactivated user was only disconnected on the task that noticed. | Postgres cluster adapter, so room emits and `disconnectSockets` reach every task. The bus stays in-process, so webhooks and comment auto-subscriptions still run exactly once, in the process that published; the worker now registers them and fans job events out through the adapter. Both clients connect WebSocket-only (no sticky sessions needed). | `realtime/cluster.live` (two API processes + a worker: cross-process delivery, cross-process disconnect, a 14 KB payload through the attachments table, recovery after the LISTEN backend is killed, TLS translation) |
| 3 | Schedulers ran in every task | Seven schedulers started in every API process with no leader, two with no off switch: with two tasks, duplicate emails, reports and billing runs. | A leader holding `pg_try_advisory_lock(918273, hashtext(key))` on a one-connection client runs them; it re-checks ownership each heartbeat and demotes itself if the lock is lost. API tasks set `SCHEDULERS_ENABLED=false`; the worker leads. Every side effect is also claimed atomically (email and push leases, report `nextRunAt`, daily-log distribution, workflow escalation, billing reminders, accounting polls), so even two leaders cannot double-send. | `jobs/worker-lifecycle.live`, `billing-reminders.live`, `services/shared-state.live` |
| 4 | Proxy trust | A non-numeric `TRUST_PROXY_HOPS` silently disabled trust proxy. | Production requires 1 (load balancer only) or 2 (CloudFront then load balancer). | `proxy-ip.live` (spoofed X-Forwarded-For does not move the client IP) |
| 5 | CloudFront secret vs a load-balancer-only API | The secret was mandatory, so every request except `/api/health` got 403. | With 1 hop the secret must be unset; with 2 it is required. Health paths always pass. | `alb-only.live` |
| 6 | Email and links | Mail only through a JSON webhook; in production, forgot-password and invitations failed with 500, and forgot-password's answer revealed whether an account existed. | SES v2 transport signed with the task role (`EMAIL_PROVIDER=ses`). Production refuses to boot without https, non-local `WEB_APP_URL` and `API_BASE_URL` and a real provider. Forgot-password always answers 200 and audits a failed send. | `email-ses.transport.live`, `forgot-password-delivery.live` |
| 7 | Leaks in errors and logs | A Prisma error returned its text to the client — a probe got the User table's column list. Request logs held portal tokens and OAuth codes. | Production 5xx bodies carry only the catalogue message for their code; P2002 → 409, P2025 → 404. The AI provider no longer copies upstream replies into its errors (they reached users through four assistants' "degraded" answers too). A JSON request log masks path tokens and keeps only query key names. | `error-handler.prod.live`, `ai-provider-errors`, `request-log.live` |
| 8 | Data scripts | The seed, E2E reset and UAT fixtures had no guard; the E2E reset would delete any organisation with "E2E" in its name. | `utils/data-script-guard.js`: refuses any non-local database, and any database under `NODE_ENV=production`, unless `ALLOW_DATA_SCRIPT` names it exactly as `<host>/<database>`. The seed's purge is scoped to its own organisation. | `data-script-guard.live` |
| 9 | First administrator | Only through public sign-up, which provisions an organisation. | `npm run admin:bootstrap --workspace=backend`: refuses unless the database has no organisations and no users (under an advisory lock), sets an unusable password and issues a single-use set-password link that lives `BOOTSTRAP_LINK_MINUTES` (30; 5–60). Public registration is closed in production unless `PUBLIC_REGISTRATION=true`, and the web app hides sign-up when it is closed. | `bootstrap-admin.live` (on a throwaway database), `registration-gate.live`, web `registration-gate.spec` |
| 10 | Image, readiness, release identity | No Dockerfile; `/api/health` only said "ok". | `backend/Dockerfile` (Node 24.14 slim, production dependencies only, non-root, exec-form CMD, the RDS CA baked in; the worker and migrations use the same image). `/api/health` for the load balancer (503 while draining, no database), `/api/health/live`, `/api/health/ready` (`SELECT 1` with a timeout). Every response carries `X-OctaPM-Release`. `.github/workflows/container-image.yml` builds the image and proves it (below). | `health.live`, the Container Image workflow |
| 11 | Mobile builds | The API origin defaulted to localhost; no `eas.json`. | `mobile/eas.json` with development, preview (staging) and production profiles; `app.config.js` refuses a non-development build whose origin is not public https. No store configuration. | `mobile/scripts/release-origins.test.mjs` (35 cases) |
| 12 | Keys derived from `JWT_SECRET` | MFA secrets and inbound addresses fell back to keys derived from JWT_SECRET, so rotating it — or setting `INTEGRATION_SECRET_KEY` later — broke two-factor sign-in, and a decryption failure became a 500. | `utils/keyring.js`: a primary key, an optional `*_PREVIOUS` for rotation, and the old fallbacks only outside production. Production requires `MFA_SECRET_KEY` and `INTEGRATION_SECRET_KEY`. A secret opened with the previous key is re-sealed under the new one. | `mfa-key-rotation.live`, `inbound-address-rotation.live` |
| 13 | Database pool and TLS | Prisma's default pool (cores × 2 + 1) per process and no TLS rule. Prisma silently downgrades `verify-full` and, by default, **accepts any server certificate**. | `DATABASE_CONNECTION_LIMIT` per process. Production requires `sslmode=require`, an absolute CA path that exists, `sslaccept=strict`, and no repeated parameters (Prisma honours the last copy); `REALTIME_DATABASE_URL`, if set, gets the same TLS rules. | `db-pool.live`, `prod-database-url.live`, `docker/database-tls.live` (a decoy CA is refused) |

Also fixed because they break several tasks: login lockout in memory (now the `AuthThrottle` table; same thresholds), rate limits per task (now `RateLimitBucket`), a permission-template cache that honoured a revoke on another task only after 15 seconds (now versioned by `updatedAt`), refresh-token, SSO-ticket and reset-token claims that were not atomic, `keepAliveTimeout` below the load balancer's idle timeout (now 65 s), shutdown that dropped work (now bounded by `SHUTDOWN_TIMEOUT_MS`, drains sockets, waits for a job claimed mid-shutdown), and a worker that could exit when idle.

## Process roles

| | API tasks | Worker task |
|---|---|---|
| Command | `node src/index.js` | `node src/worker.js` |
| `SCHEDULERS_ENABLED` | `false` | `true` (default) |
| `JOB_WORKER_ENABLED` | `false` | `true` |
| `DATABASE_CONNECTION_LIMIT` | 10 | 6 |
| `SHUTDOWN_TIMEOUT_MS` | 25000 (ECS stopTimeout 30) | 110000 (stopTimeout 120) |
| Health check | ALB → `/api/health` | none |

Migrations run as a one-off task from the same image: `npx prisma migrate deploy`. The first administrator: `npm run admin:bootstrap --workspace=backend` as a one-off task.

## The production environment contract

`backend/.env.example`, section *Running on AWS*, is the list; `validateProductionEnv` (`backend/src/config/security.js`) enforces it and names the variable it refuses. In short: release identity (`RELEASE_GIT_SHA`, `APP_ENV`), TLS to RDS, a pool size, dedicated secrets (JWT ×2, MFA, integration), proxy hops, https link origins, SES, the bucket and region, and shared stores that are not `memory`. It refuses static AWS keys, endpoint overrides, local file storage, `ALLOW_DATA_SCRIPT`, a mail provider of `log`, the CloudFront secret with one hop, and (at launch) `INBOUND_EMAIL_DOMAIN`.

The database secret has this shape — `sslaccept=strict` is not optional:

```
postgresql://octapm_app:<password>@<rds-endpoint>:5432/octapm?sslmode=require&sslcert=/app/certs/rds-ca.pem&sslaccept=strict
```

## Evidence (final gate run, commit `c279cde`)

| Gate | Result |
|---|---|
| Backend unit suite | 206 suites, 2,365 tests — all pass |
| Backend live suites (real processes, real Postgres) | 28 suites, 140 tests — all pass |
| Web end-to-end (Playwright) | 171 passed, 0 failed |
| Mobile end-to-end (Playwright, web build) | 141 passed, 55 skipped (layout-independent specs run once), 0 failed |
| Mobile typecheck · lint · unit | pass · pass · 346 tests pass |
| Web typecheck · build · 29 test scripts | pass · pass · all pass |
| OpenAPI coverage | 739 documented paths |
| Financial reconciliation | snapshot 36/36, 16/16 source lines, actual-cost delta **0.00** (SQL / API / SQL vs API) |
| Web lint | 81 problems, 16 errors — **unchanged from before this work**, none in a file it touched |
| `infra:validate:deployment-readiness` | fails, as before: it checks the retired EC2 `deploy.yml`, which AWS-2 replaces |

Every behaviour above has a test that was run green, then run with the fix removed and seen to fail, then restored. The six workstreams were each reviewed by an independent agent that tried to break them, and the merged result by four more reviewers whose findings were each checked by a separate verifier; all confirmed findings are fixed.

There is no Docker on this machine, so the image is proven by the **Container Image** workflow on GitHub (`.github/workflows/container-image.yml`), green on commit `e9ba3cc` (run 35682218268). All 19 steps of its backend job pass: the image runs as the non-root `node` user and holds no `.env`, tests or other workspaces; the RDS root it picks (`Amazon RDS us-east-2 Root CA RSA2048 G1`, valid until 2061) is in the real bundle; all 117 migrations apply to an empty Postgres 16 over TLS from inside the image, and a second run finds nothing pending; Prisma refuses a decoy CA (`P1011`); the API boots with a production-shaped environment and answers with `X-OctaPM-Release` equal to the commit; the worker takes scheduler leadership, claims a job and stays up; SIGTERM stops the API in 1 s and the worker in 0 s, both with exit code 0; and a boot with a secret missing is refused with the variable named. Its web job builds the app for `api.octapm.com` and finds no local origin in the bundle; its mobile job checks the release profiles through `expo config`.

Its first run failed, usefully: `COPY --chmod` had created `/app` without the execute bit, so the `node` user could not reach its own code, and `npm ci` in `mobile/` needed the `--legacy-peer-deps` every local install already used (now `mobile/.npmrc`). Both fixed in `e9ba3cc`.

## Deferred, with reasons

- **TOTP codes can be replayed within their 90-second window, and a backup code can be spent twice by two requests at once.** Needs a column (`User.mfaLastTotpStep`) and a compare-and-set; it is not specific to running several tasks.
- **Webhooks can target private addresses** (SSRF). Pre-existing; needs an address check at delivery time.
- **The commitments execute route leaks its temporary upload.** Pre-existing, harmless on Fargate (ephemeral disk) but should be closed.
- **Web links (`<img src>`, `<a href>`) to `/api/v1/...` cannot send the bearer token**, so those downloads already fail before S3 is involved; a JSON download mode (`?redirect=false`) is the follow-up.
- **Inbound email** needs a receiving path (SES receipt rules or a vendor webhook); production refuses `INBOUND_EMAIL_DOMAIN` until then.
- **The RDS CA root** is chosen by `RDS_CA_CN` (default `Amazon RDS us-east-2 Root CA RSA2048 G1`, confirmed present in the real bundle by CI). The RDS instance must be created with `--ca-certificate-identifier rds-ca-rsa2048-g1`, and the first staging deploy should run `prisma migrate status` as a one-off task to confirm the chain end to end.
- **One web spec (`30-console-quality`, package rows)** relies on packages created by earlier specs, so it passes only as part of the full run.

## What is still needed before AWS work can start

1. AWS access through IAM Identity Center (`aws configure sso`, `aws sso login`) — never access keys.
2. Stripe: roll the secret key and webhook secret that were committed to `deploy.yml`.
3. Confirm the June us-east-2 environment is retired and whether any of its data matters.
4. Decisions: region (us-east-2 recommended), how production gets its code (merge to `main`, or release tags from this branch), and whether `@octapm.com` email exists.
