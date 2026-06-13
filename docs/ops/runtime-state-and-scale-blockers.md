# Runtime State And Scale Blockers

Status: open. These items do not block an internal demo, but they remain blockers
for paid customer use, multi-instance deployment, and production scale.

For a controlled shadow pilot, these risks require explicit Product, Backend,
DevOps, and Security acceptance. Acceptance expires on 2026-07-31 unless a
durable job store and shared rate limiter are implemented sooner.

## Durable Job State

- Current state: BOQ and schedule job state use in-memory `Map` stores.
- Impact: queued or in-progress jobs are lost on process restart and are not
  visible across multiple API instances.
- Required before paid customer or production: move job state to PostgreSQL,
  Redis, or a compatible durable adapter; add restart-safety tests and
  operational cleanup/TTL behavior.
- Shadow-pilot constraint if risk accepted: single backend instance only, no
  critical long-running imports without manual retry, and every import result
  reviewed against the source file before use.
- Owner: Backend. Target fix decision: 2026-07-15.

## Distributed Rate Limiting

- Current state: API/auth/upload/AI/billing/webhook rate limit buckets are
  process-local in memory.
- Impact: limits are not enforced consistently across horizontally scaled API
  instances.
- Required before multi-instance or production: use Redis, a managed edge/WAF
  limiter, or another shared limiter backend; keep local memory mode only for
  development and single-instance demos.
- Shadow-pilot constraint if risk accepted: single backend instance only,
  external-party access limited, and edge/WAF throttling configured if exposed
  outside an internal network.
- Owner: Backend/Security/DevOps. Target fix decision: 2026-07-15.

## Performance And Load Evidence

- Current state: unit/build gates pass locally, but no load test evidence is
  attached for realistic construction-project volumes.
- Impact: dashboard, schedule, document, and import behavior under pilot-scale
  data is not proven.
- Required before controlled production use: run and archive load tests for
  project list/search, project detail, schedule Gantt, BOQ upload/import,
  document revision access, EV dashboard, and notification queues.
- Owner: QA/Backend/Frontend. Target first load evidence: 2026-07-31.
