# OctaPM Mobile — Implementation Plan

**Audience:** the product owner and the engineers delivering the field app.
**Status:** plan of record. Milestones follow the brief (MOBILE-M0 to MOBILE-M10). Each milestone lists its scope, what proves it, the backend it depends on, and its current state. The gate for every milestone is: typecheck, lint, unit tests, rendered-screen tests, permission tests, no new runtime errors, and a native build where the environment permits. The environment limits in section 11 of the [Architecture](OCTAPM_MOBILE_ARCHITECTURE.md) apply to every native gate.

## Milestones

### MOBILE-M0 — architecture, shell, auth, API, design system

**Scope.** Expo project; typed request layer over generated OpenAPI types; native session contract on the backend (body-delivered refresh token for native clients, channel binding, family revocation outside the transaction); request ids end to end; secure storage abstraction; sign-in, biometric lock, resume and sign-out; the five-destination shell; design system from the brand book; documentation set.

**Proof.** Backend: browser cookie suite unchanged; native-client route suite; channel-binding service suite; request-id middleware suite. Mobile: unit tests for the policy, error model, formatting and layout classes; request-layer tests (headers, 401 refresh-and-retry, single-flight under concurrent 401s, refused refresh ends the session and clears keychain and cache, 403 keeps the session, request id from header, fail-fast offline, dead network, cancellation, project-scoped cache); session tests (memory versus keychain, refused login as a sentence, resume rotates, transient failure keeps the session, biometric wait, logout revokes and clears even when the server is down, offline cold start opens with the last known profile); rendered tests for the sign-in reasons, 401 and 403 as sentences, offline sign-in, and the shell redirects. Live: sign-in, rotated refresh on reload and profile fetch through the web target against the local API.

**Backend dependencies.** Delivered in this milestone: `X-OctaPM-Client` channel, `cli` claim, `error.requestId`, `X-Request-Id` echo and CORS exposure.

**State.** Complete on this machine except native builds (Android: NOT YET VERIFIED LOCALLY; iPhone/iPad: DEVICE/MAC VERIFICATION REQUIRED).

### MOBILE-M1 — Home, Projects, Needs You, Search, notifications

**Scope.** Home as the field control centre (Needs You first, today's items, quick actions, offline/outbox status); project list and switch (clearing scoped state); Needs You from `/projects/:id/assignments/mine` and `/projects/workspace-dashboard`; global search over `/search` with typed results and deep links into records; notifications list, mark-read, and preferences view. Effective permissions fetched per project and used for rendering.

**Proof.** Rendered tests per screen with the fake server; permission tests that a site engineer sees no approve actions and a warehouse role sees no RFI create; project-switch test that nothing from the previous project remains; Playwright on the web target against the local API for the happy path.

**Backend dependencies.** None new. Known gap: Needs You across projects omits role-derived PO, commitment, pay-app and bid items (map §8.18); shown per project as the server provides.

### MOBILE-M2 — RFI, Tasks, Documents, Drawings

**Scope.** RFI list, filters, ball-in-court, detail with responses and history, create (quick create from Home pre-filling project, person and date), respond, close and convert where permitted; tasks (`assignee=me`, cursor paging, close, comment); document register and search, extracted text; drawing register, sheet viewer (source PDF page rendered on device: zoom, pan, fit width), latest-revision guard with the superseded warning, favourites and recently viewed, pins that create punch items, links to RFI, NCR, inspection and task; attachments through the unified endpoint; comments and subscriptions; custom fields.

**Proof.** Rendered tests including the superseded-drawing warning and the RFI create flow; permission tests for party roles; Playwright happy paths.

**Backend dependencies.** None blocking. Gaps: no per-page sheet images (render on device); RFI create has no replay key (send once, online).

### MOBILE-M3 — Daily Logs, schedule field progress, photos

**Scope.** Daily log day view and entries by section with copy-previous (structure, not values), weather refresh, submit; daily reports and site diaries; timesheets create and submit; photo capture and gallery with caption, tags, location and record association (EXIF handled by the server on unified attachments); today's work, activities, progress submission with method awareness (`source: 'mobile'`), lookahead item status, milestones, critical activities, risks and long-lead views; earned-value tiles from `/health` for field roles.

**Proof.** Rendered tests; permission tests (assignment rule on progress; parties cannot patch summaries); camera and EXIF stay on the native verification list.

**Backend dependencies.** None blocking. Gaps: progress has no replay key (online only); no client-supplied coordinates on any endpoint (the app does not send location to the server).

### MOBILE-M4 — Quality, NCR, Punch, Safety, material tests

**Scope.** Quality home from `/quality/dashboard`; inspections from templates with checklists, photos per item, signatures, hold points and completion, deficiency to punch or observation; punch items with quick creation from the camera, transitions and closeout photo; observations; NCR create, submit with closeout evidence through workflow uploads, and the approve/reject/reopen steps for the roles that hold them; safety incidents on the same pattern; legacy ITP and material tests as view-and-record where the role allows.

**Proof.** Rendered tests for each state machine as the API map describes it; evidence-gate tests (closeout refused without evidence); permission tests (no party access to NCR or safety).

**Backend dependencies.** None blocking. Gaps: no single-record GET for NCR, safety, ITP, defects or material tests (lists are filtered on device); no automatic NCR from a failed inspection.

### MOBILE-M5 — Inventory, barcode, goods receipt, issue, transfer

**Scope.** Inventory home for the storekeeper; scan to resolve items by barcode, QR or SKU; goods receipt against a purchase order with a client-generated receipt number; issue, return, reserve, damage, quarantine and release per role; transfers dispatch and receive; movement ledger; low-stock and summary tiles.

**Proof.** Rendered tests including the receipt-replay rule; permission tests per transition role; barcode scanning stays on the native verification list.

**Backend dependencies.** Gaps that shape the design: no bin, warehouse or PO barcodes (scan resolves items only); stock mutations are not replay-safe (online only, no automatic retry); no stock counts or movement reversal.

### MOBILE-M6 — Change Events, approvals, procurement subset

**Scope.** Change events create and view for the roles that hold them; workflow inbox (`/workflows/my-steps`, respond); purchase orders, packages, deliveries and lead-time alerts as read and acknowledge; pay applications as view, and submit for contractor and subcontractor parties; commitments and change orders as view.

**Proof.** Rendered and permission tests; every approve, certify or pay action verified absent from the app.

### MOBILE-M7 — Offline and sync

**Scope.** The [offline policy](OCTAPM_MOBILE_OFFLINE_POLICY.md): SQLite cache and outbox, replay-safe queue, needs-attention handling, drawing supersession marking, lifetime and wipe rules, status lines and outbox screens.

**Proof.** Unit tests for the outbox state machine with a scripted server; rendered tests for the status lines; Playwright with network throttling on the web target; device behaviour stays on the native verification list.

**Backend dependencies.** None strictly required. Proposed, not built: a delta endpoint per list and a generic idempotency key would simplify sync materially.

### MOBILE-M8 — Tablet and iPad optimisation

**Scope.** Master–detail layouts on the expanded class; the rail; split view and rotation; drawing viewer and Gantt-lite for tablets; keyboard and pointer support.

**Proof.** Layout tests per class; screenshots at tablet widths on the web target; iPad behaviour stays on the native verification list.

### MOBILE-M9 — cross-device integration and hardening

**Scope.** Push registration (blocked on a backend endpoint for Expo, FCM or APNs tokens; the API registers Web Push only), deep and universal links from every notification type, realtime invalidation, performance passes on long lists and low-end devices, accessibility review.

**Backend dependencies.** Required: a native push registration endpoint and a sender. Proposed here, decided by the product owner.

### MOBILE-M10 — full certification

**Scope.** The final gates from the brief (platform matrix, auth, RBAC, tenant and project isolation, offline, sync, push and deep links, camera, barcode, documents, drawings, RFI, daily log, quality, inventory, tasks, approvals, cross web/mobile propagation, financial reconciliation delta 0.00) and the final report with the verdicts READY / CONDITIONAL / NOT READY for internal UAT and for a field pilot.

## Verification approach under this machine's limits

Everything that can be proven without a device is proven at each milestone: TypeScript, lint, Jest with rendered screens, permission tests from the shared policy, backend suites, and the web target in the browser pane and Playwright against the local API. Everything native is recorded on MOBILE_NATIVE_VERIFICATION_PENDING in the architecture document and stays CONDITIONAL until a device run is recorded. No milestone claims a native pass it has not seen.

## Rules that do not change between milestones

- No approval, certification, payment or budget action on the phone.
- No status set by editing; transitions only.
- No token outside memory and the secure store; nothing sensitive logged.
- No parallel business rules: the backend decides, the app renders.
- No store publishing, no deployment, no force push, no committed secrets, logs, databases or certificates.
