# Project Access Authorization QA

Backend project authorization is release-blocking. PM users have org-wide
project visibility. Planning, QS, cost, procurement, warehouse, site engineer,
and finance users must be assigned to a project through `ProjectAssignment`.

## Automated Evidence

- Backend service tests cover creator assignment, assigned-project list
  filtering, and the negative unassigned `403 PROJECT_ACCESS_DENIED` case.
- Backend route tests cover project detail and nested project routes rejecting
  unassigned users before module services run.
- Frontend assertions cover the project-detail 403 state and prevent nested
  project queries from running after access is denied.

## Manual QA

1. Create or identify two active projects in the same organization: Project A
   and Project B.
2. Assign a Site Engineer to Project A only.
3. Sign in as that Site Engineer and confirm `/projects` lists Project A but not
   Project B.
4. Open Project A and verify schedule, BOQ, progress, reports, and allowed
   module actions still follow the role matrix.
5. Directly request `/api/v1/projects/{projectBId}` with the Site Engineer
   token and confirm `403 PROJECT_ACCESS_DENIED`.
6. Directly request `/api/v1/projects/{projectBId}/schedule` and confirm the
   same 403 response with no schedule payload.
7. Open the Project B URL in the frontend and confirm it displays the project
   access restricted state, not "Project not found" and not the module sidebar.
8. Sign in as PM and confirm both Project A and Project B remain visible and
   accessible.
