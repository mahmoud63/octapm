# BIM models (OCTA-BIM-IFC-043)

IFC models read into **data**: the spatial breakdown, every element with its
type, materials, property sets and base quantities, and links from those
elements to the activities, locations, BOQ items and issues they belong to.

**What this card does not do:** it does not render geometry. There is no 3D
viewer — no solids are evaluated, no triangles produced. That is deliberate
and it is the honest boundary of this card; see *Known limits* below.

## The reader

`backend/src/parsers/ifc-parser.js` is a dependency-free ISO 10303-21 (STEP)
reader for IFC2X3 and IFC4.

- `parseIfc(text)` for a string, `parseIfcFile(path, { onProgress, maxBytes,
  maxEntities })` for a file. The file reader streams in `latin1` (the
  encoding the standard guarantees, so a chunk never splits a character) and
  reports progress.
- **Geometry never enters memory.** Points, placements, profiles, solids,
  shells, representations, styles and ownership entities are skipped by name
  while scanning (`SKIP_TYPES` plus a few prefix rules), which is 90 % of a
  real model's instances. What is kept is the spatial structure, the
  products, the relationship entities and the property sets.
- Values are decoded properly: `''` escapes, `\X2\00E9\X0\` / `\X\E9` / `\S\c`
  unicode escapes, `$` and `*` as null, `.T.` / `.F.` / enums, `#123`
  references, nested lists and typed values such as `IFCLABEL('x')`.
- Read from the model: the header (`FILE_NAME`, authoring tool), the schema,
  the unit assignment (length / area / volume / mass, with SI prefixes), the
  spatial tree through `IfcRelAggregates`, elements through
  `IfcRelContainedInSpatialStructure` (plus anything aggregated under a
  contained element, so a stair's flights come too, plus `IfcSpace`), type
  objects through `IfcRelDefinesByType`, property sets and element quantities
  through `IfcRelDefinesByProperties`, and materials through
  `IfcRelAssociatesMaterial` (layer sets, profile sets, constituent sets and
  material lists are all walked).
- Quantity names are mapped onto fixed fields — `NetVolume`, `GrossVolume`,
  `NetArea` / `NetSideArea` / `NetFloorArea`, `GrossArea`, `Length`, `Width`,
  `Height` / `Depth`, `Perimeter`, `Weight`, `Count` — so they can be filtered
  and summed. Values stay in the model's own units, which are reported
  alongside.

## Model, elements, links

| Table | Purpose |
| --- | --- |
| `BimModel` | The upload: name, discipline, source document, IFC schema, units, header, spatial tree (JSON), element counts by type, warnings, status `processing → ready / failed`, `version` + `isCurrent` + `supersededById`. |
| `BimElement` | One row per element or space: `globalId`, `ifcType`, name, object / predefined type, tag, type name, storey and spatial path, materials, property sets (JSON) and the ten quantity columns, plus `searchText` and `linkCount`. |
| `BimElementLink` | An element tied to a record: `recordType` + `recordId`, `relationType` (`represents`, `affects`, `reference`). Unique per element + record. |

Rules (`bim.service.js`):

- **Upload** stores the `.ifc` as a project document (`BIM_MODEL`, up to
  `BIM_MAX_BYTES`, default 300 MB) and queues `bim.parse`. Uploading under an
  existing name creates version n+1 and marks the previous one superseded;
  deleting a version makes the one it superseded current again.
- **Parsing** runs on the durable job queue with progress, stores elements in
  chunks of 500, caps at `BIM_MAX_ELEMENTS` (default 250 000, with a warning
  when it bites), and de-duplicates repeated GlobalIds. A failure records the
  reason on the model and *Read again* re-queues it. The uploader is notified
  when it is ready.
- **Elements** are filtered by IFC type, storey, type name, free text
  (`searchText` covers name, tag, type name, object type, storey and
  materials) and linked / not linked, and cursor-paged.
- **Quantities** roll up by IFC type or by storey over exactly the same
  filters, so what the table shows and what the totals say always agree.
- **Links** take either `elementIds` or the element list's own `filter` (up to
  5 000 elements), which is how a planner ties every wall on a storey to one
  activity in a single action. Links already present are counted, not
  duplicated; `linkCount` on the element and `linkedCount` on the model are
  recomputed on every change. `GET …/bim/records/{recordType}/{recordId}/elements`
  answers the other direction with quantity totals — what an activity or a
  location covers in the models.
- Linkable record types: `activity`, `location`, `boq_item`, `punch_item`,
  `observation`, `rfi`, `ncr`. **Activity links are the point** — they put
  model elements on the activity-linked spine, which is the groundwork for 4D.

## Where

Project › **BIM** (deep link `/projects/{id}/bim?source=bim_model&recordId=`),
loaded as its own chunk.

- **Models**: tiles (models, elements, linked, reading / failed), the table
  with version, discipline, schema, element / storey / link counts and status,
  *Upload IFC* (file, name, discipline, notes), *Read again*, delete. The list
  polls itself while a model is being read.
- **Browser**: the spatial tree and the type list on the left as filters; a
  search box, linked / not-linked chips and a *Clear filters* button; the
  element table (select rows, click to open) with *Load more*; a quantities
  card that switches between by type and by storey; *XLSX* export of exactly
  what is filtered; and **Link** — the selected elements, or everything the
  filter matches, to an activity, BOQ item or RFI (found through the global
  search) or to a location.
- **Element dialog**: GlobalId, predefined type and materials as chips, the
  quantities that exist, the links (with a remove button) and every property
  set as a table.

| Endpoint | Permission (`bim`) |
| --- | --- |
| `GET /projects/{id}/bim/models?status&discipline&current` | read |
| `POST /projects/{id}/bim/models` (multipart `file`, name, discipline, notes) | create |
| `GET /models/{modelId}`, `/spatial`, `/elements`, `/elements/{elementId}`, `/quantities`, `/links` | read |
| `PATCH /models/{modelId}`, `POST /models/{modelId}/reparse` | update |
| `POST /models/{modelId}/links`, `DELETE /models/{modelId}/links/{linkId}` | `bim.link` |
| `GET /models/{modelId}/elements/export.xlsx` | export |
| `GET /bim/records/{recordType}/{recordId}/elements` | read |
| `DELETE /models/{modelId}` | delete |

New `bim` permission module (create / delete are PM and planner; `bim.link`
is PM, planner, QS and site engineer). Party templates: owners and consultants
read and export, contractors also update and link, subcontractors read. Report
source **BIM elements**; attachments and record links on `bim_model`.

## Environment

`BIM_MAX_BYTES` (default 314572800), `BIM_MAX_ELEMENTS` (default 250000),
`BIM_MODEL_RETENTION_DAYS` (default 3650).

## Known limits

- **No 3D viewer.** Rendering IFC geometry in the browser needs a WASM
  tessellator (`web-ifc`) and a WebGL scene graph (`three`); neither is a
  dependency of this repository and neither could be added here, because this
  worktree's `node_modules` is a junction into the main checkout and
  installing into it would change shared state. The data layer above is
  designed so a viewer can be added later without touching it: `globalId` on
  every element is the key a viewer selects by.
- BCF coordination issues (importing and exporting `.bcfzip` topics against
  the punch / observation engine) are the next card, not this one.
- The link picker offers activities, BOQ items and RFIs (through the global
  search) and locations (from the project tree); the API accepts punch items,
  observations and NCRs too, for integrations.

## Test

```bash
cd backend && npx jest src/parsers/__tests__/ifc-parser.test.js src/services/__tests__/bim.service.test.js
cd frontend && node scripts/bim-ui.test.mjs
```

Manual: Project › BIM › Upload IFC with a Revit or ArchiCAD export → the row
shows *Reading…* and flips to *Ready* on its own → open it → the storeys and
types appear on the left, the elements in the table → filter to a storey and
one type → the quantities card totals match → select a few rows → Link →
Activity → pick the activity → open the schedule's activity and the elements
are on it → export the XLSX and the three sheets carry the elements, the
totals and the model's provenance.
