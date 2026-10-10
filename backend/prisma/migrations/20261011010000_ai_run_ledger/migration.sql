-- AI-1: the AI usage ledger written only by the AI gateway (services/ai/gateway.js).
-- CreateTable
CREATE TABLE "AiRun" (
    "id" TEXT NOT NULL,
    "orgId" TEXT,
    "projectId" TEXT,
    "userId" TEXT,
    "apiClientId" TEXT,
    "jobId" TEXT,
    "actorKind" TEXT NOT NULL,
    "feature" TEXT NOT NULL,
    "provider" TEXT,
    "model" TEXT,
    "status" TEXT NOT NULL,
    "errorClass" TEXT,
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    "costMicros" INTEGER,
    "latencyMs" INTEGER NOT NULL DEFAULT 0,
    "retries" INTEGER NOT NULL DEFAULT 0,
    "requestId" TEXT,
    "route" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AiRun_orgId_createdAt_idx" ON "AiRun"("orgId", "createdAt");

-- CreateIndex
CREATE INDEX "AiRun_orgId_feature_createdAt_idx" ON "AiRun"("orgId", "feature", "createdAt");

-- CreateIndex
CREATE INDEX "AiRun_projectId_createdAt_idx" ON "AiRun"("projectId", "createdAt");

