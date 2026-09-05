-- OCTA-RPT-BUILDER-023: saved reports, schedules, runs and per-project health snapshots.

CREATE TABLE "ReportDefinition" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "projectId" TEXT,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "source" TEXT NOT NULL,
  "columnsJson" JSONB NOT NULL DEFAULT '[]',
  "filtersJson" JSONB NOT NULL DEFAULT '[]',
  "sortJson" JSONB,
  "groupBy" TEXT,
  "aggregatesJson" JSONB NOT NULL DEFAULT '[]',
  "chartJson" JSONB,
  "visibility" TEXT NOT NULL DEFAULT 'private',
  "createdBy" TEXT,
  "updatedBy" TEXT,
  "lastRunAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ReportDefinition_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ReportDefinition_orgId_projectId_idx" ON "ReportDefinition"("orgId", "projectId");
CREATE INDEX "ReportDefinition_orgId_createdBy_idx" ON "ReportDefinition"("orgId", "createdBy");
CREATE INDEX "ReportDefinition_orgId_visibility_idx" ON "ReportDefinition"("orgId", "visibility");

ALTER TABLE "ReportDefinition"
  ADD CONSTRAINT "ReportDefinition_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "ReportDefinition_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "ReportSchedule" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "reportId" TEXT NOT NULL,
  "frequency" TEXT NOT NULL DEFAULT 'weekly',
  "dayOfWeek" INTEGER NOT NULL DEFAULT 1,
  "dayOfMonth" INTEGER NOT NULL DEFAULT 1,
  "hour" INTEGER NOT NULL DEFAULT 7,
  "minute" INTEGER NOT NULL DEFAULT 0,
  "timezone" TEXT NOT NULL DEFAULT 'UTC',
  "format" TEXT NOT NULL DEFAULT 'pdf',
  "recipientsJson" JSONB NOT NULL DEFAULT '{}',
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "nextRunAt" TIMESTAMP(3),
  "lastRunAt" TIMESTAMP(3),
  "lastStatus" TEXT,
  "lastError" TEXT,
  "createdBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ReportSchedule_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ReportSchedule_enabled_nextRunAt_idx" ON "ReportSchedule"("enabled", "nextRunAt");
CREATE INDEX "ReportSchedule_reportId_idx" ON "ReportSchedule"("reportId");

ALTER TABLE "ReportSchedule"
  ADD CONSTRAINT "ReportSchedule_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "ReportSchedule_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "ReportDefinition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "ReportRun" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "reportId" TEXT NOT NULL,
  "scheduleId" TEXT,
  "status" TEXT NOT NULL DEFAULT 'queued',
  "trigger" TEXT NOT NULL DEFAULT 'manual',
  "format" TEXT NOT NULL DEFAULT 'pdf',
  "rowCount" INTEGER NOT NULL DEFAULT 0,
  "truncated" BOOLEAN NOT NULL DEFAULT false,
  "pdfBytes" BYTEA,
  "xlsxBytes" BYTEA,
  "fileBase" TEXT,
  "recipientsJson" JSONB,
  "deliveryJson" JSONB,
  "error" TEXT,
  "requestedBy" TEXT,
  "startedAt" TIMESTAMP(3),
  "finishedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ReportRun_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ReportRun_reportId_createdAt_idx" ON "ReportRun"("reportId", "createdAt");
CREATE INDEX "ReportRun_orgId_createdAt_idx" ON "ReportRun"("orgId", "createdAt");

ALTER TABLE "ReportRun"
  ADD CONSTRAINT "ReportRun_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "ReportRun_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "ReportDefinition"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "ReportRun_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES "ReportSchedule"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "ProjectHealthSnapshot" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "overallScore" INTEGER,
  "dimensionsJson" JSONB NOT NULL DEFAULT '{}',
  "weakestDimension" TEXT,
  "spi" DOUBLE PRECISION,
  "cpi" DOUBLE PRECISION,
  "ev" DECIMAL(18,2) NOT NULL DEFAULT 0,
  "pv" DECIMAL(18,2) NOT NULL DEFAULT 0,
  "ac" DECIMAL(18,2) NOT NULL DEFAULT 0,
  "eac" DECIMAL(18,2) NOT NULL DEFAULT 0,
  "bac" DECIMAL(18,2) NOT NULL DEFAULT 0,
  "cashIn90" DECIMAL(18,2) NOT NULL DEFAULT 0,
  "cashOut90" DECIMAL(18,2) NOT NULL DEFAULT 0,
  "cashNet90" DECIMAL(18,2) NOT NULL DEFAULT 0,
  "cashNetToDate" DECIMAL(18,2) NOT NULL DEFAULT 0,
  "openRfis" INTEGER NOT NULL DEFAULT 0,
  "overdueRfis" INTEGER NOT NULL DEFAULT 0,
  "openPunch" INTEGER NOT NULL DEFAULT 0,
  "openNcrs" INTEGER NOT NULL DEFAULT 0,
  "pendingSubmittals" INTEGER NOT NULL DEFAULT 0,
  "openTasks" INTEGER NOT NULL DEFAULT 0,
  "overdueTasks" INTEGER NOT NULL DEFAULT 0,
  "pendingChangeOrders" INTEGER NOT NULL DEFAULT 0,
  "delayedActivities" INTEGER NOT NULL DEFAULT 0,
  "criticalActivities" INTEGER NOT NULL DEFAULT 0,
  "procurementRisks" INTEGER NOT NULL DEFAULT 0,
  "overdueItems" INTEGER NOT NULL DEFAULT 0,
  "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProjectHealthSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ProjectHealthSnapshot_projectId_key" ON "ProjectHealthSnapshot"("projectId");
CREATE INDEX "ProjectHealthSnapshot_orgId_overallScore_idx" ON "ProjectHealthSnapshot"("orgId", "overallScore");

ALTER TABLE "ProjectHealthSnapshot"
  ADD CONSTRAINT "ProjectHealthSnapshot_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "ProjectHealthSnapshot_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
