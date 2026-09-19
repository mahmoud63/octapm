# OctaPM Mobile — iOS Native Report

**Audience:** whoever produces the first iOS build, and the reviewer deciding whether the field pilot may start.
**Date:** 2026-09-18. **Branch:** `feat/p0-foundations-sprint1`.
**Evidence tag for everything below:** NOT TESTED (no simulator, no device) with configuration read from `app.json`. There is no REAL DEVICE, SIMULATOR or REMOTE BUILD result in this report.

## 1. Environment, stated plainly

**IOS NATIVE LOCAL BUILD REQUIRES MACOS OR AN APPROVED REMOTE BUILD SERVICE.**

The host is Windows 11 Enterprise 10.0.26100. There is no macOS, no Xcode, no Simulator, and no iOS device. This is not a defect in the application.

It is worth recording precisely how far Windows gets, because it is further than nothing and less than people assume: Expo will not even **generate** the iOS project here. Running the generator returns, verbatim:

```
> npx expo prebuild --platform ios --no-install
⚠️  Skipping generating the iOS native project files. Run npx expo prebuild again from macOS or Linux to generate the iOS project.
CommandError: At least one platform must be enabled when syncing
```

So unlike Android — where the full Gradle project was generated and read (see the [Android report](OCTAPM_ANDROID_NATIVE_REPORT.md)) — there is no generated `Info.plist` or entitlements file to inspect on this machine. What follows is read from `app.json`, which is the input those files are generated from.

## 2. The iOS configuration that will be generated

From `mobile/app.json`:

| Setting | Value |
|---|---|
| Bundle identifier | `com.octapm.app` |
| Tablet support | `supportsTablet: true`, `requireFullScreen: false` — see the [iPad report](OCTAPM_IPAD_NATIVE_REPORT.md) |
| Orientation | `default` (the device decides) |
| Interface style | `automatic` (light and dark follow the system) |
| Associated domains | `applinks:app.octapm.com`, `applinks:octapm.com` |
| Encryption declaration | `ITSAppUsesNonExemptEncryption: false` |
| New architecture | enabled (`newArchEnabled: true`) |

Every permission string a reviewer will read is written and specific to what the app does with it, which is what Apple's review actually rejects apps over:

| Key | String |
|---|---|
| `NSCameraUsageDescription` | "OctaPM uses the camera to take site photos, scan barcodes and QR codes, and capture delivery notes." |
| `NSPhotoLibraryUsageDescription` | "OctaPM attaches photos from your library to site records such as RFIs, inspections and daily logs." |
| `NSFaceIDUsageDescription` | "OctaPM can unlock your signed-in session with Face ID." |
| `NSLocationWhenInUseUsageDescription` | "OctaPM can tag a site photo with where it was taken, only when you choose to." |

No microphone string is declared, and none should be: the corresponding Android permission was removed in this phase for the same reason (NATIVE-01 in the Android report). If a future build adds `expo-image-picker` without `microphonePermission: false`, iOS will start asking for `NSMicrophoneUsageDescription` too.

## 3. What a human must provide, and what must never be committed

Nothing in this list can be produced by this session, and §29 of the brief is explicit about where to stop.

| Needed | For |
|---|---|
| An Apple Developer Program membership (paid) | Both **push notifications** and **associated domains** are paid-tier capabilities. Without it, neither universal links nor native push can be enabled on iOS at all |
| A signing certificate and provisioning profile, or EAS-managed credentials | Any build that runs on a device |
| An App ID with the Push Notifications and Associated Domains capabilities | As above |
| `https://app.octapm.com/.well-known/apple-app-site-association` and the same on `octapm.com` | Universal links to open the app instead of Safari. A hosting task on the web platform, served as `application/json` with no redirect |

**Not created, not committed, and not to be committed:** distribution certificates, provisioning profiles, Apple credentials, signing passwords, `.p8` push keys. None exists in this repository and none was generated. This phase stops at that boundary deliberately.

## 4. Two routes to a first build

Neither was run; both are stated so the next person does not have to work them out.

**A Mac.** Requires Xcode 26.4 or later on macOS Tahoe 26.2 or later for the Expo SDK 57 / React Native 0.86 toolchain. Then, from `mobile/`:

```bash
npm install
npx expo prebuild --platform ios      # generates ios/ with the Info.plist and entitlements from §2
npx expo run:ios                      # Simulator
# or open ios/OctaPM.xcworkspace in Xcode, pick a team, and run on a connected device
```

**EAS Build, which works from Windows.** The cloud builder supplies macOS; `eas build --local` does not and cannot run here.

```bash
npm i -g eas-cli && eas login
eas build:configure                   # creates eas.json and writes the EAS projectId into app.json
eas build --platform ios --profile development   # asks for Apple credentials interactively, stores them with EAS
```

Two prerequisites are genuinely absent from the repository and are not defects, only unfinished setup: **`expo-dev-client` is not a dependency** and **there is no `eas.json`, and `extra.eas` in `app.json` is an empty object** (no `projectId`). The longer walkthrough is in the [iOS verification guide](OCTAPM_IOS_VERIFICATION_GUIDE.md).

## 5. Everything iOS-specific is NOT TESTED

| Capability | Status |
|---|---|
| Camera, photo library, barcode and QR scanning | NOT TESTED |
| Keychain round trip; refresh token cleared on sign-out | NOT TESTED |
| Face ID and Touch ID unlock | NOT TESTED |
| APNs registration, delivery, and a cold-start notification tap | NOT TESTED — see the [notification report](OCTAPM_NATIVE_NOTIFICATION_REPORT.md) |
| Universal links from Mail, Messages and Notes | NOT TESTED |
| Keyboard avoidance on the sheets (PILOT-14 is an iOS-specific risk) | NOT TESTED |
| The extra top inset inside a page sheet | NOT TESTED |
| SQLite outbox across a force-quit | NOT TESTED — see the [offline report](OCTAPM_NATIVE_OFFLINE_REPORT.md) |
| Real-device performance and cold start | NOT TESTED |

## 6. Verdict

**iOS: NOT TESTED.** The configuration that will produce the build is complete and coherent, and the permission strings are written to a standard Apple review accepts. Nothing beyond the configuration has been demonstrated, and no part of this report should be read as an iOS pass. A pilot that includes iPhones cannot start on this evidence; a pilot restricted to Android can, on the terms set out in the [field pilot readiness](OCTAPM_FIELD_PILOT_READINESS.md).
