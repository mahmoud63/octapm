# BOQ Backend API Endpoints

## Base URL: `/api/v1`
## Auth: JWT in `Authorization: Bearer <token>` header on all routes
## Response envelope: `{ success: true, data: {...} }` or `{ success: false, error: { code, message } }`

---

## 1. Download BOQ Template

```
GET /projects/:projectId/boq/template
Auth: required
Response: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet
          filename: boq-template.xlsx
```

Generates and returns the 6-column Excel template with header row + 3 example rows.
No DB interaction — pure file generation.

---

## 2. Upload & Process BOQ

```
POST /projects/:projectId/boq/upload
Auth: required
Content-Type: multipart/form-data
Body:
  file:  <Excel file .xlsx or .xls>
  label: <string, optional — revision label>

Success 200:
{
  "success": true,
  "data": { "jobId": "uuid" }
}

Validation failure 400:
{
  "success": false,
  "error": {
    "code": "BOQ_VALIDATION_FAILED",
    "message": "BOQ file contains validation errors",
    "errors": [
      { "code": "1.2", "field": "quantity", "message": "Quantity must be a positive number" }
    ]
  }
}
```

Processing is async — returns jobId immediately. Frontend polls job endpoint.

---

## 3. Poll Job Status (reuse existing pattern)

```
GET /projects/:projectId/schedule/job/:jobId
Auth: required
Response 200:
{
  "success": true,
  "data": {
    "status": "processing" | "running" | "done" | "error",
    "step": "Calling AI to generate activities…",
    "progress": 70,
    "error": null
  }
}
```

Note: Reuse the existing job polling infrastructure from `use-schedule.ts` if possible, or create `GET /projects/:projectId/boq/job/:jobId` with identical shape.

---

## 4. Get Full BOQ (items + activities + financial)

```
GET /projects/:projectId/boq
Auth: required
Response 200:
{
  "success": true,
  "data": {
    "projectId": "uuid",
    "hasUploadedBoq": true,
    "uploadedAt": "2026-05-03T10:00:00Z",
    "items": [
      {
        "id": "uuid",
        "code": "1.1",
        "description": "Site Clearance",
        "quantity": 1200,
        "unit": "m²",
        "rate": 15.00,
        "amount": 18000.00,
        "isManual": false,
        "sortOrder": 0,
        "createdAt": "...",
        "activities": [
          {
            "id": "uuid",
            "boqItemId": "uuid",
            "activityCode": "AC-7F2K9",
            "activityName": "Vegetation removal and site hoarding",
            "unit": "m²",
            "quantity": 1200,
            "rate": 8.00,
            "budget": 9600.00,
            "dependencyType": null,
            "predecessorCode": null,
            "isManual": false,
            "sortOrder": 0
          }
        ]
      }
    ],
    "financial": {
      "subtotal1": 95000.00,
      "extraServices": [
        { "label": "VAT", "percentage": 5.0, "value": 4750.00 },
        { "label": "Contractor Overhead", "percentage": 10.0, "value": 9500.00 },
        { "label": "Contingency", "percentage": 3.0, "value": 2850.00 }
      ],
      "subtotal2": 112100.00,
      "totalProjectCost": 112100.00
    }
  }
}
```

---

## 5. Update BOQ Item (inline edit)

```
PATCH /projects/:projectId/boq/items/:itemId
Auth: required
Body (all fields optional):
{
  "code": "1.1b",
  "description": "Updated description",
  "quantity": 1300,
  "unit": "m²",
  "rate": 16.00
}

Response 200:
{
  "success": true,
  "data": {
    "item": { ...updated BoqItem with recalculated amount },
    "financial": { ...recalculated BoqFinancialSummary }
  }
}
```

Server recalculates `amount = quantity * rate` and updates financial summary.

---

## 6. Add Manual BOQ Row

```
POST /projects/:projectId/boq/items
Auth: required
Body:
{
  "code": "5.1",
  "description": "Manual: Additional steelwork",
  "quantity": 200,
  "unit": "kg",
  "rate": 3.50,
  "activityName": "Fabricate and erect steelwork",
  "activityCode": "AC-STEEL1"
}

Response 201:
{
  "success": true,
  "data": {
    "item": { ...BoqItemWithActivities, isManual: true },
    "financial": { ...updated }
  }
}
```

Server creates BOQ item (`isManual: true`) + one activity with the provided `activityName` + `activityCode` (no AI call).

---

## 7. Delete Manual BOQ Row

```
DELETE /projects/:projectId/boq/items/:itemId
Auth: required

Success 200: { "success": true, "data": { "financial": {...} } }

Error 403 (if isManual === false):
{
  "success": false,
  "error": {
    "code": "BOQ_ITEM_NOT_DELETABLE",
    "message": "Uploaded BOQ rows cannot be deleted"
  }
}
```

---

## 8. Add Activity to BOQ Item

```
POST /projects/:projectId/boq/items/:itemId/activities
Auth: required
Body:
{
  "activityName": "Install temporary drainage",
  "unit": "m",
  "quantity": 50,
  "rate": 45.00,
  "dependencyType": "FS",
  "predecessorCode": "AC-7F2K9"
}

Response 201:
{
  "success": true,
  "data": {
    "activity": {
      "id": "uuid",
      "activityCode": "AC-9XQ22",   ← server generates this
      "activityName": "Install temporary drainage",
      ...
    }
  }
}
```

Activity code is auto-generated server-side (random alphanumeric). Not provided by client.

---

## 9. Update Activity (inline edit)

```
PATCH /projects/:projectId/boq/activities/:activityId
Auth: required
Body (all optional):
{
  "activityCode": "AC-NEWCD",
  "activityName": "Updated activity name",
  "unit": "m²",
  "quantity": 80,
  "rate": 25.00,
  "dependencyType": "SS",
  "predecessorCode": "AC-7F2K9"
}

Response 200:
{
  "success": true,
  "data": {
    "activity": { ...updated BoqActivity with recalculated budget }
  }
}
```

Server recalculates `budget = quantity * rate`.

---

## 10. Delete Activity

```
DELETE /projects/:projectId/boq/activities/:activityId
Auth: required
Response 200: { "success": true, "data": null }
```

No restriction on deleting activities (unlike BOQ rows).

---

## 11. Extra Services Config

```
GET /config/extra-services
Auth: required
Response 200:
{
  "success": true,
  "data": [
    { "label": "VAT",                  "percentage": 5.0 },
    { "label": "Contractor Overhead",  "percentage": 10.0 },
    { "label": "Contingency",          "percentage": 3.0 }
  ]
}
```

---

## Middleware Requirements

All BOQ routes must pass through:
1. `authMiddleware` — validate JWT
2. `tenantMiddleware` — scope by `org_id` (multi-tenant)
3. `rbacMiddleware(['PM', 'Planning Engineer', 'QS'])` — only these roles can modify BOQ

---

## Express Router Registration

```javascript
// backend/routes/boq.routes.js

const router = express.Router({ mergeParams: true })

router.get('/template',                    auth, rbac(['PM','Planning Engineer','QS']), downloadTemplate)
router.post('/upload',                     auth, rbac(['PM','Planning Engineer','QS']), upload.single('file'), uploadBoq)
router.get('/job/:jobId',                  auth, getBoqJobStatus)
router.get('/',                            auth, getProjectBoq)
router.patch('/items/:itemId',             auth, rbac(['PM','Planning Engineer','QS']), updateBoqItem)
router.post('/items',                      auth, rbac(['PM','Planning Engineer','QS']), createManualBoqItem)
router.delete('/items/:itemId',            auth, rbac(['PM','Planning Engineer','QS']), deleteBoqItem)
router.post('/items/:itemId/activities',   auth, rbac(['PM','Planning Engineer','QS']), createActivity)
router.patch('/activities/:activityId',    auth, rbac(['PM','Planning Engineer','QS']), updateActivity)
router.delete('/activities/:activityId',   auth, rbac(['PM','Planning Engineer','QS']), deleteActivity)

// Register at:
app.use('/api/v1/projects/:projectId/boq', router)
```
