-- OCTA-DOC-ATTACH-006: one polymorphic Attachment table plus a Photo entity
-- over ProjectDocument. Existing WorkflowAttachment, CommercialAttachmentRef,
-- TaskAttachment rows and daily-report / site-diary photosJson entries that
-- point at a stored document are migrated; the legacy tables stay readable.

CREATE TABLE "Attachment" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "recordType" TEXT NOT NULL,
  "recordId" TEXT NOT NULL,
  "documentId" TEXT NOT NULL,
  "role" TEXT NOT NULL DEFAULT 'attachment',
  "caption" TEXT,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "source" TEXT NOT NULL DEFAULT 'upload',
  "uploadedBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "Attachment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Attachment_recordType_recordId_documentId_key" ON "Attachment"("recordType", "recordId", "documentId");
CREATE INDEX "Attachment_orgId_idx" ON "Attachment"("orgId");
CREATE INDEX "Attachment_projectId_recordType_recordId_idx" ON "Attachment"("projectId", "recordType", "recordId");
CREATE INDEX "Attachment_projectId_documentId_idx" ON "Attachment"("projectId", "documentId");
CREATE INDEX "Attachment_documentId_idx" ON "Attachment"("documentId");

ALTER TABLE "Attachment"
  ADD CONSTRAINT "Attachment_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Attachment"
  ADD CONSTRAINT "Attachment_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Attachment"
  ADD CONSTRAINT "Attachment_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "ProjectDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "Photo" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "documentId" TEXT NOT NULL,
  "locationId" TEXT,
  "caption" TEXT,
  "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "takenAt" TIMESTAMP(3),
  "latitude" DOUBLE PRECISION,
  "longitude" DOUBLE PRECISION,
  "altitude" DOUBLE PRECISION,
  "cameraMake" TEXT,
  "cameraModel" TEXT,
  "width" INTEGER,
  "height" INTEGER,
  "orientation" INTEGER,
  "thumbnailKey" TEXT,
  "thumbnailStatus" TEXT NOT NULL DEFAULT 'pending',
  "exifJson" JSONB,
  "uploadedBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "Photo_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Photo_documentId_key" ON "Photo"("documentId");
CREATE INDEX "Photo_orgId_idx" ON "Photo"("orgId");
CREATE INDEX "Photo_projectId_takenAt_idx" ON "Photo"("projectId", "takenAt");
CREATE INDEX "Photo_projectId_createdAt_idx" ON "Photo"("projectId", "createdAt");
CREATE INDEX "Photo_projectId_locationId_idx" ON "Photo"("projectId", "locationId");
CREATE INDEX "Photo_projectId_thumbnailStatus_idx" ON "Photo"("projectId", "thumbnailStatus");

ALTER TABLE "Photo"
  ADD CONSTRAINT "Photo_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Photo"
  ADD CONSTRAINT "Photo_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Photo"
  ADD CONSTRAINT "Photo_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "ProjectDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Photo"
  ADD CONSTRAINT "Photo_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Workflow evidence (storageKey holds the ProjectDocument id for stored uploads).
INSERT INTO "Attachment" ("id", "orgId", "projectId", "recordType", "recordId", "documentId", "role", "caption", "source", "uploadedBy", "createdAt", "updatedAt")
SELECT gen_random_uuid(), d."orgId", w."projectId", w."recordType", w."recordId", d."id", 'evidence', w."description", 'migrated_workflow', w."uploadedBy", w."uploadedAt", CURRENT_TIMESTAMP
FROM "WorkflowAttachment" w
JOIN "ProjectDocument" d ON (d."id" = w."storageKey" OR d."storageKey" = w."storageKey") AND d."projectId" = w."projectId"
WHERE w."storageKey" IS NOT NULL
ON CONFLICT ("recordType", "recordId", "documentId") DO NOTHING;

-- Commercial attachment references.
INSERT INTO "Attachment" ("id", "orgId", "projectId", "recordType", "recordId", "documentId", "role", "caption", "source", "uploadedBy", "createdAt", "updatedAt")
SELECT gen_random_uuid(), d."orgId", c."projectId", c."recordType", c."recordId", d."id", 'attachment', c."description", 'migrated_commercial', c."uploadedBy", c."createdAt", CURRENT_TIMESTAMP
FROM "CommercialAttachmentRef" c
JOIN "ProjectDocument" d ON d."id" = COALESCE(c."documentId", c."storageKey") AND d."projectId" = c."projectId"
ON CONFLICT ("recordType", "recordId", "documentId") DO NOTHING;

-- Task attachments.
INSERT INTO "Attachment" ("id", "orgId", "projectId", "recordType", "recordId", "documentId", "role", "source", "uploadedBy", "createdAt", "updatedAt")
SELECT gen_random_uuid(), t."orgId", t."projectId", 'task', t."taskId", t."projectDocumentId", 'attachment', 'migrated_task', t."uploadedById", t."createdAt", CURRENT_TIMESTAMP
FROM "TaskAttachment" t
WHERE t."projectDocumentId" IS NOT NULL
ON CONFLICT ("recordType", "recordId", "documentId") DO NOTHING;

-- Daily report and site diary photo evidence stored as JSON arrays.
INSERT INTO "Attachment" ("id", "orgId", "projectId", "recordType", "recordId", "documentId", "role", "caption", "source", "uploadedBy", "createdAt", "updatedAt")
SELECT gen_random_uuid(), d."orgId", r."projectId", 'daily_report', r."id", d."id", 'photo',
       NULLIF(BTRIM(COALESCE(p.elem->>'caption', p.elem->>'description', '')), ''),
       'migrated_photos', r."engineerId", r."createdAt", CURRENT_TIMESTAMP
FROM "DailyReport" r
CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(r."photosJson") = 'array' THEN r."photosJson" ELSE '[]'::jsonb END) AS p(elem)
JOIN "ProjectDocument" d ON d."id" = COALESCE(p.elem->>'documentId', p.elem->>'storageKey', p.elem->>'key') AND d."projectId" = r."projectId"
ON CONFLICT ("recordType", "recordId", "documentId") DO NOTHING;

INSERT INTO "Attachment" ("id", "orgId", "projectId", "recordType", "recordId", "documentId", "role", "caption", "source", "uploadedBy", "createdAt", "updatedAt")
SELECT gen_random_uuid(), d."orgId", s."projectId", 'site_diary', s."id", d."id", 'photo',
       NULLIF(BTRIM(COALESCE(p.elem->>'caption', p.elem->>'description', '')), ''),
       'migrated_photos', NULL, s."createdAt", CURRENT_TIMESTAMP
FROM "SiteDiary" s
CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(s."photosJson") = 'array' THEN s."photosJson" ELSE '[]'::jsonb END) AS p(elem)
JOIN "ProjectDocument" d ON d."id" = COALESCE(p.elem->>'documentId', p.elem->>'storageKey', p.elem->>'key') AND d."projectId" = s."projectId"
ON CONFLICT ("recordType", "recordId", "documentId") DO NOTHING;

-- Every stored image that is a site photo or attached somewhere becomes a Photo;
-- EXIF and thumbnails are filled in by the photo.thumbnail job on next access.
INSERT INTO "Photo" ("id", "orgId", "projectId", "documentId", "takenAt", "thumbnailStatus", "uploadedBy", "createdAt", "updatedAt")
SELECT gen_random_uuid(), d."orgId", d."projectId", d."id", d."uploadedAt", 'pending', d."uploadedBy", d."uploadedAt", CURRENT_TIMESTAMP
FROM "ProjectDocument" d
WHERE d."mimeType" LIKE 'image/%'
  AND (d."documentType" = 'site_photo' OR EXISTS (SELECT 1 FROM "Attachment" a WHERE a."documentId" = d."id"))
ON CONFLICT ("documentId") DO NOTHING;
