# OctaPM Mobile — Android Native Report

**Audience:** whoever produces the first Android build, and the reviewer deciding whether the field pilot may start.
**Date:** 2026-09-18. **Branch:** `feat/p0-foundations-sprint1`.
**Evidence tag for everything below:** REAL CONFIG (generated native project, read on this machine) — **not** REAL DEVICE, **not** EMULATOR. No Android device or emulator was used in this phase.

## 1. Environment, stated plainly

**ANDROID NATIVE BUILD TOOLCHAIN NOT INSTALLED ON THIS MACHINE.**

| Prerequisite | State |
|---|---|
| JDK (`java`, `javac`) | not on PATH; `JAVA_HOME` empty; no `Eclipse Adoptium`, `Java` or `Microsoft\jdk*` directory under Program Files |
| Android SDK | absent; `ANDROID_HOME` and `ANDROID_SDK_ROOT` empty; no `%LOCALAPPDATA%\Android\Sdk`, no `C:\Program Files\Android` |
| `adb` | not on PATH |
| Emulator / system image | none |
| Android Studio | not installed |
| EAS CLI / `EXPO_TOKEN` | not installed / not set |
| Host | Windows 11 Enterprise 10.0.26100, not elevated, `winget` available, `choco` absent |
| Headroom | 1.2 GB RAM free of 15.8 GB; 36.5 GB disk free |

**Why nothing was installed.** §12 of the brief permits installing what is necessary when it is safe and appropriate. It is not appropriate here, and the reason is memory rather than permissions: a Gradle build of a React Native 0.86 app runs a Gradle daemon and a Kotlin daemon and wants several gigabytes. With 1.2 GB free on a machine also running the OctaPM API and the export server, the build would page heavily and put the user's running services at risk, and the APK it produced could not be installed on anything — there is no device and no emulator, and an emulator will not run in that headroom either. Downloading roughly a gigabyte of SDK to reach an unusable artefact is not a defensible use of the machine. Nothing was removed, no SDK version was changed, no environment variable was overwritten and no signing key was created.

## 2. What was produced instead, and what it proves

`npx expo prebuild --platform android --no-install` was run and **succeeded**, generating the real native project at `mobile/android/` (gitignored — this repository uses continuous native generation, so the directory is an output, not a source). This is not a simulation: it is the exact Gradle project and merged manifest inputs a build would compile. Everything in §3–§6 is read from that output.

```
> npm run prebuild
- Creating native directory (./android)
✔ Created native directory
✔ Updated package.json | no changes
✔ Finished prebuild
```

## 3. The manifest the pilot would ship

`android/app/src/main/AndroidManifest.xml`, verbatim in substance:

| Declared | Value |
|---|---|
| Permissions, as first generated | `CAMERA`, `INTERNET`, `READ_EXTERNAL_STORAGE` (maxSdk 32), `RECORD_AUDIO`, `SYSTEM_ALERT_WINDOW`, `USE_BIOMETRIC`, `USE_FINGERPRINT`, `VIBRATE`, `WRITE_EXTERNAL_STORAGE` (maxSdk 32) — two of which were removed in this phase, §5 |
| Launch mode | `singleTask`, `windowSoftInputMode="adjustResize"`, `screenOrientation="unspecified"` |
| Custom scheme | `octapm://` |
| App links | `autoVerify="true"` for `https://app.octapm.com/` and `https://octapm.com/` |
| Notifications | Firebase and expo-notifications default icon and colour resources present |
| Updates | `expo.modules.updates.ENABLED = false` — no over-the-air updates in the pilot build |
| Backup | `allowBackup="true"` with `@xml/secure_store_backup_rules` and `@xml/secure_store_data_extraction_rules` |

**`POST_NOTIFICATIONS` is not missing.** It is absent from the app's own manifest but declared by `expo-notifications`' library manifest (`node_modules/expo-notifications/android/src/main/AndroidManifest.xml`, alongside `RECEIVE_BOOT_COMPLETED`) and merges in at build time. This was checked rather than assumed, because its absence would have broken push on Android 13 and later.

## 4. The refresh token at rest — a §16 result

The manifest points the backup rules at resources supplied by `expo-secure-store`, and those resources exclude the SecureStore preferences from **both** cloud backup and device transfer:

```xml
<!-- secure_store_data_extraction_rules.xml, Android 12+ -->
<cloud-backup>   <include domain="sharedpref" path="."/> <exclude domain="sharedpref" path="SecureStore"/> </cloud-backup>
<device-transfer> <include domain="sharedpref" path="."/> <exclude domain="sharedpref" path="SecureStore"/> </device-transfer>
```

```xml
<!-- secure_store_backup_rules.xml, Android 11 and lower -->
<full-backup-content> <include domain="sharedpref" path="."/> <exclude domain="sharedpref" path="SecureStore"/> </full-backup-content>
```

So the refresh token cannot leave a pilot handset through Android auto-backup or a device-to-device transfer. That is a configuration result, not a device result: the device check is still to dump the Keystore-backed entry after a sign-out and confirm it is gone. It is recorded here because it answers the question a client security reviewer asks first.

## 5. Two permissions the app had no use for, and their fix

The first generated manifest declared two permissions the product does not need. Both were traced to an exact cause and closed in this phase.

| Id | Finding | Cause, traced | Fix |
|---|---|---|---|
| NATIVE-01 | `RECORD_AUDIO` — the microphone — was declared although the app never records audio, and although `app.json` already sets `expo-camera`'s `recordAudioAndroid: false` | Not the camera: `expo-camera` honours that flag (`withCamera.js:32`). It came from **`expo-image-picker`**, whose plugin adds `RECORD_AUDIO` unless `microphonePermission` is explicitly `false` (`withImagePicker.js:11`), and the app's options set only `photosPermission` | `"microphonePermission": false` added to the `expo-image-picker` plugin options in `app.json` |
| NATIVE-02 | `SYSTEM_ALERT_WINDOW` — draw over other apps — was declared, requested by nothing in `app.json` | **Expo's own bare-app manifest template** (`@expo/config-plugins/build/plugins/withAndroidBaseMods.js:62`), which carries it under the comment "OPTIONAL PERMISSIONS, REMOVE WHATEVER YOU DO NOT NEED". It is in the app's main manifest, so it would ship in a release build, not only in debug | Added to `android.blockedPermissions` in `app.json`, together with `RECORD_AUDIO` as a belt-and-braces block against any future plugin re-adding it |

Both mattered for the same reason: a construction project-management app that asks for the microphone and for permission to draw over other apps invites exactly the wrong question at a client security review, and both are sensitive declarations on Google Play.

After the fix, `npx expo prebuild` regenerates the manifest with the merger's removal directive on each:

```xml
<uses-permission android:name="android.permission.RECORD_AUDIO" tools:node="remove"/>
<uses-permission android:name="android.permission.SYSTEM_ALERT_WINDOW" tools:node="remove"/>
```

That is the documented mechanism by which the Android manifest merger strips a permission from the merged result and prevents a library from contributing it. **It is verified here at the configuration level only.** Confirming the merged output requires a build: `aapt dump permissions app-release.apk` must list neither. That check belongs to whoever runs §8.

## 6. App links need hosting before they work

`autoVerify="true"` only verifies if `https://app.octapm.com/.well-known/assetlinks.json` and `https://octapm.com/.well-known/assetlinks.json` serve the app's package name (`com.octapm.app`) and the **release signing certificate's** SHA-256 fingerprint. Until that file is hosted with the fingerprint of whatever key signs the pilot build, a tapped link opens the browser instead of the app, and the `octapm://` scheme still works. This is a hosting task on the OctaPM web platform, not an app change. No signing key was created in this phase.

## 7. What is still NOT TESTED on Android

Every one of these needs a build in a hand. None may be reported as passing.

| Capability | Status |
|---|---|
| Camera capture, barcode and QR scanning | NOT TESTED |
| SecureStore / Keystore round trip, sign-out wipe | NOT TESTED (configuration verified, §4) |
| Biometric unlock (fingerprint, face) | NOT TESTED |
| Native push registration and delivery, cold-start tap | NOT TESTED — see the [notification report](OCTAPM_NATIVE_NOTIFICATION_REPORT.md) |
| App links and `octapm://` intents on device | NOT TESTED |
| SQLite outbox across a force-stop | NOT TESTED — see the [offline report](OCTAPM_NATIVE_OFFLINE_REPORT.md) |
| Real-device performance, cold start, scroll | NOT TESTED |
| Android tablet resize and split-screen | NOT TESTED |

## 8. Exact commands for the machine that does have headroom

Run in order on a Windows, macOS or Linux host with ≥8 GB free RAM. Nothing here needs elevation except where noted.

```bash
# 1. JDK 17 (Android Gradle Plugin 8.12 requires 17)
winget install --id Microsoft.OpenJDK.17 --accept-package-agreements --accept-source-agreements
# then set JAVA_HOME to the install path and add %JAVA_HOME%\bin to PATH

# 2. Android SDK command-line tools, unpacked to %LOCALAPPDATA%\Android\Sdk\cmdline-tools\latest
#    (from https://developer.android.com/studio#command-line-tools-only), then:
sdkmanager --install "platform-tools" "platforms;android-36" "build-tools;36.0.0" "ndk;27.1.12297006"
sdkmanager --licenses

# 3. Set ANDROID_HOME to that SDK path and add platform-tools to PATH, then from mobile/:
npm run prebuild
cd android && ./gradlew assembleDebug        # the APK lands in app/build/outputs/apk/debug/
adb install -r app/build/outputs/apk/debug/app-debug.apk

# 4. Deep links, once the app is installed
adb shell am start -a android.intent.action.VIEW -d "octapm://rfi/<id>"
adb shell am start -a android.intent.action.VIEW -d "https://app.octapm.com/projects/<projectId>/rfi?recordId=<id>&source=rfi"
```

A cloud build needs no local SDK at all and works from Windows:

```bash
npm i -g eas-cli && eas login
eas build:configure                 # creates eas.json; none exists yet in this repository
eas build --platform android --profile development
```

Two prerequisites are genuinely absent from the repository today and must be added by whoever does the first build: **`expo-dev-client` is not a dependency**, and **there is no `eas.json` and no EAS `projectId` in `app.json`** (`extra.eas` is an empty object). Neither is a defect — the app has never been built natively — but neither can be skipped. The step-by-step is in the [Android verification guide](OCTAPM_ANDROID_VERIFICATION_GUIDE.md).

## 9. Verdict

**Android: REAL CONFIG VERIFIED, NOT TESTED ON DEVICE.** The native project generates cleanly, the manifest is coherent, deep links and notification resources are wired, and the refresh token is excluded from Android backup by configuration. Nothing about Android's readiness beyond that has been demonstrated, and this report does not claim it.
