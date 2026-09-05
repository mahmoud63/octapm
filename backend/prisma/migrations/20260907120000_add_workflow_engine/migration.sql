-- OCTA-PLAT-WF-024: configurable workflow engine (templates, instances, step assignments).

CREATE TABLE "WorkflowTemplate" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "projectId" TEXT,
  "tool" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "isDefault" BOOLEAN NOT NULL DEFAULT false,
  "priority" INTEGER NOT NULL DEFAULT 0,
  "status" TEXT NOT NULL DEFAULT 'active',
  "rulesJson" JSONB NOT NULL DEFAULT '[]',
  "stepsJson" JSONB NOT NULL DEFAULT '[]',
  "startStep" TEXT,
  "isSystem" BOOLEAN NOT NULL DEFAULT false,
  "createdBy" TEXT,
  "updatedBy" TEXT,
  "archivedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "WorkflowTemplate_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "WorkflowTemplate_orgId_tool_status_idx" ON "WorkflowTemplate"("orgId", "tool", "status");
CREATE INDEX "WorkflowTemplate_projectId_tool_idx" ON "WorkflowTemplate"("projectId", "tool");

ALTER TABLE "WorkflowTemplate"
  ADD CONSTRAINT "WorkflowTemplate_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "WorkflowTemplate_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "WorkflowInstance" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "templateId" TEXT NOT NULL,
  "tool" TEXT NOT NULL,
  "recordId" TEXT NOT NULL,
  "recordRef" TEXT,
  "recordTitle" TEXT,
  "status" TEXT NOT NULL DEFAULT 'running',
  "outcome" TEXT,
  "currentStepKey" TEXT,
  "contextJson" JSONB NOT NULL DEFAULT '{}',
  "stepsJson" JSONB NOT NULL DEFAULT '[]',
  "applyStatus" TEXT,
  "applyError" TEXT,
  "escalationLevel" INTEGER NOT NULL DEFAULT 0,
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "startedBy" TEXT,
  "completedAt" TIMESTAMP(3),
  "cancelledAt" TIMESTAMP(3),
  "cancelReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "WorkflowInstance_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "WorkflowInstance_projectId_tool_recordId_idx" ON "WorkflowInstance"("projectId", "tool", "recordId");
CREATE INDEX "WorkflowInstance_orgId_status_idx" ON "WorkflowInstance"("orgId", "status");
CREATE INDEX "WorkflowInstance_templateId_idx" ON "WorkflowInstance"("templateId");

ALTER TABLE "WorkflowInstance"
  ADD CONSTRAINT "WorkflowInstance_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "WorkflowInstance_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "WorkflowInstance_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "WorkflowTemplate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "WorkflowStepAssignment" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "instanceId" TEXT NOT NULL,
  "stepKey" TEXT NOT NULL,
  "stepName" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "response" TEXT,
  "comment" TEXT,
  "isOverride" BOOLEAN NOT NULL DEFAULT false,
  "dueAt" TIMESTAMP(3),
  "respondedAt" TIMESTAMP(3),
  "escalatedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WorkflowStepAssignment_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "WorkflowStepAssignment_instanceId_stepKey_idx" ON "WorkflowStepAssignment"("instanceId", "stepKey");
CREATE INDEX "WorkflowStepAssignment_userId_status_idx" ON "WorkflowStepAssignment"("userId", "status");
CREATE INDEX "WorkflowStepAssignment_projectId_status_dueAt_idx" ON "WorkflowStepAssignment"("projectId", "status", "dueAt");

ALTER TABLE "WorkflowStepAssignment"
  ADD CONSTRAINT "WorkflowStepAssignment_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "WorkflowStepAssignment_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "WorkflowStepAssignment_instanceId_fkey" FOREIGN KEY ("instanceId") REFERENCES "WorkflowInstance"("id") ON DELETE CASCADE ON UPDATE CASCADE;
