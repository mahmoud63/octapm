# Drawings tool: sets → sheets → revisions (OCTA-DWG-CORE-011)

Upload a designer's PDF set, let the title blocks be read per page, check
the grid, publish — and the site sees only current sheets.

## Model

| Table | Purpose |
| --- | --- |
| `DrawingSet` | One uploaded PDF: `setNumber` (SET-001…), `name`, `discipline` (fallback), `purpose` (IFC / IFT / IFA / AS_BUILT / TENDER / SHOP / RECORD / OTHER), `status` (draft → processing → review → published / archived / failed), `sourceDocumentId`, `pageCount`, `processedPages`, `detectionSummaryJson`, `receivedAt`, `issuedAt`, `jobId`, `error`. |
| `Sheet` | One drawing number per project (`number` unique per project, `title`, `discipline`, `locationId` area, `status` current / obsolete + `obsoleteReason`, `currentRevisionId`, `sortKey` natural sort, `drawingRecordId` for rows migrated from the legacy register). |
| `SheetRevision` | One page of a set (or a single-sheet upload): `documentId` + `pageNumber`, working `number` / `title` / `revision` / `discipline`, `status` (pending_review → published → superseded, or rejected), detected values + per-field `confidenceJson`, `textStatus`, page size / rotation, review and publish stamps, `supersededById`. Unique per (`setId`, `pageNumber`). |

The migration turns every legacy `DrawingRecord` into a `Sheet` and its
latest stored `DocumentRevision` into the published `SheetRevision`, so the
existing register is the day-one sheet list. `DrawingRecord.fileUrl` is no
longer written by the drawings tool (the legacy register stays readable).

## Pipeline

1. `POST /projects/:id/drawings/sets` (multipart PDF, ≤ 250 MB, ≤ 1 500
   pages) stores the file as `documentType = drawing_set` and queues the
   `drawing.set_process` job → 202 with the set in `processing`.
2. The job (`drawing-set.service.runDrawingSetJob`) reads the PDF once with
   `utils/document-text.pdfPages` (text layer, MediaBox size, rotation per
   page) and runs `utils/sheet-title-detect.detectSheetMetadata` on every
   page: keyword forms (`DWG NO`, `SHEET TITLE`, `REV`) score ≥ 0.85,
   standalone number lines 0.6, bare patterns 0.4; discipline comes from the
   number prefix (A/S/C/M/E/P/FP/L/T/G/…) or the set's default. Each page
   becomes a pending `SheetRevision`; progress is reported every 10 pages
   (`processedPages`, job progress) and the set moves to `review` with a
   `detectionSummary` (detected / needs review / no text). Pages already
   published from the set are left untouched on re-processing.
3. Reviewers fix the grid (`PATCH …/sets/:setId/revisions`, up to 500 rows;
   numbers are normalised and disciplines derived) and can mark pages that
   are not sheets as rejected.
4. `POST …/sets/:setId/publish` (transition `drawing.publish`: PM, planning
   engineer) publishes every pending page with a number (or a chosen
   subset): the Sheet is found or created by number, the previous current
   revision is superseded (`supersededById`, `supersededAt`), the new one
   becomes current, the sheet's title/discipline follow the revision, and it
   is un-obsoleted. All-or-nothing; duplicate numbers inside one publish are
   rejected (`SHEET_NUMBER_DUPLICATE`). Pages without a number are skipped
   and reported. Audit events: `sheet_revision.published`,
   `sheet_revision.superseded`, `drawing_set.published`. Notifications:
   followers of the set plus PM / planning / site engineer roles
   (`drawing_set.published`, category workflow).
5. Single-sheet flow: `POST …/sheets/:sheetId/revisions` (multipart, `revision`
   label, optional `publish=true` for publishers) creates a pending
   revision; `POST …/sheets/revisions/:revisionId/publish` publishes it.

## Visibility rules

- Reading sheets/sets: `document_control.read` (every role).
- Upload and review: transition `document.revision.upload` (PM, planning,
  site engineer).
- Publish: transition `drawing.publish` (PM, planning engineer, or a
  permission template granting it).
- `GET …/sheets` lists current revisions only. `GET …/sheets/:id` returns
  superseded revisions only to users with `document_control.update`; the
  viewer shows a banner when a superseded or pending revision is open, and
  an obsolete banner when the sheet is obsolete.
- Obsolete: `PATCH …/sheets/:id { status: "obsolete", obsoleteReason }`;
  publishing a new revision makes the sheet current again.

## API summary

| Method | Path |
| --- | --- |
| GET / POST | `/projects/:id/drawings/sets` |
| GET / PATCH / DELETE | `/projects/:id/drawings/sets/:setId` (delete only before anything was published; archive otherwise) |
| POST | `/projects/:id/drawings/sets/:setId/reprocess` |
| GET / PATCH | `/projects/:id/drawings/sets/:setId/revisions` |
| POST | `/projects/:id/drawings/sets/:setId/publish` |
| GET | `/projects/:id/drawings/sheets?discipline&locationId&search&status&setId` |
| GET | `/projects/:id/drawings/sheets/offline-manifest` (current files with sizes and sha256 for device caching) |
| GET / PATCH | `/projects/:id/drawings/sheets/:sheetId` |
| GET / POST | `/projects/:id/drawings/sheets/:sheetId/revisions` |
| POST | `/projects/:id/drawings/sheets/revisions/:revisionId/publish` |

Sheets, sets and revisions are comment-able and attachable record types
(`sheet`, `drawing_set`, `sheet_revision`) and have workspace links
(`/projects/:id/doc-control/drawings?recordId=&source=sheet|drawing_set`).

## Frontend

Doc control › Drawings is now the drawings tool
(`features/drawings/components/drawings-module.tsx`):

- **Sheets** — the current register as cards with lazily rendered page
  thumbnails (PDF.js, one download per set shared by every tile), filters
  by search / discipline / area (location tree) / current-obsolete-all, and
  an **Offline list** dialog built from the manifest.
- **Sheet viewer** — PDF.js canvas at device pixel ratio with zoom steps,
  fit-to-width, rotate, Ctrl + wheel zoom, revision picker with
  superseded / pending / obsolete banners, "New revision" upload (publish
  immediately for publishers), obsolete toggle for document controllers,
  and the sheet's discussion thread.
- **Sets** — upload dialog (PDF, name, issued-for, default discipline,
  received date, upload progress), set list with live processing progress,
  and the **review grid**: thumbnail, editable number / title / revision /
  discipline, confidence badge (green ≥ 80 %, amber ≥ 50 %, red / "No text"),
  "Not a sheet" reject, Save, Publish N sheets, Re-read title blocks,
  Archive / Delete.
- The legacy drawing register (workflow records used by RFIs and
  transmittals) stays under a collapsed toggle beneath the sheet grid.

PDF.js (`pdfjs-dist`) is loaded as its own chunk the first time a sheet is
rendered; bytes are fetched through the authenticated API client.

## QA checklist

1. Upload a 20-page IFC PDF → set shows processing with a progress bar,
   then "Ready for review" with the number of pages read automatically.
2. In the grid, pages with a keyword title block are pre-filled ≥ 90 %;
   correct one number, reject the cover page, Save → rows update.
3. Publish → toast with published count; Sheets tab lists them with
   thumbnails; audit history on a sheet shows `published`.
4. Upload a revised set with the same numbers → publish → old revisions
   superseded; as a site engineer the viewer opens the new revision only;
   as PM the revision picker shows both and the old one carries a banner.
5. Mark a sheet obsolete → hidden from the default list, banner in viewer;
   publishing a new revision makes it current again.
6. Site engineer cannot see the Publish button (403 on the API).
7. Offline list shows every current sheet with file sizes.

## Markups, pins and compare (OCTA-DWG-MARKUP-012)

| Table | Purpose |
| --- | --- |
| `Markup` | A vector layer on a sheet: `visibility` personal (author only) or published (everyone), `shapesJson` (rect, ellipse, cloud, arrow, line, polyline, highlight, text, measure — all with 0..1 page-normalised coordinates), `shapeCount`, `sheetRevisionId` it was drawn on, `publishedAt`. |
| `Pin` | A point (`x`, `y` normalised) tied to a record (`recordType`, `recordId`: rfi, defect, photo, ncr, submittal, task, safety_incident, itp, correspondence) with optional `label` / `color`. |
| `Sheet.scaleRatio` | Drawing scale denominator (100 for 1:100) used by the measure tool. |

Because coordinates are normalised, layers and pins drawn on rev A appear
in the same place on rev B without any migration.

API (all under `/projects/:id/drawings`):

| Method | Path | Permission |
| --- | --- | --- |
| GET | `/sheets/:sheetId/markups` | document_control.read — published layers + the caller's personal layer |
| GET / PUT | `/sheets/:sheetId/markups/mine` | document_control.read — the caller's personal layer (created on first use); `PUT` replaces shapes (auto-save) |
| PATCH / DELETE | `/sheets/:sheetId/markups/:markupId` | author, or document_control.update for published layers |
| POST | `/sheets/:sheetId/markups/:markupId/publish` | document_control.create (PM, planning, site engineer); audited on the sheet as `markup_published` |
| GET / POST | `/sheets/:sheetId/pins` | document_control.read; dropping a pin also needs `create` on the target module when creating the record (`create: {…}` for RFI or defect) or `read` when linking (`recordId`) |
| GET | `/pins?recordType&recordId` | which sheets a record is pinned on |
| DELETE | `/pins/:pinId` | the person who dropped it, or document_control.update |

Shapes are validated server-side (`normalizeShapes`: known types only,
coordinates clamped, ≤ 500 shapes, ≤ 2 000 points, ≤ 500 text chars). A pin
that creates an RFI calls `rfi.service.createRfi` with the sheet named in the
question and leaves a comment ("Raised on sheet A-101 rev B") on the new
record; linking an existing record leaves "Pinned on sheet …". Every markup
publish / removal and pin add / remove is an audit event on the sheet, so the
sheet's activity feed doubles as the markup feed.

Frontend (viewer modes):

- **Markup** — tools: select, rectangle, ellipse, revision cloud, arrow,
  line, freehand, highlight, text, measure; colours and stroke; Delete /
  Backspace removes the selected shape, Escape returns to select. The
  personal layer auto-saves 0.8 s after the last edit and is invisible to
  others until **Publish to project** (needs document_control.create).
  Published layers of other users appear in the **Layers** row with
  show / hide and (for their author or a document controller) remove.
- **Pins** — click the sheet to raise an RFI on the spot, link an existing
  RFI or defect, or take / attach a photo (uploaded against the sheet, then
  pinned). Pin markers are coloured by record type and dimmed once the
  record is closed / answered; clicking one shows the record state with an
  **Open** link. Records list their pins as "On drawings · A-101" chips
  that open the viewer with the pin highlighted
  (`?recordId=<sheetId>&source=sheet&pin=<pinId>`).
- **Measure** — with a sheet scale (Scale button, document controllers)
  labels read real lengths (mm / m) derived from the PDF page size and the
  scale; without one they read the paper length.
- **Compare** — choose Before / After from the sheet's revisions (superseded
  ones for document controllers): side by side, tinted overlay (red =
  before only, blue = after only, dark = unchanged, with a "before" opacity
  slider) or **Changes** (per-pixel difference painted red with the changed
  share of the page). Rendering and the diff run in the browser with
  PDF.js; no server rasteriser is needed.

QA additions:

1. Draw a cloud and a text note as user A → user B on the same sheet sees
   nothing; A publishes → B sees the layer in "Layers" and can hide it.
2. Drop a pin → "Raise an RFI here" → the RFI opens from the pin dialog,
   its discussion shows "Raised on sheet A-101 rev B", and its record card
   shows "On drawings · A-101".
3. Publish rev C of the sheet → the pin and published layers still sit on
   the same feature; Compare › Changes highlights the revised area.
4. Set scale 1:100 → a measure across a 5 m bay reads "5.00 m".

## Known limits / follow-ups

- Title-block reading uses the PDF text layer; scanned sets come back as
  "No text" and are entered manually (OCR is a later card).
- No server-side per-page split or tiles: the viewer renders the page of
  the set PDF client-side (also how markups and compare work).
- Pins currently target RFIs, defects, photos and existing quality /
  submittal / task records; punch items and observations plug in with
  PUNCH-013 / OBS-015.
- QR codes per sheet (quick-create from the field) come with PUNCH-013.
- Very large sets (>250 MB) must be split by the issuer.
