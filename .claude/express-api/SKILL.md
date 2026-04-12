---
name: express-api
description: Generate Express.js REST API endpoints for PMcopilots. Use when creating new routes, controllers, services, or middleware. Enforces activity-linked data model, multi-tenant isolation, RBAC, and consistent response format.
---

# Express.js API Endpoint Generator

## Architecture
Every endpoint follows a 3-layer pattern:
- **Route** (`src/routes/`) — defines HTTP method, path, validation, middleware chain
- **Service** (`src/services/`) — all business logic lives here, never in routes
- **Prisma Query** — database access via Prisma ORM, always scoped by orgId

## Response Format
ALWAYS use this envelope:
```js
// Success
res.status(200).json({ success: true, data: result });

// Error
res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Project name is required' } });

// Paginated
res.status(200).json({ success: true, data: items, pagination: { cursor, hasMore, total } });
```

## Route Template
```js
const express = require('express');
const router = express.Router();
const { body, param, query } = require('express-validator');
const validate = require('../middleware/validate');
const { authenticate } = require('../middleware/auth');
const { authorize } = require('../middleware/rbac');
const service = require('../services/[module]Service');

// GET /api/v1/projects/:projectId/[resource]
router.get(
  '/:projectId/[resource]',
  authenticate,
  authorize(['pm', 'planning_eng', 'qs']), // list allowed roles
  [param('projectId').isUUID()],
  validate,
  async (req, res, next) => {
    try {
      const result = await service.getAll(req.params.projectId, req.user.orgId, req.query);
      res.json({ success: true, data: result });
    } catch (err) { next(err); }
  }
);

module.exports = router;
```

## Mandatory Rules
1. **Multi-tenant isolation**: Every Prisma query MUST include `where: { project: { orgId: req.user.orgId } }` or equivalent org scope
2. **Activity linking**: All transactional records (costs, progress, procurement, NCRs, daily reports) MUST have an `activityId` foreign key
3. **RBAC middleware**: Every route MUST use `authorize([...roles])` — never skip role checks
4. **Input validation**: Every route MUST validate inputs using express-validator or Zod before hitting the service layer
5. **No business logic in routes**: Routes only call service methods and return responses
6. **Async error handling**: Always wrap service calls in try/catch and call `next(err)`

## Auth Middleware Pattern
```js
// authenticate — verifies JWT, attaches req.user = { id, orgId, role, email }
// authorize(['pm', 'qs']) — checks req.user.role against allowed roles, returns 403 if denied
```

## Error Codes
Use these standard error codes:
- `VALIDATION_ERROR` (400) — invalid input
- `UNAUTHORIZED` (401) — no/invalid JWT
- `FORBIDDEN` (403) — valid JWT but wrong role
- `NOT_FOUND` (404) — resource doesn't exist or not in user's org
- `CONFLICT` (409) — duplicate entry
- `INTERNAL_ERROR` (500) — unexpected server error

## WebSocket Events
When progress or cost data changes, emit via Socket.io:
```js
const io = req.app.get('io');
io.to(`project:${projectId}`).emit('ev:updated', { projectId, metrics: evResult });
```
