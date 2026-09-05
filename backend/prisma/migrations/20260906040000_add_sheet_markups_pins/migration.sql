-- OCTA-DWG-MARKUP-012: vector markups (personal until published) and pins
-- that tie records to a point on a sheet. Coordinates are normalised (0..1)
-- so both carry across revisions of the same sheet.

ALTER TABLE "Sheet" ADD COLUMN "scaleRatio" DOUBLE PRECISION;

CREATE TABLE "Markup" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "sheetId" TEXT NOT NULL,
  "sheetRevisionId" TEXT,
  "authorId" TEXT,
  "visibility" TEXT NOT NULL DEFAULT 'personal',
  "name" TEXT,
  "shapesJson" JSONB NOT NULL DEFAULT '[]',
  "shapeCount" INTEGER NOT NULL DEFAULT 0,
  "publishedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "Markup_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Markup_orgId_idx" ON "Markup"("orgId");
CREATE INDEX "Markup_projectId_sheetId_visibility_idx" ON "Markup"("projectId", "sheetId", "visibility");
CREATE INDEX "Markup_sheetId_authorId_visibility_idx" ON "Markup"("sheetId", "authorId", "visibility");

ALTER TABLE "Markup"
  ADD CONSTRAINT "Markup_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Markup"
  ADD CONSTRAINT "Markup_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Markup"
  ADD CONSTRAINT "Markup_sheetId_fkey" FOREIGN KEY ("sheetId") REFERENCES "Sheet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "Pin" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "sheetId" TEXT NOT NULL,
  "sheetRevisionId" TEXT,
  "x" DOUBLE PRECISION NOT NULL,
  "y" DOUBLE PRECISION NOT NULL,
  "recordType" TEXT NOT NULL,
  "recordId" TEXT NOT NULL,
  "label" TEXT,
  "color" TEXT,
  "createdBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "Pin_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Pin_orgId_idx" ON "Pin"("orgId");
CREATE INDEX "Pin_projectId_sheetId_idx" ON "Pin"("projectId", "sheetId");
CREATE INDEX "Pin_projectId_recordType_recordId_idx" ON "Pin"("projectId", "recordType", "recordId");

ALTER TABLE "Pin"
  ADD CONSTRAINT "Pin_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Pin"
  ADD CONSTRAINT "Pin_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Pin"
  ADD CONSTRAINT "Pin_sheetId_fkey" FOREIGN KEY ("sheetId") REFERENCES "Sheet"("id") ON DELETE CASCADE ON UPDATE CASCADE;
