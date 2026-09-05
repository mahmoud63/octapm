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

## Known limits / follow-ups

- Title-block reading uses the PDF text layer; scanned sets come back as
  "No text" and are entered manually (OCR is a later card).
- No server-side per-page split or tiles: the viewer renders the page of
  the set PDF client-side, which is what MARKUP-012 builds on.
- QR codes per sheet and the raster revision compare are part of
  MARKUP-012.
- Very large sets (>250 MB) must be split by the issuer.
