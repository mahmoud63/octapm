# OctaPM Mobile — Android Verification Guide

**Audience:** the engineer who will produce the first Android build and run the device checks.
**Status:** written on 2026-09-18 from the official Expo, React Native and Android documentation, and from the version catalogue pinned inside this repository's own `node_modules`. Every version below carries its source. Nothing here has been executed: **ANDROID NATIVE BUILD TOOLCHAIN NOT INSTALLED ON THIS MACHINE** (no JDK, no Android SDK, no Android Studio, no `adb`, no emulator). Android builds perfectly well on Windows once the toolchain is installed; that is what this guide is for. The device checks themselves are the twelve rows in the [native capability register](OCTAPM_MOBILE_NATIVE_VERIFICATION.md).

## 1. What to install

| Piece | Version | Source |
|---|---|---|
| JDK | **17** (Microsoft Build of OpenJDK: `choco install -y microsoft-openjdk17`) | [Expo: set up your environment](https://docs.expo.dev/get-started/set-up-your-environment/); [React Native 0.86 Windows setup](https://reactnative.dev/docs/set-up-your-environment) warns that higher JDKs cause problems |
| Node | 22.13 or later | [Expo SDK 57 support table](https://docs.expo.dev/versions/latest/) |
| Android Studio | any current stable (AGP 8.12 needs Narwhal Feature Drop 2025.1.2 or newer) | [Android Studio and AGP compatibility](https://developer.android.com/studio/releases#android_gradle_plugin_and_android_studio_compatibility) |
| SDK Platform | **Android 36** plus its sources | [Expo: set up your environment](https://docs.expo.dev/get-started/set-up-your-environment/); React Native's page still says 35 and is stale against its own catalogue |
| Build-Tools | **36.0.0** | React Native 0.86.3 version catalogue, below |
| Command-line Tools | latest (this is where `sdkmanager` and `avdmanager` live) | [Android: sdkmanager](https://developer.android.com/tools/sdkmanager) |
| Android Emulator | with an x86_64 system image | [Expo: set up your environment](https://docs.expo.dev/get-started/set-up-your-environment/) |

**What `expo prebuild` will generate.** For SDK 57 the generated Gradle files carry no version numbers of their own: `settings.gradle` calls `expoAutolinking.useExpoVersionCatalog()`, which reads `node_modules/react-native/gradle/libs.versions.toml`. For the React Native 0.86.3 pinned in this repository that resolves to:

| Key | Value |
|---|---|
| `minSdk` | 24 |
| `compileSdk` | 36 |
| `targetSdk` | 36 |
| `buildTools` | 36.0.0 |
| `ndkVersion` | 27.1.12297006 |
| Android Gradle Plugin | 8.12.0 |
| Kotlin | 2.1.20 |
| Gradle wrapper | 9.3.1 |

Source: [React Native 0.86.3 version catalogue](https://raw.githubusercontent.com/facebook/react-native/v0.86.3/packages/react-native/gradle/libs.versions.toml) and the [SDK 57 bare template](https://github.com/expo/expo/tree/sdk-57/templates/expo-template-bare-minimum/android). Override them with `expo-build-properties` if ever needed ([Expo: build properties](https://docs.expo.dev/versions/latest/sdk/build-properties/)). The Android Gradle Plugin can install the NDK itself once licences are accepted ([Android: install the NDK](https://developer.android.com/studio/projects/install-ndk)), and Expo modules ship precompiled since SDK 53, so most of them do not compile native code locally ([Expo: prebuilt modules](https://docs.expo.dev/guides/prebuilt-expo-modules/)).

## 2. Windows environment

```powershell
# User environment variables (Control Panel → User Accounts → Change my environment variables)
JAVA_HOME    = C:\Program Files\Microsoft\jdk-17...
ANDROID_HOME = %LOCALAPPDATA%\Android\Sdk

# PATH additions
%LOCALAPPDATA%\Android\Sdk\platform-tools
%LOCALAPPDATA%\Android\Sdk\emulator
%LOCALAPPDATA%\Android\Sdk\cmdline-tools\latest\bin

# Check
adb --version
emulator -accel-check
```

`ANDROID_HOME` and the `platform-tools` entry are Expo's own instructions ([Expo: set up your environment](https://docs.expo.dev/get-started/set-up-your-environment/)); `ANDROID_SDK_ROOT` is deprecated in favour of `ANDROID_HOME` ([Android: environment variables](https://developer.android.com/tools/variables)). `JAVA_HOME` is what a terminal Gradle build uses ([Android: JDKs](https://developer.android.com/build/jdks)). On Windows the emulator wants the Windows Hypervisor Platform, with virtualisation enabled in the BIOS ([Android: emulator acceleration](https://developer.android.com/studio/run/emulator-acceleration)).

## 3. Build and run

```bash
cd mobile
npm install
npx expo install expo-dev-client          # a development build needs it; not yet a dependency here
npx expo prebuild --platform android --clean
npx expo run:android                       # emulator or the single connected device
npx expo run:android --device              # choose a device
npx expo run:android --variant release     # unsigned; not for a store
```

`expo run:android` runs `prebuild` itself when `android/` is missing, compiles, installs and starts Metro ([Expo: local app development](https://docs.expo.dev/guides/local-app-development/), [Expo CLI](https://docs.expo.dev/more/expo-cli/#compiling)). `--clean` is the safest form of prebuild ([Expo: continuous native generation](https://docs.expo.dev/workflow/continuous-native-generation/)). After the first build, `npx expo start` and pressing `A` is enough for JavaScript changes.

For a USB device: enable Developer options (tap Build number seven times), turn on USB debugging, confirm `adb devices` lists it as `device`, then `adb -s <serial> reverse tcp:8081 tcp:8081` so it can reach Metro ([React Native: running on device](https://reactnative.dev/docs/running-on-device)).

**A signed release.** Create an upload keystore, put it in `android/app`, add the four `MYAPP_UPLOAD_*` properties to `android/gradle.properties`, add the signing config to `android/app/build.gradle`, then from `android\` run `gradlew app:bundleRelease` (Windows Command Shell; PowerShell uses `./gradlew`). The bundle lands at `android/app/build/outputs/bundle/release/app-release.aab` ([Expo: local production build](https://docs.expo.dev/guides/local-app-production/), [React Native: signed APK](https://reactnative.dev/docs/signed-apk-android), [Android: build from the command line](https://developer.android.com/build/building-cmdline)). An APK comes from `gradlew assembleRelease`; the exact output filename is not documented by Expo or React Native, so read it from `android/app/build/outputs/apk/release/` after the build.

## 4. Emulator and adb, from the command line

```bash
sdkmanager "platform-tools" "platforms;android-36" "build-tools;36.0.0" "system-images;android-36;google_apis;x86_64"
sdkmanager --licenses
avdmanager create avd -n octapm-36 -k "system-images;android-36;google_apis;x86_64"
emulator -list-avds
emulator @octapm-36

adb devices -l
adb install app-release.apk
adb logcat ReactNativeJS:V *:S
adb shell am start -W -a android.intent.action.VIEW -c android.intent.category.BROWSABLE \
  -d "https://app.octapm.com/projects/<projectId>/rfi?recordId=<rfiId>&source=rfi" com.octapm.app
adb shell am start -W -a android.intent.action.VIEW -d "octapm://rfi/<rfiId>" com.octapm.app
```

Sources: [sdkmanager](https://developer.android.com/tools/sdkmanager), [avdmanager](https://developer.android.com/tools/avdmanager), [emulator command line](https://developer.android.com/studio/run/emulator-commandline), [adb](https://developer.android.com/tools/adb), [logcat](https://developer.android.com/tools/logcat), [deep linking](https://developer.android.com/training/app-links/deep-linking), [Expo: Android app links](https://docs.expo.dev/linking/android-app-links/).

Two current caveats. `sdkmanager` and `avdmanager` are marked deprecated in favour of a new Android CLI, but that CLI's `android emulator` command **is disabled on Windows** and it cannot even be downloaded from PowerShell, so the commands above remain the ones to use here ([Android CLI known issues](https://developer.android.com/tools/agents/android-cli)). The Android Emulator hypervisor driver is being retired on 31 December 2026; use the Windows Hypervisor Platform ([emulator acceleration](https://developer.android.com/studio/run/emulator-acceleration)).

## 5. App links

The app already declares the verified intent filters for `app.octapm.com` and `octapm.com`. What the server side needs:

- Host `https://<host>/.well-known/assetlinks.json` over HTTPS with content type `application/json`, containing `relation: ["delegate_permission/common.handle_all_urls"]`, `namespace: "android_app"`, `package_name: "com.octapm.app"` and the signing certificate's SHA-256 fingerprint. Take the fingerprint from `eas credentials -p android` or from the Play Console under Release → Setup → App Signing; several fingerprints may be listed ([Expo: Android app links](https://docs.expo.dev/linking/android-app-links/)).
- Verification happens at install time and is asynchronous: allow at least twenty seconds ([Android: verify app links](https://developer.android.com/training/app-links/verify-android-applinks)).

```bash
adb shell pm set-app-links --package com.octapm.app 0 all
adb shell pm verify-app-links --re-verify com.octapm.app
adb shell pm get-app-links com.octapm.app      # look for "verified"
```

## 6. What Expo Go cannot tell you

Expo Go is useful for a quick look at the screens, but it cannot certify this app. Remote push notifications are unavailable in Expo Go on Android since SDK 53 ([expo-notifications](https://docs.expo.dev/versions/latest/sdk/notifications/)); app links and universal links need a two-way association that Expo Go cannot have, and the app's own `octapm://` scheme is not exercised because Expo Go uses `exp://` ([Expo: development builds FAQ](https://docs.expo.dev/develop/development-builds/faq/), [Expo: linking into your app](https://docs.expo.dev/linking/into-your-app/)); the icon, name and splash screen cannot be tested; `expo-secure-store`'s `requireAuthentication` is unsupported there; and config-plugin native options do not apply. A development build is the honest target for every row in the register.

Within Expo Go you can still exercise the screens, local notifications, SQLite, SecureStore without the authentication requirement, local authentication on Android, and the camera on a physical device ([expo-camera](https://docs.expo.dev/versions/latest/sdk/camera/) is device-only, not emulator).

## 7. Edge-to-edge on Android 15 and 16

Android 15 enforced edge-to-edge with an opt-out; for an app targeting Android 16 that opt-out is deprecated and disabled, so **this app cannot opt out** — `targetSdk` is 36 ([Android 16 behaviour changes](https://developer.android.com/about/versions/16/behavior-changes-16#edge-to-edge)). React Native 0.86 ships the fixes that make this workable, including correct `measureInWindow` coordinates and `KeyboardAvoidingView` behaviour under edge-to-edge ([React Native 0.86 release notes](https://reactnative.dev/blog/2026/06/11/react-native-0.86)). The app already uses `react-native-safe-area-context` throughout, which is the required approach ([Expo: safe areas](https://docs.expo.dev/develop/user-interface/safe-areas/)).

Two things to watch on the first device run, both listed in the register: the connectivity bar and the sheets are where safe-area handling matters most, and for an app targeting API 36 on Android 16 predictive back is on by default, so `onBackPressed` is not called and `KEYCODE_BACK` is not dispatched ([Android 16 behaviour changes](https://developer.android.com/about/versions/16/behavior-changes-16)). Confirm that the app's back navigation behaves on a device.

The `edgeToEdgeEnabled` key was removed from `app.json` during this certification phase because Expo SDK 57's prebuild no longer honours it and warns to remove it; the generated `gradle.properties` sets it regardless ([Expo SDK 57 prebuild config](https://github.com/expo/expo/blob/sdk-57/packages/%40expo/prebuild-config/src/plugins/unversioned/edge-to-edge/withEdgeToEdge.ts)).

## 8. Recording the result

Run the twelve device checks in the [native capability register](OCTAPM_MOBILE_NATIVE_VERIFICATION.md) on at least one Android phone and one Android tablet. Record the build id, device model, Android version, date, tester and outcome for each, and move a row to NATIVE-VERIFIED only with that evidence.

## 9. Stated as unconfirmed

No official page states a minimum Android Studio version for Expo SDK 57 (the floor above is derived from the Gradle plugin's compatibility table). Neither Expo nor React Native documents the release APK's Gradle task or output filename for an Expo project. Whether this app needs the NDK installed by hand was not verified, because no build was run here. The resolved Gradle plugin version comes from the pinned catalogue, not from a generated project.
