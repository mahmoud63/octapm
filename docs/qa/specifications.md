# Specifications and scope intelligence (OCTA-AI-SPEC-036)

The specification becomes a navigable **section index** built from the
documents' extracted text; every section is related to the BOQ, the
drawings, the schedule and the RFIs by deterministic matching; **scope
gaps** fall out of that; and one section can be **checked against the
drawings' text layers** by the model. Nothing is written to a record by any
of it — an RFI is raised only when the person asks.

## Where

- **Doc control › Specifications** (sidebar child `specifications`,
  `/projects/{id}/doc-control/specifications?recordId=<sectionId>`).
- *Documents* (needs `document_control.update`): every document with
  extracted text, likely specifications first (CSI hints in the excerpt,
  name or category containing "spec", or already indexed). *Find and
  index* parses every document whose text reads like a specification;
  *Index selected* parses the ticked ones. Re-indexing replaces a
  document's sections.
- Left: sections grouped by division with search (code / title) and a
  division filter. Right: **Scope coverage** (default) or the selected
  **section** — heading, pages, keywords, collapsible text, related BOQ
  items / drawings / activities / RFIs with the basis of each match, and
  *Check against drawings*.
- **Scope coverage**: tiles, notes on what could not be checked, the
  sections with gaps (click → section), BOQ items no section covers,
  disciplines with sheets but no specification; *Review with AI* adds the
  model's reading with suggested tasks / RFIs (needs `assistant.read`).
- **Check against drawings** (needs `assistant.read`): pick up to
  `AI_SPEC_SHEETS` related sheets (title / vocabulary matches first, then
  same discipline) → summary, confidence, conflicts (topic, specification
  says, drawing says, sheet, severity, suggestion) with *Raise RFI*
  (needs `rfi.create`; draft RFI tagged with the section code and the
  division's discipline), gaps, feedback.

## Section parsing

1. CSI MasterFormat: `SECTION 03 30 00`, `SECTION 033000`, `SECTION 03300`
   (title on the same line or the next line), or `03 30 00 – TITLE`.
   Division = first two digits.
2. Only when no CSI heading exists: `SECTION 5 – CONCRETE WORKS` (generic),
   else numbered upper-case headings `3.2 EXCAVATION` (depth ≤ 3).
3. `DIVISION nn` lines and the `1.01 SUMMARY` paragraphs inside CSI
   sections are never sections.
4. A code that appears several times (table of contents, running headers)
   keeps the occurrence with the longest body; bodies under 120 characters
   are dropped.
5. Pages: for PDFs the heading line is searched in the PDF's own page
   texts, preferring the last page that carries it (the TOC comes first).

## Relating

Keywords = stemmed words of the section title minus stopwords. A record
relates when ≥ 2 title keywords hit, or 1 title keyword plus a word of the
division's vocabulary (`DIVISION_KEYWORDS`), or 1 keyword when the title
has ≤ 2 keywords, or ≥ 2 vocabulary words (`basis: division`). BOQ items
whose code is a CSI number under the section's first four digits match by
`code`; RFIs whose `specSection` equals the section (or its 4-digit prefix)
match by `spec_section`; sheets of the division's disciplines
(`DIVISION_DISCIPLINES`) match by `discipline` — counted as drawing
coverage but listed after title matches.

## API (tag "Specifications", `/projects/{id}/specifications`)

| Endpoint | Permission | Notes |
| --- | --- | --- |
| `GET …/status` | `document_control.read` | `{ enabled, provider, model, sectionChars, sheetLimit }` |
| `GET …/documents` | `document_control.read` | `{ items[{ …, sections, indexedAt, likelySpec }] }` |
| `POST …/index` `{ documentIds? }` | `document_control.update` | `{ documents[{ documentId, sections, dropped, divisions, error }], sections }`; 409 `SPEC_TEXT_NOT_READY` when a document's text is not extracted |
| `GET …?q&division&documentId` | `document_control.read` | `{ items, divisions[{ division, label, count }], total }` |
| `GET …/scope-gaps` | `document_control.read` | per-section `counts` + `gaps` (`no_boq`, `no_drawings`, `no_activities`), `uncoveredBoq`, `uncoveredDisciplines`, `notes` |
| `POST …/scope-gaps/explain` | `assistant.read` + `document_control.read` | `{ degraded, gaps, review { headline, narrative, actions }, message }` — stored kind `scope_gap`; computed review without a provider |
| `GET …/{sectionId}?maxChars` | `document_control.read` | section + `text` + `related` |
| `POST …/{sectionId}/conflicts` `{ sheetIds? }` | `assistant.read` + `document_control.read` | `{ degraded, sheetsChecked, result { summary, conflicts[], gaps[], confidence }, message }` — stored kind `spec_conflict` |
| `POST …/{sectionId}/rfi` `{ subject, question?, discipline?, priority? }` | `rfi.create` | draft RFI with `specSection` = the code; 201 `{ record, url }` |

## Test

```bash
cd backend && npx jest src/services/__tests__/specification.service.test.js
cd frontend && node scripts/specifications-ui.test.mjs
```

Manual: upload a CSI specification PDF → Doc control › Search index it →
Specifications › Documents → *Find and index* → sections appear by
division → Scope coverage shows unpriced / undrawn sections → open a
section → related records → *Check against drawings* → *Raise RFI* on a
conflict → the RFI appears as a draft under Doc control › RFI with the
section code.

## Configuration

`AI_SPEC_CHARS` (section text sent per check, 2,000–60,000, default
12,000 — the opening plus PART 2 / PART 3 when longer), `AI_SPEC_SHEETS`
(sheets per check, 1–12, default 6), provider keys as for the assistant.
