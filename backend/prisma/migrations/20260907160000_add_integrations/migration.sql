-- OCTA-INT-API-026: public API keys, webhook subscriptions + deliveries, accounting connectors.

CREATE TABLE "ApiClient" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "keyPrefix" TEXT NOT NULL,
  "keyHash" TEXT NOT NULL,
  "scopes" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "projectIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "status" TEXT NOT NULL DEFAULT 'active',
  "lastUsedAt" TIMESTAMP(3),
  "expiresAt" TIMESTAMP(3),
  "createdBy" TEXT,
  "revokedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ApiClient_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ApiClient_keyHash_key" ON "ApiClient"("keyHash");
CREATE INDEX "ApiClient_orgId_status_idx" ON "ApiClient"("orgId", "status");
CREATE INDEX "ApiClient_userId_idx" ON "ApiClient"("userId");

ALTER TABLE "ApiClient"
  ADD CONSTRAINT "ApiClient_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "ApiClient_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "WebhookSubscription" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "projectId" TEXT,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "url" TEXT NOT NULL,
  "secret" TEXT NOT NULL,
  "eventTypes" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "status" TEXT NOT NULL DEFAULT 'active',
  "failureCount" INTEGER NOT NULL DEFAULT 0,
  "lastDeliveryAt" TIMESTAMP(3),
  "lastStatus" TEXT,
  "lastError" TEXT,
  "createdBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "WebhookSubscription_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "WebhookSubscription_orgId_status_idx" ON "WebhookSubscription"("orgId", "status");
CREATE INDEX "WebhookSubscription_projectId_idx" ON "WebhookSubscription"("projectId");

ALTER TABLE "WebhookSubscription"
  ADD CONSTRAINT "WebhookSubscription_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "WebhookSubscription_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "WebhookDelivery" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "subscriptionId" TEXT NOT NULL,
  "eventId" TEXT NOT NULL,
  "eventType" TEXT NOT NULL,
  "attempt" INTEGER NOT NULL DEFAULT 0,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "responseStatus" INTEGER,
  "responseBody" TEXT,
  "error" TEXT,
  "durationMs" INTEGER,
  "jobId" TEXT,
  "nextAttemptAt" TIMESTAMP(3),
  "deliveredAt" TIMESTAMP(3),
  "payloadJson" JSONB NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "WebhookDelivery_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "WebhookDelivery_subscriptionId_createdAt_idx" ON "WebhookDelivery"("subscriptionId", "createdAt");
CREATE INDEX "WebhookDelivery_orgId_status_idx" ON "WebhookDelivery"("orgId", "status");
CREATE INDEX "WebhookDelivery_eventId_idx" ON "WebhookDelivery"("eventId");

ALTER TABLE "WebhookDelivery"
  ADD CONSTRAINT "WebhookDelivery_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "WebhookDelivery_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "WebhookSubscription"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "AccountingConnection" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "externalOrgId" TEXT,
  "externalOrgName" TEXT,
  "credentialsJson" TEXT,
  "autoSyncPayApps" BOOLEAN NOT NULL DEFAULT true,
  "connectedBy" TEXT,
  "connectedAt" TIMESTAMP(3),
  "lastSyncAt" TIMESTAMP(3),
  "lastError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AccountingConnection_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AccountingConnection_orgId_provider_key" ON "AccountingConnection"("orgId", "provider");

ALTER TABLE "AccountingConnection"
  ADD CONSTRAINT "AccountingConnection_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "AccountingCodeMapping" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "costCode" TEXT NOT NULL,
  "costCodeId" TEXT,
  "externalAccountId" TEXT,
  "externalAccountName" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AccountingCodeMapping_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AccountingCodeMapping_orgId_provider_costCode_key" ON "AccountingCodeMapping"("orgId", "provider", "costCode");

ALTER TABLE "AccountingCodeMapping"
  ADD CONSTRAINT "AccountingCodeMapping_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "AccountingSync" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "recordType" TEXT NOT NULL,
  "recordId" TEXT NOT NULL,
  "externalId" TEXT,
  "externalRef" TEXT,
  "externalVendorId" TEXT,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
  "currency" TEXT,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "lastError" TEXT,
  "syncedAt" TIMESTAMP(3),
  "paidAt" TIMESTAMP(3),
  "paidAmount" DECIMAL(18,2),
  "requestedBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AccountingSync_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AccountingSync_provider_recordType_recordId_key" ON "AccountingSync"("provider", "recordType", "recordId");
CREATE INDEX "AccountingSync_orgId_status_idx" ON "AccountingSync"("orgId", "status");
CREATE INDEX "AccountingSync_projectId_recordType_idx" ON "AccountingSync"("projectId", "recordType");

ALTER TABLE "AccountingSync"
  ADD CONSTRAINT "AccountingSync_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "AccountingSync_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
