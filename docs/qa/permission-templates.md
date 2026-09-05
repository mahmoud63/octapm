# Permission templates (OCTA-ADM-PERM-003)

Configurable, per-project permissions layered over the static role policy in
`shared/permissions.json`.

## Model

| Table | Purpose |
| --- | --- |
| `PermissionTemplate` | Org-scoped template: `kind` internal/external, `clientType` (gc/owner/consultant/subcontractor), `baseRole` **or** `basePartyRole`, `isSystem` (seeded, cannot be archived), `status` active/archived. Unique on `(orgId, name)`. |
| `PermissionTemplateTool` | One row per module the template overrides: `level` = `none`, `read_only`, `standard`, `admin`. |
| `PermissionTemplateGrant` | Extra allowances: `"<module>\|action:<action>"` or `"<module>\|transition:<transition>"`. |
| `ProjectUserPermission` | `(projectId, userId)` → template + `overridesJson` (`{ tools: { module: level }, grants: [key] }`). |
| `ProjectParty.permissionTemplateId` | External template applied to every active member of a party. |
| `User.isCompanyAdmin` | Org-wide project visibility + administration of users and templates. The registering user is a company admin. |

Twelve system defaults are seeded per organisation (migration for existing
orgs, `seedDefaultTemplates` on registration): one per internal role and one per
party role. A template with no tool rows is exactly its base role, so the
defaults reproduce today's behaviour.

## Evaluation

For a request on `/projects/:projectId/...`:

1. `requireProjectAccess` resolves access as before and then attaches the
   compiled template (if any) to `req.projectAccess.template`:
   `ProjectUserPermission` → party template → nothing.
2. `requirePermission(module, action, { transition })`:
   - company admin → allowed on `user_management` and `project_parties`;
   - template attached → `templateAllows` decides (grants first, then level:
     `none` deny, `read_only` read/export only, `standard` = base role/party
     policy, `admin` everything);
   - otherwise the static policy for the effective role + party profiles.
3. Modules without a tool row default to `standard` when the base role can read
   the module, otherwise `none`.

Template edits are cached for 15 s per process (`invalidateTemplateCache` runs
on update/archive), so changes apply without a redeploy.

## API

| Method | Path | Who |
| --- | --- | --- |
| GET | `/api/v1/auth/me/permissions?projectId=` | any user — matrix `{ source, role, template, modules: { [module]: { level, visible, actions, transitions } } }` |
| GET | `/api/v1/permissions/catalog` | any user |
| GET/POST | `/api/v1/permissions/templates` | company admin or PM |
| GET/PATCH/DELETE | `/api/v1/permissions/templates/:id` | company admin or PM (DELETE archives; 409 while assigned) |
| POST | `/api/v1/permissions/templates/:id/duplicate` | company admin or PM |
| GET | `/api/v1/projects/:projectId/team` | any project member |
| PUT/DELETE | `/api/v1/projects/:projectId/team/:userId/permissions` | company admin or PM |
| PUT | `/api/v1/projects/:projectId/team/parties/:partyId/permissions` | company admin or PM (external templates only) |
| PATCH | `/api/v1/users/:id` `{ isCompanyAdmin }` | user_management.update |

All template/assignment changes write `AuthAuditEvent` rows
(`permission_template`, `project_user_permission`, `project_party_permission`).

## Frontend

- **Settings › Permissions** (`/settings/permissions`, PM or company admin):
  template list, level grid per module, grant checkboxes, duplicate/archive.
- **Project › Team**: members with the template governing each, template
  picker per member and per party.
- `ProjectPermissionProvider` receives the matrix from `/auth/me/permissions`;
  `useCanPerform` and `useModuleAccess` consult it before the static policy, and
  project navigation hides modules at level `none`.

## Manual QA

1. Register a new org → Settings › Permissions lists 12 system templates.
2. Duplicate "Site Engineer - Internal", set Schedule to *Read only* and add the
   grant `schedule → update`; assign it to a site engineer on one project.
3. As that user: schedule page shows, editing works, approving a revision is
   403 with `details.source = "template"`; on another project their role
   policy still applies.
4. Set Cost to *None* on the template → the Cost module disappears from the
   project navigation and `GET /cost` returns 403.
5. Archive the template → 409 while assigned; remove the assignment → archive
   succeeds; system templates refuse archiving.
6. Toggle `isCompanyAdmin` on a QS user → they see every project and can open
   Settings › Permissions, but cannot certify an IPC.

## Known limits

- Search, tasks and workspace-dashboard project scoping still use the role
  only; a company admin who is not a PM sees assigned projects there.
- Overrides are stored per user/project but only editable through the API.
