-- OCTA-AI-SPEC-036: specification sections indexed from document text.

CREATE TABLE "SpecSection" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "documentId" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "codeKey" TEXT NOT NULL,
  "division" TEXT,
  "title" TEXT NOT NULL,
  "charStart" INTEGER NOT NULL,
  "charEnd" INTEGER NOT NULL,
  "pageFrom" INTEGER,
  "pageTo" INTEGER,
  "wordCount" INTEGER NOT NULL DEFAULT 0,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SpecSection_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SpecSection_documentId_charStart_key" ON "SpecSection"("documentId", "charStart");
CREATE INDEX "SpecSection_orgId_idx" ON "SpecSection"("orgId");
CREATE INDEX "SpecSection_projectId_codeKey_idx" ON "SpecSection"("projectId", "codeKey");
CREATE INDEX "SpecSection_projectId_division_idx" ON "SpecSection"("projectId", "division");

ALTER TABLE "SpecSection"
  ADD CONSTRAINT "SpecSection_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "SpecSection_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "SpecSection_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "ProjectDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;
