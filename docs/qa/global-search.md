# Global Search QA Notes

## Scope

Global search is available at `GET /api/v1/search` and in the authenticated command menu. It searches authorized project records across projects, activities, BOQ items, RFIs, submittals, drawings, document revisions, change orders, IPC periods, risks, procurement packages, long-lead items, meetings, and tasks.

## Authorization Expectations

- Results must be scoped to `orgId` and to projects the user can access through PM org-wide access, `ProjectAssignment`, or active `ProjectParty` membership.
- RFI and submittal search must preserve party-routed visibility for external party users.
- Task search must preserve task visibility for non-project-wide users: assigned-to-me or created-by-me only.
- Current-only document roles (`site_engineer`, `warehouse`) should only discover latest approved document revisions.

## Manual Checks

- Search a known RFI title as a PM and confirm the result opens the project Doc Control RFI tab.
- Search the same RFI as an unrelated project user and confirm it is absent.
- Filter by `type=rfi` and `status=open`; confirm only open RFIs appear.
- Filter by `projectId`; confirm results come only from that project.
- Filter by `dateFrom`/`dateTo`; confirm older updated records are excluded.
- Search a task as a site engineer; confirm only assigned or self-created tasks appear.
