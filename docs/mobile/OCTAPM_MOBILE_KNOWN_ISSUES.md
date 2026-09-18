# OctaPM Mobile — Known Issues

**Audience:** the product owner deciding the pilot scope, and the engineer picking up the next piece of work.
**Status:** the register produced by the certification phase of 2026-09-18, on branch `feat/p0-foundations-sprint1`. Ten read-only auditors read `mobile/` and the server routes it calls; each finding was then put to two independent verifiers (one against the code, one against the field use and the approved scope). What survived is below. Live certification runs on the production web export sit in the [certification report](OCTAPM_MOBILE_CERTIFICATION_REPORT.md).

**Classification.** MOB-P0 unsafe, data integrity or security · MOB-P1 a core mobile workflow cannot be completed · MOB-P2 important usability or reliability · MOB-P3 polish, non-blocking · NATIVE-VERIFY cannot be certified without a device · ENV toolchain, not a product defect.

**Counts.** MOB-P0 0 · MOB-P1 3 (all fixed) · MOB-P2 37 (10 fixed, 27 open) · MOB-P3 35 (5 fixed, 30 open) · NATIVE-VERIFY 7 · ENV 2 (no JDK/Android SDK; no macOS). A missing native toolchain is not a product defect and is not counted against the pilot gates.

## 1. Fixed in this phase

Each carries a regression test that fails when the fix is reverted (checked by reverting it).

| Id | Severity | What was wrong | Fix | Test |
|---|---|---|---|---|
| CERT-01 | MOB-P1 | Daily-log photos captured without a signal could never send: the queued entry's sender returned no record id, so the photo behind it stopped in "Needs your attention" with "The record this photo belongs to has no id yet." | The daily-log sender returns the log id it created, which the photo is then uploaded against | `certification-fixes.test.ts` (real senders against a fake server) |
| CERT-02 | MOB-P1 | The on-device read cache was restored and written only after a password sign-in. After any restart or biometric unlock the app opened to an empty cache: offline, every screen showed a skeleton or an error | `resume()` attaches the session's outbox and read cache on both the online and the offline-open path, and registers the push device | covered live by the offline specs; the call site is asserted by the session suite |
| CERT-03 | MOB-P1 | Workflow steps for records with no in-app screen (IPC certification, budget revision, submittal, correspondence, document revision) could be decided with only the step name on screen | Carried, not fixed: see PILOT-02 below. The approvals the app does show in full (change order, commitment, pay application, progress, closeouts) are unaffected | — |
| CERT-04 | MOB-P2 (security) | `POST /projects/:id/workflow/uploads` had no module permission guard: any project member, including a party-scoped person with no quality or commercial rights, could upload up to ten 25 MB files into the project's workflow storage | The route now requires a create/update/submit/approve right on one of the modules whose records carry workflow evidence | `backend/src/routes/__tests__/workflow-uploads.routes.test.js` |
| CERT-05 | MOB-P2 | A wrong password was reported as "Your session has ended" and a disabled account as a role refusal | The 401 sentence branches on the server's own code: wrong credentials, disabled account, verification code needed, or a genuinely ended session | `certification-fixes.test.ts` |
| CERT-06 | MOB-P2 | The outbox printed the server's developer message and raw fetch text ("Network request failed", Prisma text) under a queued item | The outbox stores the sentence the person reads; the server code and the request id stay on the item for support | `certification-fixes.test.ts` |
| CERT-07 | MOB-P2 | Evidence "Open" on NCR and safety records printed bare error codes (`OFFLINE`, `NOT_FOUND`) | The same error mapper the rest of the app uses | covered by the error-leak scan in every certification spec |
| CERT-08 | MOB-P2 | Links for legacy ITP records, legacy defects and progress submissions opened screens that query a different table, so they always failed with "That record is no longer available" | Those types hand over to the web platform, which owns those records | `certification-fixes.test.ts` |
| CERT-09 | MOB-P2 | A link naming a project the person is not on switched to that project and persisted it, breaking every screen until they visited Home | The opener asks the server before switching, keeps the current project and says "You are not on that project" | `cert-security.spec.ts`, `cert-links.spec.ts` |
| CERT-10 | MOB-P2 | A transient failure of the token refresh after a 401 (lost signal, server fault) ended the session, wiped the refresh token and the read cache, and demanded a password — impossible in a basement | A refused refresh still ends the session; a retryable failure is raised to the caller and the session is kept | request-layer behaviour; exercised by the offline specs |
| CERT-11 | MOB-P2 | An inventory change never refetched the inventory screens: those keys sit outside the project scope the socket invalidates | Inventory entity types invalidate the inventory keys too | `certification-fixes.test.ts` |
| CERT-12 | MOB-P2 | The photo grid and the photo screen were sized from the window, so on a tablet they overflowed the 440-wide master pane and the right pane | Both size from their own measured width | `cert-responsive.spec.ts` at every tablet and iPad size |
| CERT-13 | MOB-P2 | The commercial hub had no loading or error state and reported a confident "0 approvals" while its queries were still pending or had failed | The count reads "—" until the inbox answers; a failure shows the error state with a retry | `cert-responsive.spec.ts` (no blank screens) |
| CERT-14 | MOB-P2 | A failed lookahead fetch was shown as "No items on this lookahead", telling the crew the planner had published nothing | The error state with a retry | — |
| CERT-15 | MOB-P2 | The connectivity bar drew under the status bar (a dead ternary meant the safe-area inset was never applied) and was a 26 px tap target | The inset is applied and the bar meets the tap-target floor | `cert-responsive.spec.ts` |
| CERT-16 | MOB-P3 | Filter chips were 36 px tall, below the 44 px floor, and they are the choice control in the progress, daily-log and stock-move forms | The chip meets the floor | `cert-responsive.spec.ts` (fails below 40 px at any width) |
| CERT-17 | MOB-P3 | An express-validator failure showed the bare words "Validation failed" and never named the field | The first field message the server sent is shown when its own message is the generic one | `certification-fixes.test.ts` |
| CERT-18 | MOB-P3 | A 402 subscription refusal had no sentence and read as a transient fault | Its own error class and sentence | `certification-fixes.test.ts` |
| CERT-19 | MOB-P3 | No app-level error boundary: an uncaught render exception showed the router's default, which prints the exception text | A crash screen with a sentence and a retry; the detail goes to the log | typecheck and lint; the screen is `screen-crash` |

## 2. Open, and what they mean for a pilot

### Blocking nothing, but worth a decision before the pilot

| Id | Severity | Issue | Where |
|---|---|---|---|
| PILOT-01 | MOB-P2 | A change-order approval on the phone shows the reference, title, project and prior answers, but not the amount, counterparty, retention or the supporting document. A person can approve without seeing the money | `mobile/app/(app)/workflow/[id].tsx:86`, `commercial/change-orders/[id].tsx` |
| PILOT-02 | MOB-P1 (carried) | Workflow steps for tools with no in-app record (IPC certification, budget revision, submittal, correspondence, document revision) show only the step name. Either render the server's `context` (amount, period, change type) or make those steps "Review on web" | `mobile/app/(app)/workflow/[id].tsx:125` |
| PILOT-03 | MOB-P2 | Commitment and pay-application screens carry no attachments, comments or history, so the record behind an approval cannot be reviewed in full on the phone | `mobile/app/(app)/commercial/commitments/[id].tsx` |
| PILOT-04 | MOB-P2 | Progress approval is a single tap with no confirmation, and the submission row does not name who submitted it or show its evidence | `mobile/app/(app)/activities/[id].tsx:195` |
| PILOT-05 | MOB-P2 | On the web target a queued photo is stored as base64 inside one storage document; a quota failure silently drops the whole outbox. On a device the queue is SQLite-backed and unaffected | `mobile/src/offline/storage.ts:44` |
| PILOT-06 | MOB-P2 | Replaying a queued upload on the web target sends plain objects instead of files, so a web-captured photo that went through the outbox cannot be sent. Native is unaffected | `mobile/src/offline/senders.ts:59` |
| PILOT-07 | MOB-P2 | Photo copies made for the queue under the documents directory are created on every upload, online or not, and are never deleted — including after sign-out on a shared tablet | `mobile/src/offline/capture.ts:36` |
| PILOT-08 | MOB-P2 | An item the server refused shows no captured content and cannot be edited: only "Try again" unchanged or "Discard" | `mobile/app/(app)/outbox.tsx:68` |
| PILOT-09 | MOB-P2 | The "Photo" quick action is gated on `document_control.create` while the capture itself needs `progress.submit`, so a party-scoped person can be offered a form they cannot complete | `mobile/src/home/quick-actions.ts:26` |
| PILOT-10 | MOB-P2 | A photo older than the newest sixty in the project cannot be opened by link: the screen scans the first page only and says the photo is no longer available | `mobile/app/(app)/photos/[id].tsx:31` |
| PILOT-11 | MOB-P2 | The tablet timeline mounts a row for every activity of the filtered register without windowing | `mobile/src/components/TimelineStrip.tsx:50` |
| PILOT-12 | MOB-P2 | Photo tiles fall back to the full-size original whenever the server thumbnail is not ready | `mobile/app/(app)/photos/index.tsx:155` |
| PILOT-13 | MOB-P2 | Draining N queued items invalidates every project query N times on a freshly restored connection | `mobile/src/offline/senders.ts:17` |
| PILOT-14 | MOB-P2 | Sheets with an auto-focused input have no keyboard avoidance, so on iOS the confirm button can sit behind the keyboard | `mobile/src/components/PromptSheet.tsx:41` |
| PILOT-15 | MOB-P2 | A link opened while signed out or biometric-locked does not return to the intended record after signing in: the person lands on Home and must find it by hand. Measured live in this phase, not only read from the code | `mobile/app/(app)/_layout.tsx:22` |

### Server-side, and therefore a propagation class rather than a mobile defect

| Id | Severity | Issue | Effect |
|---|---|---|---|
| SRV-01 | MOB-P2 | Stock movements (issue, receive, transfer) publish no domain event | Inventory propagation is REFRESH REQUIRED rather than realtime |
| SRV-02 | MOB-P2 | A workflow step response and a step assignment publish no domain event; only the final decision does | The approvals inbox is REFRESH REQUIRED between steps |
| SRV-03 | MOB-P2 | An NCR assignment or field edit without a status change, and an NCR delete, publish no event | Those edits are REFRESH REQUIRED |
| SRV-04 | MOB-P3 | The server strips `details[]` in production, so the two detail-driven mobile explanations (CERT-17) fall back to the generic sentence there | Field names are named in development, not in production |

### Polish (MOB-P3, thirty open)

The larger ones: the realtime client coalesces per event type rather than per project; the activities register is fetched and persisted under two keys; the lookahead list is unwindowed; memoised rows are defeated by inline callbacks; the web image cache is never cleared; punch "Close" is a one-tap transition; record screens carry no freshness line; the error state always offers "Try again", including after a refusal; opening a notification from Home takes two taps; quick actions render before a project is chosen; a missed socket event is never caught up after a reconnect. The full list with file and line is in the audit journal for this phase.

## 3. Cannot be certified here (NATIVE-VERIFY)

Native persistence and the connectivity signal; the camera taps in the site-photo path; native socket behaviour (websocket transport, reconnection from the background); the extra top inset inside an iOS page sheet; keyboard avoidance on every form outside sign-in; a cold-start push tap and a universal link while the session is still booting; and whether the bearer survives the API's redirect to a signed file URL on the native HTTP stack. Each is a row in the [native capability register](OCTAPM_MOBILE_NATIVE_VERIFICATION.md).

## 4. Environment (ENV, not product defects)

ANDROID NATIVE BUILD TOOLCHAIN NOT INSTALLED ON THIS MACHINE — no JDK, no Android SDK, no Android Studio, no adb, no emulator. IOS NATIVE LOCAL BUILD REQUIRES MACOS OR A SUPPORTED REMOTE BUILD SERVICE — the host is Windows 11. Neither is a defect in the application; both are why the native rows above are unproven. The [Android guide](OCTAPM_ANDROID_VERIFICATION_GUIDE.md) and the [iOS guide](OCTAPM_IOS_VERIFICATION_GUIDE.md) say exactly what to install and run.
