---
name: mobile-api
description: Design and document REST API endpoints consumed by the mobile app team. Use when creating engineer-facing endpoints, daily report submission, offline sync, push notifications, or writing Swagger/OpenAPI documentation.
---

# Mobile API Contract Skill

## Scope
You build the API. A separate team builds the mobile app. Your job is to provide well-documented, tested REST endpoints and a complete OpenAPI/Swagger specification.

## Authentication Flow
```
POST /api/v1/auth/login          → { accessToken, refreshToken, user }
POST /api/v1/auth/otp/verify     → { verified: true }
POST /api/v1/auth/refresh        → { accessToken }
POST /api/v1/auth/forgot-password → { message: "Reset email sent" }
```
- Engineers log in with email + password (created by PM on web app)
- First login requires OTP verification
- Access token expires in 15 minutes, refresh token in 7 days
- Deactivated engineers receive 403 on all requests

## Engineer-Facing Endpoints

### Assignments
```
GET /api/v1/users/me/assignments
→ { projects: [{ id, name, activities: [{ id, name, startDate, endDate, pctComplete }] }] }
```

### Activities for a project
```
GET /api/v1/projects/:id/activities?assigned=me
→ { data: [{ id, name, wbs, duration, startDate, endDate, pctComplete, status, materials: [...], equipment: [...] }] }
```

### Submit daily report
```
POST /api/v1/projects/:id/reports
Body: {
  activityId: "uuid",
  pctProgress: 45,
  materials: [{ materialId: "uuid", qty: 5.5, unit: "TON" }],
  equipment: [{ equipmentId: "uuid", hours: 8 }],
  notes: "Completed rebar for zone A"
}
→ { success: true, data: { reportId, activityStatus: "in_progress" } }
```

### Batch submit (offline sync)
```
POST /api/v1/projects/:id/reports/batch
Body: { reports: [...array of report objects...] }
→ { success: true, data: { submitted: 5, failed: 0, results: [...] } }
```

### Photo upload
```
POST /api/v1/upload/photos
Content-Type: multipart/form-data
Fields: reportId, activityId, photos[] (max 10, max 5MB each)
→ { success: true, data: { urls: ["https://..."] } }
```

### Delta sync
```
GET /api/v1/projects/:id/sync?since=2026-04-12T10:00:00Z
→ { 
    data: {
      activities: { updated: [...], deleted: [...] },
      materials: { updated: [...], deleted: [...] },
      equipment: { updated: [...], deleted: [...] },
      notifications: [...]
    },
    syncTimestamp: "2026-04-12T14:30:00Z"
  }
```

### Push notification registration
```
POST /api/v1/notifications/push-register
Body: { deviceToken: "fcm-token-here", platform: "ios" | "android" }
→ { success: true }
```

## Auto-Status Derivation
When a daily report is submitted, the backend automatically updates activity status:
- `0%` → "to_do"
- `1-99%` → "in_progress" 
- `100%` → "complete"
- Past end date + `<100%` → "delayed"

This triggers EV recomputation and WebSocket push to web dashboard.

## Swagger Documentation
Every endpoint must be documented in OpenAPI 3.0 spec. Include:
- Request body schema with all field types and validations
- Response schema for success and error cases
- Authentication requirements
- Example request/response pairs
- Error codes and their meanings

Generate Swagger spec at `/api/v1/docs` using swagger-jsdoc + swagger-ui-express.

## Material Units
PMs create materials with these standard units:
TON, KG, M³, M², M, PCS, L, BAG, SHEET, ROLL, LOAD

## Equipment Rate Types
hourly, daily
