# Photo and safety intelligence (OCTA-AI-PHOTO-034)

A site photo is shown to the vision-capable provider with its context and
comes back as a proposed caption, tags, the scene and activity, quality
notes and the **safety hazards visible in the image** — each with severity
and confidence. Nothing is written until the person applies the caption /
tags or raises an observation, which goes through the punch engine with the
photo attached as evidence.

## Where

- **Photos › open a photo** → *What the assistant sees*: *Analyse this
  photo* (or *Look again*) → confidence, activity and location hint, scene,
  caption with *Use caption*, tags with *Add tags*, quality notes, **Safety
  findings** with *Raise observation* (needs `punch.create`) — the raised
  OBS-nnn is linked back on the card; thumbs up / down on the run.
- **Photos header** → *Analyse uncaptioned photos*: the uncaptioned photos
  in the current date range (up to `AI_PHOTO_BATCH`, default 10); the toast
  counts analysed / already done / safety findings.
- **On upload** (`AI_PHOTO_AUTO=on`): every image upload also queues a
  `photo.analyze` job for the uploader, so the analysis is waiting when the
  photo is opened.

## API (tag "Assistant")

| Endpoint | Permission | Notes |
| --- | --- | --- |
| `GET /projects/{id}/photos/ai/status` | `document_control.read` | `{ enabled (provider + vision), provider, model, autoOnUpload, batchLimit }` |
| `POST /projects/{id}/photos/ai/analyze` `{ photoIds? \| from?, to?, uncaptionedOnly?, force?, limit? }` | `document_control.create` + `assistant.read` | Sequential; fresh analyses (< 24 h) reused unless `force`; stops on a degraded provider. |
| `GET /projects/{id}/photos/{photoId}/ai` | `document_control.read` | Latest stored analysis. |
| `POST /projects/{id}/photos/{photoId}/ai/analyze` `{ force? }` | `document_control.create` + `assistant.read` | Original ≤ 6 MB, else thumbnail; 409 `PHOTO_AI_UNREADABLE`; `degraded` without a vision provider. |
| `POST /projects/{id}/photos/{photoId}/ai/apply` `{ caption?, tags?, locationId?, overwrite? }` | `document_control.create` | Caption only when empty unless `overwrite`; tags merged; empty location filled. Through `attachment.updatePhoto` (audited). |
| `POST /projects/{id}/photos/{photoId}/ai/observation` `{ hazard, description?, severity?, trade?, … }` | `punch.create` | `punch.createPunchItem` (kind observation, type safety, priority from severity, source = the photo) + the photo attached as evidence. |

## What the model is asked

Only what the image shows; caption (what and where), 3–8 tags (trade,
element, stage), quality notes if visible, every safety hazard visible
(PPE, edges and openings, ladders and scaffolds, housekeeping, excavations,
fire / electrical, loads over people, access) with severity and confidence;
**never identify or describe people** beyond role and equipment; low
confidence when the image is not a site photo or unclear. Context supplied:
project, location on record, capture time, current caption and tags, the
records the photo is attached to.

## Storage

Each analysis is an `AssistantConversation` of kind `photo_analysis` on the
photo (`recordType = photo`) holding the context sent and the findings;
`GET …/ai` reads the latest, and the batch and *Analyse* reuse it for 24 h.
Background runs store under the uploader (`payload.userId` / the job's
requester).

## Walkthrough

1. Photos → open a photo of steel fixing near an open slab edge → *Analyse
   this photo* → caption "Rebar fixing on the level 3 slab, east bay", tags
   rebar / slab / level 3 / steel fixing, quality note on missing spacers,
   safety findings *Unprotected slab edge* (high) and *Worker without
   helmet* (medium).
2. *Use caption*, *Add tags* → the photo is updated (audited); *Raise
   observation* on the edge → OBS-007 (safety, high priority, location =
   the photo's) appears in Quality › Observations with the photo as
   evidence; the card links to it.
3. Photos header → *Analyse uncaptioned photos* → toast "4 photos analysed;
   3 safety findings — open a photo to review".
4. Set `AI_PHOTO_AUTO=on` → new uploads arrive with the analysis ready.
5. Unset the provider keys → the panel explains that no vision provider is
   configured; nothing else changes.

## Tests

`backend/src/services/__tests__/photo-assistant.service.test.js` (context
and image block, normalisation of tags / quality / safety, storage and
reuse; degraded without a provider / vision, outage, unreadable image;
batch with counts and reuse; apply rules and observation with evidence;
background job for the uploader) and
`frontend/scripts/photo-assistant-ui.test.mjs`.
