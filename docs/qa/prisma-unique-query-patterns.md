# Prisma Unique Query Pattern QA

Use this checklist for BOQ item workflows that depend on project-scoped object checks before primary-key writes.

## Automated Gate

- BOQ service tests pass for:
  - Duplicate active BOQ item code rejection.
  - Update lookup using `findFirst({ id, projectId })` before `update({ where: { id } })`.
  - Delete lookup using `findFirst({ id, projectId })` before `delete({ where: { id } })`.
  - BOQ upload revision import and comparison-only baseline behavior.

## Manual API Checks

- Updating a BOQ item that belongs to the project succeeds and records BOQ audit history.
- Updating a BOQ item ID from another project returns `BOQ_ITEM_NOT_FOUND` and does not write.
- Changing a BOQ item code to an active duplicate in the same project returns `DUPLICATE_BOQ_ITEM_CODE`.
- Deleting a manual draft BOQ item in the project succeeds and retires draft linked allocation/activity rows where present.
- Deleting a BOQ item ID from another project returns `BOQ_ITEM_NOT_FOUND`.
- Historical inactive BOQ rows cannot be edited or deleted from the current BOQ grid.

## Data Checks

- BOQ item codes remain project-scoped and active-row scoped, not globally unique across revisions.
- Service writes use primary IDs after the project-scoped existence check.
- No schema migration is required unless product decides to make a specific BOQ code uniqueness rule enforceable at the database layer.
