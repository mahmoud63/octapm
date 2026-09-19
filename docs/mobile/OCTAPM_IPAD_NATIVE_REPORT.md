# OctaPM Mobile — iPad Native Report

**Audience:** the pilot lead deciding whether site engineers and the PM can work from iPads.
**Date:** 2026-09-18. **Branch:** `feat/p0-foundations-sprint1`.
**Evidence tag:** NOT TESTED on iPad hardware or Simulator. What exists is WEB/RESPONSIVE LAYOUT VALIDATION at iPad sizes, which is a different thing and is labelled as such throughout.

## 1. Why there is no native result

Same reason as the iPhone: **IOS NATIVE LOCAL BUILD REQUIRES MACOS OR AN APPROVED REMOTE BUILD SERVICE.** The host is Windows 11; Expo declines even to generate the iOS project here. See the [iOS report](OCTAPM_IOS_NATIVE_REPORT.md) §1 for the verbatim output.

## 2. What the configuration says

| Setting | Value | Consequence on iPad |
|---|---|---|
| `ios.supportsTablet` | `true` | The app installs and runs as a native iPad app, not a scaled iPhone app |
| `ios.requireFullScreen` | `false` | Slide Over, Split View and Stage Manager are all permitted. The app's window can be any width the system gives it |
| `orientation` | `default` | Both orientations, which is what a tablet on a site desk needs |
| `userInterfaceStyle` | `automatic` | Follows the system's light and dark setting |

`requireFullScreen: false` is the setting that matters most and the one most likely to surprise: it means the app must survive being resized to roughly a third of the screen while a record is open. The app is built for that — the layout is driven by measured width, not by device type.

## 3. What has actually been validated, and at what sizes

`mobile/e2e/cert-responsive.spec.ts` drives the production web export at the four iPad geometries and checks, at each: no horizontal page overflow, every control inside the viewport, tap targets at or above 40 px, no technical text on screen, the navigation rail on the left from 900 px, and master–detail on every record group from 900 px.

| Geometry | Class | Result |
|---|---|---|
| 834×1194 (iPad portrait) | WEB/RESPONSIVE LAYOUT VALIDATION | PASS |
| 1194×834 (iPad landscape) | WEB/RESPONSIVE LAYOUT VALIDATION | PASS |
| 1024×1366 (iPad Pro portrait) | WEB/RESPONSIVE LAYOUT VALIDATION | PASS |
| 1366×1024 (iPad Pro landscape) | WEB/RESPONSIVE LAYOUT VALIDATION | PASS |

The app's width classes are compact below 600 px, medium 600–899 px and expanded from 900 px (`mobile/src/hooks/useLayout.ts`), and every iPad geometry above reaches expanded. The tablet-specific work certified earlier in the programme — master–detail on the record registers, the timeline strip, progress approval and the signature pad — was exercised at these sizes on the web target.

This proves the **layout logic** at iPad dimensions. It does not prove the iPad.

## 4. What only an iPad can settle

| Question | Status |
|---|---|
| Slide Over and Split View: does the width class follow the window as the divider is dragged, mid-record? | NOT TESTED |
| Stage Manager: a resized, overlapping window | NOT TESTED |
| The extra top inset inside a page sheet | NOT TESTED |
| Keyboard avoidance on the sheets — PILOT-14, and the iPad's floating keyboard is the harder case | NOT TESTED |
| Apple Pencil on the signature pad | NOT TESTED |
| External keyboard and trackpad | NOT TESTED |
| Camera on an iPad in a site environment (weight, focus distance) | NOT TESTED |
| Real-device scroll performance on the long registers | NOT TESTED |

## 5. Verdict

**iPad: NOT TESTED.** The layout is validated at every iPad geometry on the web target and the configuration is right for a native iPad app that supports multitasking. Whether it behaves as an iPad app is unproven, and a pilot involving iPads cannot start on this evidence.
