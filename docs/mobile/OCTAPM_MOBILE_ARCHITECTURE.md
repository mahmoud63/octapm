# OctaPM Mobile — Architecture

**Audience:** engineers building or reviewing the field app, and the security reviewer who signs off the session model.
**Status:** describes the code under `mobile/` and the backend changes it relies on, as of 2026-09-18. The verification record at the end says what has been proven on this machine and what has not.
**Companion documents:** [API map](OCTAPM_MOBILE_API_MAP.md), [Feature matrix](OCTAPM_MOBILE_FEATURE_MATRIX.md), [Offline policy](OCTAPM_MOBILE_OFFLINE_POLICY.md), [Permission matrix](OCTAPM_MOBILE_PERMISSION_MATRIX.md), [Implementation plan](OCTAPM_MOBILE_IMPLEMENTATION_PLAN.md).

## 1. What the app is

One field application for Android phones, Android tablets, iPhone and iPad, built once in React Native with Expo and TypeScript. It talks to the same Express API and the same PostgreSQL database as the web platform; there is no mobile backend, no second schema and no second permission model. Anything the app shows or changes is a record the web platform already owns.

The app is field-first: it exists for the people who stand on site with a phone in one hand. The web platform remains the place for administration, configuration, bulk work and wide tables. Where a capability exists only on the web, the app says so and hands over with a link rather than half-building it.

## 2. Stack

| Layer | Choice | Why |
|---|---|---|
| Runtime | Expo SDK 57, React Native 0.86, React 19 | Managed native modules (secure store, camera, barcode, biometrics, notifications) with prebuild when a custom module is needed |
| Language | TypeScript 6, `strict` | The API types are generated, so the compiler catches contract drift |
| Navigation | expo-router (file routes, typed routes) | Deep links and universal links fall out of the file tree |
| Server state | TanStack Query 5 | Cache, stale-while-revalidate, project-scoped invalidation |
| Client state | zustand | The session and a few UI stores; nothing persisted |
| Forms | react-hook-form + zod | The same validation vocabulary as the web platform |
| API client | openapi-fetch over types generated from `backend/src/openapi/spec.js` | One source of truth; no hand-typed request shapes |
| Secure storage | expo-secure-store (Keychain on iOS, Keystore-backed on Android) | The only place the refresh token may live |
| Tests | jest-expo, React Native Testing Library; Playwright against the web target | Unit and rendered-screen tests run on any machine; device tests are recorded separately |

The web target (react-native-web through Metro, port 8081) exists so the app can be exercised in a browser during development and in Playwright. It is not a product surface and it certifies nothing native (section 11).

## 3. Repository layout

```
mobile/
├── app/                      # expo-router file routes
│   ├── _layout.tsx           # fonts, theme, query client, session bootstrap
│   ├── (auth)/               # sign-in stack; redirects a signed-in person home
│   └── (app)/                # the signed-in shell: Home, Projects, Needs You, Search, More
├── src/
│   ├── api/                  # client.ts (request layer), errors.ts, network.ts, query.ts, generated/ (ignored)
│   ├── auth/                 # session.ts, store.ts, secure-storage.ts, biometric.ts
│   ├── permissions/          # policy.ts over generated/policy.json (copy of shared/permissions.json)
│   ├── design-system/        # tokens, Text, Button, Input, Card, Badge, states, RecordRow, KPI, ThemeProvider
│   ├── components/           # Screen, Wordmark
│   ├── hooks/                # useLayout (compact / medium / expanded)
│   ├── analytics/            # allow-listed events; no sink until one is configured
│   ├── utilities/            # logger (redacting), format
│   ├── config/env.ts         # EXPO_PUBLIC_* only
│   └── testing/              # setup (native fakes), fake-server, rendered-screen tests
├── scripts/generate.mjs      # regenerates the API types and the permission policy
├── scripts/brand-assets.mjs  # renders icon, splash and notification assets from the brand vectors
├── app.json                  # bundle ids com.octapm.app, scheme octapm, universal-link domains
├── jest.config.js, eslint.config.js, tsconfig.json
└── .env.example
```

`src/api/generated/schema.d.ts` and `src/permissions/generated/policy.json` are build products. They are git-ignored and rebuilt by `node scripts/generate.mjs`, which runs before typecheck, test and start. A change to the OpenAPI spec therefore becomes a compile error in the app, not a runtime surprise.

## 4. Configuration

All runtime configuration is read from `EXPO_PUBLIC_*` variables at build time through `src/config/env.ts`: the API origin, the web origin used for hand-over links, the environment name and the EAS project id. Nothing else is configurable from the outside and no value in the bundle is secret. There are no API keys, signing secrets, certificates or service credentials in the repository, in `app.json`, or in the bundle.

## 5. Session and authentication

### 5.1 Two channels, one authority

The backend issues the same two tokens to every client: a short-lived access JWT and a longer-lived refresh JWT whose SHA-256 is stored in a `RefreshSession` row. What differs is only how the refresh token travels.

| | Browser (web platform) | Native app |
|---|---|---|
| How the client identifies itself | nothing | request header `X-OctaPM-Client: mobile` |
| Where the refresh token is delivered | httpOnly cookie `pmc_refresh_token`, path `/api/v1/auth`; stripped from every JSON body | `tokens.refreshToken` and `tokens.refreshTokenExpiresAt` in the response body; no cookie is set |
| How it is presented back | cookie on `POST /auth/refresh` and `POST /auth/logout` | `{ refreshToken }` in the body of the same two endpoints; the cookie is never read |
| Channel binding | refresh JWT claim `cli: "web"` | refresh JWT claim `cli: "mobile"` |

The header chooses the delivery channel and nothing else. It cannot bypass any security decision: authorization runs on the access token, through the same `authenticate` middleware and the same permission checks, for both channels. A native token presented as a cookie, or a cookie token presented in a body, is refused with `REFRESH_TOKEN_CHANNEL_MISMATCH` and its whole family is revoked. Tokens minted before the claim existed are treated as browser tokens, so nothing changed for signed-in web users.

The web cookie flow is unchanged and was re-tested unchanged: a browser never sees a refresh token in a body, never sends one in a body, and cannot obtain one by adding the header to a request that carries a cookie session.

### 5.2 Session rules the server enforces

- Refresh tokens are random per session, hashed at rest, and rotated on every refresh: the old session is marked replaced, a new one is created, and the response carries the new token only.
- Presenting a token that has already been rotated is replay. The server refuses it and revokes the entire family (the token, its replacement, and every descendant), so a stolen copy ends the session for the thief and the owner alike, and the owner signs in again.
- Refusals for reuse and channel mismatch are written outside the transaction that discovered them, so the refusal cannot roll the revocation back. This was a latent bug in the previous code and is now covered by tests.
- Expiry is checked on every refresh. An expired or revoked session cannot be refreshed; a disabled user cannot refresh on either channel.
- `authenticate` re-reads the user on every request, so deactivation and role changes take effect on the next call, not at the next refresh.
- Access tokens keep their short lifetime. There is no permanent bearer token and no long-lived access token for mobile.

### 5.3 What the app stores, and where

| Item | Where | Never |
|---|---|---|
| Access token | memory only (`useAuthStore`) | disk, keychain, logs, query cache |
| Refresh token | expo-secure-store, `WHEN_UNLOCKED_THIS_DEVICE_ONLY` | AsyncStorage, SQLite, JSON files, zustand persistence, the query cache, logs |
| Remembered email, biometric preference | expo-secure-store | |
| Server records | TanStack Query cache in memory; the offline store (see the offline policy) | tokens of any kind |

`src/auth/secure-storage.ts` is the only module that touches the secure store, and `src/auth/session.ts` is the only module that reads or writes the refresh token key. The logger redacts any field named like a token, password, secret or authorization header before it prints, and no code path prints either token; a rendered test asserts that nothing resembling an access token is ever written to the store.

On the development web target the secure store is replaced by session storage for the current browser tab. That is a development convenience for a surface that is not shipped, not a security claim.

### 5.4 Session lifecycle in the app

```
booting --(no saved session)-----------------> signedOut --(sign in)--> signedIn
   |                                                                       |
   +--(saved session, biometric on)--> locked --(unlock)--> signedIn       |
                                                                           v
                               signedOut <--(sign out / refresh refused / revoked)
```

- **Bootstrap** reads the saved refresh token. With biometric unlock on, the app waits in `locked` until the platform prompt succeeds, then refreshes. Otherwise it refreshes immediately. The splash screen stays up until this decision is made, so the first frame is either the workspace or the sign-in screen.
- **Refresh** is single-flight: however many requests fail together, one refresh runs and the others wait for it. A refused refresh (`AUTH_REQUIRED`, `FORBIDDEN`) ends the session; a transient failure (offline, timeout, server error) leaves the session as it is and the caller sees that error instead.
- **Ending a session** clears the in-memory token, deletes the refresh token from the secure store, clears the query cache, locks any offline data, and returns the person to the sign-in screen with a reason it can explain: expired, or revoked by an administrator.
- **Sign-out** posts the refresh token to `/auth/logout`, which revokes the session family, and then ends the session locally whether or not the server answered.

## 6. The request layer

`src/api/client.ts` is a small typed layer over openapi-fetch and is the only way the app talks to the server. It owns:

- the base URL from configuration;
- the headers on every call: `Authorization: Bearer`, `X-OctaPM-Client: mobile`, `Accept`, and a fresh `X-Request-Id`;
- the response envelope, so callers receive `data` or an `AppError`;
- one refresh-and-retry on `401`, using the single-flight refresh; a second `401` ends the session;
- a per-request timeout and an abort signal, so leaving a screen cancels what it started;
- the network state: when the device knows it is offline the call fails fast with `OFFLINE` and never touches the network.

Downloads are the exception: the API answers file requests with a redirect to a presigned URL, and the app must not forward the `Authorization` header to that URL.

### 6.1 Error model

Every failure the app handles is an `AppError` with one of these codes. The server's own code is kept alongside it (`serverCode`) for the cases where the screen needs to be specific, such as a workflow lock.

| Code | Meaning | What the person sees |
|---|---|---|
| `AUTH_REQUIRED` | no session, or the session could not be refreshed | the sign-in screen, with the reason |
| `FORBIDDEN` | signed in, but not allowed this record or action | an inline refusal; the session continues |
| `NOT_FOUND` | the record is gone or was never theirs | "This record is no longer available" |
| `CONFLICT` | state changed underneath the request | the server's explanation and a refresh |
| `VALIDATION` | the server refused the input | field-level messages where the server gave them |
| `OFFLINE` | no connection, or the network failed before a response | an offline banner; writes are queued where the offline policy allows |
| `TIMEOUT` | the server did not answer in time | retry offered |
| `SERVER_ERROR` | anything else from the server | "Something went wrong" with the request id |
| `CANCELLED` | the caller abandoned the request | nothing |

The server's `error.requestId` (or the `X-Request-Id` response header) is preserved on every error and shown as the support reference. Raw Prisma, SQL or stack text is never shown: a server message that looks technical is replaced by the generic sentence for its code.

## 7. Authorization

The server is the authority. Every list the app shows and every action it offers is one the server has already agreed to; the app never derives a permission on its own and never trusts a role string to bypass a check.

- `GET /auth/me/permissions?projectId=` returns the effective matrix for the signed-in person on that project (modules, levels, actions and transitions, resolved through the project's permission templates). The app uses it to decide what to render.
- `src/permissions/policy.ts` reads the same `shared/permissions.json` the server uses. It exists for offline hints and for tests; when the server's answer is available it wins.
- A `403` is a refusal for that record, not the end of the session. A removed project assignment therefore shows as a refusal on that project and a missing project in the list, while the person stays signed in elsewhere.
- Switching projects calls `forgetProject`, which drops every query keyed to the previous project, so nothing from one project can be shown on another.

## 8. State and caching

The query client keeps server records in memory with a short stale time and a long garbage-collection time, retries only errors the error model marks retryable, and runs in offline-first mode so cached data renders while the network is away. Keys are structured (`me`, `projects`, `project(id)`, `projectScoped(id, …)`, `needsYou(id)`, `notifications`, `search`) so a project can be forgotten as a unit and the whole cache can be cleared at sign-out. Since M7 the settled part of that cache is also kept on the device between launches, under the signed-in person's id and within a budget, and restored when they sign in; the outbox of captured writes and the sheets kept offline live beside it. The rules for all of it are in the offline policy, and `src/offline/` implements them.

## 9. Design system and layout

The design system implements the OctaPM brand book: the brand palette, Space Grotesk for display and Inter for text, the same status vocabulary as the web platform, and tap targets no smaller than the platform minimum. `useLayout` classifies the window as compact (phones), medium (large phones, small tablets and split view) or expanded (tablets), and screens use that classification rather than device names. The signed-in shell keeps the same five destinations everywhere: a bottom bar on a phone, the same bar as a left rail on a tablet, which frees the width for master–detail screens.

On the expanded width class each route group splits itself (`src/navigation/split.tsx`): the section's list on the left, the group's stack on the right, so records open beside the list without any screen knowing the device. A list drawn by the stack while its list is already on the left shows a placeholder instead of itself.

One rule for sheets: a screen never closes a sheet and pushes a route in the same tick. The navigator freezes the screen being left, so its "close the sheet" update does not commit, and on the web the sheet's focus trap then steals focus on the screen that was pushed. A screen that must navigate after a sheet asks `useNavigateAfterClose` to do it, which pushes only once the sheet is closed and its exit animation has finished.

## 10. Observability

The logger keeps a bounded in-memory ring buffer, redacts sensitive keys before writing, and has no remote sink. Analytics events are allow-listed by name and carry no record content; the sink is a no-op until an environment configures one. Nothing about a person's session, tokens or credentials is ever an event or a log line.

## 11. Environment limitations and native verification

This work was built and verified on a Windows machine without Java, the Android SDK, Android Studio, macOS or Xcode. On this machine the app can be type-checked, linted, unit-tested, rendered under Jest, and run as a web build in a browser. It cannot be built or run as an Android or iOS binary here.

| Platform | Status | What it means |
|---|---|---|
| Android phone and tablet | **NOT YET VERIFIED LOCALLY** | The app is designed and configured for Android; no Android build has been produced or run on this machine. This is a verification gap, not a statement that Android is unsupported. |
| iPhone and iPad | **DEVICE/MAC VERIFICATION REQUIRED** | An iOS build needs a Mac with Xcode; none is available here. |
| Web target (development only) | verified in the browser pane and by Playwright | Proves screens, navigation, forms, the request layer and the session contract against the live API. Proves nothing native. |

Web-target tests do not certify any of the following. Each item stays on the list until it has been exercised on a real device or emulator and the result recorded.

**MOBILE_NATIVE_VERIFICATION_PENDING**

1. Secure storage of the refresh token in the iOS Keychain and the Android Keystore-backed store, including survival across app restarts and removal on uninstall.
2. Biometric unlock (Face ID, Touch ID, Android biometrics) and the locked state on cold start.
3. Camera capture and photo attachment, including EXIF and orientation.
4. Barcode and QR scanning.
5. Push notification registration and delivery (also blocked on the server: the API registers Web Push subscriptions only; there is no Expo, FCM or APNs registration endpoint yet).
6. Background sync and the offline queue under real connectivity changes, backgrounding and process death.
7. Native file handling: PDF rendering of drawing sheets, sharing, and downloads through presigned URLs.
8. App-scheme and universal deep links (`octapm://`, `app.octapm.com`, `octapm.com`) from cold and warm starts.
9. Offline behaviour on a device (airplane mode, captive portals), including the fail-fast path.
10. Rotation, split view and multitasking on tablets; keyboard avoidance on phones.
11. Performance on low-end Android devices and long lists.
12. Store-build configuration (icons, splash, permissions strings) as rendered by the platforms.

## 12. Security rules that hold everywhere

- The web cookie flow is not weakened or replaced, and the web refresh token is never exposed to browser JavaScript.
- A client-provided flag never bypasses a security check; the client header only selects a delivery channel.
- The access token lives in memory; the refresh token lives in the platform secure store; neither is written to AsyncStorage, SQLite, a JSON file, a persisted store, the query cache or a log, and neither is printed.
- Refresh is single-flight, retried once, and a refused refresh ends the session, clears state and cache, locks offline data and returns to sign-in.
- Logout revokes the session family on the server.
- Authorization is decided by the server on every request.
- No secrets, certificates, tokens, logs or local databases are committed.

## 13. M0 verification record (2026-09-18)

| Check | Result |
|---|---|
| Backend auth and request-id suites (routes, services, middleware) | 41 passed |
| Backend OpenAPI, utility and middleware suites | 121 passed |
| Backend config suites (CORS, rate limits, permissions) | 64 passed |
| Browser cookie flow suite | unchanged, passing |
| Mobile TypeScript (`tsc --noEmit` over the generated types) | 0 errors |
| Mobile ESLint | 0 errors, 0 warnings |
| Mobile Jest | 56 passed in 10 suites |
| Expo web target boots to sign-in | yes, port 8081 |
| Live sign-in through the app against the local API | yes: `POST /auth/login` 200 with the mobile header; Home rendered |
| Live resume on reload | yes: `POST /auth/refresh` 200 (rotated), `GET /auth/me` 200 |
| Live sign-out | yes: `POST /auth/logout` 200; refresh token and profile cleared; back at sign-in with the email remembered |
| Replay refused and family revoked; channel mismatch refused | proven against the API directly before the app existed; the service and route suites carry the proof |
| Tokens in logs or persisted stores | none: no token near a log call, and no AsyncStorage, SQLite, persisted zustand or persisted query cache anywhere in `mobile/` |

Not verified here: everything on MOBILE_NATIVE_VERIFICATION_PENDING (section 11). Two notes on the web-target run: pointer and key input through the browser pane did not activate react-native-web buttons, so the sign-out press was dispatched as a DOM click on the app's own button element; Playwright specs from M1 onwards carry this proof durably. The web target's secure store is browser session storage, as section 5.3 says.

## 14. M1 verification record (2026-09-18)

| Check | Result |
|---|---|
| Mobile TypeScript and ESLint | 0 errors, 0 warnings |
| Mobile Jest | 92 passed in 18 suites (request layer, session, offline start, permissions hook, quick actions, links, and rendered Home, Projects, Needs You, Search, Notifications, sign-in, More and shell) |
| Playwright against the production web export and the local API | 16 passed: 8 checks on a phone viewport (390×844) and the same 8 on a tablet viewport (1024×768) |
| Playwright checks | sign-in through the native contract (mobile header, refresh token in the body, no cookie); Home cards with live permissions, assignments, health and notifications; project switch (strip changes, the new project's assignments are requested); Needs You counts and filters; Search request carries the bearer and widens scope; Notifications inbox, filters and preferences; refused refresh ends the session with the reason and clears storage; sign-out revokes on the server and clears storage |

## 15. M2 verification record (2026-09-18)

| Check | Result |
|---|---|
| Mobile TypeScript and ESLint | 0 errors, 0 warnings (typed routes now regenerated by the generate step, so a new screen cannot fail the typecheck because of a stale declaration) |
| Mobile Jest | 121 passed in 26 suites (adds RFI list, record and form; tasks; documents; drawings; picker; prompt sheet; in-app link resolution) |
| Playwright against the production web export and the local API | 28 passed: 14 checks on the phone viewport and the same 14 on the tablet viewport |
| RFI lifecycle, live | raised from the quick action (201, status open), answered through the response thread with the official flag (201; record moves to answered), approved by the project manager through the approve route (200; record closed; history shows the change). No status was ever edited directly. |
| Tasks, live | a task raised through the API for the same person appears under "All I can see" and takes a comment (201) |
| Where writes went | the dedicated end-to-end organisation only; the demo and certified projects were not written to |

Native items added to the verification list by M2: the camera and library photo upload on a record, sharing a downloaded file through the system sheet, iOS PDF rendering in the web view, and Android PDF rendering (a bundled pdf.js viewer is planned; until then Android hands the file to the system viewer).

## 16. M3 verification record (2026-09-18)

| Check | Result |
|---|---|
| Mobile TypeScript and ESLint | 0 errors, 0 warnings |
| Mobile Jest | 138 passed in 29 suites (adds the daily log, activities and the progress sheet, the lookahead board, photos and timesheets) |
| Playwright against the production web export and the local API | 34 passed: 17 checks on the phone viewport and the same 17 on the tablet viewport |
| Daily log, live | a manpower entry posted to today's log with a client-generated replay key (201) and reflected in the section and the totals |
| Progress, live | an activity raised for the run through the API, found in the list, and a progress draft submitted from the sheet with `source: 'mobile'`; the approved figure was not touched |
| Timesheets, live | a worker ensured through the API, a sheet started for them from the form with a replay key |
| Where writes went | the dedicated end-to-end organisation only |

Native items added to the verification list by M3: the camera on the photos screen, the image library picker, authenticated image loading through the native image loader's headers, and the daily log under real connectivity changes.

How the end-to-end run is made: `npm run export:web` produces the production web build and `npm run serve:web` serves it on port 8081; `npm run e2e` runs the checks. The Metro development bundle is not used for this: it is large and unminified, and on this machine a fresh browser context per test spent most of its budget parsing it and then froze under tracing. Two defects the run found and fixed before the record was taken: the search scope was decided before the remembered project had loaded on a cold start, so it searched every project; and selected chips and rows exposed no `aria-selected` on the web. A locator rule learned the same way: the tab navigator keeps inactive screens mounted, so every web check scopes its queries to the visible screen's test id.

## 17. M4 verification record (2026-09-18)

| Check | Result |
|---|---|
| Mobile TypeScript and ESLint | 0 errors, 0 warnings |
| Mobile Jest | 169 passed in 33 suites (adds the quality home, inspections and the checklist, punch items, NCR and safety closeouts and decisions, material tests). One Home check, "asks which project when there are several", timed out twice while the browser run was still winding down on this machine and passed in the clean full run and in three solo runs after it; it waits on rendered text within the five-second budget and is sensitive to load, not to order |
| Playwright against the production web export and the local API | 42 passed: 21 checks on the phone viewport and the same 21 on the tablet viewport |
| Inspections, live | a project template ensured through the API, an instance created from it with a replay key (201), two answers saved in one request (200), completed through the complete route with outcome pass |
| Punch, live | an item raised open with a replay key and high priority (201), moved to ready for review and then closed on the transition route (200, 200); no status patch anywhere |
| NCR, live | raised open (201); the closeout submitted with a comment and a photo that went through the workflow upload route first (201) and arrived as an attachment reference on the submit (200); approved through the approve route (200) to closed |
| Material tests, live | scheduled as pending (201); the result recorded with the actual value and the laboratory through a patch of the test (200) |
| Where writes went | the dedicated end-to-end organisation only |

Native items added to the verification list by M4: the camera and picker on the punch form and the closeout sheet, and the file picker behind evidence on the web target.

A defect the run found and fixed before the record was taken: closing a sheet and pushing a route in the same tick leaves the previous screen frozen by the navigator with its sheet still mounted; on the web the sheet's focus trap then steals focus on the pushed screen and inputs lose every keystroke. `useNavigateAfterClose` now defers the push until the sheet is closed and its exit animation has finished, and the rule in §9 applies to every sheet that navigates.

## 18. M5 verification record (2026-09-18)

| Check | Result |
|---|---|
| Mobile TypeScript and ESLint | 0 errors, 0 warnings |
| Mobile Jest | 192 passed in 37 suites (adds the inventory home and scan, items and the movement sheet with its offline refusal and lost-reply rule, goods in with the receipt replay rule and the over-receipt guard, transfers and the ledger) |
| Playwright against the production web export and the local API | 48 passed: 24 checks on the phone viewport and the same 24 on the tablet viewport |
| Scan and issue, live | a typed SKU resolved through the scan route; one bag issued to an activity from a stocked warehouse through the issue route (201), sent once |
| Goods receipt, live | an order raised for the run through the procurement routes (draft, submit, approve, issue), its line received as 8 accepted and 2 rejected with the device's receipt number (201); the same body sent again was refused by the server as `RECEIPT_ALREADY_POSTED` (409), the answer the app shows as done |
| Transfers, live | a draft with one line created (201), dispatched (200), received as 1 good and 1 damaged (200); the ledger then showed the transfer out |
| Where writes went | the dedicated end-to-end organisation only |

Native items added to the verification list by M5: the camera barcode scanner (the web target types the code instead).

A defect the run found and fixed before the record was taken: the ledger filtered by project by default, and since inventory is organisation-level most movements carry no project, so transfers never appeared; the ledger now filters by warehouse, type or item only.

## 19. M6 verification record (2026-09-18)

| Check | Result |
|---|---|
| Mobile TypeScript and ESLint | 0 errors, 0 warnings |
| Mobile Jest | 215 passed in 41 suites (adds the commercial home, change events, change orders, commitments, pay applications with the party submit and the over-claim refusal, the approvals inbox and instance, procurement with alert acknowledgement, the register and long lead; and the absence of every approve, certify and pay action) |
| Playwright against the production web export and the local API | 56 passed: 28 checks on the phone viewport and the same 28 on the tablet viewport |
| Approvals, live | a change-order template ensured on the end-to-end project; a change order raised with an affected activity and a supporting document through the workflow upload route, submitted (200); its approval step found in the inbox, answered "Approve" from the phone through the respond route (200, body `{ response: "approve" }`); the order then read back approved from the register, with no approve route called by the app |
| Change events, live | raised from the field form as a site condition with a rough order of magnitude and days (201), opened, the web hand-over offered |
| Procurement, live | the overview loaded; no open lead-time alert existed on the end-to-end project, so the acknowledge step ran in the rendered tests only (recorded as a note on the check); the register opened an issued order and handed the delivery to inventory |
| Where writes went | the dedicated end-to-end organisation only |

Native items added to the verification list by M6: none; every screen is read-and-respond.

Two defects the run found and fixed before the record was taken: the change-order register answers `{ orders, summary }` where every other list answers `{ items }`, so the app's list was empty against the live server until the endpoint learned the shape and the rendered test's fake was corrected to match; and the approval workflow starts after the submit has replied, so an inbox read at once sees nothing (the app's inbox refetches on focus; the browser check polls). A rendered-test race was also fixed: the Home test read the project strip's placeholder as proof of the chooser and then asserted the rows synchronously, which failed under load; it now waits for a row.

## 20. M7 verification record (2026-09-18)

| Check | Result |
|---|---|
| Mobile TypeScript and ESLint | 0 errors, 0 warnings |
| Mobile Jest | 239 passed in 46 suites (adds the outbox state machine against a scripted server — order, dependants, back-off, attention, refused, lock and adopt, discard, hydrate — the persisted cache, capture-or-queue, the offline screens and the kept-sheet supersession rule) |
| Playwright against the production web export and the local API | 60 passed: 30 checks on the phone viewport and the same 30 on the tablet viewport |
| Offline capture, live | with the browser taken offline by Playwright, a punch item raised from the form went to the outbox as Waiting with the bar reading "Offline · 1 item waiting to send"; when the connection returned it was posted once (201) with the replay key it was captured with, turned Sent, and appeared once in the register |
| Refusal handling, live | a daily-log manpower entry captured offline without a trade was refused by the server on send (400 "trade is required"); the item turned Attention with that reason and the bar turned red, as the policy requires; the check now fills the trade and sees the entry sent (201) |
| Where writes went | the dedicated end-to-end organisation only |

Native items added to the verification list by M7: the SQLite store and the documents directory on a device (the web target uses local storage and keeps no files), the copy of picked photos into the app's documents for a queued upload, background drain while the app is closed, and the kept-sheet PDF opened from the device without a signal.

Two things the run taught: Playwright's offline switch did not always raise the browser's offline event on the phone viewport, so the web listener now also polls the connectivity flag every two seconds; and a rendered-test gate started while edits were still landing reported a stale failure, so the gate is now started only once every edit is on disk.

## 21. M8 verification record (2026-09-18)

| Check | Result |
|---|---|
| Mobile TypeScript and ESLint | 0 errors, 0 warnings |
| Mobile Jest | 254 passed in 50 suites (adds the split by route group, the timeline scale and rows, the signature pad's helpers, tablet progress approval and rejection with the hold-point warning, and the signature item's pad) |
| Playwright against the production web export and the local API | 67 passed: 33 checks on the phone viewport and 34 on the tablet viewport (the wide-screen checks assert their absence on the phone; the approval check runs on the tablet only and is skipped on the phone) |
| Master–detail, live | on the tablet viewport the RFI list stayed on the left while the opened record filled the right pane; on the phone viewport the record took the screen and the list left it |
| Signatures, live | a checklist raised for the run from a template with a signature item; the pad opened from the item, a stroke drawn with the mouse, the result posted as a PNG data URL with the signer's name and the item id (201), the item then shown as signed |
| Timeline, live | offered on the wide screen only, drawn with a row per activity |
| Progress approval, live | an activity raised for the run with the person as engineer, a 10% update submitted through the API as from mobile, approved from the tablet through the approve route (200), the activity's approved figure then read back as 10 |
| Where writes went | the dedicated end-to-end organisation only |
| Backend defect found by the live signature check | the form service stores a signature as an attachment under the role `signature`, which the attachment service refused with 400, so no client could sign; the role is now accepted and listed in the OpenAPI enum, and the attachment and form suites fail without it (proved by reverting the one line) |

Native items added to the verification list by M8: the view capture behind the signature pad (the web target draws the PNG on a canvas), iPad split view and rotation as real window changes, and stylus input on the pad.

The rule the split rests on: a screen never knows it is on a tablet by device; it asks which side of the split it is drawn on. A list drawn by the stack while its list is already on the left shows the placeholder, so the same file serves the phone, the left pane and the right pane.

## 22. Cross-device integration (M9)

**Links.** Every way a link reaches the app ends in one resolver (`src/navigation/deepLinks.ts`): the `octapm://` scheme, an `https://app.octapm.com/...` universal link, the web platform's own record paths (the same ones the server puts in a notification's `actionUrl`), a push notification's data, and the app's own routes. The result is an app route and, when the link names one, the project it belongs to. On a device `app/+native-intent.ts` hands every incoming link to the resolver; a link naming another project goes through the opener screen (`/open`), which switches the project (dropping the previous project's cached records, as the Projects screen does) and then replaces itself with the record, so back lands on the record's own list. A link the app has no screen for lands on Home rather than a broken screen. The web target has no intent hook, so it opens links through the same opener with `?link=`.

**Push.** The app asks for permission once, obtains its Expo push token and registers it on sign-in through the push subscription route as provider `expo`; sign-out removes it while the session can still be presented. The token is kept on the device only for that removal; it is not a session credential and the rule in section 5.3 is unchanged. A tap on a notification, including one that launched the app, opens the record through the resolver. The web target and simulators have no token and do nothing. On the server the same table serves browsers and devices: an Expo token is the `endpoint`, the key columns stay empty and `platform` is `expo-ios` or `expo-android`; the push service sends native rows in one batch per user through Expo's push API, drops tokens Expo reports unregistered, keeps them when Expo itself is unreachable, and needs no VAPID keys for people with a native device. Delivery on a device is on the native verification list.

**Realtime.** A socket.io client presents the session's access token in its handshake, joins the current project's room (the server applies the same project access check as the REST layer) and listens for `domain.event`. The app never writes an event's payload into its cache: it marks the project's queries stale, coalesced over 400 ms, and the screens that are open refetch, so what is shown always comes from the API. The socket follows the session: it connects on sign-in, carries a fresh token after every refresh, rejoins the room on a project switch, reconnects when the app comes to the front and disconnects on sign-out. Nothing depends on it for correctness; without a socket the screens still refetch on focus and on pull.

**Photo markup.** The signature pad's stroke capture (`src/components/strokes.tsx`, the platform's responder system, so a finger, a stylus and a mouse all draw) is shared with a markup sheet over a photo fitted inside the view. The strokes are mapped back onto the photo's own pixels and burnt into a JPEG copy (canvas on the web target, view capture on a device) that replaces the original in the upload; the maths is pure and tested.

**Hardening.** Every record list carries the same rendering budget (`listPerformance`: a screenful first, windowed from there, clipped rows dropped natively) and the row component is memoised. The accessibility sweep gives every screen a heading and every control a name; a test walks Home and Notifications and fails on an unnamed button.

## 23. M9 verification record (2026-09-18)

| Check | Result |
|---|---|
| Mobile TypeScript and ESLint | 0 errors, 0 warnings |
| Mobile Jest | 275 passed in 55 suites (adds the deep-link resolver, native push, the realtime client, the markup maths and the accessibility sweep) |
| Backend Jest | push service, notification service and the notifications, forms and attachment suites green; the Expo provider proved by register, validate, batch send, drop-unregistered and Expo-down cases |
| Playwright against the production web export and the local API | 75 passed on the phone and tablet viewports, 1 skipped by design (the tablet-only approval check on the phone); 4 new M9 checks on each viewport |
| Deep link, live | an RFI raised for the run; the web platform's record path opened the record through the opener, the app's own route with the project named did the same, and a link naming no screen landed on Home |
| Realtime, live | with the RFI list open, an RFI raised through the API appeared in the list without a reload, through the socket's event and the screen's own refetch |
| Push, live | signing in on the web target made no push registration request |
| Photo markup, live | a photo chosen on the photos screen, marked up in yellow on the markup sheet, uploaded as the marked copy with a caption; the daily log's attachments then listed a `-marked.jpg` file under that caption |
| Where writes went | the dedicated end-to-end organisation only |

Native items added to the verification list by M9: push permission, token and delivery on a device; a universal link and an `octapm://` link opening the installed app; the markup view capture; background sync while the app is closed.
