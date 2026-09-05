# Drawing intelligence (OCTA-AI-DWG-035)

Three helpers on the drawings tool, all draft-then-approve:

1. **Title blocks read by the vision provider** for the pages the automatic
   reader could not settle (scans without a text layer, missing numbers, low
   confidence). Pages are rendered **in the browser** with PDF.js and sent as
   JPEG data URLs; the proposals fill the review grid's empty fields as
   editable drafts and are saved only when the reviewer saves.
2. **Cross-references between sheets** — sheet numbers and detail callouts
   (`SEE S-201`, `3/A-501`) found in a page's text layer become links
   (`SheetReference`) resolved to the target sheet when it exists; the
   viewer shows *References* and *Referenced by* chips that open the sheet.
   Deterministic; no model call.
3. **What changed between two revisions** — the compare view can send both
   rendered revisions to the vision provider for a plain-language list of
   changes by area with a site-impact rating, next to the pixel diff.

## Where

- **Drawings › Sets › open a set** → *Read with AI (n)* in the header (only
  with a vision-capable provider and unsettled pending pages; n ≤
  `AI_DRAWING_PAGES`, default 8). Progress shows rendering / reading; the
  toast counts pages filled in. Typed values are never overwritten — the
  proposal only fills what is empty. Save / publish as usual.
- Same header → *Link references* once the set has published pages: reads
  every published page's text layer and links the sheets (one PDF parse per
  source document; stale text links removed).
- **Drawings › open a sheet** → the *References* bar under the toolbar:
  outgoing chips (×count on repeated callouts, dashed when the target sheet
  does not exist yet, *obsolete* badge) and *Referenced by*. *Find
  references* / *Re-read* rebuilds from the current revision (needs
  `document.revision.upload`).
- **Sheet › Compare** → *Explain the changes* under the canvases: summary,
  confidence, the change list (impact · Added / Removed / Changed · area ·
  description) and thumbs up / down on the run.

## API (tag "Assistant", `/projects/{id}/drawings/ai`)

| Endpoint | Permission | Notes |
| --- | --- | --- |
| `GET …/status` | `document_control.read` | `{ vision, provider, model, pageLimit }` |
| `POST …/sets/{setId}/read` `{ pages: [{ revisionId, image }], apply?, overwrite? }` | `assistant.read` + `document.revision.upload` | ≤ 12 pages (server caps at `AI_DRAWING_PAGES`), each a JPEG / PNG / WebP data URL ≤ ~2 MB. Per page: `current`, `proposal { number, title, revision, date, discipline, scale, drawnBy, references[], fields { confidence }, notes }`, `error`, `message`. `apply` writes empty fields of pending / rejected pages through `reviewRevisions` (all fields with `overwrite`). `degraded` without vision. |
| `POST …/sets/{setId}/references` | `document.revision.upload` | `{ sheetsBuilt, references, noText, revisions }` |
| `GET …/sheets/{sheetId}/references` | `document_control.read` | `{ outgoing[], incoming[], builtAt }`; each link carries the resolved sheet with its workspace `path`, `count`, `samples` (context snippets), `source`. |
| `POST …/sheets/{sheetId}/references` | `document.revision.upload` | Rebuilds from the current published revision; `textStatus` ready / no_text / no_revision. |
| `POST …/sheets/{sheetId}/compare` `{ a: { revisionId, image }, b: {…} }` | `assistant.read` + `document_control.read` | Both must be different revisions of the sheet (400 `DRAWING_AI_REVISIONS`). `comparison { summary, changes[{ area, description, kind, impact }], confidence }`. |

Runs are stored as `AssistantConversation` kind `sheet_read` (record
`sheet_revision`) and `sheet_diff` (record `sheet`) and can be rated through
the assistant feedback endpoint.

## Rules

- Proposals normalise the number (`normalizeNumber`), upper-case the
  revision, map the discipline onto the platform's list (falling back to the
  number prefix) and drop self-references; field confidence low / medium /
  high → 0.35 / 0.65 / 0.9.
- Reference extraction only keeps tokens that name **another sheet of the
  project** (`A-101`, `A 101` and `A101` are the same sheet); detail
  callouts count once; samples keep ±40 characters of context.
- Nothing is written to a sheet by the comparison; the title-block reader
  writes only with `apply`.

## Test

```bash
cd backend && npx jest src/services/__tests__/drawing-assistant.service.test.js
cd frontend && node scripts/drawing-assistant-ui.test.mjs
```

Manual: upload a scanned set (no text layer) → the review shows *No text*
badges and *Read with AI (n)* → run → numbers / titles appear as drafts →
save → publish → *Link references* → open a sheet → chips → click one → the
referenced sheet opens with *Referenced by* pointing back → Compare two
revisions → *Explain the changes*.

## Configuration

`AI_VISION` (off disables both vision features), `AI_DRAWING_PAGES` (pages
per read call, 1–12, default 8), provider keys as for the assistant.
