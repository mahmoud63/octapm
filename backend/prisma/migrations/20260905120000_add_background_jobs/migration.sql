-- Durable background job queue (replaces the in-memory BOQ/schedule job maps).

CREATE TABLE "BackgroundJob" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "projectId" TEXT,
  "type" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'queued',
  "priority" INTEGER NOT NULL DEFAULT 0,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "maxAttempts" INTEGER NOT NULL DEFAULT 3,
  "payloadJson" JSONB NOT NULL DEFAULT '{}',
  "progressJson" JSONB NOT NULL DEFAULT '{}',
  "resultJson" JSONB,
  "errorCode" TEXT,
  "errorMessage" TEXT,
  "errorJson" JSONB,
  "requestedBy" TEXT,
  "lockedBy" TEXT,
  "lockedAt" TIMESTAMP(3),
  "heartbeatAt" TIMESTAMP(3),
  "runAfter" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "startedAt" TIMESTAMP(3),
  "finishedAt" TIMESTAMP(3),
  "expiresAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "BackgroundJob_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "BackgroundJob_status_runAfter_priority_idx" ON "BackgroundJob"("status", "runAfter", "priority");
CREATE INDEX "BackgroundJob_orgId_projectId_createdAt_idx" ON "BackgroundJob"("orgId", "projectId", "createdAt");
CREATE INDEX "BackgroundJob_projectId_type_status_idx" ON "BackgroundJob"("projectId", "type", "status");
CREATE INDEX "BackgroundJob_status_heartbeatAt_idx" ON "BackgroundJob"("status", "heartbeatAt");
CREATE INDEX "BackgroundJob_expiresAt_idx" ON "BackgroundJob"("expiresAt");
