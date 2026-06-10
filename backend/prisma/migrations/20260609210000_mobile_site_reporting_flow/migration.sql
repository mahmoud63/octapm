-- FB-011 mobile-ready site reporting workflow, site diaries, and photo evidence metadata.

ALTER TABLE "DailyReport"
  ADD COLUMN "rejectionReason" TEXT;

ALTER TABLE "DailyReport"
  DROP CONSTRAINT IF EXISTS "DailyReport_status_check";

UPDATE "DailyReport"
SET "status" = 'approved'
WHERE "status" = 'reviewed';

ALTER TABLE "DailyReport"
  ADD CONSTRAINT "DailyReport_status_check"
  CHECK ("status" IN ('draft', 'submitted', 'approved', 'rejected'));

ALTER TABLE "SiteDiary"
  ADD COLUMN "engineerId" TEXT,
  ADD COLUMN "manpowerJson" JSONB,
  ADD COLUMN "materialsJson" JSONB,
  ADD COLUMN "equipmentJson" JSONB,
  ADD COLUMN "photosJson" JSONB,
  ADD COLUMN "notes" TEXT,
  ADD COLUMN "status" TEXT NOT NULL DEFAULT 'draft',
  ADD COLUMN "submittedAt" TIMESTAMP(3),
  ADD COLUMN "reviewedBy" TEXT,
  ADD COLUMN "reviewedAt" TIMESTAMP(3),
  ADD COLUMN "rejectionReason" TEXT,
  ADD COLUMN "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE INDEX "SiteDiary_engineerId_idx" ON "SiteDiary"("engineerId");
CREATE INDEX "SiteDiary_projectId_date_idx" ON "SiteDiary"("projectId", "date");
CREATE INDEX "SiteDiary_projectId_status_idx" ON "SiteDiary"("projectId", "status");

ALTER TABLE "SiteDiary"
  ADD CONSTRAINT "SiteDiary_engineerId_fkey"
  FOREIGN KEY ("engineerId") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "SiteDiary"
  ADD CONSTRAINT "SiteDiary_status_check"
  CHECK ("status" IN ('draft', 'submitted', 'approved', 'rejected'));
