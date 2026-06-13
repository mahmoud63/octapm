# Runtime State And Scale Blockers

Status: open. These items do not block an internal demo, but they remain blockers
for paid customer use, multi-instance deployment, and production scale.

## Durable Job State

- Current state: BOQ and schedule job state use in-memory `Map` stores.
- Impact: queued or in-progress jobs are lost on process restart and are not
  visible across multiple API instances.
- Required before paid customer or production: move job state to PostgreSQL,
  Redis, or a compatible durable adapter; add restart-safety tests and
  operational cleanup/TTL behavior.

## Distributed Rate Limiting

- Current state: API/auth/upload/AI/billing/webhook rate limit buckets are
  process-local in memory.
- Impact: limits are not enforced consistently across horizontally scaled API
  instances.
- Required before multi-instance or production: use Redis, a managed edge/WAF
  limiter, or another shared limiter backend; keep local memory mode only for
  development and single-instance demos.

## Performance And Load Evidence

- Current state: unit/build gates pass locally, but no load test evidence is
  attached for realistic construction-project volumes.
- Impact: dashboard, schedule, document, and import behavior under pilot-scale
  data is not proven.
- Required before controlled production use: run and archive load tests for
  project list/search, project detail, schedule Gantt, BOQ upload/import,
  document revision access, EV dashboard, and notification queues.
