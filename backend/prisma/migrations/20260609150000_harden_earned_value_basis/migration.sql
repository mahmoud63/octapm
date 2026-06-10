-- Harden earned value basis with period cutoffs, approved time-phased PV,
-- explicit progress approval metadata, and lockable EV snapshots.

ALTER TABLE "ActivityProgress"
ADD COLUMN "progressMethod" TEXT NOT NULL DEFAULT 'percent_complete',
ADD COLUMN "source" TEXT NOT NULL DEFAULT 'manual',
ADD COLUMN "status" TEXT NOT NULL DEFAULT 'approved',
ADD COLUMN "approvedBy" TEXT,
ADD COLUMN "approvedAt" TIMESTAMP(3);

CREATE INDEX "ActivityProgress_activityId_status_updatedAt_idx"
ON "ActivityProgress"("activityId", "status", "updatedAt");

ALTER TABLE "BudgetRevision"
ADD COLUMN "status" TEXT NOT NULL DEFAULT 'approved',
ADD COLUMN "approvedBy" TEXT,
ADD COLUMN "approvedAt" TIMESTAMP(3);

CREATE INDEX "BudgetRevision_projectId_status_effectiveDate_idx"
ON "BudgetRevision"("projectId", "status", "effectiveDate");

CREATE TABLE "ReportingPeriod" (
  "id" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "label" TEXT,
  "periodStart" TIMESTAMP(3) NOT NULL,
  "periodEnd" TIMESTAMP(3) NOT NULL,
  "cutoffDate" TIMESTAMP(3) NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'open',
  "lockedBy" TEXT,
  "lockedAt" TIMESTAMP(3),
  "createdBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ReportingPeriod_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ActivityCostLoading" (
  "id" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "activityId" TEXT NOT NULL,
  "reportingPeriodId" TEXT,
  "plannedDate" TIMESTAMP(3) NOT NULL,
  "plannedValue" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "source" TEXT NOT NULL DEFAULT 'manual',
  "baselineVersion" TEXT,
  "status" TEXT NOT NULL DEFAULT 'draft',
  "notes" TEXT,
  "submittedBy" TEXT,
  "submittedAt" TIMESTAMP(3),
  "approvedBy" TEXT,
  "approvedAt" TIMESTAMP(3),
  "rejectedBy" TEXT,
  "rejectedAt" TIMESTAMP(3),
  "rejectedReason" TEXT,
  "createdBy" TEXT,
  "updatedBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ActivityCostLoading_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "EvPeriodSnapshot" (
  "id" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "reportingPeriodId" TEXT NOT NULL,
  "cutoffDate" TIMESTAMP(3) NOT NULL,
  "formulaVersion" TEXT NOT NULL DEFAULT 'ev.v1',
  "totalBudget" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "pv" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "ev" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "ac" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "spi" DOUBLE PRECISION,
  "cpi" DOUBLE PRECISION,
  "eac" DOUBLE PRECISION,
  "sv" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "cv" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "etc" DOUBLE PRECISION,
  "basisJson" JSONB NOT NULL DEFAULT '{}',
  "sCurveJson" JSONB NOT NULL DEFAULT '[]',
  "activityBreakdownJson" JSONB NOT NULL DEFAULT '[]',
  "lockedBy" TEXT,
  "lockedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "EvPeriodSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ReportingPeriod_projectId_code_key"
ON "ReportingPeriod"("projectId", "code");

CREATE INDEX "ReportingPeriod_projectId_idx"
ON "ReportingPeriod"("projectId");

CREATE INDEX "ReportingPeriod_projectId_cutoffDate_idx"
ON "ReportingPeriod"("projectId", "cutoffDate");

CREATE INDEX "ReportingPeriod_projectId_status_idx"
ON "ReportingPeriod"("projectId", "status");

CREATE INDEX "ActivityCostLoading_projectId_idx"
ON "ActivityCostLoading"("projectId");

CREATE INDEX "ActivityCostLoading_activityId_idx"
ON "ActivityCostLoading"("activityId");

CREATE INDEX "ActivityCostLoading_reportingPeriodId_idx"
ON "ActivityCostLoading"("reportingPeriodId");

CREATE INDEX "ActivityCostLoading_projectId_status_plannedDate_idx"
ON "ActivityCostLoading"("projectId", "status", "plannedDate");

CREATE UNIQUE INDEX "EvPeriodSnapshot_reportingPeriodId_key"
ON "EvPeriodSnapshot"("reportingPeriodId");

CREATE INDEX "EvPeriodSnapshot_projectId_idx"
ON "EvPeriodSnapshot"("projectId");

CREATE INDEX "EvPeriodSnapshot_cutoffDate_idx"
ON "EvPeriodSnapshot"("cutoffDate");

ALTER TABLE "ReportingPeriod"
ADD CONSTRAINT "ReportingPeriod_projectId_fkey"
FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ActivityCostLoading"
ADD CONSTRAINT "ActivityCostLoading_projectId_fkey"
FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ActivityCostLoading"
ADD CONSTRAINT "ActivityCostLoading_activityId_fkey"
FOREIGN KEY ("activityId") REFERENCES "Activity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ActivityCostLoading"
ADD CONSTRAINT "ActivityCostLoading_reportingPeriodId_fkey"
FOREIGN KEY ("reportingPeriodId") REFERENCES "ReportingPeriod"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "EvPeriodSnapshot"
ADD CONSTRAINT "EvPeriodSnapshot_projectId_fkey"
FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "EvPeriodSnapshot"
ADD CONSTRAINT "EvPeriodSnapshot_reportingPeriodId_fkey"
FOREIGN KEY ("reportingPeriodId") REFERENCES "ReportingPeriod"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
