# Background Jobs And Shared Rate Limits QA

Task: `OCTA-PLAT-JOBS-001` (Sprint 1, P0 foundations).

## What Changed

- BOQ AI processing (`boq.parse`) and AI schedule generation (`schedule.generate`)
  no longer live in process-memory maps. They are rows in the `BackgroundJob`
  table (`backend/src/jobs/job.service.js`) claimed by a worker
  (`backend/src/jobs/worker.js`) with `FOR UPDATE SKIP LOCKED`, so any number of
  API/worker instances share one queue without double-processing.
- The worker runs only where `JOB_WORKER_ENABLED=true` (it is off unless set to
  exactly `true`): inside the API process for a single-process setup, or leave
  it unset on API instances and run `npm run worker --workspace=backend` with
  it set to move AI work to dedicated processes.
- Jobs heartbeat every `JOB_HEARTBEAT_MS` (15 s). A job whose worker dies is
  detected after `JOB_STALE_MS` (5 min) and re-queued (or failed once
  `maxAttempts` is spent). Retryable failures back off 30 s, 60 s, 120 s … up to
  10 min. Terminal jobs are pruned after `JOB_TTL_MS` (7 days).
- Failed jobs notify the requester (in-app/email per preference), write an
  audit event (`entityType = background_job`), and can be retried from the UI
  or `POST /projects/{projectId}/jobs/{jobId}/retry`.
- The existing pollers keep working: `GET /schedule/job/{jobId}` and
  `GET /boq/job/{jobId}` return the same shape (`status` in
  `processing|running|done|error`, `step`, `progress`, `error`, plus new
  `errorCode`, `attempts`, `maxAttempts`, `canRetry`, `jobStatus`).
- Rate-limit buckets now use a shared store (`backend/src/config/rate-limit-store.js`).
  With `REDIS_URL` set, counters live in Redis and are enforced consistently across
  instances; without it (dev/test) counters stay in memory. If Redis is down the
  limiter falls back to per-instance counters and logs once a minute.

## API

| Endpoint | Permission | Notes |
| --- | --- | --- |
| `GET /projects/{projectId}/jobs?status=&type=&limit=` | project access | Newest first, `summary` counts |
| `GET /projects/{projectId}/jobs/{jobId}` | project access | Full job record |
| `POST /projects/{projectId}/jobs/{jobId}/retry` | `update` on the job's module (`boq` or `schedule`) | Only `failed`/`cancelled`; grants one more attempt |
| `POST /projects/{projectId}/jobs/{jobId}/cancel` | same | Only `queued` |
| `POST /projects/{projectId}/schedule/job/{jobId}/retry` | `schedule.update` | Legacy view response |
| `POST /projects/{projectId}/boq/job/{jobId}/retry` | PM / Planner / QS | Legacy view response |

## Environment

```
REDIS_URL=redis://localhost:6379        # optional; enables shared rate-limit counters
JOB_WORKER_ENABLED=true                 # off unless exactly "true"; leave unset on API instances that have dedicated workers
JOB_WORKER_CONCURRENCY=2
JOB_POLL_INTERVAL_MS=2000
JOB_HEARTBEAT_MS=15000
JOB_STALE_MS=300000
JOB_TTL_MS=604800000
```

## Manual QA

1. Upload a BOQ and, while the AI step is running, restart the API. The job
   row stays `running`; within `JOB_STALE_MS` the restarted worker re-queues it
   and the BOQ upload panel resumes polling to completion without a new upload.
2. Start two API instances against the same database and Redis. Trigger a
   schedule generation on instance A; confirm instance B's
   `GET /projects/{id}/jobs` shows it and only one instance runs it.
3. Hit `POST /auth/login` past `RATE_LIMIT_LOGIN_MAX` across the two instances;
   the 429 must arrive at the combined count, not per instance.
4. Force a non-retryable failure (upload a workbook with no BOQ rows). The job
   ends `failed` with `errorCode = EMPTY_FILE`, the requester receives a
   notification, the audit history shows `background_job failed`, and the
   upload panel offers **Retry** (which re-queues the same job).
5. Stop Redis while the API runs; requests continue with per-instance limits
   and one warning per minute appears in the log.

## Automated Checks

- `backend/src/jobs/__tests__/job.service.test.js`
- `backend/src/jobs/__tests__/worker.test.js`
- `backend/src/config/__tests__/rate-limit-store.test.js`
- `backend/src/routes/__tests__/jobs.routes.test.js`
- Existing rate-limit, BOQ upload, and schedule permission tests must keep passing.

## Remaining Process-Local State

- Login backoff/lockout counters in `auth-abuse.service.js` are still in memory
  (their callers and tests are synchronous). The shared `auth-login` limiter
  bounds attempts per IP+email across instances in the meantime; moving the
  lockout state to the shared store is a follow-up.
- Realtime socket rooms are per instance until the socket.io Redis adapter is
  added (same `REDIS_URL`).
