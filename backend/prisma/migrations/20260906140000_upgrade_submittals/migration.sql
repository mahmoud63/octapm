-- OCTA-PM-SUB-017: submittal packages, multi-step workflow templates,
-- response codes and lead-time due dates.

ALTER TABLE "Submittal"
  ADD COLUMN "packageId" TEXT,
  ADD COLUMN "workflowTemplateId" TEXT,
  ADD COLUMN "currentStepId" TEXT,
  ADD COLUMN "responseCode" TEXT,
  ADD COLUMN "responseCodeLabel" TEXT,
  ADD COLUMN "leadTimeWeeks" INTEGER,
  ADD COLUMN "reviewDays" INTEGER,
  ADD COLUMN "requiredOnSite" TIMESTAMP(3),
  ADD COLUMN "submitBy" TIMESTAMP(3),
  ADD COLUMN "revisionNumber" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "scheduleImpactDays" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "managerUserId" TEXT,
  ADD COLUMN "createdBy" TEXT,
  ADD COLUMN "distributionJson" JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN "distributedAt" TIMESTAMP(3);

CREATE TABLE "SubmittalPackage" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "number" INTEGER NOT NULL,
  "ref" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "status" TEXT NOT NULL DEFAULT 'open',
  "activityId" TEXT,
  "requiredOnSite" TIMESTAMP(3),
  "managerUserId" TEXT,
  "createdBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "SubmittalPackage_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SubmittalPackage_projectId_ref_key" ON "SubmittalPackage"("projectId", "ref");
CREATE INDEX "SubmittalPackage_projectId_status_idx" ON "SubmittalPackage"("projectId", "status");
CREATE INDEX "SubmittalPackage_orgId_idx" ON "SubmittalPackage"("orgId");
ALTER TABLE "SubmittalPackage" ADD CONSTRAINT "SubmittalPackage_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SubmittalPackage" ADD CONSTRAINT "SubmittalPackage_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SubmittalPackage" ADD CONSTRAINT "SubmittalPackage_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "Activity"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SubmittalPackage" ADD CONSTRAINT "SubmittalPackage_managerUserId_fkey" FOREIGN KEY ("managerUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "SubmittalWorkflowTemplate" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "projectId" TEXT,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "isDefault" BOOLEAN NOT NULL DEFAULT false,
  "status" TEXT NOT NULL DEFAULT 'active',
  "stepsJson" JSONB NOT NULL DEFAULT '[]',
  "createdBy" TEXT,
  "updatedBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "SubmittalWorkflowTemplate_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SubmittalWorkflowTemplate_orgId_projectId_status_idx" ON "SubmittalWorkflowTemplate"("orgId", "projectId", "status");
ALTER TABLE "SubmittalWorkflowTemplate" ADD CONSTRAINT "SubmittalWorkflowTemplate_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SubmittalWorkflowTemplate" ADD CONSTRAINT "SubmittalWorkflowTemplate_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "SubmittalStep" (
  "id" TEXT NOT NULL,
  "submittalId" TEXT NOT NULL,
  "revisionNumber" INTEGER NOT NULL DEFAULT 0,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "name" TEXT NOT NULL,
  "mode" TEXT NOT NULL DEFAULT 'sequential',
  "days" INTEGER NOT NULL DEFAULT 7,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "startedAt" TIMESTAMP(3),
  "dueAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "SubmittalStep_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SubmittalStep_submittalId_revisionNumber_sortOrder_idx" ON "SubmittalStep"("submittalId", "revisionNumber", "sortOrder");
CREATE INDEX "SubmittalStep_status_dueAt_idx" ON "SubmittalStep"("status", "dueAt");
ALTER TABLE "SubmittalStep" ADD CONSTRAINT "SubmittalStep_submittalId_fkey" FOREIGN KEY ("submittalId") REFERENCES "Submittal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "SubmittalStepAssignment" (
  "id" TEXT NOT NULL,
  "stepId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "role" TEXT,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "responseCode" TEXT,
  "comment" TEXT,
  "decidedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "SubmittalStepAssignment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SubmittalStepAssignment_stepId_userId_key" ON "SubmittalStepAssignment"("stepId", "userId");
CREATE INDEX "SubmittalStepAssignment_userId_status_idx" ON "SubmittalStepAssignment"("userId", "status");
ALTER TABLE "SubmittalStepAssignment" ADD CONSTRAINT "SubmittalStepAssignment_stepId_fkey" FOREIGN KEY ("stepId") REFERENCES "SubmittalStep"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SubmittalStepAssignment" ADD CONSTRAINT "SubmittalStepAssignment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Submittal" ADD CONSTRAINT "Submittal_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "SubmittalPackage"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Submittal" ADD CONSTRAINT "Submittal_workflowTemplateId_fkey" FOREIGN KEY ("workflowTemplateId") REFERENCES "SubmittalWorkflowTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Submittal" ADD CONSTRAINT "Submittal_managerUserId_fkey" FOREIGN KEY ("managerUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "Submittal_packageId_idx" ON "Submittal"("packageId");
CREATE INDEX "Submittal_workflowTemplateId_idx" ON "Submittal"("workflowTemplateId");
CREATE INDEX "Submittal_managerUserId_idx" ON "Submittal"("managerUserId");

-- Legacy outcomes get a response code so the register reads the same way.
UPDATE "Submittal" SET "responseCode" = 'approved', "responseCodeLabel" = 'Approved' WHERE "status" = 'approved' AND "responseCode" IS NULL;
UPDATE "Submittal" SET "responseCode" = 'revise_resubmit', "responseCodeLabel" = 'Revise and resubmit' WHERE "status" = 'resubmit' AND "responseCode" IS NULL;
UPDATE "Submittal" SET "responseCode" = 'rejected', "responseCodeLabel" = 'Rejected' WHERE "status" = 'rejected' AND "responseCode" IS NULL;
