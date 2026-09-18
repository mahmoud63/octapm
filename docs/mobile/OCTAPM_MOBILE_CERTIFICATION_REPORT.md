# OctaPM Mobile — Certification Report

**Audience:** the product owner, the release manager, and whoever runs the internal UAT and the field pilot.
**Status:** the certification and hardening phase of 2026-09-18, on branch `feat/p0-foundations-sprint1`, against the production web export served on port 8081 and the local API on port 5000, writing only to the dedicated end-to-end organisation. Every figure below was produced on this machine. Nothing was deployed or published.
**Companion documents:** [known issues](OCTAPM_MOBILE_KNOWN_ISSUES.md) · [native capability register](OCTAPM_MOBILE_NATIVE_VERIFICATION.md) · [device matrix](OCTAPM_MOBILE_DEVICE_MATRIX.md) · [propagation matrix](OCTAPM_MOBILE_WEB_MOBILE_PROPAGATION.md) · [Android guide](OCTAPM_ANDROID_VERIFICATION_GUIDE.md) · [iOS guide](OCTAPM_IOS_VERIFICATION_GUIDE.md) · [offline policy](OCTAPM_MOBILE_OFFLINE_POLICY.md) · [feature matrix](OCTAPM_MOBILE_FEATURE_MATRIX.md) · [M10 final report](OCTAPM_MOBILE_FINAL_REPORT.md).

## 1. Three verdicts

| Question | Verdict | Why |
|---|---|---|
| Mobile web export certification | **PASS** | Every gate that can be proven in a browser is proven against the certified bundle: authentication and session, role-aware access for all nine roles, tenant and project isolation, deep links for every record type with a screen, phone and tablet and iPad-style layout, the eight web↔mobile handoffs, financial and inventory integrity with a delta of 0.00, and no technical text on any screen the checks visited. |
| Native device readiness | **READY FOR DEVICE VERIFICATION** | The application is complete and its logic is proven; what is missing is a build. The toolchain is absent on this machine, the two guides say exactly what to install and run, and the register lists twelve device checks. Nothing blocks a build from starting today. |
| Field pilot | **CONDITIONAL** | Two independent reasons, either of which alone would make it conditional. First, camera, barcode, SecureStore and push have not been exercised on a device and the pilot needs all four. Second, approvals score 3.8 of 5, below the 4.0 floor: a change order can be approved on the phone without the amount on screen. |

The words "production ready" do not appear in this report, by design.

## 2. Environment, as checked

| | |
|---|---|
| Repository | `…/worktrees/procore-competitive-benchmark-6bd1b6`, branch `feat/p0-foundations-sprint1` |
| Production export | `http://localhost:8081`, served by `node scripts/serve-web.mjs 8081` from `mobile/dist` |
| Metro development | not started; port 8082 free and reserved for it |
| API | `http://localhost:5000/api/v1`, `node src/index.js`, responding |
| Database | PostgreSQL on `localhost:55432`, database `octapm_verify`, accepting connections |
| Realtime | socket.io endpoint answering on the API port |
| End-to-end organisation | `pm@octapm-e2e.test` and eight role accounts; one project, "Riverside Tower" |
| JDK | **NOT INSTALLED** (no `java`, no `JAVA_HOME`) |
| Android SDK | **NOT INSTALLED** (no `ANDROID_HOME`, no SDK directory) |
| adb | **NOT INSTALLED** |
| Android emulator | **NOT AVAILABLE** |
| Android Studio | **NOT INSTALLED** |
| iOS native local build | **REQUIRES MACOS OR A SUPPORTED REMOTE BUILD SERVICE** (host is Windows 11) |
| EAS CLI | not installed; no `EXPO_TOKEN` |
| Free memory during the runs | about 0.9 GB, which is why the suites run with one worker |

The precise wording the brief asks for: **ANDROID NATIVE BUILD TOOLCHAIN NOT INSTALLED ON THIS MACHINE.** Android builds on Windows perfectly well once the JDK and SDK are installed. **IOS NATIVE LOCAL BUILD REQUIRES MACOS OR A SUPPORTED REMOTE BUILD SERVICE.**

## 3. What was run

| Gate | Result |
|---|---|
| Mobile TypeScript | 0 errors |
| Mobile ESLint | 0 errors, 0 warnings |
| Mobile Jest (unit and rendered screens) | **281 passed in 56 suites** |
| Backend Jest (whole server) | **2,219 passed in 200 suites** |
| Playwright against the certified export | **119 passed, 0 failed, 33 skipped by design** (phone and tablet viewports, 11.2 minutes) |
| Production export | rebuilt from the working tree immediately before the certification run, so the bundle tested is the bundle certified |

The Playwright suite is the ten milestone specs (`m1`–`m10`) plus the eight certification specs written in this phase (`cert-auth`, `cert-roles`, `cert-security`, `cert-links`, `cert-responsive`, `cert-propagation`, `cert-finance`, `cert-performance`). Skips are by design: layout-independent checks run once on the phone viewport, and wide-screen checks assert their own absence on the phone.

## 4. Certification, area by area

| Area | Result | Evidence |
|---|---|---|
| Mobile web export | PASS | the whole suite against `mobile/dist` on 8081 |
| Phone responsive | PASS | 320, 360, 375, 390, 412 and 430 px across thirty routes: no page overflow, no control unreachable, no tap target under 40 px, no technical text, the bar along the bottom at every width |
| Tablet responsive | PASS | 768, 820, 1024 and 1280 px: the rail on the left from 900 px, master–detail on every record group, no overflow |
| iPad-style responsive | PASS (WEB/RESPONSIVE LAYOUT VALIDATION, not native iPad certification) | 834×1194, 1194×834, 1024×1366 and 1366×1024 |
| Authentication | PASS | wrong password refused with a sentence; a deactivated person signed out with a reason and unable to sign in again; lost project access ending in a sentence with the project gone from the list; sign-out leaving no token-shaped value in browser storage and no record behind the back button |
| RBAC | PASS | all nine role accounts: every quick action and every record door compared one by one with the effective matrix the server returns for that person; a site engineer offered no approval on a submitted progress update or an open RFI; the server refusing the same actions with 403 |
| Tenant isolation | PASS | a manager of another organisation refused this project's record by the API and told plainly in the app |
| Project isolation | PASS | switching project leaves nothing of the previous project on screen and its record refuses to open; a person not on a project cannot reach its record by link; the temporary project used for the check is archived again |
| Home | PASS | role-aware doors and quick actions, Needs You counts, today's items, project health, notifications |
| Needs You | PASS | opens for every role; counts and filters; rows open the record |
| Quick Actions | PASS | gated on the server's matrix; measured click paths in section 7 |
| Project switching | PASS | no data bleed; the previous project's cache dropped |
| Notifications | PASS | list, read state, and every notification type routed through the same resolver as a deep link |
| Search | PASS | scoped by organisation on the server; typed results; a forbidden record cannot appear because the server never returns it |
| Deep links | PASS | nineteen record types opened from the web platform's own path; missing, wrong-type, wrong-project and signed-out links all end in a sentence |
| RFI | PASS | raised from the field, answered officially on the web, approved to closed through the server's transitions |
| Documents | PASS | register, folders, search, file opened through the platform viewer |
| Drawings | PASS on fixtures | register and the superseded guard; the local seed publishes no drawing set, so the viewer is proven on fixtures and the register on the live empty state |
| Daily logs | PASS | entry with a replay key, totals, offline capture |
| Schedule | PASS | activities, today's work, lookahead, progress by method, the tablet timeline |
| Quality | PASS | quality home and all five registers |
| Inspection | PASS | started from a template, answered in one request, completed, signed |
| NCR | PASS | raised, closed out with evidence, approved |
| Punch | PASS | raised with a replay key, moved through review and closed |
| Safety | PASS | incident raised and closed out |
| Inventory | PASS | scan, item, stock moves, ledger |
| Goods receipt | PASS | received against a fresh order; the same receipt number posted twice counts once (409 `RECEIPT_ALREADY_POSTED`) |
| Material issue | PASS | see section 6 |
| Transfers | PASS | drafted, dispatched, received line by line |
| Barcode / QR | PASS for the typed-code path; the scanner is NATIVE-VERIFY | the camera view cannot be exercised in a browser |
| Tasks | PASS | assigned on the web, completed from the field |
| Meetings | NOT IN THE APP | no meetings screen; a meeting link hands over to the web. The feature matrix was corrected in this phase, where it had claimed VIEW |
| Change Events | PASS | raised on the screen and readable on the web at once |
| Approvals | CONDITIONAL | the flow works end to end, but a change order can be approved without the amount, counterparty, retention or attachment on screen, and workflow steps for tools with no in-app record show only the step name (PILOT-01, PILOT-02, PILOT-03) |
| PM daily control centre | PARTIAL | Home answers what needs me, what is late and what I can do now, from live signals. Of the brief's morning list it does not yet surface long-lead risk, quantity overrun or commercial exposure as their own items; quantity overrun has no backend to read (section 9) |

## 5. Web ↔ mobile propagation

Full detail and method in the [propagation matrix](OCTAPM_MOBILE_WEB_MOBILE_PROPAGATION.md).

| Handoff | Class |
|---|---|
| RFI answer → open mobile record | REALTIME (972 ms) |
| Web NCR assignment → mobile list | REALTIME (901 ms) |
| Web NCR edit with no status change → open mobile record | REFRESH REQUIRED |
| Mobile goods receipt → open purchase order record | REALTIME (154 ms) |
| Mobile material issue → open item screen, and the web | REALTIME (159 ms); immediate on the web |
| Mobile progress submission → open activity | REALTIME (869 ms) |
| Web task assignment → mobile list; mobile completion → web | REALTIME (876 ms); immediate |
| Mobile change event → web commercial record | IMMEDIATE (48 ms) |
| Web approval assignment → mobile inbox; mobile answer → web | REALTIME (724 ms); immediate |

Nothing is STALE and only one row needs a refresh: a web edit to an NCR that does not change its status, which is exactly the server-side event gap the audit found.

## 6. Financial and inventory integrity

The app performs no financial arithmetic. Every figure it shows is a field the server returned, and every movement is posted by the server.

| Check | Result |
|---|---|
| Material issue made on the app's own screen | 2 × CEM-42.5N at the weighted average 6.4000 = **12.80**; stock 1690 → 1688; the item ledger gained exactly one movement; the activity's `actual` rose by 12.80 |
| Financial delta (expected against the server's own figures) | **0.00** |
| Authoritative reconciliation, read straight from PostgreSQL | the cost ledger holds exactly one entry for that movement, `material_issue:<movementId>:header`, amount 12.80, quantity −2, unit 6.4000, type material; SQL sum 12.80; **delta SQL − API 0.00**; no duplicate source keys |
| Duplicate ledger entries | none: the cost row moved by exactly the movement's value, once |
| Duplicate inventory movements | none: the item's ledger gained exactly one movement |
| Double tap on Send | one request reached the server |
| Same goods receipt posted twice | first 201, second refused `RECEIPT_ALREADY_POSTED`; stock rose once |
| Two people issuing the last of the stock at the same moment | one 201, one refused; the balance never went negative and ended at 0 |
| Mobile-calculated authoritative cost | none: the app reads `actual` from the server's cost row |

Two facts worth recording for whoever reads the numbers next: a stock issue is written with a **negative quantity and a positive value**, and on a project cost row a material issue lands on **`actual`** — the `material` column is the budget breakdown by category and does not move.

## 7. Click paths from Home

| Action | Target | Measured |
|---|---|---|
| Needs You row → record | 1 | 1 |
| Notification → record | 1 | 2 (Home's card opens the inbox first; the inbox row is one tap) |
| New RFI submitted | ≤ 3 | 3 |
| New punch item submitted | ≤ 3 | 3 |
| Site photo chosen and uploaded | ≤ 2 | 2 |
| Barcode identify after the scanner opens | ≤ 2 | 2 |

Only the notification path exceeds its target, by one tap, and it is recorded as a polish item rather than fixed here: removing the intermediate card would cost the "latest three" summary that Home exists to give.

## 8. Defects

Counts from the audit of this phase, after two independent verifiers per finding. Full register with file and line in the [known issues](OCTAPM_MOBILE_KNOWN_ISSUES.md).

| Class | Raised | Fixed here | Open |
|---|---|---|---|
| MOB-P0 | 0 | — | **0** |
| MOB-P1 | 3 | 2 | 1 (PILOT-02, an approvals context gap) |
| MOB-P2 | 37 | 10 | 27 |
| MOB-P3 | 35 | 5 | 30 |
| NATIVE-VERIFY | 7 | — | 7 |
| ENV | 2 | — | 2 (no JDK/Android SDK; no macOS) |

Nineteen fixes, each with a regression test that fails when its fix is reverted. One was a security defect: the workflow evidence upload route had no module permission guard, so any project member could fill the project's workflow storage.

## 9. Two things the backend does not yet support

**Quantity overrun alerts.** The brief describes authorised quantity against installed, committed, received and forecast, with suggested actions. The server has cost-overrun forecasting (`/projects/:id/forecast`), not a BOQ quantity-exception engine. The app must not compute this itself, so this is **PLANNED / BACKEND DEPENDENCY**, not a failed mobile feature.

**Three domain events.** Stock movements, workflow step responses and NCR edits without a status change publish nothing, which is why the matching propagation rows are not realtime. Left alone deliberately during certification.

## 10. Experience score

Scored honestly, one decimal, no rounding up.

| Area | Score |
|---|---|
| Phone usability | 4.5 |
| Tablet usability | 4.5 |
| Navigation | 4.5 |
| Field efficiency | 4.6 |
| Needs You | 4.5 |
| Search | 4.4 |
| Offline clarity | 4.5 |
| Sync clarity | 4.4 |
| Quality workflow | 4.7 |
| Inventory workflow | 4.7 |
| RFI workflow | 4.7 |
| Documents | 4.0 |
| Drawings | 4.0 |
| Approvals | **3.8** |
| Visual professionalism | 4.7 |
| Performance | 4.3 |
| Responsibility clarity | 4.5 |

Sum 75.3 over 17 areas. **Overall 4.43.** The target for an external field pilot is 4.5 with no core workflow below 4.0; this is below both, on approvals. 4.43 is not rounded to 4.5.

## 11. Performance, as measured in this environment

Median of three runs on the phone viewport against the production export and the local API. These are browser figures, not device figures.

| Measurement | ms |
|---|---|
| First load of the bundle to the sign-in screen | 479 |
| DOMContentLoaded | 247 |
| Sign-in tap to Home with its data | 903 |
| Home | 197 |
| Needs You | 197 |
| Activities register (41 rows) | 221 |
| RFI list (25 rows) | 210 |
| RFI record | 188 |
| Inventory items | 192 |
| Document register | 206 |
| Quality home | 232 |
| Search to the result count | 895 |

No native performance number is claimed. One low-end Android device on the longest registers is on the device list.

## 12. Screenshot evidence

Captured by the responsive checks to `mobile/test-results/shots/` (git-ignored): phone Home, Needs You, RFI, Quality, Inventory, daily log and drawings at 390 px; tablet and iPad portrait and landscape Home, RFI master–detail, Quality and Inventory. They show the dedicated end-to-end organisation's data only, with no debug overlay and no developer tooling.

## 13. What turns the pilot verdict

1. Produce an Android and an iOS build and run the twelve device checks in the [native capability register](OCTAPM_MOBILE_NATIVE_VERIFICATION.md). Camera, barcode, SecureStore and push are the four the pilot depends on.
2. Close PILOT-01 and PILOT-02: show the amount and the counterparty before a change-order approval, and either render the context or offer "Review on web" for workflow tools with no in-app record.
3. Give the pilot project a published drawing set, so the viewer and kept-offline sheets are used rather than proven on fixtures.
4. Decide explicitly that the pilot accepts foreground-only sending: the outbox drains when the app is open or comes to the front, and background sync is deliberately absent.
5. Measure one low-end Android device on the activities, ledger and photo registers.

With 1, 2 and 3 done the score clears 4.5 and the pilot verdict becomes READY. Until then it is CONDITIONAL.

## 14. How to reproduce every figure

```bash
cd mobile && npm run generate && npx tsc --noEmit && npx eslint . && npx jest --runInBand --forceExit
cd mobile && npm run export:web                    # rebuild the certified bundle
npm run serve:web                                   # port 8081, or attach to the running server
npx playwright test --config e2e/playwright.config.ts
cd backend && npx jest --runInBand --forceExit
```

The API must be running on port 5000 with `http://localhost:8081` in its CORS allow-list, and PostgreSQL on 55432. Every write goes to the dedicated end-to-end organisation; the demo organisation is read once for the tenant-isolation check and never written to; the certified Phase 21 project is never touched.
