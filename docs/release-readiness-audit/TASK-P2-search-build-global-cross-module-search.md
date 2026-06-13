# TASK: Build Global Cross-Module Search

## Task ID
TASK-P2-SEARCH-001

## Priority
P2

## Severity
Medium

## Area
Product

## Related Feature
SRCH-01, SRCH-02, SRCH-03

## Related Risk
RISK-SEARCH-001

## Problem Summary
Global search is missing. The command menu appears to provide search but is primarily navigation/theme command behavior.

## Evidence
- `frontend/src/components/command-menu.tsx:33` displays command/search input.
- No global search API/index was found.
- Module-level route filters exist in places such as `backend/src/routes/rfi.js:34`.

## Why This Blocks or Affects Launch
Construction teams need to find RFIs, submittals, documents, drawings, change orders, and tasks quickly.

## Business Impact
- PMs waste time locating records.
- Document controllers cannot efficiently retrieve revisions.
- Site teams may miss current information.

## Technical Impact
Search behavior is fragmented by module and cannot support global discovery.

## Required Changes
- [ ] Define searchable entities.
- [ ] Add global search API.
- [ ] Add permission-aware search results.
- [ ] Connect command menu to search.
- [ ] Add filters and result grouping.

## Suggested Implementation Approach
- Frontend changes: global search results UI.
- Backend changes: search service across allowed project/org data.
- Database changes: indexes or search table as needed.
- API changes: `/search` endpoint.
- Permission changes: filter results by role/project/file access.
- Test changes: search relevance and access tests.
- Documentation changes: search usage notes.

## Acceptance Criteria
- [ ] Search returns only authorized records.
- [ ] Results include key modules.
- [ ] Filters by project/status/date/type work.

## Testing Requirements
- Unit tests.
- Integration tests.
- E2E tests.
- Permission tests.
- Manual QA checks.
- Regression checks.

## Dependencies
Stable permission model.

## Risks
Naive search can leak record titles from unauthorized projects.

## Estimated Effort
M

## Recommended Owner
Full-stack Developer

