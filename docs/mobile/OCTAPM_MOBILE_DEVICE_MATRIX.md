# OctaPM Mobile — Device Matrix

**Audience:** the release manager and the pilot lead.
**Status:** as of 2026-09-18. Two kinds of rows: what the production web export was checked at in a browser (WEB/RESPONSIVE LAYOUT VALIDATION), and what a device must still confirm (NATIVE). No native build exists on this machine. The environment lines: ANDROID NATIVE BUILD TOOLCHAIN NOT INSTALLED ON THIS MACHINE; IOS NATIVE LOCAL BUILD REQUIRES MACOS OR A SUPPORTED REMOTE BUILD SERVICE.

## 1. Web/responsive layout validation (production export on port 8081)

Run by `mobile/e2e/cert-responsive.spec.ts` against the same bundle the certification suite uses. At every size the checks are: no horizontal page overflow, every control inside the viewport, tap targets of at least 40 px, no technical text, the tab bar along the bottom below 900 px and the rail on the left from 900 px, master–detail on record groups from 900 px only.

| Class | Sizes checked (CSS px) | Screens | Result |
|---|---|---|---|
| Phone | 320×568, 360×780, 375×812, 390×844, 412×915, 430×932 | sign-in, Home, Projects, Needs You, Search, Notifications, RFI list/record/form, Tasks, Documents, Drawings, Daily log, Activities, Photos, Timesheets, Quality home, Inspections, Punch, NCRs, Inventory home/items/goods in, Approvals, Commercial home, Change events, Procurement home/orders, Outbox, More | PASS — no page overflow, no control unreachable, no tap target under 40 px, no technical text, the tab bar along the bottom at every width |
| Tablet | 768×1024, 820×1180 (portrait); 1024×768, 1280×800 (landscape) | Home, Needs You, RFI list/record, Quality, Punch, Inventory, Items, Activities, Approvals, Documents, Drawings, Orders | PASS — the rail on the left from 900 px, master–detail on every record group, no overflow at any size |
| iPad-style | 834×1194 (portrait), 1194×834 (landscape), 1024×1366 (Pro portrait), 1366×1024 (Pro landscape) | as tablet | PASS — same as tablet at all four sizes; labelled WEB/RESPONSIVE LAYOUT VALIDATION, not native iPad certification |

The width classes the app uses: compact below 600 px, medium 600–899 px, expanded from 900 px (`mobile/src/hooks/useLayout.ts`). A 768 px or 820 px portrait tablet is therefore the phone layout with more room, by design: the bar stays along the bottom and records take the screen; the rail and the split begin at 900 px, which every landscape tablet and every iPad size above reaches.

## 2. Native device matrix (to be run)

| Platform | Form factor | OS floor | Build | Status |
|---|---|---|---|---|
| Android | phone (e.g. Pixel 7, Samsung A-series) | see the Android guide (minSdk from `expo prebuild`) | development build or release APK | NOT TESTED — the native project generates and was read (REAL CONFIG, [Android report](OCTAPM_ANDROID_NATIVE_REPORT.md)); no build, no device |
| Android | tablet (10" and 12") | as above | as above | NOT TESTED |
| iOS | iPhone (one recent, one three years old) | see the iOS guide (deployment target from `expo prebuild`) | development build via Xcode or EAS | NOT TESTED — Expo declines to generate the iOS project on Windows ([iOS report](OCTAPM_IOS_NATIVE_REPORT.md)) |
| iPadOS | iPad and iPad Pro | as above | as above | NOT TESTED — layout validated at all four iPad geometries on the web target ([iPad report](OCTAPM_IPAD_NATIVE_REPORT.md)) |

Per device, run the twelve-item list in the [native capability register](OCTAPM_MOBILE_NATIVE_VERIFICATION.md) and record build id, model, OS version, date, tester and outcome in the certification report appendix.

## 3. Ports on this machine

| Purpose | Port | Process | Rule |
|---|---|---|---|
| Certified production web export (Playwright, QA, demos) | 8081 | `node scripts/serve-web.mjs 8081` (serves `mobile/dist` from disk; a re-export is served without a restart) | attach with the `mobile-web-export` launch entry; never start a second server on it |
| Metro development server (hot reload) | 8082 or another free port | `npm run web -- --port 8082` from `mobile/` | only when implementation work needs it; the API's CORS allow-list must then include that origin |
| Local API | 5000 | `node src/index.js` from `backend/` | one process; restart after backend changes |
| PostgreSQL | 55432 | local service, database `octapm_verify` | never a shared or client database |

Check the owner of a port before starting anything (`Get-NetTCPConnection -LocalPort 8081 -State Listen`); attach when the right server is already there.
