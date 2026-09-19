# OctaPM Mobile — Native Notification and Deep Link Report

**Audience:** the pilot lead, and whoever runs the first build.
**Date:** 2026-09-18. **Branch:** `feat/p0-foundations-sprint1`.
**Evidence tag:** NOT TESTED on a device.

**This report claims no native push pass.** §21 of the brief is explicit and it is worth repeating here because it is the single easiest thing to get wrong in a certification document: a browser notification test proves nothing about APNs or FCM. None was used as evidence, and the web target makes no native registration at all.

## 1. What is built, and what is proven about it

| Piece | Where | Evidence | Tag |
|---|---|---|---|
| Push registration: permission asked, token obtained, device registered with the server, and the four refusal paths (denied, unsupported, failed, removed) | `mobile/src/notifications/push.ts` | unit suite covering every path | UNIT |
| The server's sender: batched Expo push, `DeviceNotRegistered` devices dropped, a failing Expo retried | `backend/src/services/push.service.js` | backend suite | UNIT |
| The device is registered on **both** the password sign-in and the biometric-resume path (the CERT-02 fix) | `mobile/src/auth/session.ts` | session suite, live offline specs | WEB-LOGIC-VERIFIED |
| A notification tap resolves to the right screen, including from a cold start | `push.ts` → `deepLinks.ts` → `/open` | unit suite (tap routing incl. cold start) | UNIT |
| Every record type the platform links to opens on its screen, driven by the web platform's own path | `m9.spec.ts`, `cert-links.spec.ts` | Playwright against the live API | WEB-LOGIC-VERIFIED |
| A link naming a project the person is not on does not switch them to it (the CERT-09 fix) | `cert-security.spec.ts`, `cert-links.spec.ts` | Playwright | WEB-LOGIC-VERIFIED |
| A browser makes **no** native push registration | `m9.spec.ts` asserts this explicitly | WEB-LOGIC-VERIFIED |

The routing — which is where deep-link bugs actually live — is therefore well covered. The transport is not covered at all.

## 2. The native configuration

**Android** (read from the generated project; see the [Android report](OCTAPM_ANDROID_NATIVE_REPORT.md)):

- `POST_NOTIFICATIONS` is contributed by `expo-notifications`' library manifest and merges in, so the Android 13+ runtime prompt will be available. This was verified rather than assumed.
- Firebase and expo-notifications default notification icon and colour resources are present in the manifest.
- Deep links: the `octapm://` scheme and `autoVerify="true"` app-link filters for `app.octapm.com` and `octapm.com`.

**iOS** (read from `app.json`; the project cannot be generated on Windows):

- `associatedDomains: applinks:app.octapm.com, applinks:octapm.com`.

## 3. What must exist before either platform can deliver a notification

Neither is an app change, and neither exists yet.

| Platform | Prerequisite |
|---|---|
| Android | A Firebase project and its `google-services.json`, wired into the build. Expo's push service sits in front of FCM, but FCM credentials are still required |
| iOS | **A paid Apple Developer Program membership.** Push notifications and associated domains are both paid-tier capabilities, plus an APNs key or certificate registered with Expo or with your own sender |
| Both, for links | `assetlinks.json` (Android) and `apple-app-site-association` (iOS) hosted under `/.well-known/` on `app.octapm.com` and `octapm.com`, carrying the app id and the **release signing fingerprint**. Until then a tapped https link opens the browser; the custom scheme still works |

No Apple credential, signing key, certificate or provisioning profile was created or committed in this phase.

## 4. What is NOT TESTED

| Question | Status |
|---|---|
| Does the Android 13+ runtime permission prompt appear, and is the token registered afterwards? | NOT TESTED |
| Does a real FCM notification arrive on a locked Android handset? | NOT TESTED |
| Does a real APNs notification arrive on a locked iPhone? | NOT TESTED |
| Does tapping a delivered notification open the right record — app in the foreground, in the background, and **cold**? | NOT TESTED |
| Does a universal link tapped in Mail or Messages open the app rather than Safari? | NOT TESTED |
| Does an Android app link tapped in Gmail or Chrome open the app? | NOT TESTED |
| Does a link opened while signed out return to the record after signing in? | Known open issue PILOT-15: on the web target it does **not** — the person lands on Home. This was measured, not read from the code, and it will be worse on a device where a notification tap is the normal way in | NOT TESTED natively; FAILING on the web target |

PILOT-15 deserves the pilot lead's attention: if crews are told "tap the notification", the first tap of the day — when the session is locked — drops them on Home.

## 5. The device procedure, exactly

1. Install the build. Sign in. Accept the notification prompt. Confirm the device appears under `GET /notifications/push/subscriptions` with provider `expo`.
2. From the web platform, assign that person an RFI. Confirm the notification arrives with the handset **locked**.
3. Tap it with the app in the foreground. Then background the app and repeat. Then force-stop the app and repeat — the cold case is the one that breaks.
4. Repeat 2–3 for an NCR assignment, a workflow step assignment and a task assignment.
5. Decline the permission on a second handset. Confirm the app still works and says nothing alarming.
6. Sign out. Confirm the device registration is removed and no further notification arrives.
7. With `assetlinks.json` / `apple-app-site-association` hosted, send yourself a record link by email. Tap it: signed in, then signed out, then biometric-locked. The third and second cases are PILOT-15.
8. Android only: `adb shell am start -a android.intent.action.VIEW -d "octapm://rfi/<id>"` and the https equivalent.

## 6. Verdict

**Native push and deep links: NOT TESTED.** The routing is well proven on the web target and in unit tests, the configuration is right on both platforms, and the server's sender is tested. Delivery has never happened on a real device, the credentials that would make it possible do not exist yet, and no part of this report may be read as a push pass.
