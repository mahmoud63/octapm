# Mobile Site Reporting API

Base path: `/api/v1/projects/{projectId}`  
Auth: `Authorization: Bearer <accessToken>`  
Envelope: `{ "success": true, "data": ... }` or `{ "success": false, "error": { "code": "...", "message": "..." } }`

## Status Model

Daily reports and site diaries use:

- `draft`
- `submitted`
- `approved`
- `rejected`

Site engineers can create/update drafts and submit records. Only PM users can approve or reject submitted daily reports and site diaries. Planning Engineer and QS users may still approve normal progress submissions where the progress permission matrix allows it, but they do not perform final site-record approval.

Mobile clients should send a stable `clientRequestId` for every locally captured record. Replaying the same `{ projectId, clientRequestId }` returns the original saved record instead of creating a duplicate, which supports offline retry after weak connectivity.

## Photo Upload

`POST /site-reporting/uploads`

Multipart form-data:

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `files` | file[] | yes | Up to 10 images, 8 MB each. JPEG, PNG, WebP, HEIC, HEIF. |

Response:

```json
[
  {
    "documentId": "8f4ef4f1-6b71-4b64-9b2a-9dbf2b94f4c0",
    "key": "8f4ef4f1-6b71-4b64-9dbf2b94f4c0",
    "storageKey": "8f4ef4f1-6b71-4b64-9dbf2b94f4c0",
    "url": "/api/v1/projects/project-id/site-reporting/uploads/8f4ef4f1-6b71-4b64-9dbf2b94f4c0",
    "downloadUrl": "/api/v1/projects/project-id/site-reporting/uploads/8f4ef4f1-6b71-4b64-9dbf2b94f4c0",
    "filename": "north-pour.jpg",
    "originalName": "north pour.jpg",
    "mimeType": "image/jpeg",
    "size": 482901,
    "sizeBytes": 482901,
    "storage": "s3",
    "scanStatus": "clean",
    "retentionExpiresAt": "2033-06-08T21:00:00.000Z",
    "uploadedBy": "user-id",
    "uploadedAt": "2026-06-09T21:00:00.000Z"
  }
]
```

`GET /site-reporting/uploads/{key}` downloads one project-scoped uploaded image. When S3 storage is enabled, the authenticated API responds with a short-lived private presigned redirect; clients should keep using the API URL, not the private object key.

## Daily Activity Reports

`GET /daily-reports?activityId=&status=&date=&from=&to=`  
`POST /daily-reports`  
`GET /daily-reports/{reportId}`  
`PATCH /daily-reports/{reportId}`  
`POST /daily-reports/{reportId}/submit`  
`POST /daily-reports/{reportId}/approve`  
`POST /daily-reports/{reportId}/reject`

Create/update request:

```json
{
  "activityId": "activity-id",
  "date": "2026-06-09",
  "shift": "day",
  "pctProgress": 35,
  "weather": { "summary": "Clear, 34C", "rainfallMm": 0, "delayImpact": false },
  "manpower": [{ "trade": "civil", "workers": 8, "hours": 8 }],
  "equipment": [{ "name": "crane", "hours": 3 }],
  "materials": [{ "name": "rebar", "qty": 4, "unit": "ton" }],
  "issues": [{ "description": "Pump downtime 30 minutes", "severity": "medium", "status": "open" }],
  "photos": [{ "key": "photo-document-id", "url": "/api/v1/projects/project-id/site-reporting/uploads/photo-document-id" }],
  "notes": "North zone complete",
  "clientRequestId": "mobile-uuid-1",
  "clientCreatedAt": "2026-06-09T06:15:00.000Z",
  "deviceId": "tablet-7",
  "status": "submitted",
  "progress": {
    "method": "percent",
    "pctComplete": 35,
    "evidence": {
      "photos": [{ "key": "photo-document-id", "url": "/api/v1/projects/project-id/site-reporting/uploads/photo-document-id" }]
    }
  }
}
```

Reject request:

```json
{ "reason": "Photo evidence is missing" }
```

Response shape:

```json
{
  "id": "report-id",
  "projectId": "project-id",
  "activityId": "activity-id",
  "engineerId": "user-id",
  "date": "2026-06-09T00:00:00.000Z",
  "shift": "day",
  "pctProgress": 35,
  "weather": { "summary": "Clear, 34C", "rainfallMm": 0, "delayImpact": false },
  "manpower": [],
  "equipment": [],
  "materials": [],
  "issues": [],
  "photos": [],
  "notes": "North zone complete",
  "lineSummary": {
    "totalWorkers": 0,
    "totalManHours": 0,
    "equipmentHours": 0,
    "materialLines": 0,
    "photoCount": 0,
    "issueCount": 0
  },
  "clientRequestId": "mobile-uuid-1",
  "clientCreatedAt": "2026-06-09T06:15:00.000Z",
  "deviceId": "tablet-7",
  "status": "submitted",
  "submittedAt": "2026-06-09T21:00:00.000Z",
  "reviewedBy": null,
  "reviewedAt": null,
  "rejectionReason": null,
  "activity": { "id": "activity-id", "name": "Foundations", "wbsCode": "A.01" },
  "progressSubmissions": []
}
```

Approving a submitted daily report approves linked FB-008 progress submissions and creates official approved progress rows used by earned value reporting.

Photo evidence with a `key` must reference a clean `site_photo` document uploaded through `/site-reporting/uploads` for the same project. Cross-project, unavailable, or unscanned photo keys are rejected with `INVALID_SITE_PHOTO_REFERENCE`.

## Site Diaries

`GET /site-diaries?status=&date=&from=&to=`  
`POST /site-diaries`  
`GET /site-diaries/{diaryId}`  
`PATCH /site-diaries/{diaryId}`  
`POST /site-diaries/{diaryId}/submit`  
`POST /site-diaries/{diaryId}/approve`  
`POST /site-diaries/{diaryId}/reject`

Create/update request:

```json
{
  "date": "2026-06-09",
  "shift": "day",
  "weather": "Clear, 34C",
  "weatherDetails": { "summary": "Clear, 34C", "rainfallMm": 0, "delayImpact": false },
  "workers": 42,
  "visitors": "Client QA team",
  "workDone": "Level 2 slab pour",
  "issues": "Pump downtime 30 minutes",
  "issueItems": [{ "description": "Pump downtime 30 minutes", "severity": "medium", "status": "open" }],
  "instructions": "Protect edge forms overnight",
  "manpower": [{ "trade": "concrete", "workers": 18, "hours": 8 }],
  "equipment": [{ "name": "pump", "hours": 6 }],
  "materials": [{ "name": "concrete", "qty": 120, "unit": "m3" }],
  "photos": [{ "key": "photo-document-id", "url": "/api/v1/projects/project-id/site-reporting/uploads/photo-document-id" }],
  "notes": "Pour completed",
  "clientRequestId": "mobile-uuid-2",
  "clientCreatedAt": "2026-06-09T06:20:00.000Z",
  "deviceId": "tablet-7",
  "status": "submitted"
}
```

Response shape:

```json
{
  "id": "diary-id",
  "projectId": "project-id",
  "engineerId": "user-id",
  "date": "2026-06-09T00:00:00.000Z",
  "shift": "day",
  "weather": "Clear, 34C",
  "weatherDetails": { "summary": "Clear, 34C", "rainfallMm": 0, "delayImpact": false },
  "workers": 42,
  "visitors": "Client QA team",
  "workDone": "Level 2 slab pour",
  "issues": "Pump downtime 30 minutes",
  "issueItems": [],
  "instructions": "Protect edge forms overnight",
  "manpower": [],
  "equipment": [],
  "materials": [],
  "photos": [],
  "notes": "Pour completed",
  "lineSummary": {
    "totalWorkers": 0,
    "totalManHours": 0,
    "equipmentHours": 0,
    "materialLines": 0,
    "photoCount": 0,
    "issueCount": 0
  },
  "clientRequestId": "mobile-uuid-2",
  "clientCreatedAt": "2026-06-09T06:20:00.000Z",
  "deviceId": "tablet-7",
  "status": "submitted",
  "submittedAt": "2026-06-09T21:00:00.000Z",
  "reviewedBy": null,
  "reviewedAt": null,
  "rejectionReason": null
}
```
