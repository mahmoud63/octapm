# OctaPM Mobile — UX V2 Specification

**Audience:** the engineers building waves UX2-A through UX2-L.
**Date:** 2026-09-19. **Status:** the implementation contract. Reads with the [audit](OCTAPM_MOBILE_UX_AUDIT.md), the [information architecture](OCTAPM_MOBILE_INFORMATION_ARCHITECTURE.md), the [role experiences](OCTAPM_MOBILE_ROLE_EXPERIENCE.md), the [photo system](OCTAPM_MOBILE_PHOTO_SYSTEM.md), the [site reporting design](OCTAPM_MOBILE_SITE_REPORTING.md), the [connection matrix](OCTAPM_MOBILE_DASHBOARD_CONNECTION_MATRIX.md) and the [wireflows](OCTAPM_MOBILE_WIREFLOWS.md).

## 1. What we are building

Not a better menu. A field operating system that answers, for whoever is holding the phone: **what do I have to do today, what is happening on site, what needs me, what is late, what is blocked, what can I capture now, what changed, and what does the office need to know.**

Three rules govern every decision below.

1. **Role decides the shape; permission decides the contents.** Neither alone is enough — `site_engineer` and `quality_engineer` hold identical permissions and need different apps.
2. **The server owns every number.** The app renders what the API computed and never calculates a KPI it then presents as truth. A figure the server did not send renders as an em-dash.
3. **Nothing is invented.** Where the platform cannot serve a section, it is derived from records that exist, hidden, or the model is extended — never faked (§63). The 212 unsupported needs each carry their option in the [page inventory](OCTAPM_MOBILE_PAGE_INVENTORY.md).

## 2. The design system comes first

The audit's design domain returned ten REDESIGN verdicts against nine primitives. Every screen in every later wave depends on these, so **UX2-A builds the system before anything is rebuilt on top of it.**

| New primitive | Replaces | Why |
|---|---|---|
| `FactGrid` | **97 hand-rolled `Fact` renders** and an eleven-fact 450 px "Details" card | The label:value grid is the single most repeated pattern in the app and has no component |
| Icon set + `IconButton` | text-only affordances; **only six files in the app import an icon** | A fixed construction iconography — RFI, NCR, punch, inspection, delivery, transfer, drawing, activity, location, camera, signature, weather, manpower — so a list is scannable at arm's length |
| `PhotoStrip`, `CameraTile`, `PhotoField`, `CameraAction` | nothing — evidence exists on 17 of 107 screens | The affordance that makes §15–§21 possible everywhere |
| `StatusTag` with a per-module vocabulary map | a regex over status strings | quality pass/fail/pending, schedule not_started/in_progress/complete/delayed, inventory quarantine/released/damaged — a word beside every colour |
| `Sheet` | **eight hand-rolled `Modal`s** | one header, scroll, keyboard handling and footer actions; fixes PILOT-14's keyboard overlap in one place |
| `Toggle` family — Checkbox, Switch, Radio, SegmentedControl | a checkbox rendered as the character `☑` inside a button | |
| Field inputs — `DateField` (Today/Yesterday), `QuantityField` (big keypad, unit suffix, steppers), `CurrencyField`, `ScanField` | generic text inputs | gloves, sunlight, one hand |
| `SectionHeader`, `SummaryRow`, `MetricTile`, `ListGroup` | `Card` used for everything | density: construction people want many facts per screen, not three giant cards (§56) |
| `Toast` / `SyncConfirmation` | silent success, a red line for failure | **"Approved. The dashboard now shows RFI-034 as closed."** — this is how §22's promise becomes visible |
| `RecordHeader` v2 | the current header | reference · title · status · location · ball in court, then tabs (§58) |

Density and legibility are part of the contract: a tap target floor of 44 px, `tabular-nums` wherever figures align, a type scale that survives 160 % text size, and a theme that is legible in sunlight. The connectivity bar's 13 px white-on-warning caption (measured at ~1.6:1 in dark) is replaced.

## 3. Navigation

Five slots, computed from the role, using expo-router's existing `href: null` mechanism so every other stack stays deep-linkable. The nine tab sets are tabulated in the [information architecture](OCTAPM_MOBILE_INFORMATION_ARCHITECTURE.md) §3; field roles get a centre **Capture**, management roles get a second analytical destination. **Projects and Search lose their permanent slots** — the project switch already lives in the header, and search belongs in every list header plus More.

Every destination named there was verified to exist against the running API.

## 4. Screen patterns

**Every record type, one shape,** so the app is learnable once:

```
LIST     search · filter chips · grouping · freshness · sticky primary action
  ↓
DETAIL   RecordHeader: reference · title · status · location · ball in court
         [ Overview ] [ Evidence ] [ Activity ] [ Related ]
         sticky contextual actions
```

- **Overview** — `FactGrid` of the facts the server sent, in the server's own labels.
- **Evidence** — attachments and photos, with `CameraAction`. Present on every record type the attachment service accepts (52 of them).
- **Activity** — comments and status history, the audit trail for this record.
- **Related** — the linked records. This is what makes OctaPM a connected platform rather than twelve registers, and it is absent almost everywhere today: an activity that says "Inspection required" does not link to the inspection.

A tab with genuinely nothing in it is not shown.

## 5. State patterns

Every screen must express seven states in words, not only icons:

**loading** (skeleton of the real shape) · **empty** (what this screen is for, and how the first record gets created) · **error** (a sentence and a retry; never a code) · **offline** (what is shown and how old) · **stale** (the freshness line) · **queued** (the record appears in its register with a WAITING badge, not only in the outbox) · **conflict** (yours beside theirs).

Two of these are new behaviour, not new styling:

- **Queued records appear where they belong.** Not one screen imports `useOutbox` today except the outbox. A punch item raised offline must appear in the punch register, a queued photo in the gallery.
- **The loop closes back to the office.** `item.resultId` already holds the id the server assigned and no screen uses it. After a send: *"Sent — this is now PUNCH-114 on the web register."*

## 6. Offline capture, extended

`OutboxKind` today is `punch.create | form.create | daily-log.entry | timesheet.create | attachment.upload | goods-receipt`. **`progress.submit` and `rfi.create` are missing, and they are the two most frequent field writes in the product.** UX2-C adds them through the existing outbox machinery — client-generated replay key, ordered drain, the same sender contract — and changes nothing about how the queue works. Stock movements and approvals stay online-only by policy, and say so in a sentence.

## 7. The three cross-cutting systems

- **Evidence** — one capture component, context inherited never typed, permission-gated, on every record type the platform accepts. [Photo system](OCTAPM_MOBILE_PHOTO_SYSTEM.md).
- **Site reporting** — eleven sections: seven native, four derived, none missing. [Site reporting](OCTAPM_MOBILE_SITE_REPORTING.md).
- **Dashboard connectivity** — every mobile action visibly reaching the office, with the propagation class stated honestly where the server publishes no event. [Connection matrix](OCTAPM_MOBILE_DASHBOARD_CONNECTION_MATRIX.md).

## 8. Tablet

Master–detail already works through `SplitGroup` in eleven module layouts and must not regress. UX2-J adds the **third pane** and the density to fill it:

```
[ rail ] [ list ] [ record ] [ evidence · history · actions ]
```

plus a two-column composition on the dashboards, a full-screen drawing workspace, a date-grouped photo contact sheet with a lightbox, a tablet review queue for approvals, and a `SplitGroup` for `documents/` which has none. **`TimelineStrip` is currently locked behind `isExpanded`** — a phone gets no visual programme at all, which UX2-E addresses.

## 9. The waves

Each wave ends with typecheck, lint, the affected unit tests, the affected Playwright specs, and a check that permissions, deep links, offline, sync and financial side effects still behave (§67).

| Wave | Contents | Gate |
|---|---|---|
| **UX2-A** | Design system (§2) · role-shaped navigation · Capture sheet · Sync Center · the stale `needs-you.tsx:80` sentence | every primitive rendered in light/dark at 100 % and 160 %; nine tab sets resolve; no regression in deep links |
| **UX2-B** | Nine role homes · Needs You grouped (§36) · Notifications tabs (§35) | each role's home renders only what its permissions allow; every figure traced to an endpoint |
| **UX2-C** | Evidence everywhere · photo-first capture · markup · gallery views · `progress.submit` and `rfi.create` queued | §68: a photo from each of eleven origins lands with the right project, record, user and time, read back from the API |
| **UX2-D** | Site Reporting home · the eleven sections · submit/approve lifecycle · manpower report | §69 end to end, verified on the web |
| **UX2-E** | Project Dashboard · Overview · Activity feed · Locations · Location detail · Activity detail with related records · phone programme view | locations empty state is honest; no fabricated SPI |
| **UX2-F** | RFI · drawings (full-screen viewer, markup, pin-drop) · documents · submittals · specifications | Android PDF rendering resolved or the limitation stated on screen |
| **UX2-G** | Quality detail depth · ITP hold points · defects · safety incident and corrective actions · punch walk mode | approvals work **on a phone** — the `isExpanded` gate at `activities/[id].tsx:80` is removed |
| **UX2-H** | Inventory and procurement depth · material requisition · deliveries board · suppliers · three-way match | §75 financial reconciliation: delta 0.00, no duplicate ledger rows or movements |
| **UX2-I** | Commercial depth · IPC · EOT · approval detail · contract position | no commercial figure computed on the device |
| **UX2-J** | Tablet and iPad third pane, drawing workspace, review queue, photo contact sheet | every size in the device matrix, no horizontal overflow |
| **UX2-K** | Dashboard connectivity both directions · the web additions §51 permits | §74 hard gate, live, both directions |
| **UX2-L** | Certification: per-role (§70), scorecard (§71), screenshots (§72), user-flow (§73) | ≥4.5 overall, no primary role below 4.2, **actual arithmetic** |

## 10. What must not regress

Authentication · RBAC · tenant isolation · project isolation · financial rules · the Cost Ledger · inventory · the workflow engine · notifications · deep links · the offline architecture · web↔mobile propagation. The read cache **does** persist across a restart (`offlineSessionStarted` → `restoreQueryCache`, the CERT-02 fix) — an early audit claim to the contrary was wrong and is corrected in the [audit](OCTAPM_MOBILE_UX_AUDIT.md) §6. Master–detail, the drawings register, the inspection checklist, `ProgressSheet`, the approvals inbox and "copy yesterday's crews" are the parts that already work; the redesign carries them forward rather than replacing them.

**Native device verification remains a separate gate.** Browser screenshots are never labelled NATIVE VERIFIED (§76).
