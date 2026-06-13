ALTER TABLE "Risk" ADD COLUMN "dueDate" TIMESTAMP(3);
ALTER TABLE "Risk" ADD COLUMN "responsePlan" TEXT;
ALTER TABLE "Risk" ADD COLUMN "residualProbability" TEXT NOT NULL DEFAULT 'medium';
ALTER TABLE "Risk" ADD COLUMN "residualImpact" TEXT NOT NULL DEFAULT 'medium';
ALTER TABLE "Risk" ADD COLUMN "residualSeverity" TEXT NOT NULL DEFAULT 'MEDIUM';
ALTER TABLE "Risk" ADD COLUMN "residualDescription" TEXT;
ALTER TABLE "Risk" ADD COLUMN "escalationLevel" TEXT NOT NULL DEFAULT 'none';
ALTER TABLE "Risk" ADD COLUMN "escalationNotes" TEXT;
ALTER TABLE "Risk" ADD COLUMN "closeoutComment" TEXT;
ALTER TABLE "Risk" ADD COLUMN "closeoutSubmittedBy" TEXT;
ALTER TABLE "Risk" ADD COLUMN "closeoutSubmittedAt" TIMESTAMP(3);
ALTER TABLE "Risk" ADD COLUMN "closedBy" TEXT;
ALTER TABLE "Risk" ADD COLUMN "closedAt" TIMESTAMP(3);
ALTER TABLE "Risk" ADD COLUMN "rejectedBy" TEXT;
ALTER TABLE "Risk" ADD COLUMN "rejectedAt" TIMESTAMP(3);
ALTER TABLE "Risk" ADD COLUMN "rejectionReason" TEXT;
ALTER TABLE "Risk" ADD COLUMN "reopenedBy" TEXT;
ALTER TABLE "Risk" ADD COLUMN "reopenedAt" TIMESTAMP(3);

CREATE TABLE "RiskActivityLink" (
  "id" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "riskId" TEXT NOT NULL,
  "activityId" TEXT NOT NULL,
  "relationType" TEXT NOT NULL DEFAULT 'affected',
  "scheduleImpactDays" INTEGER NOT NULL DEFAULT 0,
  "costImpact" DECIMAL(18,2) NOT NULL DEFAULT 0,
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "RiskActivityLink_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "RiskActivityLink_riskId_activityId_relationType_key"
  ON "RiskActivityLink"("riskId", "activityId", "relationType");
CREATE INDEX "RiskActivityLink_projectId_idx" ON "RiskActivityLink"("projectId");
CREATE INDEX "RiskActivityLink_riskId_idx" ON "RiskActivityLink"("riskId");
CREATE INDEX "RiskActivityLink_activityId_idx" ON "RiskActivityLink"("activityId");
CREATE INDEX "RiskActivityLink_projectId_activityId_idx"
  ON "RiskActivityLink"("projectId", "activityId");
CREATE INDEX "Risk_projectId_status_idx" ON "Risk"("projectId", "status");
CREATE INDEX "Risk_projectId_dueDate_idx" ON "Risk"("projectId", "dueDate");

ALTER TABLE "RiskActivityLink"
  ADD CONSTRAINT "RiskActivityLink_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "Project"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "RiskActivityLink"
  ADD CONSTRAINT "RiskActivityLink_riskId_fkey"
  FOREIGN KEY ("riskId") REFERENCES "Risk"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "RiskActivityLink"
  ADD CONSTRAINT "RiskActivityLink_activityId_fkey"
  FOREIGN KEY ("activityId") REFERENCES "Activity"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
