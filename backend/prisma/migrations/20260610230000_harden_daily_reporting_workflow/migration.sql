-- TASK-P1-domain-build-daily-reporting-mobile-workflow
-- Adds mobile/offline-safe metadata and structured header fields for daily reports/site diaries.

ALTER TABLE "DailyReport"
  ADD COLUMN "shift" TEXT NOT NULL DEFAULT 'day',
  ADD COLUMN "weatherJson" JSONB,
  ADD COLUMN "issuesJson" JSONB,
  ADD COLUMN "clientRequestId" TEXT,
  ADD COLUMN "clientCreatedAt" TIMESTAMP(3),
  ADD COLUMN "deviceId" TEXT;

ALTER TABLE "SiteDiary"
  ADD COLUMN "shift" TEXT NOT NULL DEFAULT 'day',
  ADD COLUMN "weatherJson" JSONB,
  ADD COLUMN "issuesJson" JSONB,
  ADD COLUMN "clientRequestId" TEXT,
  ADD COLUMN "clientCreatedAt" TIMESTAMP(3),
  ADD COLUMN "deviceId" TEXT;

CREATE UNIQUE INDEX "DailyReport_projectId_clientRequestId_key"
  ON "DailyReport"("projectId", "clientRequestId");

CREATE UNIQUE INDEX "SiteDiary_projectId_clientRequestId_key"
  ON "SiteDiary"("projectId", "clientRequestId");

ALTER TABLE "DailyReport"
  ADD CONSTRAINT "DailyReport_shift_check"
  CHECK ("shift" IN ('day', 'night', 'swing'));

ALTER TABLE "SiteDiary"
  ADD CONSTRAINT "SiteDiary_shift_check"
  CHECK ("shift" IN ('day', 'night', 'swing'));
