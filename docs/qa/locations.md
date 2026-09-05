# Project Locations QA

Task: `OCTA-DATA-LOC-005` (Sprint 1, P0 foundations).

## Scope

Hierarchical project locations (site › building › level › zone › room › area)
stored with a materialized path of ids. Locations are the spatial key that punch
items, inspections, observations, photos and daily entries will reference.

- API: `/api/v1/projects/{projectId}/locations`
  - `GET /` (optional `includeArchived`) → `{ items, tree, summary }`
  - `POST /` create (`name`, optional `code`, `kind`, `parentId`, `description`, `sortOrder`)
  - `PATCH /{id}` rename, recode, change kind/description, move (`parentId`), set `sortOrder`
  - `POST /reorder` `{ parentId?, orderedIds[] }`
  - `POST /{id}/archive`, `POST /{id}/restore`, `DELETE /{id}` (alias of archive)
- Permissions module `location` in `shared/permissions.json`:
  read all internal roles and all project-party roles; create/update PM, Planner,
  Site Engineer; archive/restore PM, Planner.
- Every mutation writes an `AuditEvent` (`entityType = location`) and publishes a
  realtime `record.changed` event.

## Rules

- Names must be unique among active siblings (case-insensitive); codes unique per project.
- Maximum depth is 8 levels.
- A location cannot be moved under itself or one of its descendants.
- Archiving cascades to the whole subtree; restoring requires an active parent.
- Moving rewrites `path` and `depth` for the subtree in one transaction.

## Manual QA

1. Open a project › Locations. Create `Site` (kind site) › `Block A` (building) › `Level 1` (level) › `Apartment 101` (room).
2. Rename `Level 1` to `Level 01`; confirm the full name in the tree updates and audit history shows the change.
3. Try to create a second `Block A` under `Site`: expect `LOCATION_DUPLICATE_NAME`.
4. Move `Apartment 101` under `Block A` directly; confirm depth changes and the path shows `Site › Block A › Apartment 101`.
5. Try to move `Site` under `Apartment 101`: expect `LOCATION_INVALID_PARENT`.
6. Archive `Block A`; confirm `Level 01` and `Apartment 101` are archived too and disappear unless "Show archived" is enabled.
7. Restore `Apartment 101` before `Block A`: expect `LOCATION_PARENT_ARCHIVED`; restore `Block A` first, then the child.
8. As Finance, confirm the tree is visible but create/rename/archive controls are hidden and direct API calls return `403`.

## Automated Checks

- `backend/src/services/__tests__/location.service.test.js`
- `backend/src/routes/__tests__/locations.routes.test.js`
- `frontend/scripts/navigation-realtime-locations.test.mjs`
