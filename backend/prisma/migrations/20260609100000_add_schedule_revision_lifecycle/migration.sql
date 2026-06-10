ALTER TABLE "ScheduleRevision"
ADD COLUMN "status" TEXT NOT NULL DEFAULT 'draft',
ADD COLUMN "submittedBy" TEXT,
ADD COLUMN "submittedAt" TIMESTAMP(3),
ADD COLUMN "reviewComment" TEXT,
ADD COLUMN "approvedBy" TEXT,
ADD COLUMN "approvedAt" TIMESTAMP(3),
ADD COLUMN "approvalComment" TEXT,
ADD COLUMN "rejectedBy" TEXT,
ADD COLUMN "rejectedAt" TIMESTAMP(3),
ADD COLUMN "rejectionReason" TEXT,
ADD COLUMN "baselinedBy" TEXT,
ADD COLUMN "baselinedAt" TIMESTAMP(3),
ADD COLUMN "baselineComment" TEXT,
ADD COLUMN "supersededBy" TEXT,
ADD COLUMN "supersededAt" TIMESTAMP(3),
ADD COLUMN "readinessJson" JSONB,
ADD COLUMN "statusTransitionLog" JSONB NOT NULL DEFAULT '[]';

ALTER TABLE "ScheduleRevision"
ADD CONSTRAINT "ScheduleRevision_status_check"
CHECK ("status" IN ('draft', 'under_review', 'approved', 'rejected', 'baselined', 'superseded'));

CREATE INDEX "ScheduleRevision_projectId_status_idx"
ON "ScheduleRevision"("projectId", "status");
