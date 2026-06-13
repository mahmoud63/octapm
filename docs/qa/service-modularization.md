# Service Modularization QA

Use this checklist for incremental refactors that split large services into smaller modules without changing API behavior.

## BOQ Refactor Slice

- BOQ upload job state lives in `backend/src/services/boq/job-store.js`.
- BOQ workbook template generation lives in `backend/src/services/boq/template.js`.
- BOQ Excel parsing and row validation live in `backend/src/services/boq/excel-parser.js`.
- `backend/src/services/boq.service.js` remains the route-facing service facade and preserves the existing exported API.

## Automated Gate

- Run BOQ service regression tests for upload/import, manual BOQ rows, activity allocation, duplicate code, baseline comparison, and scoped update/delete behavior.
- Run module tests for BOQ job-store state merge/TTL pruning, Excel parser header aliases/row validation, and workbook template generation.
- Run full backend Jest before release because service modularization can break import paths even when behavior is intended to be unchanged.

## Manual Smoke

- Download the BOQ template and confirm it opens with Code, Description, Quantity, Unit, Rate, and Amount columns.
- Upload a valid BOQ workbook and confirm imported rows, revision metadata, and financial totals are unchanged.
- Upload a BOQ workbook with duplicate codes and confirm row-level validation errors are returned.
- Start AI BOQ-to-schedule generation and confirm job polling still reports progress through completion or structured failure.
