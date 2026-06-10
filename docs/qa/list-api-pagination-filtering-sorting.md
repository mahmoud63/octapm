# List API Pagination, Filtering, Sorting QA

## Scope

TASK-P1-api-standardize-pagination-filtering-sorting covers large project list endpoints that previously returned unbounded rows:

- `GET /api/v1/projects/{projectId}/rfi`
- `GET /api/v1/projects/{projectId}/submittals`
- `GET /api/v1/projects/{projectId}/cost`

## Automated Evidence

- Backend service and route coverage:
  - `backend/src/services/__tests__/list-pagination.service.test.js`
  - `backend/src/routes/__tests__/list-query-contract.test.js`
- Frontend assertion:
  - `frontend/scripts/list-pagination-ui.test.mjs`
- OpenAPI validation:
  - `backend/scripts/validate-openapi.js`

## Manual QA Scenarios

1. Sign in as PM and open a project with more than 25 RFIs, submittals, and cost rows.
2. Confirm the first RFI page loads quickly and shows no more than the requested page size.
3. Filter RFIs by `status=open` and `priority=urgent`; confirm only matching records display and summary counts remain full-filter counts, not page counts.
4. Search RFIs by subject or question text; confirm changing search resets to the first page.
5. Sort RFIs by due date ascending and descending; confirm Next page follows the selected order.
6. Repeat submittal checks for `status=under_review`, title/spec search, submitted-date sorting, and cursor navigation.
7. Open Cost Control > By Activity; filter by phase/category, search linked activity name or WBS code, sort by actual/forecast, and confirm Next page does not change totals in Overview or By Phase.
8. Try invalid API query values such as `limit=101` or unsupported `sortBy=passwordHash`; confirm the API returns the standard `{ success: false, error: { code: "VALIDATION_ERROR" } }` envelope.
9. Repeat the read scenarios as a non-PM user assigned to the project, then as a non-assigned user; confirm project-level object authorization behavior is unchanged.
