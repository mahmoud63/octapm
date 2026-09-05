# Document text, full-text search and embeddings (OCTA-DOC-TEXT-010)

Every text-bearing upload is read once by the `document.extract` job; the
text becomes searchable across the project (and in the global search) and is
chunked for embeddings when a provider is configured.

## Model

| Table | Purpose |
| --- | --- |
| `DocumentText` | One row per `ProjectDocument`: `status` (pending / ready / unsupported / failed), `extractor`, `text` (≤ 800 000 chars), `excerpt`, `wordCount`, `pageCount`, `chunkCount`, `embeddingStatus` (none / pending / ready / failed / disabled), `embeddingModel`, `embeddingError`, `error`, `extractedAt`, and a generated `searchVector` (`to_tsvector('english', left(text, 400000))`, GIN-indexed). |
| `DocumentChunk` | Overlapping ~1 200-character chunks (`index`, `charStart`, `charEnd`) with an `embedding` `double precision[]` (empty until embedded). |

## Extraction (`backend/src/utils/document-text.js`)

No new dependencies. Readers:

| Type | How |
| --- | --- |
| text / Markdown / CSV / TSV / JSON / XML / RTF / log | UTF-8 decode (BOM stripped, RTF control words dropped); binary content is rejected. |
| HTML | scripts/styles removed, block tags → newlines, entities decoded. |
| xlsx / xlsm / xls / ods | `@e965/xlsx` (already used for BOQ import), one CSV block per sheet, `pageCount` = sheets. |
| docx | `backend/src/utils/zip-reader.js` (core `zlib`) → `word/document.xml` + headers, footers, footnotes; paragraphs → lines, table cells → tabs. |
| pptx | slides in numeric order + speaker notes, `pageCount` = slides. |
| odt / odp | `content.xml` paragraphs and headings. |
| pdf | Object parser (incremental updates win), Flate streams incl. PNG predictors, object streams (PDF 1.5 compressed objects), page tree order, per-page font resources (inherited through `/Parent`), literal and hex strings, `Tj` / `TJ` / `'` / `"`, line breaks from `Td` / `T*` / `Tm`, ToUnicode CMaps (`bfchar`, `bfrange`) for CID fonts, WinAnsi fallback for simple fonts, inline images skipped. Encrypted files → `unsupported: encrypted`; pages without text operators → `unsupported: no_text_layer` (scanned). |

`isExtractableDocument` excludes site photos and any `image/*` mime type.
Images never reach the extractor (OCR is a later card).

## Pipeline

1. `uploadProjectDocument` (all uploads) queues `document.extract` for
   extractable files; failures to queue never block the upload.
2. The job reads bytes from local storage or the S3 presigned URL, extracts,
   writes `DocumentText` + chunks in one transaction, then embeds chunks
   when a provider is configured (`embeddingStatus` records the outcome; a
   provider error keeps the text searchable and marks embeddings `failed`).
3. The migration queues extraction for every existing text-bearing
   document, so the index fills after deploy as workers run.
4. `POST /projects/:id/documents/reindex` (document_control.update) queues
   missing/failed documents (`force: true` re-runs everything, 500 per
   call); `POST /projects/:id/documents/:documentId/extract` re-runs one.

## Search

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/projects/:id/documents/search?q&limit&semantic` | `websearch_to_tsquery` (quotes, OR, -exclusions), `ts_rank_cd`, `ts_headline` snippets with `[[` `]]` markers. `semantic=true` merges cosine similarity of chunk embeddings when a provider is enabled (`meta.mode = hybrid`). Each hit is filtered by the modules the document is linked from: a document that only hangs off an IPC needs `ipc.read`. |
| GET | `/projects/:id/documents/index-status` | documents / indexed / per-status counts / embeddings info. |
| GET | `/projects/:id/documents/:documentId/text?maxChars` | status + truncated text. |
| GET | `/search?q=` | The global search adds content hits as type `document` (`metadata.source = "content"`, `metadata.snippet`) for projects where the caller can read document control. |

Hits carry `path` (the record's workspace URL via `utils/record-links.js`) and
`fileUrl` (`/projects/:id/attachments/documents/:documentId`).

## Embeddings (optional)

`backend/src/services/embedding.service.js` picks a provider from
`EMBEDDINGS_PROVIDER` (`openai`, `voyage`, `gemini`, or `none`) or the first
key present (`OPENAI_API_KEY`, `VOYAGE_API_KEY`, `GEMINI_API_KEY`);
`EMBEDDINGS_MODEL` overrides the default model. Requests use global `fetch`
in batches of 64. Vectors live in `DocumentChunk.embedding`; similarity is
computed in the API for the project's chunks (fine for pilot scale; pgvector
is the follow-up when a project exceeds ~50k chunks). Without a provider the
whole feature still works in text mode and the UI hides the semantic toggle.

## Frontend

- Doc control › **Search** tab (`/projects/:id/doc-control/search`):
  debounced query, highlighted snippets, document type / record chips
  linking to the record, Open file, index coverage card with **Reindex**
  for document_control.update, and a semantic toggle when embeddings are
  enabled.
- Global search results of type Document show the matching snippet.

## QA checklist

1. Upload a PDF with a text layer to an RFI → within a few seconds
   `index-status` shows it `ready`; search for a phrase from page 2 → hit
   with `[[…]]` snippet and a path to the RFI.
2. Upload a scanned PDF → status `unsupported`, reason `no_text_layer`
   (visible in the Search tab's coverage card).
3. As a site engineer, search a term only present in an IPC attachment →
   no hit (ipc.read missing); as QS → hit.
4. Configure `OPENAI_API_KEY`, re-extract one document → `embeddingStatus:
   ready`; search with the semantic toggle → `meta.mode = hybrid`.
5. Global search (Cmd+K) for the same phrase → Document result with snippet.

## Known limits

- No OCR for scanned PDFs / images.
- PDF fonts without ToUnicode maps (some subset Type0 fonts) yield partial
  text; the file is still indexed with what could be recovered.
- Only the first 400 000 characters of a document are indexed for
  full-text search (the tsvector size cap); chunks cover the full text.
- Similarity search loads the project's chunk vectors into the API process;
  pgvector is the next step for very large projects.
