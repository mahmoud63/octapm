# OctaPM Mobile — Native Capability Register

**Audience:** whoever produces the first Android and iOS builds and runs them on devices, and the reviewer who signs off the field pilot.
**Status:** as of 2026-09-18, on a Windows 11 host with no JDK, no Android SDK, no adb, no emulator, no Android Studio, no EAS CLI and no macOS. The [certification report](OCTAPM_MOBILE_CERTIFICATION_REPORT.md) explains what the web target proves; this register says, capability by capability, what has and has not been proven on a device. Nothing here is inferred: every status has its evidence.

**Statuses.** IMPLEMENTED — the code exists and is unit-tested with native stand-ins. WEB-LOGIC-VERIFIED — the logic around the capability (the requests, the states, the routing) is proven on the web target by Playwright against the local API. NATIVE-VERIFIED — proven on a device or simulator (none yet). DEVICE-VERIFICATION-REQUIRED — needs a build in a hand. BLOCKED — cannot be verified in this environment for a stated reason. The environment lines the brief requires: **ANDROID NATIVE BUILD TOOLCHAIN NOT INSTALLED ON THIS MACHINE**; **IOS NATIVE LOCAL BUILD REQUIRES MACOS OR A SUPPORTED REMOTE BUILD SERVICE**.

| Capability | Status | Where it lives | Evidence so far | Device check |
|---|---|---|---|---|
| SecureStore (refresh token at rest) | IMPLEMENTED · DEVICE-VERIFICATION-REQUIRED | `mobile/src/auth/secure-storage.ts` (expo-secure-store; the web target uses sessionStorage, dev only) | Unit: session tests (memory vs keychain, refused refresh clears keychain); `cert-auth`: no token-shaped value remains in browser storage after sign-out | Sign in, kill the app, reopen: the session resumes; sign out: `RefreshSession` row revoked and nothing in the keychain (iOS Keychain dump / Android Keystore-backed entry) |
| Keychain (iOS) | DEVICE-VERIFICATION-REQUIRED | same | none native | as above on an iPhone |
| Android Keystore | DEVICE-VERIFICATION-REQUIRED | same | none native | as above on an Android phone |
| Camera (photo capture) | IMPLEMENTED · WEB-LOGIC-VERIFIED | `expo-image-picker` in photos, punch, closeout, attachments | m3, m4, m9, `cert-finance`: the chosen file's upload, caption, markup and daily-log placement; the web target uses the file chooser | Take a photo onto the daily log and a punch item; EXIF (taken-at, camera) stored by the server |
| Photo library | IMPLEMENTED · WEB-LOGIC-VERIFIED | same | same | Choose from the library; multiple selection on the photos screen |
| Barcode / QR scanner | IMPLEMENTED · WEB-LOGIC-VERIFIED (typed code) | `mobile/app/(app)/inventory/scan.tsx` (expo-camera) | m5: a typed code resolves to the item; the camera view is a unit stand-in | Scan a printed item code, a warehouse/bin label and a PO label; drawing QR only if the pilot project prints them |
| Push registration | IMPLEMENTED · WEB-LOGIC-VERIFIED | `mobile/src/notifications/push.ts`; server `push.service.js` Expo provider | Unit: registered/denied/unsupported/failed/removed; backend: Expo provider suite; m9: a browser makes no native registration | Grant permission; the token appears under `GET /notifications/push/subscriptions` with provider expo |
| Push delivery | IMPLEMENTED (server) · DEVICE-VERIFICATION-REQUIRED | `backend/src/services/push.service.js` (Expo push API batch) | Backend unit: batch send, DeviceNotRegistered dropped, Expo down retried | Assign the person an RFI from the web; the notification arrives; tap opens the RFI |
| Notification deep link (tap) | IMPLEMENTED · WEB-LOGIC-VERIFIED (resolver) | `push.ts` → `deepLinks.ts` → `/open` | Unit: tap routing incl. cold start; m9 and `cert-links`: every record type from the web platform's path | Tap a delivered notification on both platforms, warm and cold |
| Face ID | IMPLEMENTED · DEVICE-VERIFICATION-REQUIRED | `mobile/src/auth/biometric.ts` (expo-local-authentication) | Unit: biometric wait, lock/unlock; the web target has no biometrics | Turn on Unlock with biometrics in More; background past the lock window; Face ID prompt unlocks |
| Touch ID | DEVICE-VERIFICATION-REQUIRED | same | none native | as above on a Touch ID device |
| Android biometrics | DEVICE-VERIFICATION-REQUIRED | same | none native | as above with fingerprint / face unlock |
| Native file picker | IMPLEMENTED · WEB-LOGIC-VERIFIED | image picker for photos; documents open through the platform viewer | m2: a file opens through the system with the bearer | Pick from Files/Drive on iOS and Android for a closeout evidence upload |
| PDF viewer (drawings) | IMPLEMENTED · WEB-LOGIC-VERIFIED (fixtures) | `mobile/src/components/PdfPage.tsx` | Unit: fitted page, superseded warning, kept sheet; the local seed has no published set (register proven on the live empty state) | Open a sheet from a published set; zoom and pan; superseded warning on an older revision; Android renderer specifically |
| SQLite (outbox, kept files, read cache) | IMPLEMENTED · WEB-LOGIC-VERIFIED (localStorage on web) | `mobile/src/offline/storage.ts` | Unit: the key-value store on the sqlite stand-in; m7: queue and drain on the web target | Queue offline, kill the app, reopen: the queue is intact and sends |
| Offline restart persistence | IMPLEMENTED · DEVICE-VERIFICATION-REQUIRED | same + `persist.ts` | Unit: restore/persist under budget | as above; the last-seen lists open in airplane mode after a restart |
| Background upload | NOT IMPLEMENTED (by design) | — | The outbox drains when the app is open or comes to the front (`offline/index.ts`) | Confirm the pilot accepts foreground-only sending |
| Background sync | NOT IMPLEMENTED (by design) | — | as above | as above |
| Android deep links (intent filters) | IMPLEMENTED · DEVICE-VERIFICATION-REQUIRED | `mobile/app.json` intentFilters for app.octapm.com and octapm.com, `+native-intent.ts` | Unit: the resolver; `cert-links` on the web target | `adb shell am start -a android.intent.action.VIEW -d "https://app.octapm.com/projects/<id>/rfi?recordId=<id>&source=rfi"` opens the record; also `octapm://rfi/<id>`; assetlinks.json must be hosted |
| iOS Universal Links | IMPLEMENTED · DEVICE-VERIFICATION-REQUIRED | `app.json` associatedDomains applinks | as above | Tap a link from Notes; apple-app-site-association must be hosted at `/.well-known/` |
| Orientation | IMPLEMENTED · WEB-LOGIC-VERIFIED (viewport changes) | `useLayout` width classes; `SplitGroup` | `cert-responsive`: portrait and landscape sizes for tablets and iPad | Rotate a phone and a tablet with a record open |
| iPad split view (multitasking) | DEVICE-VERIFICATION-REQUIRED | `app.json` supportsTablet | none native | Slide Over and Split View sizes; the width class follows the window |
| Android tablet resize | DEVICE-VERIFICATION-REQUIRED | same | none native | Freeform / split-screen resize |
| Real-device performance | DEVICE-VERIFICATION-REQUIRED | `listPerformance` budget on every list | `cert-performance`: web-target timings only | One low-end Android on the activities, ledger and photo registers; scroll at 60 fps, cold start time |
| Native session channel | IMPLEMENTED · WEB-LOGIC-VERIFIED | `X-OctaPM-Client: mobile`, `cli` claim | Backend suites; m1 live | Refresh from the app on a device rotates the session row |

## What the web target certifies and what it does not

Expo web runs the same TypeScript, screens, request layer, permission matrix, offline queue and link resolver as the native app, so it proves the app's logic against the real API. It does **not** certify: SecureStore, Keychain or Keystore; the camera; the barcode and QR scanner; biometrics; native push registration and delivery; background sync; the native file picker; the native document viewer; native deep linking (intent filters and universal links); native orientation handling; SQLite persistence; or real-device memory and performance. Every row above marked DEVICE-VERIFICATION-REQUIRED is one of these.

## How to turn a row NATIVE-VERIFIED

Follow the [Android guide](OCTAPM_ANDROID_VERIFICATION_GUIDE.md) or the [iOS guide](OCTAPM_IOS_VERIFICATION_GUIDE.md), run the device check in the last column, and record the build id, device model, OS version, date and outcome in the [certification report](OCTAPM_MOBILE_CERTIFICATION_REPORT.md) appendix. A row changes status only with that evidence.
