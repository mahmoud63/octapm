-- OCTA-DWG-CORE-011: drawing sets → sheets → sheet revisions. Legacy
-- DrawingRecord rows become Sheets, and their latest stored DocumentRevision
-- becomes the published SheetRevision, so nothing disappears from the site.

CREATE TABLE "DrawingSet" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "setNumber" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "discipline" TEXT,
  "purpose" TEXT,
  "status" TEXT NOT NULL DEFAULT 'draft',
  "sourceDocumentId" TEXT,
  "pageCount" INTEGER,
  "processedPages" INTEGER NOT NULL DEFAULT 0,
  "detectionSummaryJson" JSONB,
  "receivedAt" TIMESTAMP(3),
  "issuedAt" TIMESTAMP(3),
  "uploadedBy" TEXT,
  "publishedAt" TIMESTAMP(3),
  "publishedBy" TEXT,
  "jobId" TEXT,
  "error" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "DrawingSet_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DrawingSet_projectId_setNumber_key" ON "DrawingSet"("projectId", "setNumber");
CREATE INDEX "DrawingSet_orgId_idx" ON "DrawingSet"("orgId");
CREATE INDEX "DrawingSet_projectId_status_idx" ON "DrawingSet"("projectId", "status");
CREATE INDEX "DrawingSet_sourceDocumentId_idx" ON "DrawingSet"("sourceDocumentId");

ALTER TABLE "DrawingSet"
  ADD CONSTRAINT "DrawingSet_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DrawingSet"
  ADD CONSTRAINT "DrawingSet_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DrawingSet"
  ADD CONSTRAINT "DrawingSet_sourceDocumentId_fkey" FOREIGN KEY ("sourceDocumentId") REFERENCES "ProjectDocument"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "Sheet" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "number" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "discipline" TEXT,
  "locationId" TEXT,
  "status" TEXT NOT NULL DEFAULT 'current',
  "obsoleteReason" TEXT,
  "currentRevisionId" TEXT,
  "drawingRecordId" TEXT,
  "sortKey" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "Sheet_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Sheet_projectId_number_key" ON "Sheet"("projectId", "number");
CREATE INDEX "Sheet_orgId_idx" ON "Sheet"("orgId");
CREATE INDEX "Sheet_projectId_status_sortKey_idx" ON "Sheet"("projectId", "status", "sortKey");
CREATE INDEX "Sheet_projectId_discipline_idx" ON "Sheet"("projectId", "discipline");
CREATE INDEX "Sheet_projectId_locationId_idx" ON "Sheet"("projectId", "locationId");
CREATE INDEX "Sheet_drawingRecordId_idx" ON "Sheet"("drawingRecordId");

ALTER TABLE "Sheet"
  ADD CONSTRAINT "Sheet_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Sheet"
  ADD CONSTRAINT "Sheet_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Sheet"
  ADD CONSTRAINT "Sheet_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "SheetRevision" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "sheetId" TEXT,
  "setId" TEXT,
  "documentId" TEXT NOT NULL,
  "pageNumber" INTEGER NOT NULL DEFAULT 1,
  "number" TEXT,
  "title" TEXT,
  "revision" TEXT,
  "discipline" TEXT,
  "status" TEXT NOT NULL DEFAULT 'pending_review',
  "detectedNumber" TEXT,
  "detectedTitle" TEXT,
  "detectedRevision" TEXT,
  "detectedDiscipline" TEXT,
  "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "confidenceJson" JSONB,
  "textStatus" TEXT NOT NULL DEFAULT 'none',
  "widthPt" DOUBLE PRECISION,
  "heightPt" DOUBLE PRECISION,
  "rotation" INTEGER NOT NULL DEFAULT 0,
  "reviewedBy" TEXT,
  "reviewedAt" TIMESTAMP(3),
  "publishedAt" TIMESTAMP(3),
  "publishedBy" TEXT,
  "supersededById" TEXT,
  "supersededAt" TIMESTAMP(3),
  "createdBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "SheetRevision_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SheetRevision_setId_pageNumber_key" ON "SheetRevision"("setId", "pageNumber");
CREATE INDEX "SheetRevision_orgId_idx" ON "SheetRevision"("orgId");
CREATE INDEX "SheetRevision_projectId_status_idx" ON "SheetRevision"("projectId", "status");
CREATE INDEX "SheetRevision_sheetId_status_idx" ON "SheetRevision"("sheetId", "status");
CREATE INDEX "SheetRevision_documentId_idx" ON "SheetRevision"("documentId");
CREATE INDEX "SheetRevision_supersededById_idx" ON "SheetRevision"("supersededById");

ALTER TABLE "SheetRevision"
  ADD CONSTRAINT "SheetRevision_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SheetRevision"
  ADD CONSTRAINT "SheetRevision_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SheetRevision"
  ADD CONSTRAINT "SheetRevision_sheetId_fkey" FOREIGN KEY ("sheetId") REFERENCES "Sheet"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SheetRevision"
  ADD CONSTRAINT "SheetRevision_setId_fkey" FOREIGN KEY ("setId") REFERENCES "DrawingSet"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SheetRevision"
  ADD CONSTRAINT "SheetRevision_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "ProjectDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: one Sheet per legacy drawing record (first record wins a number).
INSERT INTO "Sheet" ("id", "orgId", "projectId", "number", "title", "discipline", "status", "drawingRecordId", "sortKey", "createdAt", "updatedAt")
SELECT DISTINCT ON (d."projectId", upper(regexp_replace(d."drawingNumber", '\s+', '', 'g')))
       gen_random_uuid()::text,
       p."orgId",
       d."projectId",
       upper(regexp_replace(d."drawingNumber", '\s+', '', 'g')),
       d."title",
       d."discipline",
       CASE WHEN d."status" = 'active' THEN 'current' ELSE 'obsolete' END,
       d."id",
       lower(regexp_replace(upper(regexp_replace(d."drawingNumber", '\s+', '', 'g')), '(\d+)', '000000\1', 'g')),
       d."createdAt",
       NOW()
FROM "DrawingRecord" d
JOIN "Project" p ON p."id" = d."projectId"
WHERE d."drawingNumber" IS NOT NULL AND btrim(d."drawingNumber") <> ''
ORDER BY d."projectId", upper(regexp_replace(d."drawingNumber", '\s+', '', 'g')), d."createdAt"
ON CONFLICT ("projectId", "number") DO NOTHING;

-- Backfill: the latest stored revision of each legacy drawing becomes the
-- published sheet revision.
INSERT INTO "SheetRevision" ("id", "orgId", "projectId", "sheetId", "documentId", "pageNumber", "number", "title", "revision", "discipline", "status", "confidence", "textStatus", "publishedAt", "createdBy", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text,
       s."orgId",
       s."projectId",
       s."id",
       r."projectDocumentId",
       1,
       s."number",
       s."title",
       COALESCE(NULLIF(btrim(r."revision"), ''), NULLIF(btrim(d."revision"), ''), '0'),
       s."discipline",
       'published',
       1,
       'none',
       COALESCE(r."approvedAt", r."issuedAt", r."createdAt"),
       r."issuedBy",
       r."createdAt",
       NOW()
FROM "Sheet" s
JOIN "DrawingRecord" d ON d."id" = s."drawingRecordId"
JOIN LATERAL (
  SELECT dr.*
  FROM "DocumentRevision" dr
  WHERE dr."recordType" = 'drawing'
    AND dr."recordId" = d."id"
    AND dr."projectDocumentId" IS NOT NULL
  ORDER BY dr."isLatest" DESC, dr."issuedAt" DESC, dr."createdAt" DESC
  LIMIT 1
) r ON TRUE;

UPDATE "Sheet" s
SET "currentRevisionId" = r."id"
FROM "SheetRevision" r
WHERE r."sheetId" = s."id"
  AND r."status" = 'published'
  AND s."currentRevisionId" IS NULL;
