# API Response and Error Normalization QA

Use this checklist when validating the API response envelope and global error-code behavior for frontend and mobile consumers.

## Automated Gate

- Backend route source regression passes with no production route hand-rolling `{ success: true }` envelopes.
- Backend response helper tests pass for `sendSuccess`, legacy `sendError(res, status, code, ...)`, Error-like `sendError(res, err, ...)`, and OpenAPI catalog coverage.
- OpenAPI validation passes and `components.schemas.ErrorCode.enum` includes every runtime catalog code.

## Manual API Checks

- `GET /api/health` returns `{ success: true, data: { status, timestamp } }`.
- Unknown route requests return `{ success: false, error: { code: "NOT_FOUND", message } }`.
- Validation failures return `{ success: false, error: { code: "VALIDATION_ERROR", message, details } }`.
- Authentication and authorization failures return the same error envelope with a cataloged code such as `AUTH_REQUIRED`, `INVALID_TOKEN`, `PROJECT_ACCESS_DENIED`, or `FORBIDDEN`.
- Rate limiting and login abuse failures return the same error envelope with `RATE_LIMIT_EXCEEDED`, `LOGIN_BACKOFF`, or `ACCOUNT_LOCKED` plus retry metadata where applicable.
- Production unexpected errors do not expose internal `details`; non-production errors may include structured details for debugging.

## Consumer Checks

- Frontend and mobile clients parse success responses only from `success: true` and parse failures only from `success: false.error`.
- Clients do not special-case RFI, submittal, quality, safety, document-control, commercial, or cash-flow routes for envelope shape.
- API docs consumers can discover expected error codes from the OpenAPI `ErrorCode` enum.
