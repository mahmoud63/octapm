-- OCTA-DOC-TEXT-010: extracted document text with a generated tsvector for
-- Postgres full-text search, plus overlapping chunks that can carry
-- embeddings when a provider is configured.

CREATE TABLE "DocumentText" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "documentId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "extractor" TEXT,
  "text" TEXT,
  "excerpt" TEXT,
  "wordCount" INTEGER NOT NULL DEFAULT 0,
  "pageCount" INTEGER,
  "chunkCount" INTEGER NOT NULL DEFAULT 0,
  "embeddingStatus" TEXT NOT NULL DEFAULT 'none',
  "embeddingModel" TEXT,
  "embeddingError" TEXT,
  "error" TEXT,
  "extractedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "searchVector" tsvector GENERATED ALWAYS AS (
    to_tsvector('english'::regconfig, left(coalesce("text", ''), 400000))
  ) STORED,

  CONSTRAINT "DocumentText_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DocumentText_documentId_key" ON "DocumentText"("documentId");
CREATE INDEX "DocumentText_orgId_idx" ON "DocumentText"("orgId");
CREATE INDEX "DocumentText_projectId_status_idx" ON "DocumentText"("projectId", "status");
CREATE INDEX "DocumentText_projectId_embeddingStatus_idx" ON "DocumentText"("projectId", "embeddingStatus");
CREATE INDEX "DocumentText_searchVector_idx" ON "DocumentText" USING GIN ("searchVector");

ALTER TABLE "DocumentText"
  ADD CONSTRAINT "DocumentText_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DocumentText"
  ADD CONSTRAINT "DocumentText_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DocumentText"
  ADD CONSTRAINT "DocumentText_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "ProjectDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "DocumentChunk" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "documentId" TEXT NOT NULL,
  "documentTextId" TEXT NOT NULL,
  "index" INTEGER NOT NULL,
  "text" TEXT NOT NULL,
  "charStart" INTEGER NOT NULL DEFAULT 0,
  "charEnd" INTEGER NOT NULL DEFAULT 0,
  "embedding" DOUBLE PRECISION[] DEFAULT ARRAY[]::DOUBLE PRECISION[],
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "DocumentChunk_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DocumentChunk_documentId_index_key" ON "DocumentChunk"("documentId", "index");
CREATE INDEX "DocumentChunk_orgId_idx" ON "DocumentChunk"("orgId");
CREATE INDEX "DocumentChunk_projectId_documentId_idx" ON "DocumentChunk"("projectId", "documentId");
CREATE INDEX "DocumentChunk_documentTextId_idx" ON "DocumentChunk"("documentTextId");

ALTER TABLE "DocumentChunk"
  ADD CONSTRAINT "DocumentChunk_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DocumentChunk"
  ADD CONSTRAINT "DocumentChunk_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DocumentChunk"
  ADD CONSTRAINT "DocumentChunk_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "ProjectDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DocumentChunk"
  ADD CONSTRAINT "DocumentChunk_documentTextId_fkey" FOREIGN KEY ("documentTextId") REFERENCES "DocumentText"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Queue extraction for every existing text-bearing document so the index is
-- populated by the job worker after deploy (photos and binary uploads skip).
INSERT INTO "DocumentText" ("id", "orgId", "projectId", "documentId", "status", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, d."orgId", d."projectId", d."id", 'pending', NOW(), NOW()
FROM "ProjectDocument" d
WHERE d."status" IN ('available', 'linked')
  AND d."documentType" <> 'site_photo'
  AND d."mimeType" NOT LIKE 'image/%'
ON CONFLICT ("documentId") DO NOTHING;

INSERT INTO "BackgroundJob" ("id", "orgId", "projectId", "type", "status", "priority", "attempts", "maxAttempts", "payloadJson", "progressJson", "runAfter", "expiresAt", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, t."orgId", t."projectId", 'document.extract', 'queued', -1, 0, 3,
       jsonb_build_object('documentId', t."documentId", 'source', 'migration'),
       jsonb_build_object('progress', 0),
       NOW(), NOW() + INTERVAL '30 days', NOW(), NOW()
FROM "DocumentText" t
WHERE t."status" = 'pending';
