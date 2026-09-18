# OctaPM Mobile — Offline Policy

**Audience:** engineers implementing sync, and the product owner deciding what a person may do on site without a signal.
**Status:** policy of record, written before the offline milestone (M7) so that every earlier screen is built to fit it, and implemented in M7 on 2026-09-18; section 10 records what is built and what is carried. Where the backend lacks a capability the policy depends on, the gap is named here and in section 8 of the [API map](OCTAPM_MOBILE_API_MAP.md).

## 1. Principles

1. **The server owns the truth.** An offline copy is a snapshot with a timestamp; it is never presented as newer than it is.
2. **Offline is for capturing, not deciding.** A person may draft records, take photos, fill checklists and scan barcodes without a signal. Approvals, certifications, payments, stock movements and anything that changes money or state for someone else wait for a connection.
3. **Nothing sensitive at rest beyond what the platform protects.** Tokens live only in the secure store. Records live in the app's database, which the OS encrypts at rest; the app adds no second key it would have to hide.
4. **A session ends offline data too.** Sign-out, a revoked session, or removal from a project deletes that data on the device.
5. **Honest state, always visible.** Every screen shows whether it is live, cached (with age) or queued; every queued item shows whether it is waiting, sending, sent or needs attention.

## 2. What the app caches for reading

Per project, on first open and on each refresh while online. Cached reads render immediately when offline, marked with their age.

| Data | Source | Notes |
|---|---|---|
| Projects list, profile, effective permissions | `/projects`, `/auth/me`, `/auth/me/permissions?projectId=` | permissions are re-fetched on every online project open; offline, the cached answer renders but the server still decides on sync |
| Needs You, notifications | `/projects/:id/assignments/mine`, `/projects/workspace-dashboard`, `/notifications` | read-only offline |
| Activities, lookaheads, milestones | `/projects/:id/activities`, `/lookaheads` | the whole programme is one payload (no delta sync exists), so it is refreshed, not merged |
| RFIs, submittals, tasks, meetings | cursor lists | the first pages and every record the person opened |
| Drawing register and sheets | `/drawings/sheets`, `/sheets/offline-manifest` (sha256 per sheet), source PDFs through `/attachments/documents/:documentId` | see section 5 |
| Inspection templates, form instances, punch items, observations | `/forms/templates`, `/forms`, `/punch` | needed to draft offline |
| Daily-log days, daily reports, timesheets | `/daily-logs`, `/daily-reports`, `/timesheets` | recent range only |
| Inventory items, warehouses, bins, receivable purchase orders | `/inventory/*` | for scanning and drafting a goods receipt; balances are shown with their age |
| Photos | `/photos` metadata and thumbnails | full-size images on demand |

Not cached: budgets, cost, IPC, pay applications, commitments, bids, reports, audit trails, other people's private conversations. These are web-platform surfaces or online-only views.

## 3. What may be captured offline, and how it syncs

An offline write is a queued operation with a client-generated `clientRequestId` (a UUID), `clientCreatedAt`, and the device id, stored in an outbox table ordered by creation time within a project. Only endpoints that honour `clientRequestId` replay are allowed in the queue, so a retry after an interrupted send cannot create a duplicate.

| Capture | Endpoint | Replay-safe | Offline verdict |
|---|---|---|---|
| Punch item / observation | `POST /projects/:id/punch` | yes (`clientRequestId`) | **queue** |
| Inspection or form instance, answers, signatures, completion | `POST /forms` (`clientRequestId`, `clientCreatedAt`, `deviceId`), `PUT /forms/:id/responses`, `POST /signatures`, `POST /complete` | create yes; responses are idempotent by nature (full replace); signatures and completion are sent once after the create has succeeded | **queue** as one ordered group |
| Photo or file evidence | `POST /projects/:id/attachments` (`clientRequestId`) | yes | **queue**, after the record it belongs to |
| Daily report, site diary | `POST /daily-reports`, `POST /site-diaries` (`clientRequestId`, `clientCreatedAt`, `deviceId`) | yes | **queue** |
| Daily-log entry | `POST /daily-logs/:date/entries/:section` (`clientRequestId`) | yes | **queue** |
| Timesheet | `POST /timesheets` (`clientRequestId`) | yes | **queue** |
| RFI, submittal, NCR, safety incident, task, meeting, change event | create endpoints without a replay key | no | **draft locally, send once online with the person watching**; the draft is kept if the send fails before a response |
| Activity progress | `POST /activities/:id/progress` (no replay key) | no | **online only** |
| Goods receipt | `POST /inventory/goods-receipt` with a client-generated `receiptNumber`; `409 RECEIPT_ALREADY_POSTED` counts as success | natural key | **queue** (the one inventory write that may be queued) |
| Stock issue, return, transfer, adjust, damage, quarantine, reserve | `/inventory/stock/*`, `/transfers/*` | no; a retried issue double-posts cost | **online only**, never retried automatically |
| Approvals, decisions, certifications, payments, workflow responses | various | n/a | **online only** |
| NCR / safety closeout evidence | `POST /workflow/uploads` then `attachmentRefs` on `/submit` | no | **online only** |

Rules for the queue:

- Items send in order within a project; a failure stops the items that depend on it (a photo waits for its record) and not the others.
- Transient failures (`OFFLINE`, `TIMEOUT`, `SERVER_ERROR`, `RATE_LIMITED`) retry with exponential back-off, capped, and again whenever connectivity returns or the app comes to the foreground.
- `VALIDATION` and `CONFLICT` stop that item and mark it **needs attention** with the server's message; the person edits and resends, or discards. Nothing is silently dropped.
- `FORBIDDEN` or `NOT_FOUND` marks the item **refused**: the person no longer has the right, or the target record is gone. The captured content stays visible so it can be re-created elsewhere.
- `AUTH_REQUIRED` locks the queue until the person signs in again; the queue is preserved for the same person and deleted if a different person signs in.
- Last write wins on the server; there is no ETag or version precondition anywhere in the API. The app therefore never edits a record offline that someone else may be editing: offline writes are creates (with a replay key) or appends, not updates of shared fields.

## 4. Conflict handling

Because the API has no optimistic concurrency, the app avoids conflicts rather than resolving them:

- Offline **creates** cannot conflict.
- Offline **appends** (an answer to a checklist item, a photo, a comment) are written into a record the person owns or is assigned to; if the record has moved to a state that no longer accepts them (`409`, for example a closed form), the item is marked needs attention and the person is shown the current state.
- **Edits of shared fields** (title, assignee, due date) are online only, and the app refreshes the record before showing the edit form.
- A queued item whose target was closed, voided or deleted while offline is marked refused with the server's reason; the content is kept.

## 5. Drawings offline

- A person chooses sheets or sets to keep offline. The app stores the source PDF page and the sheet's current revision id from `offline-manifest`.
- On every sync the manifest is compared. A sheet whose current revision changed is marked **SUPERSEDED — a newer revision is available** on its thumbnail and inside the viewer, with an action to open the latest revision. The superseded copy stays readable, clearly marked, until replaced.
- A superseded sheet is never silently presented as current, online or offline.
- Personal markups and pins made offline queue as creates; a pin whose sheet was superseded is re-attached by the person, not guessed.

## 6. Data at rest and its lifetime

| Data | Store | Deleted when |
|---|---|---|
| Access token | memory | app process ends |
| Refresh token, last known profile, remembered email, biometric preference | platform secure store | sign-out, refused refresh, revoked session |
| Cached records, outbox, offline sheets and photos | app database and app documents directory (OS-encrypted at rest) | sign-out, refused refresh, a different person signs in, the project is removed from the person's list, the person removes the project from offline, or the cache exceeds its budget (oldest read-only data first, never the outbox) |
| Logs | in-memory ring buffer | app process ends |

The database never holds a token, a password or an authorization header. Backups exclude the app database and documents directory on both platforms.

## 7. Sync behaviour

- **When online returns:** the outbox drains first, oldest project first; then the reads for the open project refresh; then other projects the person keeps offline.
- **Foreground:** a refresh of the open screen if its data is older than the stale time.
- **Background:** where the platform permits (background fetch on iOS, WorkManager-style scheduling on Android via Expo's background tasks), the outbox drains and the offline sheets check for supersession. Background work is best-effort and never assumed; the foreground sync remains authoritative.
- **Realtime:** while online, the socket.io connection (`domain.event` in the project rooms) invalidates the affected queries, so the app reflects web changes without polling. There is no realtime for inventory; those screens poll their summary.
- **No delta endpoints exist**, so lists are refreshed in full; the app keeps them small (first pages, recent ranges) and refreshes opened records individually.

## 8. What the person sees

- A status line on every screen: **Live**, **Cached · updated 14 min ago**, or **Offline**.
- An outbox badge on Home and in More with the count of waiting items, and a list where each item shows its state and, for needs-attention items, the server's message and the two actions: fix and resend, or discard.
- A sign-in that cannot reach the server says the device is offline; a saved session opens the app with the last known profile and cached data instead of demanding a password.

## 9. Backend gaps this policy works around

From section 8 of the API map: no delta sync; no generic idempotency key (replay only where listed above); no concurrency preconditions; no native push registration; inventory mutations not replay-safe; no per-page sheet images (source PDF only). Each gap is listed in the implementation plan with the milestone that would need it and whether a backend change is proposed.

## 10. What M7 built, and what is carried (2026-09-18)

Built as written above: the outbox (`mobile/src/offline/outbox.ts`) with the state machine of section 3 and the rules of section 4, its senders for punch items, inspections, daily-log entries, timesheets, photos and the goods receipt, and the capture-or-queue path every one of those screens takes; the read cache of section 2 kept on the device for the person who signed in, within a 4 MB budget, restored at sign-in and written as it changes; the lifetime rules of section 6 (sign-out wipes queue and cache; a refused session keeps the queue locked and drops the cache; a different person's sign-in discards the queue); the status line, bar, badges and outbox screen of section 8; and kept sheets with supersession marking from the manifest (section 5). Offline data lives in the app's SQLite database on a device and in local storage on the web target.

Differences from the text above, all deliberate: the outbox is a key-value document rather than a table, since it is small and read as a whole; the read cache excludes searches, scans and the approvals inbox, which are momentary; a kept sheet stores the source PDF as a whole file (the server serves no per-page image) and the web target stores no file at all.

Carried: background sync (section 7) — the drain runs when the signal returns and when the app comes to the front, and background tasks are on the native verification list; realtime invalidation over socket.io was built in M9 (the socket marks the project’s queries stale and open screens refetch; nothing from the event is written into the cache); the drafts-then-send-once path for RFIs, NCRs, tasks and change events (their create endpoints carry no replay key, so they stay online only for now); the delta endpoints and the generic idempotency key remain proposals to the backend.

## 11. Offline architecture audit (certification, 2026-09-18)

Every write the app makes, classified from the code by a read-only audit and checked against the server's replay keys. OFFLINE SAFE means the person can complete it with no signal and nothing is lost. OFFLINE QUEUED WITH SERVER REVALIDATION means it is kept with a client-generated key, sent later, and re-authorised and de-duplicated by the server on arrival. ONLINE REQUIRED means the app refuses politely and keeps the form. NOT IMPLEMENTED means the app does not offer it at all.

| Workflow | Class | Replay key the server honours |
|---|---|---|
| Daily-log entry | OFFLINE QUEUED WITH SERVER REVALIDATION | `clientRequestId` on the entry, unique per project |
| Punch item (and observation) | OFFLINE QUEUED WITH SERVER REVALIDATION | `clientRequestId`, unique per project |
| Inspection created from a template | OFFLINE QUEUED WITH SERVER REVALIDATION | `clientRequestId`; the server starts the instance on replay |
| Timesheet | OFFLINE QUEUED WITH SERVER REVALIDATION | `clientRequestId` |
| Photo or attachment upload | OFFLINE QUEUED WITH SERVER REVALIDATION | `clientRequestId`; a photo queued behind a record is sent against the id that record's send returned |
| Goods receipt | OFFLINE QUEUED WITH SERVER REVALIDATION | the device receipt number `GRN-M-…`, unique per project; a second post is answered `RECEIPT_ALREADY_POSTED` |
| RFI create, RFI response | ONLINE REQUIRED | no replay key on the create route |
| NCR create, NCR closeout, NCR decision | ONLINE REQUIRED | none |
| Punch transitions (ready, close, reopen, dispute, void) | ONLINE REQUIRED | none |
| Inspection start, checklist answers, complete, close, void | ONLINE REQUIRED | none (answers live in the screen until sent) |
| Task comment, task complete | ONLINE REQUIRED | none |
| Progress update | ONLINE REQUIRED | none |
| Stock issue, receive, transfer, adjust, damage, quarantine | ONLINE REQUIRED, by policy | never queued: a stale stock request must not be replayed |
| Workflow decision (approve, reject, respond) | ONLINE REQUIRED, by policy | never queued: an approval must be made against the record as it stands |
| Change event create | ONLINE REQUIRED | none |
| Background sync while the app is closed | NOT IMPLEMENTED | the drain runs when the signal returns and when the app comes to the front |

Sync rules confirmed by the same audit: each queued item carries its own client-generated operation id, which is also the server's replay key; the queue is persisted (SQLite on a device, browser storage on the web target) and survives a restart; a dependent item is sent only after its parent, with the parent's returned id; retries back off (5 s doubling to 10 minutes); the server re-runs its permission checks on every replay, so an item queued before an access change is refused rather than honoured; a validation or conflict answer moves the item to "needs your attention" with the server's reason; a refused session locks the queue and keeps it for the same person.

Carried from the certification phase: on the web target a queued photo is stored as base64 inside one storage document (a quota failure drops the queue) and a web-queued upload cannot be replayed as a file — both native-only paths are unaffected; photo copies kept for the queue are not deleted after a successful send or at sign-out; an item the server refused cannot be edited before retrying. These are listed as PILOT-05 to PILOT-08 in the [known issues](OCTAPM_MOBILE_KNOWN_ISSUES.md).
