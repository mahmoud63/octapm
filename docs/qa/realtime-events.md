# Realtime Domain Events QA

Task: `OCTA-PLAT-EVENTS-002` (Sprint 1, P0 foundations).

## What Changed

- `backend/src/events/bus.js` is the in-process domain event bus. Services publish
  normalized events; delivery is deferred by `REALTIME_EMIT_DELAY_MS` (default 150 ms)
  so connected clients refetch after the publishing transaction has committed.
- `backend/src/realtime/socket.js` attaches to the existing socket.io server.
  Every socket must authenticate with the same access token used for REST.
  Sockets join `org:{orgId}` and `user:{userId}` rooms on connect and may join
  `project:{projectId}` rooms only after `assertProjectAccess` passes.
- Publishers:
  - `audit.service.recordEvent` → `record.changed` for every audited entity, and
    persists an `OutboundEvent` row inside the same transaction (durable log for
    future webhooks).
  - `approval-workflow.service.recordTransition` → `approval.decided`.
  - `notification.service.createNotifications` → `notification.created`,
    delivered to recipient user rooms only.
- Frontend: `useRealtimeConnection` (authenticated layout) opens the socket and
  `useProjectRealtime(projectId)` (project workspace) joins the room and
  invalidates TanStack Query caches keyed by the project plus global queues.

## Event Contract

Socket event name: `domain.event`

```json
{
  "id": "uuid",
  "type": "record.changed | approval.decided | notification.created | job.progress",
  "orgId": "uuid",
  "projectId": "uuid | null",
  "entityType": "rfi",
  "entityId": "uuid",
  "action": "created | updated | status_changed | approved | rejected | archived | ...",
  "actorId": "uuid | null",
  "occurredAt": "ISO-8601",
  "payload": { "oldStatus": null, "newStatus": "open", "summary": {} }
}
```

Client → server messages: `project:join { projectId }` and
`project:leave { projectId }`, each acknowledged with `{ ok, projectId, code? }`.

## Manual QA

1. Sign in as a PM in browser A and as a site engineer in browser B on the same project.
2. In B, submit a daily report. Within ~1 s, A's Site Reporting queue and workspace dashboard refresh without a manual reload.
3. In A, approve the report. B's progress/EV views refresh; B receives an in-app notification badge update without polling.
4. Sign in as a user with no assignment on the project and open the socket manually; `project:join` must acknowledge `{ ok: false, code: "PROJECT_ACCESS_DENIED" }` and no `domain.event` for that project must arrive.
5. Restart the API mid-session; the client reconnects (socket.io auto-reconnect) and re-joins the project room.
6. Confirm `OutboundEvent` rows exist for the audited actions above.

## Automated Checks

- `backend/src/events/__tests__/bus.test.js`
- `backend/src/realtime/__tests__/socket.test.js`
- Existing audit, approval, and notification tests must pass unchanged (publishing is optional-model safe).

## Known Limits

- Fan-out is per API instance. Multi-instance deployments need the socket.io Redis adapter (planned with the durable job queue task `OCTA-PLAT-JOBS-001`).
- Deferred delivery is time-based, not commit-hooked; a transaction longer than the delay could produce one early refetch. Query invalidation makes that harmless.
