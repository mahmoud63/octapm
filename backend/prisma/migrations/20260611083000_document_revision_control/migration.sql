ALTER TABLE "DocumentRevision"
  ADD COLUMN "projectDocumentId" TEXT,
  ADD COLUMN "isLatest" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "approvedBy" TEXT,
  ADD COLUMN "approvedAt" TIMESTAMP(3),
  ADD COLUMN "supersededBy" TEXT,
  ADD COLUMN "supersededAt" TIMESTAMP(3);

UPDATE "DocumentRevision" AS revision
SET "isLatest" = true
WHERE revision.id IN (
  SELECT DISTINCT ON ("projectId", "recordType", "recordId") id
  FROM "DocumentRevision"
  WHERE COALESCE("status", '') <> 'superseded'
  ORDER BY "projectId", "recordType", "recordId", "issuedAt" DESC, "createdAt" DESC
);

CREATE INDEX "DocumentRevision_projectId_recordType_recordId_isLatest_idx"
  ON "DocumentRevision"("projectId", "recordType", "recordId", "isLatest");

CREATE INDEX "DocumentRevision_projectDocumentId_idx"
  ON "DocumentRevision"("projectDocumentId");

ALTER TABLE "DocumentRevision"
  ADD CONSTRAINT "DocumentRevision_projectDocumentId_fkey"
  FOREIGN KEY ("projectDocumentId")
  REFERENCES "ProjectDocument"("id")
  ON DELETE SET NULL
  ON UPDATE CASCADE;
