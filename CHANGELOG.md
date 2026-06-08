# Changelog

All notable platform-wide changes should be recorded here. Agents must read this file before starting work and add a concise entry for every meaningful code, schema, API, or workflow change.

## 2026-06-08

### Added
- Added an agent workflow rule requiring the latest `origin/main` to be pulled before committing and the branch to be pushed again after committing.
- Added FB-001 Activity BOQ Allocation Spine with a new `ActivityBoqAllocation` Prisma model linking BOQ items to official schedule `Activity` records.
- Added migration `20260608170000_add_activity_boq_allocation` with:
  - `ActivityBoqAllocation` table.
  - Optional `IpcItem.allocationId` relation.
  - Partial unique index preventing duplicate active BOQ item/activity allocation pairs.
  - Trigger-based validation preventing active allocation quantity/value totals from exceeding the BOQ item quantity/value.
- Added backend allocation service and project-scoped API routes for list, create, edit, submit, approve, and reject workflows.
- Added frontend BOQ allocation panel for mapping BOQ value to schedule activities.
- Added unallocated BOQ value display at project and BOQ-row levels.
- Added activity detail/list display fields for approved allocated BOQ quantity, value, weight, and allocation count.
- Added IPC activity traceability so IPC rows can reference the approved allocation and linked schedule activity.
- Added backend tests covering allocation validation, tenant scoping, approval workflow, approved rollups, and IPC allocation seeding.

### Changed
- EV report, health dashboard, schedule API, progress import, progress update fallback actual cost, cost summaries, and IPC period creation now use approved activity BOQ allocations as the official budget/value basis.
- Schedule API now returns generated budget separately from approved allocated BOQ budget.
- IPC period creation now seeds from approved allocations instead of raw BOQ items, excluding unallocated BOQ value from official certification.
- BOQ API now returns allocation summary totals and row-level allocation totals.

### Verification
- Backend JavaScript syntax checks passed using the bundled Codex Node runtime.
- Prisma format/generate, Jest, and frontend build/tests were not run because this shell had no `npm`, no `npx`, and no local `node_modules`.
