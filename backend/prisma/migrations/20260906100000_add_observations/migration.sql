-- OCTA-QA-OBS-015: observations share the punch-item engine (state machine,
-- ledger, visibility, distribution, exports) as a second `kind`, with their
-- own numbering (OBS-001) and safety-specific fields.

ALTER TABLE "PunchItem"
  ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'punch',
  ADD COLUMN "observationType" TEXT,
  ADD COLUMN "hazard" TEXT,
  ADD COLUMN "contributingCondition" TEXT,
  ADD COLUMN "sourceRecordType" TEXT,
  ADD COLUMN "sourceRecordId" TEXT;

DROP INDEX IF EXISTS "PunchItem_projectId_number_key";
CREATE UNIQUE INDEX "PunchItem_projectId_kind_number_key" ON "PunchItem"("projectId", "kind", "number");
CREATE INDEX "PunchItem_projectId_kind_status_idx" ON "PunchItem"("projectId", "kind", "status");
CREATE INDEX "PunchItem_projectId_kind_observationType_idx" ON "PunchItem"("projectId", "kind", "observationType");
