# OctaPM Mobile — Native Device Certification

**Audience:** the product owner and the pilot lead. This is the index for the native phase; each row links to the report that holds the evidence.
**Date:** 2026-09-18. **Branch:** `feat/p0-foundations-sprint1`.

## 1. The one-line answer

**No native device certification was achieved, because no native device, emulator or simulator exists in this environment — and this phase says so rather than dressing up what it did have.** What it did achieve: the remaining pilot blocker on commercial approvals is closed and verified against the running API, the Android native project was generated and read, two unnecessary Android permissions were found and removed, and every untested capability is named with the exact procedure that would settle it.

## 2. Evidence tags, used strictly

Per §33 of the brief, every result below carries exactly one tag, and they are never combined.

| Tag | Meaning | Used here |
|---|---|---|
| REAL DEVICE | run on physical hardware | never |
| EMULATOR | run on an Android emulator | never |
| SIMULATOR | run on an iOS Simulator | never |
| REMOTE BUILD ONLY | produced by a cloud builder, not run | never |
| REAL CONFIG | read from the generated native project on this machine | Android manifest, permissions, backup rules, link filters |
| WEB-LOGIC-VERIFIED | the production web export driven by Playwright against the live API | the application logic, throughout |
| UNIT | jest with native stand-ins | the modules named in each report |
| NOT TESTED | not demonstrated | everything native |

## 3. Environment

**ANDROID NATIVE BUILD TOOLCHAIN NOT INSTALLED ON THIS MACHINE.** No JDK, no Android SDK, no `adb`, no emulator, no Android Studio, no EAS CLI, no `EXPO_TOKEN`.

**IOS NATIVE LOCAL BUILD REQUIRES MACOS OR AN APPROVED REMOTE BUILD SERVICE.** The host is Windows 11 Enterprise 10.0.26100; Expo declines even to generate the iOS project here.

Neither is a defect in the application. Nothing was installed: not for want of permission, but because 1.2 GB of free RAM cannot run a Gradle build, an emulator will not run in it either, and the resulting APK could not have been installed on anything. The reasoning, and the exact commands for a machine with headroom, are in the [Android report](OCTAPM_ANDROID_NATIVE_REPORT.md) §1 and §8.

## 4. The reports

| Area | Verdict | Report |
|---|---|---|
| Commercial approval context (the pilot blocker) | **CLOSED AND VERIFIED** — WEB-LOGIC-VERIFIED against the running API | §5 below, and the [certification report](OCTAPM_MOBILE_CERTIFICATION_REPORT.md) |
| Android | REAL CONFIG VERIFIED, NOT TESTED ON DEVICE | [Android native report](OCTAPM_ANDROID_NATIVE_REPORT.md) |
| iOS | NOT TESTED | [iOS native report](OCTAPM_IOS_NATIVE_REPORT.md) |
| iPad | NOT TESTED | [iPad native report](OCTAPM_IPAD_NATIVE_REPORT.md) |
| Offline and sync on a device | NOT TESTED | [native offline report](OCTAPM_NATIVE_OFFLINE_REPORT.md) |
| Push and deep links on a device | NOT TESTED | [native notification report](OCTAPM_NATIVE_NOTIFICATION_REPORT.md) |
| Camera, barcode, files, SecureStore | NOT TESTED (SecureStore's backup exclusion is REAL CONFIG) | Android report §4, [native capability register](OCTAPM_MOBILE_NATIVE_VERIFICATION.md) |
| Human UAT | NOT PERFORMED | [pilot UAT report](OCTAPM_PILOT_UAT_REPORT.md) |
| Field pilot decision | see the verdict | [field pilot readiness](OCTAPM_FIELD_PILOT_READINESS.md) |

## 5. What changed in the product

### PILOT-02 — a commercial approval now carries its own consequence

The defect was never a missing figure on the server. `GET /projects/:id/workflows/instances/:id` has always returned a `context` for every tool — for a change order, `{ ref, title, amount, status, category, scheduleImpact }` — and the approval screen simply never rendered it. So the fix adds no computation and invents no value; it shows what the server already said, in the labels the server itself uses for those fields (`backend/src/services/workflow-tools.js`).

What a person now sees before deciding, on the phone:

```
WHAT YOU ARE APPROVING
Change value        $1,500.00
Reason              Site condition
Schedule impact     None
Status              Pending
Cost impact         Priced at cost
Schedule note       No programme impact
Affected activity   E2E progress activity …
Evidence            1 file on the record
```

and, on tapping Approve:

```
Approve change order VO-08?
Change value: $1,500.00
This action will record your approval in the project audit trail.
                                        Cancel   Approve
```

Four rules behind it, each with a test that fails when the rule is removed:

1. **Every tool, not just the ones with a screen.** An IPC certification shows its net payable and period, a budget revision its amount and change type, a commitment its schedule of values, vendor, type and retention, a pay application its net and gross for the period and any over-claim, a submittal its discipline and lead time. This closes CERT-03, which had been carried forward.
2. **A field the server adds later still appears**, humanised, rather than being silently dropped.
3. **`amount` is a money field only where the approval is a money decision.** The server sends `amount: 0` for a submittal; a submittal approval is not worth nothing, it is worth nothing to say.
4. **A money decision the app has no figure for is not offered on the phone.** No approve button, no reject button — a sentence and "Review on web". §7 of the brief, implemented as a rule rather than a hope.

And the evidence the card counts can actually be read: `EvidenceCard` was extracted from the quality record card and added to the change-order screen, so the file is one tap from the approval (PILOT-01).

### The server was checked, not trusted

§7 requires the server to revalidate rather than rely on what the app shows. Three attacks were run live against the running API in `e2e/cert-approval.spec.ts`:

| Attempt | Result |
|---|---|
| A person the step is not assigned to answers it, with the mobile client header | refused (403/404) |
| The same instance is answered under a **different project's** path | refused — the instance does not exist outside its project and tenant |
| A response key the template does not offer (`approve_silently`) | 400 |

After all three the instance is still `running` and undecided. Reading the route confirms why: `requirePermission("workflow", "submit")` with a transition check, an instance lookup scoped by `orgId` **and** `projectId`, a running-state check, a current-step check, a response-key check, a required-comment check, and a pending-assignment check for the actor, with override gated behind a separate `workflow:update` right.

### Two Android permissions removed

`RECORD_AUDIO` and `SYSTEM_ALERT_WINDOW` were both declared in the generated manifest and neither is used by the product. Causes traced exactly, fixes applied in `app.json`, manifest regenerated. See the [Android report](OCTAPM_ANDROID_NATIVE_REPORT.md) §5.

## 6. What this phase deliberately did not do

No rebuild of the app, no second mobile project, no backend architecture change, no Marketplace work, no broad audit, no multi-agent defect hunt. No production deployment, no store submission, no production signing, no merge to `main`. No Apple or Android signing material was created or committed. The P2 and P3 backlog was left in the backlog: §43 limits this phase to the pilot blocker, security and data-integrity defects, and it terminates here.
