# OctaPM Mobile — Field Pilot Readiness

**Audience:** the product owner, who has to decide whether crews get this on their phones.
**Date:** 2026-09-18. **Branch:** `feat/p0-foundations-sprint1`.

## 1. Verdict

# NOT READY TO START — for one reason, and it is not the software

**The application has never run on a phone.** No Android build, no iOS build, no emulator, no simulator, no device. Every claim anyone can make about OctaPM Mobile today rests on the production web export driven against the live API — which is a great deal of evidence about the logic and none at all about the handset.

That is the whole verdict. It is not a list of defects, because the defect list is no longer what stands in the way.

**What changed in this phase:** the last pilot blocker in the product was closed. A commercial approval on a phone now carries what it is worth, why it was raised, what it does to the programme and what evidence sits behind it, with a confirmation that names the record, the figure and the audit trail — and the app refuses to offer a money decision it has no figure for. Approvals re-score from 3.8 to **4.2**, overall from 4.43 to **4.4529, stated as 4.45**. The arithmetic is in the [certification report](OCTAPM_MOBILE_CERTIFICATION_REPORT.md); nothing was rounded up.

So the honest summary is: **the software is ready for a pilot to be prepared; the pilot cannot start until the three gates below are closed.** None of the three is a code change.

## 2. The three gates

### Gate 1 — a build, on real handsets

Nothing native is proven. Not the camera, not the barcode scanner, not the Keychain or the Keystore, not biometric unlock, not push delivery, not a deep link tapped from an email, not the SQLite outbox across a force-stop, not performance on a four-year-old Android.

The Android toolchain is absent from this machine and the host is Windows, so neither platform could be built here. **ANDROID NATIVE BUILD TOOLCHAIN NOT INSTALLED ON THIS MACHINE. IOS NATIVE LOCAL BUILD REQUIRES MACOS OR AN APPROVED REMOTE BUILD SERVICE.** Neither is a defect in the application. The exact commands are in the [Android report](OCTAPM_ANDROID_NATIVE_REPORT.md) §8 and the [iOS report](OCTAPM_IOS_NATIVE_REPORT.md) §4, and two prerequisites are genuinely missing from the repository and must be added first: `expo-dev-client` is not a dependency, and there is no `eas.json` or EAS project id.

Then run, per handset: the [offline procedure](OCTAPM_NATIVE_OFFLINE_REPORT.md) §4 and the [notification procedure](OCTAPM_NATIVE_NOTIFICATION_REPORT.md) §5. A failure in the offline procedure's steps 4–6 — the queue not surviving a force-stop, a reboot, or not draining when signal returns — is a pilot blocker and nothing else in this document matters until it passes.

### Gate 2 — the credentials and the hosted files

| Needed | Without it |
|---|---|
| Firebase project and `google-services.json` | No Android push |
| **A paid Apple Developer Program membership** | No iOS push and no universal links — both are paid-tier capabilities |
| `assetlinks.json` and `apple-app-site-association` under `/.well-known/` on `app.octapm.com` and `octapm.com`, carrying the release signing fingerprint | Tapped links open the browser instead of the app |

None of these exists today, none can be produced from here, and no signing material was created or committed in this phase.

### Gate 3 — four people and four tasks

No human has used this application. The [UAT report](OCTAPM_PILOT_UAT_REPORT.md) holds the protocol: a site engineer, a quality engineer, a storekeeper and a PM, each given one real task on a real handset, cold, with no help for ten minutes. The PM's task is the one to watch: before tapping Approve, can they say aloud what the change order is worth, why it was raised, what it does to the programme and what evidence sits behind it? The screen now shows all four. Whether that is enough is theirs to say, not ours.

This gate is larger than any open defect in the register, and automated certification does not touch it.

## 3. What is proven, so the decision is not made in the dark

All of it against the live API, on the production web export, on this date.

| Gate | Result |
|---|---|
| Mobile typecheck, lint, unit | **57 suites, 297 tests, all pass** |
| Backend | **200 suites, 2219 tests, all pass** |
| Full Playwright certification suite, phone and tablet viewports | **122 passed, 0 failed, 36 skipped by design** (12.9 minutes) |
| The new approval-context suite, live | 3 checks pass; 2 of them fail against a build with the fix mutated away |
| The new approval-context unit suite | 14 checks pass; 4 fail when the rule is removed |
| Web ↔ mobile propagation, eight handoffs | 7 realtime or immediate, 1 refresh-required (a server event gap, SRV-01–03) |
| Financial reconciliation, API against PostgreSQL | delta 0.00, no duplicate source keys |
| Android native configuration | generated and read: manifest, permissions, deep links, notification resources, SecureStore backup exclusion |

Two Android permissions the product has no use for — the microphone and draw-over-other-apps — were found in the generated manifest and removed. They would each have been a question at a client security review.

## 4. Open issues, and what they mean

MOB-P0: **none**. MOB-P1: **none open** — all four are fixed. The rest are MOB-P2 and MOB-P3 and are listed in the [known issues](OCTAPM_MOBILE_KNOWN_ISSUES.md) with file and line.

Four are worth the pilot lead's attention before day one, none of them blocking:

- **PILOT-15** — a link opened while signed out or biometric-locked drops the person on Home instead of the record. If crews are told "tap the notification", the first tap of the day is the broken one.
- **PILOT-05 / PILOT-06** — two offline defects that exist **only on the web target** by every reading of the code. If that reading is right they are irrelevant to a pilot on real phones; if it is wrong they are blockers. Gate 1's offline procedure is what decides which.
- **PILOT-04** — progress approval is still a single tap with no confirmation and does not name who submitted it. Out of scope this phase; it is the weakest remaining approval surface.
- **PILOT-16** — the approvals inbox row shows no value, so a PM with a dozen steps waiting cannot rank them without opening each.

## 5. A pilot that could start sooner

If the schedule cannot wait for both platforms: **Android only** is the shorter path. The Android project generates and builds with a standard toolchain, only Firebase is needed for push, and no paid developer programme gates it. iOS needs a paid Apple membership before push or universal links can exist at all. That is a scope decision for the product owner, not a recommendation this document makes on its own.

## 6. One sentence for the client

OctaPM Mobile is functionally complete and certified against the live platform, and is waiting on its first build, its push credentials and its first four users before it goes to site.
