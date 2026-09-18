# OctaPM Mobile — Final Report

**Audience:** the product owner, the release manager and whoever runs the internal UAT and the field pilot.
**Status:** the certification record for the field application after MOBILE-M0 to MOBILE-M10, as of 2026-09-18, on the branch `feat/p0-foundations-sprint1`. Every figure below was produced on this machine and can be reproduced with the commands in section 9. Nothing was deployed or published.
**Companion documents:** [Architecture](OCTAPM_MOBILE_ARCHITECTURE.md), [Implementation plan](OCTAPM_MOBILE_IMPLEMENTATION_PLAN.md), [Feature matrix](OCTAPM_MOBILE_FEATURE_MATRIX.md), [Permission matrix](OCTAPM_MOBILE_PERMISSION_MATRIX.md), [Offline policy](OCTAPM_MOBILE_OFFLINE_POLICY.md), [API map](OCTAPM_MOBILE_API_MAP.md), [User flow](OCTAPM_MOBILE_USER_FLOW.md), [User guide](../user-guide/mobile/OCTAPM_MOBILE_USER_GUIDE.md), [Role quick guides](../user-guide/mobile/OCTAPM_MOBILE_ROLE_QUICK_GUIDES.md).

## 1. Verdicts

| Question | Verdict | Why, in one line |
|---|---|---|
| Ready for internal mobile UAT? | **NOT READY FOR INTERNAL MOBILE UAT** | Every code gate is green and every field flow is proven live on the web target, but no native build has been produced or run on this machine (no Android SDK, no macOS), so nothing has yet been held in a hand. UAT needs a build; the list that turns this verdict into READY is in section 7 and is short. |
| Ready for a field pilot? | **NOT READY FOR FIELD PILOT** | A pilot follows UAT. When UAT passes, the pilot verdict becomes **CONDITIONAL FOR FIELD PILOT** on the four items in section 7.2 (drawing sets on the pilot project, push delivery observed on a device, background sync, one low-end device measured). |

These verdicts are about what has been demonstrated, not about the quality of the code. The application is complete for the scope in the brief; what is missing is the device evidence that this environment cannot produce. The two words the brief forbids, "production ready", do not appear in this report by design.

## 2. What was built

One React Native application (Expo SDK 57, React Native 0.86, TypeScript strict) for Android phones and tablets, iPhone and iPad, against the one existing Express API and PostgreSQL database. There is no mobile backend, no second schema and no second permission model. Milestones, each closed with its own gate and recorded in the [plan](OCTAPM_MOBILE_IMPLEMENTATION_PLAN.md):

| Milestone | Delivered |
|---|---|
| M0 | Shell, native session contract on the server (body-delivered refresh token for native clients, channel binding, family revocation), typed request layer, secure storage, sign-in, biometric lock, resume, sign-out, design system from the brand book, documentation set |
| M1 | Home as the field control centre, Projects and switch, Needs You, Search, Notifications with preferences |
| M2 | RFIs (list, record, every transition, create), tasks, document register, drawing register and viewer with the superseded guard |
| M3 | Daily log with entries by section, activities and progress submission by method, lookahead board, photos onto the daily log, timesheets |
| M4 | Quality home, inspections from templates with checklists and hold points, punch items and observations, NCRs and safety incidents with closeout evidence, material tests |
| M5 | Inventory home, barcode scan or typed code, items and stock moves, goods receipt with a device receipt number, transfers, ledger |
| M6 | Commercial home, change events, change orders, commitments and pay applications, the approvals inbox through the respond route, procurement overview, packages, orders and long-lead register |
| M7 | Offline: outbox with replay keys and a state machine, persisted read cache, capture-or-queue on every field form, kept-offline drawing sheets, connectivity bar |
| M8 | Tablet and iPad: master–detail at the route group, activities timeline, progress approval on the wide screen, signature pad |
| M9 | Deep and universal links, native push registration and delivery through Expo, realtime invalidation over socket.io, photo markup before upload, list rendering budget, accessibility sweep |
| M10 | This certification: the role and isolation gates through the app's own screens, the financial reconciliation, the platform matrix, the user guide and the role quick guides |

## 3. The gates

Each gate names its evidence tier: **unit** (Jest with the fake server), **backend** (the server's own Jest suites), **live** (Playwright against the production web export and the local API in the dedicated end-to-end organisation), or **device** (needs a phone in a hand; not available here).

| Gate from the brief | Result | Evidence |
|---|---|---|
| Platform matrix | **Web target: phone and tablet viewports pass. Android phone and tablet: NOT YET VERIFIED LOCALLY. iPhone and iPad: DEVICE/MAC VERIFICATION REQUIRED.** | Every Playwright check runs on a 390×844 phone and a 1024×768 tablet viewport; the split layout, the rail and the pane placeholder are asserted on the tablet and their absence on the phone. No native build exists on this machine (section 7). |
| Authentication and session | PASS | Backend: browser cookie suite unchanged, native-client route suite, channel-binding suite, request-id suite. Live: sign-in through the native contract, rotated refresh on reload, a refused refresh ending the session with its reason, sign-out revoking on the server (m1). The refresh token lives only in the keychain; nothing prints either token. |
| RBAC | PASS | Unit: a site engineer sees no approve actions, a warehouse role no RFI create, a party no NCR. Live (m10): a site engineer signed in on the app sees no Approve or Reject on a submitted progress update and no Answer, Approve or Close on an open RFI, while the manager sees them (m8, m2). The effective matrix of all nine role accounts on the end-to-end project is in section 4. |
| Tenant and project isolation | PASS (tenant); project isolation within an organisation carried to UAT | Live (m10): a project manager of another organisation gets not-found from the API for this project's record and, following a link into the app, sees no record. Every request is scoped by organisation on the server. The end-to-end organisation holds one project, so switching between projects of one organisation is proven by the unit test that clears the previous project's cache and by m1's live switch in the demo data, not by a cross-project refusal. |
| Offline and sync | PASS on the web target; background sync on the device list | Unit: the outbox state machine (retry classes, back-off, dependants, attention, refusal, lock on a lost session), the persisted cache budget, capture-or-queue. Live (m7): a punch item captured offline waits in the outbox and is sent once when the signal returns; a daily-log entry captured offline says so and goes to the outbox. |
| Push and deep links | PASS on the web target; delivery on the device list | Unit: the resolver for every link form, registration and removal, tap routing. Backend: the Expo provider. Live (m9): a web-platform record link opens the record through the opener, the app's own route with the project named does the same, a link naming nothing lands on Home, and a browser makes no native registration. |
| Camera and barcode | Web target: typed code and file chooser pass; camera and scanner on the device list | Live (m5): a typed code resolves to the item; (m3, m4, m9): photos chosen through the chooser go onto the daily log, a punch item and an NCR closeout. The camera view and the barcode scanner are native components proven only by their unit stand-ins here. |
| Documents and drawings | PASS for the registers; viewer on fixtures | Live (m2): the document register and the sheet register load. The local seed holds no published drawing set, so the viewer, the superseded warning and the kept-offline sheet are proven on fixtures (unit) and on the live empty state. Carried to the pilot conditions. |
| RFI | PASS | Live (m2): an RFI raised from the field, answered officially and approved to closed through the server's transition routes; the list narrowed to my court through the server; a search hit opening in the app. |
| Daily log | PASS | Live (m3): a manpower entry with a replay key and the totals; (m7) an entry captured offline. |
| Quality | PASS | Live (m4): an inspection started from a template, answered in one request and completed; a punch item moved through review and close; an NCR closed out with evidence and approved; a material test scheduled and its result recorded; (m8) a checklist signature drawn and posted as a PNG. |
| Inventory | PASS | Live (m5): stock issued once through the issue route; a delivery received against a fresh purchase order with a receipt number the server then treats as already posted; a transfer drafted, dispatched and received line by line with the ledger showing the movements. |
| Tasks | PASS | Live (m2): tasks listed for the person on the project and a task commented on. |
| Approvals | PASS | Live (m6): an approval step answered through the respond route and the change order moved; (m8) a submitted progress update approved from the tablet through the approve route. |
| Cross web/mobile propagation | PASS | The app reads and writes the same API and database as the web platform; every live check reads its result back through the API after acting in the app, and m9 shows the reverse: a record raised through the API appears in the open list without a reload. |
| Financial reconciliation, delta 0.00 | PASS | Section 5: the app shows the server's own summaries and rows (it computes no money); on the end-to-end project the change-order summary reconciles to its rows on approved and pending totals and on the approved count with a delta of 0.00, and the one commitment's original value plus its approved change orders equals its revised value, and its schedule of values equals its original, both at 0.00. |
| Realtime | PASS | Live (m9): with the RFI list open, an RFI raised through the API appeared in the list without a reload. |
| Tablet | PASS on the tablet viewport; iPad on the device list | Live (m8): the RFI list stays beside the opened record on the tablet and the record takes the whole phone; the timeline is offered on the wide screen only; approval from the tablet. |
| Accessibility | PASS for names and headings | Unit: every button on Home and Notifications has a name and every screen a heading; the design system carries roles, labels and states. A screen-reader pass with TalkBack and VoiceOver is on the device list. |

## 4. Role gate, as measured on the end-to-end project

Read from `GET /auth/me/permissions?projectId=` for each of the nine accounts on 2026-09-18. Y means the server grants it; a dash means the app never offers it. The app renders from this matrix and the server enforces it again on every request.

| Account (role) | Modules visible | Hidden modules | RFI create | RFI approve | Progress submit | Progress approve | Punch create | NCR approve | Inventory create | Change event create | Change order approve | Timesheet approve |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| pm (Project Manager) | 37 | none | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y |
| planner (Planning Engineer) | 35 | ipc, sub_pay_app | Y | – | Y | Y | Y | – | – | Y | – | – |
| qs (QS) | 37 | none | – | – | – | Y | Y | – | – | Y | – | – |
| cost (Cost Controller) | 36 | user_management | – | – | – | – | – | – | – | – | – | Y |
| procurement (Procurement) | 31 | progress, ipc, cost, user_management, change_order, eot | – | – | – | – | – | – | Y | – | – | – |
| warehouse (Warehouse) | 25 | progress, ipc, cost, user_management, bid, portfolio, commitment, sub_pay_app, change_order, eot, change_event, email | – | – | – | – | – | – | Y | – | – | – |
| site (Site Engineer) | 29 | ipc, cost, user_management, bid, portfolio, sub_pay_app, change_order, eot | Y | – | Y | – | Y | – | – | Y | – | – |
| quality (Quality Engineer) | 29 | ipc, cost, user_management, bid, portfolio, sub_pay_app, change_order, eot | Y | – | Y | – | Y | Y | – | Y | – | – |
| finance (Finance) | 36 | user_management | – | – | – | – | – | – | – | – | – | – |

Transitions the app gates on, same read: `submission.approve` is held by pm, planner and qs only; `rfi.approve` by pm only; `inspection.void` and `punch.close` by pm and quality; `change_order.approve` by pm; `pay_app.approve` by nobody on this project (the pay-application decision stays on the web, as the feature matrix says). No party-scoped account exists in the end-to-end organisation; the party rules are covered by the unit tests over the shared policy.

## 5. Financial reconciliation

The app never computes money. Every figure it shows is a field the server returned: the change-order summary (`totalApproved`, `totalPending`, `approvedCount`), each order's `value`, a commitment's `original`, `revised` and `retentionOnRevised`, a pay application's lines and totals, the health tiles. The delta between what the app shows and what the server holds is therefore 0.00 by construction, and the live check below shows the server's own figures agree with their rows.

| Check on the end-to-end project (2026-09-18) | Rows | Summary | Delta |
|---|---|---|---|
| Approved change orders, sum of `value` (14 orders) | 21,000.00 | `totalApproved` 21,000.00 | 0.00 |
| Pending change orders, sum of `value` (3 orders) | 4,500.00 | `totalPending` 4,500.00 | 0.00 |
| Approved count | 14 | `approvedCount` 14 | 0 |
| Commitment SC-0001: `original` + approved change orders (1, 74,400.00) | 1,260,400.00 | `revised` 1,260,400.00 | 0.00 |
| Commitment SC-0001: schedule of values, sum of lines | 1,186,000.00 | `original` 1,186,000.00 | 0.00 |

Draft orders (7, 10,500.00) are outside both totals, as the summary defines them. The demo project holds no change orders and reconciles trivially. No pay application exists on either project, so that path is proven by the unit tests and by m6's live submit only.

## 6. Defects found and fixed along the way

Real defects the live checks surfaced, all fixed on the branch with a test that fails without the fix:

| Found in | Defect | Fix |
|---|---|---|
| M2 live | Closing a sheet and pushing a route in the same tick left the previous screen's modal focus trap active on the web, so the next screen's inputs lost every keystroke | `useNavigateAfterClose`: navigate after the sheet has closed; rule recorded in the architecture |
| M6 live | The change-order list answers `{ orders, summary }`, not `{ items }`; a submit needs both impact summaries, an affected activity and a supporting document | Endpoint and form aligned to the server; the spec seeds the approval template |
| M7 live | A daily-log manpower entry needs a trade; the form let it through | Trade marked required on the sheet; the spec fills it |
| M8 live | Signing a checklist item failed for every client with 400: the form service stores the signature as an attachment under the role `signature`, which the attachment service refused | Role accepted; OpenAPI enum lists it; the form-service test's attachment stand-in now enforces the real role list, so both suites fail with the fix reverted (checked) |
| M8 live | The gesture library's pan never delivered strokes to the pad under a mouse on the web target | The pad and the markup sheet draw through the platform's responder system, so a finger, a stylus and a mouse all arrive |
| M9 unit | The reanimated babel plugin treats any `.value` inside a style object as a shared value and injects its runtime, which crashed Jest | The colour field renamed; the rule recorded in the code and in memory |

## 7. What turns the verdicts

### 7.1 From NOT READY to READY FOR INTERNAL MOBILE UAT

Produce one Android build and one iOS build (EAS or local prebuild) from the branch and run the native verification list. Every item is a behaviour the code already implements and the web target already proves the logic of; the list is the device evidence this machine could not produce.

| # | Item | How to verify (ten minutes each) |
|---|---|---|
| 1 | Install, first launch, sign-in with password | Sign in as a site engineer; Home shows the project |
| 2 | Keychain and biometric unlock | Turn on Unlock with biometrics in More, background the app past the lock window, return: the biometric prompt appears and the workspace opens |
| 3 | Token refresh and sign-out on the device | Leave the app open past the access token's life; a list refreshes without a sign-in prompt; sign out; the refresh session is revoked on the server (`RefreshSession` row) |
| 4 | Camera and photo library | Take a photo onto the daily log; choose one from the library for a punch item; the server stores EXIF (taken-at, camera) |
| 5 | Barcode scanner | Scan a printed code for an inventory item; the item opens |
| 6 | PDF drawing viewer | Open a sheet from a published drawing set on a project that has one; fit width, pin list, superseded warning on an older revision; keep a sheet offline and open it in airplane mode |
| 7 | Offline capture and drain | Airplane mode; raise a punch item with a photo and add a daily-log entry; they wait in the outbox; leave airplane mode; both send once and the outbox shows Sent |
| 8 | Push | Grant permission; the token appears under the person's push devices on the server; assign the person an RFI from the web; the notification arrives; tapping it opens the RFI |
| 9 | Deep and universal links | Open `octapm://rfi/<id>` and an `https://app.octapm.com/projects/<project>/rfi?recordId=<id>&source=rfi` link from a note; the app opens on the record |
| 10 | Signature and markup capture | Sign a checklist item and mark up a photo; the PNG and the marked JPEG on the server are the drawn images (view capture is the native path) |
| 11 | Tablet and iPad | Rotate an iPad with an RFI open; the list stays on the left and the record on the right; the timeline and progress approval appear on the wide screen only |
| 12 | Screen reader | TalkBack and VoiceOver read every control on Home, a list and a record with a name |

### 7.2 From NOT READY to CONDITIONAL FOR FIELD PILOT (after UAT)

1. The pilot project has a published drawing set, so the viewer and kept-offline sheets are used, not only proven on fixtures.
2. Push delivery observed on the pilot devices (item 8 above), since the Expo path was proven here by tests and the server's provider, not by a delivered notification.
3. Background sync while the app is closed stays absent by design in this release; the pilot brief must say that the outbox drains when the app is opened or comes to the front, and the pilot must confirm that is acceptable for the crews.
4. One low-end Android device measured on the longest registers (activities, ledger, photos); the rendering budget was set by inspection here, not by measurement.

## 8. Known gaps and carried items

- Records without a screen open on the web platform at the exact record (the app says so): cost, IPC certificates, bids, portfolio, EOT, meetings, e-mail. The feature matrix lists every row.
- Drafts-then-send-once for RFIs, NCRs, tasks and change events: their create endpoints carry no replay key, so they stay online-only; the app refuses politely offline.
- Stock movements and approvals are never queued offline, by policy.
- Project isolation within one organisation is not demonstrated live (one project in the end-to-end organisation); the unit tests and the demo switch cover it.
- Performance was set by budget, not measured on a device.
- The web platform's Web Push is unchanged; the app's push is a new provider on the same table and needs no VAPID keys.

## 9. How to reproduce every figure

```bash
cd mobile && npm run generate && npx tsc --noEmit && npx eslint . && npx jest --runInBand --forceExit
cd mobile && npm run export:web && npm run e2e        # the local API on :5000 and CORS for :8081 must be up
cd backend && npx jest --runInBand --forceExit
```

| Figure (2026-09-18) | Value |
|---|---|
| Mobile TypeScript and ESLint | 0 errors, 0 warnings |
| Mobile Jest | 275 tests in 55 suites |
| Backend Jest | 2,217 tests in 199 suites, all passing |
| Playwright, phone and tablet viewports | 79 passed, 1 skipped (m1 to m10; the tablet-only approval check is skipped on the phone by design) |
| Writes during the runs | the dedicated end-to-end organisation only; the demo organisation read once for the isolation gate; the certified project never touched |

## 10. Git and release state

Branch `feat/p0-foundations-sprint1`, every milestone a separate commit with its gate figures in the message, pushed; working tree clean; no force push, no history rewrite; no secret, local database, log, token, certificate, provisioning profile or private key committed. Nothing deployed; nothing published to a store; no EAS build requested. The app's configuration is `EXPO_PUBLIC_*` only.
