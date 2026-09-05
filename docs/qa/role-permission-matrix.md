# FB-009 Role Permission Matrix

Source of truth: `shared/permissions.json`.

Backend checks are authoritative. Frontend visibility uses the same policy
metadata only to hide or disable actions before a request is sent.

Project object access is enforced before module/action permissions. PM users and
company admins (`User.isCompanyAdmin`) can see all projects in their
organization. All other roles must have a `ProjectAssignment` row or active
`ProjectPartyMember` row for the requested project; otherwise project detail and
nested module routes return `403 PROJECT_ACCESS_DENIED`.

The matrix below is the **base policy**. A permission template assigned to a
user on a project (or to the user's project party) overrides it per module:
`none` hides the module, `read_only` keeps read/export, `standard` keeps the
base role's row, `admin` grants every action and transition, and grants add
single actions on top. See `docs/qa/permission-templates.md`.

## Roles

| Short name | Role              |
| ---------- | ----------------- |
| PM         | `pm`              |
| Planner    | `planning_eng`    |
| QS         | `qs`              |
| Cost       | `cost_controller` |
| Proc       | `procurement`     |
| WH         | `warehouse`       |
| Site       | `site_engineer`   |
| Finance    | `finance`         |

## Module Actions

| Module / action                      | PM  | Planner | QS  | Cost | Proc | WH  | Site | Finance |
| ------------------------------------ | --- | ------- | --- | ---- | ---- | --- | ---- | ------- |
| Schedule read                        | Y   | Y       | Y   | Y    | Y    | Y   | Y    | Y       |
| Schedule create/import               | Y   | Y       | -   | -    | -    | -   | -    | -       |
| Schedule update/delete               | Y   | Y       | -   | -    | -    | -   | -    | -       |
| Schedule submit review               | Y   | Y       | -   | -    | -    | -   | -    | -       |
| Schedule approve/reject              | Y   | -       | -   | -    | -    | -   | -    | -       |
| Schedule baseline/activate/rollback  | Y   | -       | -   | -    | -    | -   | -    | -       |
| Schedule export                      | Y   | Y       | Y   | Y    | -    | -   | -    | -       |
| Progress read                        | Y   | Y       | Y   | Y    | -    | -   | Y    | Y       |
| Progress submit/import               | Y   | Y       | -   | -    | -    | -   | Y    | -       |
| Progress method configure            | Y   | Y       | -   | -    | -    | -   | -    | -       |
| Progress approve/reject              | Y   | Y       | Y   | -    | -    | -   | -    | -       |
| Daily report submit                  | Y   | Y       | -   | -    | -    | -   | Y    | -       |
| Daily report / site diary review     | Y   | -       | -   | -    | -    | -   | -    | -       |
| IPC read/export                      | Y   | -       | Y   | Y    | -    | -   | -    | Y       |
| IPC create/update/submit             | Y   | -       | Y   | -    | -    | -   | -    | -       |
| IPC certify                          | Y   | -       | -   | -    | -    | -   | -    | Y       |
| IPC invoice/payment/retention        | Y   | -       | -   | -    | -    | -   | -    | Y       |
| Cost read                            | Y   | Y       | Y   | Y    | -    | -   | -    | Y       |
| Cost create/update/submit            | Y   | -       | Y   | Y    | -    | -   | -    | -       |
| Cost approve                         | Y   | -       | -   | -    | -    | -   | -    | Y       |
| Cost export                          | Y   | Y       | Y   | Y    | -    | -   | -    | Y       |
| RFI/Submittal read                   | Y   | Y       | Y   | Y    | Y    | Y   | Y    | Y       |
| RFI/Submittal create/update          | Y   | Y       | -   | -    | -    | -   | Y    | -       |
| RFI/Submittal archive                | Y   | -       | -   | -    | -    | -   | -    | -       |
| NCR read                             | Y   | Y       | Y   | Y    | Y    | Y   | Y    | Y       |
| NCR create/update                    | Y   | Y       | -   | -    | -    | -   | Y    | -       |
| NCR delete                           | Y   | -       | -   | -    | -    | -   | -    | -       |
| Safety read                          | Y   | Y       | Y   | Y    | Y    | Y   | Y    | Y       |
| Safety create/update                 | Y   | -       | -   | -    | -    | -   | Y    | -       |
| Safety archive                       | Y   | -       | -   | -    | -    | -   | -    | -       |
| User management read                 | Y   | Y       | Y   | -    | -    | -   | -    | -       |
| User management create/update/delete | Y   | -       | -   | -    | -    | -   | -    | -       |
| Locations read                       | Y   | Y       | Y   | Y    | Y    | Y   | Y    | Y       |
| Locations create/update/reorder      | Y   | Y       | -   | -    | -    | -   | Y    | -       |
| Locations archive/restore            | Y   | Y       | -   | -    | -    | -   | -    | -       |

## Project Party Roles

External company access is additive to the user's organization role and is
scoped to the specific project party membership.

| Party role     | Core scoped access |
| -------------- | ------------------ |
| Owner          | Project and workflow read; answer routed RFIs |
| Consultant     | Project and workflow read; answer RFIs; review/approve/reject routed submittals |
| Contractor     | Project and workflow read; create/update/submit routed RFIs and submittals |
| Subcontractor  | Project and workflow read; create/update/submit routed RFIs and submittals |

## Manual QA Walkthrough

1. Sign in as each role and open a project schedule.
2. Verify read-only roles can view schedule data but do not see schedule create,
   import, edit, delete, approval, baseline, activation, or rollback controls.
3. Verify Planner can submit schedule revisions but receives a 403 if calling
   approve, reject, baseline, activate, or rollback endpoints directly.
4. Verify Site Engineer can submit progress and daily reports but cannot approve
   progress, final-approve site records, or configure progress methods.
5. Verify QS can approve/reject progress and create/submit IPC, but cannot
   certify IPC or final-approve daily reports/site diaries.
6. Verify Finance can certify IPC, issue IPC invoices, record client payments,
   release retained amounts, and approve cost workflows, but cannot create,
   edit, or submit IPC periods.
7. Verify Cost Controller can update cost records and export project data, but
   cannot manage users or approve schedule revisions.
8. Verify non-PM users cannot create, update, deactivate, activate, reset
   passwords for, or delete users, and direct API calls return 403 with
   `FORBIDDEN`.
9. Verify Procurement, Warehouse, Cost Controller, QS, and Finance users can
   read RFI, Submittal, NCR, and Safety registers but do not see the RFI,
   Submittal, NCR, or Safety quick-create controls.
10. Verify direct API calls from disallowed roles return 403 with `FORBIDDEN`
    for POST/PATCH/DELETE on `/projects/:projectId/rfi`,
    `/projects/:projectId/submittals`, `/projects/:projectId/ncr`, and
    `/projects/:projectId/safety`.
11. Verify a Site Engineer assigned to Project A can open Project A, cannot see
    Project B in the project list, and receives `403 PROJECT_ACCESS_DENIED` for
    direct calls to `/projects/:projectBId` and
    `/projects/:projectBId/schedule`.
12. Verify an external consultant invited through a ProjectParty can open only
    that project, answer routed RFIs, and review routed submittals.
13. Verify an external subcontractor cannot view or update another company's
    routed RFI/submittal and direct API calls return
    `PROJECT_PARTY_RECORD_ACCESS_DENIED`.
