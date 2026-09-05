# Unified attachments and photos (OCTA-DOC-ATTACH-006)

One link table for every record type, and a Photo entity for images.

## Model

| Table | Purpose |
| --- | --- |
| `Attachment` | `(recordType, recordId) → documentId` with `role` (attachment / evidence / photo / reference), `caption`, `sortOrder`, `source`. Unique per record + document, so one document can hang off many records. |
| `Photo` | One row per image `ProjectDocument`: `takenAt`, GPS (`latitude`, `longitude`, `altitude`), `cameraMake/Model`, `width/height/orientation`, `locationId`, `tags[]`, `caption`, `thumbnailKey` (ProjectDocument id of the thumbnail), `thumbnailStatus` (pending / ready / unavailable / failed), `exifJson`. |

`backend/src/utils/image-metadata.js` reads JPEG EXIF (IFD0, Exif IFD, GPS IFD),
JPEG SOF dimensions, PNG IHDR and WebP headers without a native dependency.
It runs on the multer temp file before the upload is cleaned up.

Legacy tables (`WorkflowAttachment`, `CommercialAttachmentRef`,
`TaskAttachment`, `photosJson`) stay readable; the migration copies every row
that points at a stored `ProjectDocument` into `Attachment` and creates
`Photo` rows for every image that is a site photo or attached somewhere.
`attachWorkflowDetailsToRecords` merges unified rows into the existing
`attachments` list (unified rows carry `attachmentId`, `photo`, `document`).

## API

| Method | Path | Permission |
| --- | --- | --- |
| GET | `/projects/:id/attachments?recordType&recordId` | record module `read` |
| POST | `/projects/:id/attachments` (multipart: `files[]`, `recordType`, `recordId`, `role?`, `caption?`, `locationId?`, `tags?`, `documentIds?`) | record module `update` / `submit` / `create` |
| DELETE | `/projects/:id/attachments/:attachmentId` | record module `update` / `submit` / `create` |
| GET | `/projects/:id/attachments/documents/:documentId` | any project member |
| GET | `/projects/:id/photos?from&to&locationId&tag&recordType&recordId&search&cursor&limit` | `document_control.read` |
| PATCH | `/projects/:id/photos/:photoId` `{ caption, tags, locationId, takenAt }` | `document_control.create` |
| GET | `/projects/:id/photos/:photoId/file` · `/thumbnail` | `document_control.read` |

Record type → module mapping lives in `attachment.service.RECORD_TYPE_MODULES`
(e.g. `ncr`/`itp`/`defect`/`material_test` → `ncr`, `daily_report` →
`progress`, `ipc` → `ipc`). Unknown types are rejected with
`ATTACHMENT_RECORD_TYPE_INVALID`.

Every create/delete writes an `AuditEvent` (`attachment`), which also emits the
realtime `record.changed` event for the project room.

## Thumbnails

`photo.thumbnail` background job (`runPhotoThumbnailJob`): when the optional
`sharp` package is installed it writes a 480 px JPEG as a new ProjectDocument
and marks the photo `ready`; without it the photo is marked `unavailable` and
the UI shows the original. Install with `npm install sharp --workspace=backend`
on hosts that should generate thumbnails. Failures mark `failed` and are not
retried.

## Frontend

- `AttachmentPanel` (`features/attachments/components/attachment-panel.tsx`):
  upload, camera capture (`capture="environment"`), "From gallery" (link an
  existing project photo), remove. Rendered inside every workflow record's
  Evidence section by `WorkflowRecordList` when it knows the project and
  record type; legacy rows without `attachmentId` are shown dashed.
- `PhotoGallery` (project module **Photos**): date range, location subtree,
  tag chips, record type and caption search; grouped by day; detail dialog
  with EXIF, GPS link, caption/tags/location editing and the records the photo
  is attached to.

## Manual QA

1. Upload a phone JPEG to an NCR → the tile shows a thumbnail (or the original
   when `sharp` is absent), the gallery shows it under its capture date, and
   the GPS link opens the map.
2. Attach the same photo to an RFI via "From gallery" → the gallery detail
   lists both records; removing it from the RFI leaves it on the NCR.
3. Filter the gallery by a location → photos tagged at child locations are
   included.
4. A finance user can browse the gallery but cannot edit captions; a site
   engineer can attach to NCRs but not to IPCs (403).
5. After migration, an NCR that had legacy evidence shows the same files in
   the Evidence panel and its images in the gallery.

## Known limits

- HEIC/HEIF metadata is not parsed (dimensions/EXIF stay empty).
- Bulk download and photo annotations are later cards.
