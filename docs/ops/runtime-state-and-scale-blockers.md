# Runtime State And Scale Blockers

Status: durable job state and shared rate limiting were implemented on
2026-09-05 (`OCTA-PLAT-JOBS-001`, see `docs/qa/background-jobs.md`). The
remaining items below still block a production SLA claim and need evidence
before a paid pilot.

## Durable Job State — resolved (pending load evidence)

- Current state: BOQ AI processing and AI schedule generation are rows in the
  `BackgroundJob` table, claimed with `FOR UPDATE SKIP LOCKED` by the worker in
  `backend/src/jobs/worker.js`. Jobs heartbeat, are re-queued after a worker
  crash, retry transient failures with exponential backoff, and are pruned after
  `JOB_TTL_MS`.
- Multi-instance: any number of API or dedicated worker processes
  (`npm run worker --workspace=backend`) share the queue; job state is visible
  from every instance via `GET /projects/{id}/jobs`.
- Remaining evidence: run the restart-safety and two-instance scenarios in
  `docs/qa/background-jobs.md` against staging and attach the log excerpts.
- Owner: Backend.

## Distributed Rate Limiting — resolved for API buckets, partial for login lockout

- Current state: all `createRateLimiter` buckets (api, auth, login, refresh,
  upload, AI generation, billing, Stripe webhook) use
  `backend/src/config/rate-limit-store.js`. With `REDIS_URL` set the counters
  are shared in Redis; without it they are per-instance memory. A Redis outage
  degrades to per-instance counters with a throttled warning, never a block.
- Remaining: the login backoff/lockout counters in
  `backend/src/services/auth-abuse.service.js` are still process-local (their
  callers and tests are synchronous). The shared `auth-login` bucket bounds
  attempts per IP+email across instances in the meantime.
- Required before multi-instance production: provision Redis, set `REDIS_URL`
  on every API instance, and move the lockout state to the shared store.
- Owner: Backend/Security/DevOps.

## Realtime Fan-out — per instance

- Current state: socket.io rooms are per API instance. A record changed on
  instance A is pushed only to sockets connected to A.
- Required before multi-instance production: add the socket.io Redis adapter
  using the same `REDIS_URL`.
- Owner: Backend.

## Performance And Load Evidence — open

- Current state: unit/build gates pass locally, but no load test evidence is
  attached for realistic construction-project volumes.
- Impact: dashboard, schedule, document, import, and job-queue behavior under
  pilot-scale data is not proven.
- Required before controlled production use: run and archive load tests for
  project list/search, project detail, schedule Gantt, BOQ upload/import (with
  the worker under load), document revision access, EV dashboard, realtime
  fan-out, and notification queues.
- Owner: QA/Backend/Frontend. Target first load evidence: 2026-10-15.
