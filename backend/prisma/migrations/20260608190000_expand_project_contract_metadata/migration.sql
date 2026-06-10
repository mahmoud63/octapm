ALTER TABLE "Project"
ADD COLUMN "clientName" TEXT,
ADD COLUMN "consultantName" TEXT,
ADD COLUMN "contractorName" TEXT,
ADD COLUMN "contractType" TEXT,
ADD COLUMN "contractNumber" TEXT,
ADD COLUMN "baselineDate" TIMESTAMP(3),
ADD COLUMN "revisedCompletionDate" TIMESTAMP(3),
ADD COLUMN "defaultRetentionRate" DOUBLE PRECISION,
ADD COLUMN "projectCalendar" TEXT,
ADD COLUMN "reportingCutoffDay" INTEGER;

ALTER TABLE "Project"
ADD CONSTRAINT "Project_defaultRetentionRate_range"
CHECK ("defaultRetentionRate" IS NULL OR ("defaultRetentionRate" >= 0 AND "defaultRetentionRate" <= 100));

ALTER TABLE "Project"
ADD CONSTRAINT "Project_reportingCutoffDay_range"
CHECK ("reportingCutoffDay" IS NULL OR ("reportingCutoffDay" >= 1 AND "reportingCutoffDay" <= 31));
