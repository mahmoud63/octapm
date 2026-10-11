# Incident 2026-10-04 — Superadmin work regenerated the shared Prisma client

Local development machine only. No database was written; no certification
process failed.

## What happened (times CDT)

| Time | Event |
|---|---|
| 05:21 | Superadmin worktree `.claude/worktrees/platform-admin` created with junctioned `node_modules`. Intended private `@prisma/client` copy came from `procore…/backend/node_modules/@prisma`, which is empty, so nothing was copied. |
| 05:34:52 | `npx prisma generate` (Superadmin schema, 249 models) resolved `@prisma/client` through the root junction and **rewrote the shared generated client** `procore-competitive-benchmark-6bd1b6/node_modules/.prisma/client` (the client the integration API and every cert script load). Engine DLL rename failed with EPERM, so the engine stayed the original. |
| 05:37:30 | Shared client regenerated from the integration schema (245 models). Schema correct again — but generated from the Superadmin worktree's directory, so the client's env-file fallback (`schemaEnvPath`) pointed at `platform-admin/backend/.env`. |
| 05:38–05:39 | A second generate in the Superadmin worktree found no resolvable private `@prisma/client`; Prisma ran `npm install` by itself and replaced the worktree's root `node_modules` junction with a fresh partial install (the shared install it pointed to was not modified — 750 entries before and after). |
| 05:53 | Shared client regenerated from the procore worktree itself; `schemaEnvPath` back to `../../../backend/.env`. |
| 05:56 | Proof: a reference client generated from the cert schema in an isolated mirror (`C:\Temp\pa-ref`) is equal to the shared client file-by-file (only the install root path differs). |

## Schemas

| Source | sha256 (git blob, LF) | models |
|---|---|---|
| `cert/full-saas-certification` tip `f16c14f` | `996006d6…` | 245 |
| `feat/p0-foundations-sprint1` tip `fbc0f76` | `996006d6…` | 245 |
| `feat/platform-superadmin-v1` HEAD `fbc0f76` (+ working tree) | `996006d6…` (working tree: 249) | 245 / 249 |

The cert worktree's file differs from the blob only by CRLF checkout.

## Impact check

- Cert API `:5190` (PID 36156) started 2026-10-03 19:26 — loaded its client before the incident; `/api/health/ready` 200.
- Cert scripts build Prisma with an explicit `CERT_DATABASE_URL` datasource (`scripts/cert/lib/cert-env.js`) and never fall back to `DATABASE_URL`, so the wrong env fallback (05:37–05:53) could not redirect them. One cert script started in that window (`shape-sweep.js --attacker=044`, 05:38:09), after the schema was already correct.
- No cert process started 05:34:52–05:37:30 (the only window with extra models in the shared client).
- Cert DB `octapm_cert` (read-only transaction): 138 migrations applied = 138 folders on the cert branch, none missing/extra/unfinished; no `PlatformUserAccess` / `PlatformAuditEvent` / `ProductEvent` / `PlatformErrorEvent` table and no `AuditEvent_occurredAt_idx`. The Superadmin migration was applied only to `octapm_platform_admin` on `:55432`.
- `prisma validate` on the cert schema: valid. Shared client as resolved from `cert/backend`: 245 models, no platform models; starts and reads `octapm_cert`.

## Prevention

- `backend/scripts/db/prisma-client-guard.js` (+ unit tests): refuses when `@prisma/client` or the generated `.prisma/client` resolves, after following links, outside the checkout, or when `@prisma/client` does not resolve at all (the auto-install path). `npm run prisma:generate` runs the guard first.
- The Superadmin worktree now has real `node_modules/@prisma/client` and `node_modules/.prisma` and junctions for everything else; the guarded generate there was proven not to change a byte of the shared client.
- Worktrees that intentionally share the integration client (cert) must never run `prisma generate`; the guard refuses there.
