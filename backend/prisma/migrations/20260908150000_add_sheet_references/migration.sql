-- OCTA-AI-DWG-035: sheet cross-references (hyperlinks between sheets).

CREATE TABLE "SheetReference" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "sheetId" TEXT NOT NULL,
  "revisionId" TEXT,
  "targetNumber" TEXT NOT NULL,
  "targetSheetId" TEXT,
  "count" INTEGER NOT NULL DEFAULT 1,
  "samplesJson" JSONB NOT NULL DEFAULT '[]',
  "source" TEXT NOT NULL DEFAULT 'text',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SheetReference_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SheetReference_sheetId_targetNumber_key" ON "SheetReference"("sheetId", "targetNumber");
CREATE INDEX "SheetReference_orgId_idx" ON "SheetReference"("orgId");
CREATE INDEX "SheetReference_projectId_targetSheetId_idx" ON "SheetReference"("projectId", "targetSheetId");

ALTER TABLE "SheetReference"
  ADD CONSTRAINT "SheetReference_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "SheetReference_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "SheetReference_sheetId_fkey" FOREIGN KEY ("sheetId") REFERENCES "Sheet"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "SheetReference_targetSheetId_fkey" FOREIGN KEY ("targetSheetId") REFERENCES "Sheet"("id") ON DELETE SET NULL ON UPDATE CASCADE;
