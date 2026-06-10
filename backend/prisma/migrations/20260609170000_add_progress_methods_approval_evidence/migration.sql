-- FB-008 progress method configuration, submission approval workflow, and daily report evidence.

ALTER TABLE "ActivityProgress"
  ADD COLUMN "submissionId" TEXT,
  ADD COLUMN "quantityComplete" DOUBLE PRECISION,
  ADD COLUMN "quantityPlanned" DOUBLE PRECISION,
  ADD COLUMN "quantityUnit" TEXT,
  ADD COLUMN "milestoneProgressJson" JSONB,
  ADD COLUMN "inspectionStatus" TEXT,
  ADD COLUMN "evidenceJson" JSONB;

CREATE TABLE "ActivityProgressMethod" (
  "id" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "activityId" TEXT NOT NULL,
  "method" TEXT NOT NULL DEFAULT 'percent',
  "plannedQuantity" DOUBLE PRECISION,
  "quantityUnit" TEXT,
  "milestoneWeightsJson" JSONB,
  "inspectionRequired" BOOLEAN NOT NULL DEFAULT false,
  "evidenceRequired" BOOLEAN NOT NULL DEFAULT false,
  "notes" TEXT,
  "createdBy" TEXT,
  "updatedBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ActivityProgressMethod_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ProgressSubmission" (
  "id" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "activityId" TEXT NOT NULL,
  "dailyReportId" TEXT,
  "method" TEXT NOT NULL DEFAULT 'percent',
  "source" TEXT NOT NULL DEFAULT 'manual',
  "pctComplete" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "quantityComplete" DOUBLE PRECISION,
  "quantityPlanned" DOUBLE PRECISION,
  "quantityUnit" TEXT,
  "milestoneProgressJson" JSONB,
  "inspectionStatus" TEXT,
  "actualCost" DOUBLE PRECISION,
  "actualStart" TIMESTAMP(3),
  "actualFinish" TIMESTAMP(3),
  "notes" TEXT,
  "evidenceJson" JSONB,
  "status" TEXT NOT NULL DEFAULT 'submitted',
  "submittedBy" TEXT,
  "submittedAt" TIMESTAMP(3),
  "reviewedBy" TEXT,
  "reviewedAt" TIMESTAMP(3),
  "rejectionReason" TEXT,
  "createdBy" TEXT,
  "updatedBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ProgressSubmission_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "DailyReport"
  ADD COLUMN "manpowerJson" JSONB,
  ADD COLUMN "status" TEXT NOT NULL DEFAULT 'submitted',
  ADD COLUMN "submittedAt" TIMESTAMP(3),
  ADD COLUMN "reviewedBy" TEXT,
  ADD COLUMN "reviewedAt" TIMESTAMP(3),
  ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

UPDATE "DailyReport"
SET "submittedAt" = COALESCE("submittedAt", "createdAt");

CREATE UNIQUE INDEX "ActivityProgress_submissionId_key" ON "ActivityProgress"("submissionId");
CREATE UNIQUE INDEX "ActivityProgressMethod_activityId_key" ON "ActivityProgressMethod"("activityId");
CREATE INDEX "ActivityProgressMethod_projectId_idx" ON "ActivityProgressMethod"("projectId");
CREATE INDEX "ActivityProgressMethod_projectId_method_idx" ON "ActivityProgressMethod"("projectId", "method");
CREATE INDEX "ProgressSubmission_projectId_idx" ON "ProgressSubmission"("projectId");
CREATE INDEX "ProgressSubmission_activityId_idx" ON "ProgressSubmission"("activityId");
CREATE INDEX "ProgressSubmission_projectId_status_idx" ON "ProgressSubmission"("projectId", "status");
CREATE INDEX "ProgressSubmission_dailyReportId_idx" ON "ProgressSubmission"("dailyReportId");
CREATE INDEX "DailyReport_projectId_date_idx" ON "DailyReport"("projectId", "date");
CREATE INDEX "DailyReport_projectId_status_idx" ON "DailyReport"("projectId", "status");

ALTER TABLE "ActivityProgress"
  ADD CONSTRAINT "ActivityProgress_submissionId_fkey"
  FOREIGN KEY ("submissionId") REFERENCES "ProgressSubmission"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ActivityProgressMethod"
  ADD CONSTRAINT "ActivityProgressMethod_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "Project"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ActivityProgressMethod"
  ADD CONSTRAINT "ActivityProgressMethod_activityId_fkey"
  FOREIGN KEY ("activityId") REFERENCES "Activity"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ProgressSubmission"
  ADD CONSTRAINT "ProgressSubmission_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "Project"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ProgressSubmission"
  ADD CONSTRAINT "ProgressSubmission_activityId_fkey"
  FOREIGN KEY ("activityId") REFERENCES "Activity"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ProgressSubmission"
  ADD CONSTRAINT "ProgressSubmission_dailyReportId_fkey"
  FOREIGN KEY ("dailyReportId") REFERENCES "DailyReport"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ActivityProgressMethod"
  ADD CONSTRAINT "ActivityProgressMethod_method_check"
  CHECK ("method" IN ('percent', 'quantity', 'weighted_milestone', 'inspection', 'manual'));

ALTER TABLE "ProgressSubmission"
  ADD CONSTRAINT "ProgressSubmission_method_check"
  CHECK ("method" IN ('percent', 'quantity', 'weighted_milestone', 'inspection', 'manual'));

ALTER TABLE "ProgressSubmission"
  ADD CONSTRAINT "ProgressSubmission_status_check"
  CHECK ("status" IN ('draft', 'submitted', 'approved', 'rejected'));

ALTER TABLE "DailyReport"
  ADD CONSTRAINT "DailyReport_status_check"
  CHECK ("status" IN ('draft', 'submitted', 'reviewed'));
