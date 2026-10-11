# BIM / 5D Commercial Intelligence — V1 (accepted 2026-10-11)

Branch `feat/bim-5d-v1`:
- BIM-1..6 in `5be06fb`
- BIM-7..11 in `b65cf73`
- BIM-12 and the Project Overview card in `d7ca20a`

The owner accepted V1 "for now" as sufficient for the build-first roadmap.

## What V1 does

Every BIM element is traced through the chain revision → location → WBS → activity → BOQ, and on to contract → executed → approved → certified → paid → change. For each element, OctaPM answers "Why is this quantity commercially valid?"

| Area | Where |
|---|---|
| Model register, revisions R01…, supported formats (IFC2X3/IFC4; RVT/NWD/DWG labelled unsupported) | BIM / 5D → Overview, Revisions |
| Mapping to Location / WBS / Activity / BOQ, suggestions, measurement rules | Models & elements, Measurement rules |
| Quantity provenance ("Why this quantity?") | Commercial reconciliation → BOQ item → element |
| Commercial reconciliation (contract / BIM / executed / approved / certified / paid, never merged) | Commercial reconciliation |
| Revision diff by GlobalId, impact per BOQ item, carry mappings forward | Changes |
| Potential duplicates | Commercial reconciliation |
| Certification protection (model changed after certification flagged, never rewritten) | Changes, Overview alerts |
| Element commercial state (progress, location quantity, ITP, NCR, certified, paid) | Element panel |
| Model-change reviews → open change event (omissions priced negative; never an approved CO) | Changes |
| Ask OctaPM: module and element actions; the AI explains OctaPM's figures and never measures | BIM / 5D |
| Project Overview BIM / 5D card | Project Overview |

Rules that hold:
- BIM never writes executed, approved or certified quantities.
- Revisions are never overwritten.
- Certification is never reduced automatically.
- Quantities are never deleted automatically.
- No approved change order is ever created automatically.

## Deferred enhancements (owner, 2026-10-11)

Not started. Each needs the owner's go-ahead.

1. Interactive IFC / 3D viewer. The parser stores no geometry today, so this needs a WebAssembly IFC library in the web app.
2. Select an element in the model → its commercial detail.
3. Model colouring by commercial state.
4. Changed-element highlighting between revisions.
5. Native RVT / Autodesk APS integration.
6. Richer element type and property change detection. Without `IfcRelDefinesByType`, `typeName` is null and type changes are not seen; property changes are reported only as "properties changed".
7. BIM-linked inspection / ITP demo coverage. Riverside Tower has no ITPs, so the inspection-blocked states are not demonstrated.
8. Existing P3 UI polish. One known case: the element AI action buttons wrap onto a second line in the BOQ-item side panel.
