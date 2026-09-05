-- Project location tree and durable outbound (domain) event log.
-- Also removes the template navigation placeholders (apps, chats) from the
-- default top-navigation preference.

CREATE TABLE "Location" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "parentId" TEXT,
  "name" TEXT NOT NULL,
  "code" TEXT,
  "kind" TEXT NOT NULL DEFAULT 'area',
  "path" TEXT NOT NULL,
  "depth" INTEGER NOT NULL DEFAULT 0,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "status" TEXT NOT NULL DEFAULT 'active',
  "description" TEXT,
  "createdBy" TEXT,
  "updatedBy" TEXT,
  "archivedAt" TIMESTAMP(3),
  "archivedBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "Location_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Location_projectId_code_key" ON "Location"("projectId", "code");
CREATE INDEX "Location_orgId_idx" ON "Location"("orgId");
CREATE INDEX "Location_projectId_idx" ON "Location"("projectId");
CREATE INDEX "Location_projectId_status_idx" ON "Location"("projectId", "status");
CREATE INDEX "Location_projectId_parentId_sortOrder_idx" ON "Location"("projectId", "parentId", "sortOrder");
CREATE INDEX "Location_parentId_idx" ON "Location"("parentId");
CREATE INDEX "Location_projectId_path_idx" ON "Location"("projectId", "path");

ALTER TABLE "Location"
  ADD CONSTRAINT "Location_orgId_fkey"
  FOREIGN KEY ("orgId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Location"
  ADD CONSTRAINT "Location_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Location"
  ADD CONSTRAINT "Location_parentId_fkey"
  FOREIGN KEY ("parentId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "OutboundEvent" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "projectId" TEXT,
  "type" TEXT NOT NULL,
  "entityType" TEXT,
  "entityId" TEXT,
  "action" TEXT,
  "actorId" TEXT,
  "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "payloadJson" JSONB NOT NULL DEFAULT '{}',
  "recipientUserIds" JSONB NOT NULL DEFAULT '[]',
  "deliveredAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "OutboundEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "OutboundEvent_orgId_createdAt_idx" ON "OutboundEvent"("orgId", "createdAt");
CREATE INDEX "OutboundEvent_projectId_createdAt_idx" ON "OutboundEvent"("projectId", "createdAt");
CREATE INDEX "OutboundEvent_entityType_entityId_idx" ON "OutboundEvent"("entityType", "entityId");
CREATE INDEX "OutboundEvent_type_createdAt_idx" ON "OutboundEvent"("type", "createdAt");

ALTER TABLE "UserSetting"
  ALTER COLUMN "displayItems" SET DEFAULT '["dashboard","projects","tasks","users","help-center"]';
