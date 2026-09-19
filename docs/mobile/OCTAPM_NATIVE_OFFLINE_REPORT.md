# OctaPM Mobile — Native Offline and Sync Report

**Audience:** the pilot lead, who will be asked "what happens in the basement" on day one.
**Date:** 2026-09-18. **Branch:** `feat/p0-foundations-sprint1`.
**Evidence tag:** NOT TESTED on a device. Everything below is either WEB-LOGIC-VERIFIED (the production export driven by Playwright against the live API) or UNIT, and the two are distinguished on every line. The [offline policy](OCTAPM_MOBILE_OFFLINE_POLICY.md) is the specification this measures against.

## 1. What the app does, in one paragraph

Six kinds of field write are queued when there is no signal: punch items and observations, inspections and their answers and signatures, daily-log entries, timesheets, photo and file evidence, and the goods receipt. Each carries a client-generated replay key, so a retry after an interrupted send cannot create a duplicate. Everything financial or stock-moving is online-only **by policy, not by omission**: stock issues, receipts, transfers and adjustments, and every workflow decision. An approval must be made against the record as it stands, and a stale stock request must never be replayed. That is a product decision recorded in the offline policy, and the pilot should be told it plainly rather than discovering it in a lift shaft.

## 2. What is proven, and how

| Behaviour | Evidence | Tag |
|---|---|---|
| A queued item's state machine: waiting → sending → sent, or needs attention with the reason | `mobile/src/offline/outbox.test.ts` | UNIT |
| Each real sender against a fake server, including a photo sent against the id the daily log's own send returned (the CERT-01 fix) | `certification-fixes.test.ts` | UNIT |
| Queue and drain on the web target, end to end, with the connectivity bar and the outbox screen | `m7.spec.ts` | WEB-LOGIC-VERIFIED |
| The read cache is attached on both the online and the offline-open path, so the app does not open to an empty cache after a restart (the CERT-02 fix) | the offline specs; the call site is asserted by the session suite | WEB-LOGIC-VERIFIED |
| A transient refresh failure keeps the session instead of demanding a password (the CERT-10 fix) | request-layer behaviour, exercised by the offline specs | WEB-LOGIC-VERIFIED |
| Nothing is silently stale: every list and record carries a freshness line, and the connectivity bar appears offline | `cert-responsive.spec.ts`, `m7.spec.ts` | WEB-LOGIC-VERIFIED |

On the web target the queue lives in local storage; on a device it lives in the app's SQLite database. **That is exactly the substitution a device must check**, and it is why none of the above is a native result.

## 3. What only a device can settle

| Question | Why the web target cannot answer it | Status |
|---|---|---|
| Does the queue survive a force-stop and a reboot? | The web target's storage is the browser's, not SQLite | NOT TESTED |
| Does the read cache survive the same, so the last-seen lists open in airplane mode after a restart? | As above | NOT TESTED |
| Does the connectivity signal reflect a real loss of signal — a lift, a basement, a steel deck — rather than a browser's online event? | The browser's signal is not the radio's | NOT TESTED |
| Does the queue drain correctly when the app comes back to the foreground with signal restored? | Foreground transitions are native lifecycle events | NOT TESTED |
| Does a photo captured by the native camera queue and replay intact? | PILOT-06: on the **web target** a replayed upload sends plain objects rather than files, so a web-captured photo that went through the queue cannot be sent. Native is expected to be unaffected because the file reference is real — **expected, not demonstrated** | NOT TESTED |
| Does a large photo queue fit? | PILOT-05: on the web target a queued photo is base64 inside one storage document and a quota failure drops the whole outbox. On a device the queue is SQLite-backed and unaffected — again expected, not demonstrated | NOT TESTED |

PILOT-05 and PILOT-06 are the two open issues whose *severity depends entirely on this untested boundary*. If the native path behaves as the code says it should, both are web-target-only defects and irrelevant to a pilot on real phones. If it does not, they are pilot blockers. Nobody should assume the first reading without running §4.

## 4. The device procedure, exactly

Run on each pilot handset, with a build produced per the [Android](OCTAPM_ANDROID_NATIVE_REPORT.md) or [iOS](OCTAPM_IOS_NATIVE_REPORT.md) report.

1. Sign in with signal. Open Home, the activities register, the RFI list and the photo grid so the read cache fills.
2. Turn on airplane mode. Confirm the connectivity bar appears and every freshness line says the data is cached, with its age.
3. Raise a punch item with a photo taken by the camera. Add a daily-log entry. Submit a timesheet. Complete an inspection with a signature. Confirm each lands in the outbox as waiting, with its content visible.
4. **Force-stop the app** (Android: App info → Force stop; iOS: swipe it away from the app switcher). Reopen it, still in airplane mode. Confirm: the four queued items are still there and still show their content; Home and the registers show cached data rather than a skeleton or an error.
5. Reboot the handset. Reopen, still offline. Confirm the same.
6. Turn airplane mode off. Without touching anything, confirm the queue drains, each item reaches sent, and the records appear on the web platform — the punch item with its photo attached.
7. Attempt a stock issue and a workflow approval while offline. Confirm each is refused with a sentence explaining that it must be done online, and that nothing is queued.
8. Queue twenty photos offline. Confirm none is lost and the app stays responsive.
9. Sign out with items still queued, then sign in as a **different** person. Confirm the queue is discarded, not handed over.

Record, per handset: model, OS version, build id, date, tester, and each step's outcome. A failure at step 4, 5 or 6 is a pilot blocker.

## 5. Verdict

**Native offline and sync: NOT TESTED.** The logic is unit-tested and proven end to end on the web target against the real API, the policy is explicit about what is deliberately online-only, and the two open offline issues are both confined to the web target by design — but the SQLite persistence, the real connectivity signal and the native camera's place in the queue are unproven, and they are the part a field pilot depends on most.
