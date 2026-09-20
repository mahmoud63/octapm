# OctaPM Mobile — Field Evidence System

**Audience:** whoever maintains the evidence system, and the reviewer checking that mobile photos reach the office.
**Date:** 2026-09-20. **Status:** BUILT in UX2-C (`729b85f`). What follows is the design; §10 records what was implemented and what was left.

## 1. The finding that shapes everything

**OctaPM already has exactly one canonical evidence system, and it already does most of what the brief asks for.** The mobile app barely uses it.

`backend/src/services/attachment.service.js` holds a frozen map `RECORD_TYPE_MODULES` of **fifty-two record types to the permission module that guards each one**, and five roles (`attachment`, `evidence`, `photo`, `reference`, `signature`). Uploading through it does two things at once:

1. creates a `ProjectDocument` and an `Attachment` row linking that document to the record, guarded by that record's own module permission; and
2. when the file is an image, creates a `Photo` row carrying `locationId`, `caption`, `tags[]`, `takenAt`, `latitude/longitude/altitude`, `cameraMake/cameraModel`, `width/height/orientation`, `exifJson`, `uploadedBy` and a `thumbnailKey`/`thumbnailStatus`.

So **one upload puts the evidence on the record and in the project gallery at the same time.** The gallery query already supports a `takenAt` range, tags, and — importantly — a **location subtree** (`where.locationId = { in: subtree.map(...) }`), so "all photos on Level 4" works today across every descendant location.

§49 of the brief says: do not create a `mobile_photos` table; use the same authoritative evidence architecture as the web. **That is already satisfied by the platform.** The work in UX2-C is not to build a photo system — it is to put a capture affordance on the screens that lack one, and to pass the context the platform is already willing to store.

## 2. Where evidence can be attached today

Quoted from `RECORD_TYPE_MODULES`, mapped against the brief's §16 list of twenty-three record types.

| §16 asks for | Record type today | Module guard | Supported |
|---|---|---|---|
| Project | `project` | `project_parties` | yes |
| Activity | `activity` | `schedule` | yes |
| Location | `location` | `location` | yes |
| Daily Report | `daily_log`, `daily_report`, `site_diary` | `progress` | yes |
| RFI | `rfi` | `rfi` | yes |
| Submittal | `submittal` | `submittal` | yes |
| Inspection | `form_instance` (also `form_template`, `form_response`) | `inspection` | yes |
| NCR | `ncr` (also `itp`, `defect`, `material_test`) | `ncr` | yes |
| Punch | `punch_item` | `punch` | yes |
| Safety | `safety_incident` | `safety` | yes |
| Task | `task` | `task` | yes |
| Goods Receipt | `delivery_receipt` | `procurement` | yes |
| Delivery / PO delivery | `procurement_order`, `procurement_package` | `procurement` | yes |
| Change Event | `change_event` (also `rfq`) | `change_event` | yes |
| Progress Update | `progress_submission` | `progress` | yes |
| Delay | `weather_delay` | `eot` | yes |
| Document note | `document` | `document_control` | yes |
| Drawing issue | `drawing`, `sheet`, `sheet_revision`, `markup`, `pin` | `document_control` | yes |
| Meeting action | `meeting_action` (also `meeting`) | `meeting` | yes |
| Cost evidence | `cost_record`, `direct_cost` | `cost` | yes |
| **Material (inventory item)** | — | — | **no** |
| **Material issue (stock movement)** | — | — | **no** |
| **Equipment** | — | — | **no** |

Twenty of the twenty-three are supported now. The three that are not are a real gap and §63 forbids faking them.

**The honest options for the three, in order of preference:**

1. **Goods receipt already covers the receiving half.** A storekeeper photographing a delivery attaches to `delivery_receipt`, which exists. So the inventory gap is narrower than it looks: it is the **issue** and the **item** that cannot hold evidence, not the receipt.
2. **Extend the existing map, do not build a parallel one.** Adding `inventory_item: "inventory"`, `stock_movement: "inventory"` and `equipment: "progress"` to `RECORD_TYPE_MODULES` is a three-line change to the canonical service that inherits its permission guard, its storage, its thumbnailing and its gallery behaviour. That is an extension of the existing domain model, which §49 and §63 explicitly allow, not a second system. It requires the corresponding `Attachment` lookups for those record types to resolve, which needs checking before it is promised.
3. **Until then, hide the affordance** on those three screens rather than offering a camera button that fails.

This document does not decide between 2 and 3; UX2-C must verify option 2 against `attachment.service.js`'s record resolution before committing, and fall back to 3 if it does not resolve cleanly.

## 3. What a photo carries, and what it cannot

§18 wants every photo to be able to carry: project, date/time, photographer, location, activity, drawing, RFI, NCR, inspection, punch, task, material, PO/delivery, change event, daily report, caption, tags, GPS.

| Context | Where it lives | Status |
|---|---|---|
| Project | `Photo.projectId` | native |
| Date/time | `Photo.takenAt` (falls back to `document.uploadedAt`) | native |
| Photographer | `Photo.uploadedBy` | native |
| Location | `Photo.locationId` — and the gallery filters by subtree | native |
| Caption, tags | `Photo.caption`, `Photo.tags[]` (limit 20) | native |
| GPS | `Photo.latitude/longitude/altitude`, `exifJson` | native, **opt-in only** |
| Camera | `Photo.cameraMake/cameraModel` | native |
| The record it belongs to (RFI, NCR, inspection, punch, task, change event, daily log, PO…) | the `Attachment` row, **not** the `Photo` row | native, via a different table |
| **Activity** | nowhere on `Photo` | **only** via an `Attachment` to `activity` |
| Drawing | via an `Attachment` to `sheet`/`drawing` | native |

The one asymmetry worth designing around: **a photo's record link is on `Attachment`, its site metadata is on `Photo`.** A site photo taken with no record is a `Photo` with a `ProjectDocument` and no attachment; a photo taken on an NCR is both. The mobile app must therefore always upload through the attachment route with a `recordType`/`recordId` when there is a record, and pass `locationId` either way. It must never write to `Photo` directly.

**Activity context** is the single field §18 asks for that the schema does not carry on `Photo`. Two honest routes: attach to `activity` as the record (which works today and is how "photos of activity A120" should be answered), or add a nullable `activityId` to `Photo` — a one-column extension of an existing model. UX2-C should take the first and only consider the second if the gallery genuinely needs to filter by activity the way it filters by location.

**GPS is opt-in.** The brief says "GPS only if allowed and explicitly used". The columns exist and EXIF may carry coordinates. The app must not enable location tagging silently: it is a per-project setting or a per-capture choice, and the capture sheet says when a photo will carry coordinates.

## 4. The capture affordance

One component, `<CaptureButton>`, used everywhere, that takes the context it is standing in and never asks the person to re-state it.

```
<CaptureButton
  recordType="ncr" recordId={ncr.id}      // omitted for a pure site photo
  locationId={locationInContext}          // from the record, the location screen, or the project
  role="evidence"                          // attachment | evidence | photo | reference | signature
/>
```

Rules:

- **Context is inherited, never typed.** Standing inside Activity A120 on Level 04 and tapping Capture attaches to the activity and stamps the location. The person adds a caption and optional tags; that is all.
- **The sheet states what it will record**, in words: "Photo on NCR-012 · Level 04 · Zone B". If it will carry coordinates it says so.
- **Permission decides visibility.** The button is drawn only when the person holds the guarding module's `create`/`update` right, using the same `allows()` check the rest of the app uses. A button that would be refused is never shown.
- **Three sources**: take a photo, choose from the library, choose several. No video in this phase — the brief does not require it and the backend thumbnailer is image-only.

## 5. Global Capture (§17)

A centre action in the bottom bar for the field roles, opening a sheet whose entries are **role-filtered and permission-filtered**:

| Action | Guard | Lands on |
|---|---|---|
| Site photo | `document_control.create` | capture, attached to the project (and current location if one is chosen) |
| Progress update | `progress.submit` | the progress form, with capture attached |
| Daily log entry | `progress.submit` | today's log, section chooser |
| Raise RFI | `rfi.create` | the RFI form |
| Punch item | `punch.create` | the punch form |
| NCR | `ncr.create` | the NCR form |
| Safety observation | `safety.create` | the safety form |
| Inspection | `inspection.create` | the inspection starter |
| Material receipt | `inventory.create` | goods-in |
| Task | `task.create` | the task form |

The sheet is the same component for every role; only the rows differ. The centre slot itself is shown for the field-facing roles (site engineer, quality engineer, warehouse) and omitted for the management roles, whose fifth slot is better spent elsewhere — see the [information architecture](OCTAPM_MOBILE_INFORMATION_ARCHITECTURE.md).

## 6. Markup (§19)

The app already has a markup path: `mobile/src/photos/` with a mark-up step before upload, and the backend has `markup.service.js` and a `markup` attachment record type. UX2-C extends the existing editor rather than writing a new one: arrow, circle, rectangle, freehand, text, colour, undo.

**The original is never destroyed.** The marked copy is uploaded as a derivative — a second document — and the original stays attached. This is already how the certified daily-log markup path behaves and it must not regress.

## 7. Offline (§48)

The outbox already queues photo evidence with a client-generated replay key, and a photo queued behind a record is sent against the id that record's own send returned — that was the CERT-01 fix and it is regression-tested. UX2-C changes nothing in that machinery. What it adds is honesty on screen:

- a queued photo shows **WAITING TO UPLOAD** with its thumbnail, not a spinner with no content;
- a failed upload keeps the local file and offers **Retry** and **Discard**, and says why in a sentence;
- **a field photo is never silently lost** — if the outbox drops an item the person is told which one.

Two known web-target-only defects bear on this and must be re-checked on a device before the pilot, not assumed away: PILOT-05 (a queued photo is base64 in one storage document on web, so a quota failure drops the outbox) and PILOT-06 (a replayed upload sends plain objects rather than files on web). Both are expected to be irrelevant on a device, where the queue is SQLite-backed and the file reference is real — **expected, not demonstrated**.

## 8. The gallery (§20) and the web feed (§21)

The gallery endpoint already returns `{items, pagination, summary}` and already filters by `takenAt` range, tags and location subtree. That covers the brief's Timeline, By Location, By Date and tag-search views directly. **By Activity, By User, By Record Type and By Company are not filters the endpoint offers today** — By User is derivable from `uploadedBy` on the returned rows, the others are not, and the spec must either derive them client-side over a page (honest but partial) or leave them out. It must not pretend to filter what it is only sorting.

For §21, the web dashboard (`frontend/src/features/dashboard/index.tsx`) has no site-photo surface today. A **Latest site photos** section there, reading the same gallery endpoint, is a contained addition of the kind §51 permits — it adds a view of existing data and redesigns nothing.

## 9. What UX2-C must prove (§68)

A photo captured from each of these reaches the server with the right project, record, user and timestamp, and is visible on the web:

activity · daily report · RFI · inspection · NCR · punch · task · delivery · goods receipt · change event · global Capture.

Each is a live check against the running API, in the dedicated end-to-end organisation, asserting the `Attachment` row's `recordType`/`recordId` and the `Photo` row's `projectId`, `uploadedBy`, `takenAt` and `locationId` — read back from the API, not from the app's own state.


## 10. What UX2-C actually built

One component, `mobile/src/components/Evidence.tsx`, is the whole capability. `AttachmentList` is gone and its five call sites moved across. Every record screen that carries evidence uses it, and none has a camera of its own.

**Record types with evidence in the app today:** activity · RFI · inspection (form response) · punch item · material test · NCR · safety incident · task · change event. Purchase orders accept evidence through the same endpoint and were exercised live; their screen surfaces it in UX2-H.

**Context is inherited.** The component takes `recordRef` and `locationId` from the screen the person was already on, and the upload carries both. `locationId` and `tags` were always accepted by `POST /projects/:id/attachments` (attachments.js:147–148) and the client simply never sent them.

**Result state.** The outbox item now carries `resultRef` beside `resultId` — what the office calls the record. Senders return it: a punch item as its ref, an inspection as its ref, a goods receipt as its receipt number, a photograph as the record it landed on. The outbox says *"The office has this as PUNCH-114"* and offers **Open record**. `src/offline/result.test.ts` holds it; three of its four checks fail when the reference stops being persisted.

**Offline.** A photograph is kept on the device, queued with its replay key through the existing `attachment.upload` kind, and shown **on its own record** as waiting to upload rather than only in the outbox. The dependency ordering that makes a photograph wait for its parent record (CERT-01) is unchanged and still tested.

**Two defects fixed by looking at the running app.** The first was mine: the evidence component filtered inside the `useOutbox` selector, so the store's snapshot changed on every render and eight screens hit "Maximum update depth exceeded" — select the stable slice, narrow with `useMemo`. The second is the platform's: every photograph in the certified project reports `thumbnailStatus: "pending"` and that endpoint returns **500**, so both the gallery grid and the home strip were firing a failing request per tile and drawing "No preview". Both now ask only when the server says `ready`.

**Gallery filters** now use what the route always supported: Today, This week, and by record type (daily report, progress, activity, RFI, NCR, punch, safety, delivery), alongside the existing search and tags.

### Not built in this wave

- **Markup** stays as it is: the existing pre-upload annotate path is unchanged, and the marked copy is still a derivative rather than an overwrite. A published, editable, attributed markup against `markups.js` is a later wave.
- **A camera-first capture screen with a review step** (§8) — capture still starts from the record. The context-inheritance work that makes a global capture screen possible is done; the screen itself belongs with UX2-E, where Locations gives it somewhere to stand.
- **Inventory item, stock movement and equipment** still cannot carry attachments; that is a backend record-type extension, classified EXTEND and not taken in this wave.

### Proven live (`e2e/cert-evidence.spec.ts`)

A photograph attached from an activity is readable by the office against that activity **and** appears in the project gallery from the same upload. Evidence was attached to seven record types in one run: activity, RFI, punch item, NCR, task, change event, purchase order. A record belonging to another project is refused. And `mobile_photo` is not a record type the platform has — there is no mobile-only silo to create one in.
