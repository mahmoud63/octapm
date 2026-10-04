-- Platform Superadmin V1 (docs/platform/OCTAPM_SUPERADMIN_DESIGN.md).
-- Additive only: four new tables and one new index on AuditEvent. No existing
-- column, constraint or row changes. Hand-written from `prisma migrate diff`
-- (the rest of that diff is pre-existing drift; see the schema-drift note).

-- CreateTable
CREATE TABLE "PlatformUserAccess" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'platform_superadmin',
    "status" TEXT NOT NULL DEFAULT 'active',
    "reason" TEXT NOT NULL,
    "grantedBy" TEXT NOT NULL,
    "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),
    "revokedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlatformUserAccess_pkey" PRIMARY KEY ("id"),
    -- V1 knows exactly one platform role; anything else is refused by the database.
    CONSTRAINT "PlatformUserAccess_role_check" CHECK ("role" IN ('platform_superadmin')),
    CONSTRAINT "PlatformUserAccess_status_check" CHECK ("status" IN ('active', 'revoked')),
    CONSTRAINT "PlatformUserAccess_reason_check" CHECK (length(btrim("reason")) > 0),
    CONSTRAINT "PlatformUserAccess_revoked_check" CHECK (("status" = 'revoked') = ("revokedAt" IS NOT NULL))
);

-- CreateTable
CREATE TABLE "PlatformAuditEvent" (
    "id" TEXT NOT NULL,
    "actorUserId" TEXT NOT NULL,
    "actorEmail" TEXT NOT NULL,
    "actorRole" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "targetType" TEXT,
    "targetId" TEXT,
    "targetOrgId" TEXT,
    "method" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "queryKeys" JSONB NOT NULL DEFAULT '[]',
    "statusCode" INTEGER NOT NULL,
    "requestId" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlatformAuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductEvent" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "projectId" TEXT,
    "userId" TEXT,
    "eventName" TEXT NOT NULL,
    "module" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductEvent_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ProductEvent_platform_check" CHECK ("platform" IN ('web', 'mobile', 'api')),
    CONSTRAINT "ProductEvent_source_check" CHECK ("source" IN ('client', 'server')),
    -- Catalogue words only: a lower-case dotted name can never carry a sentence of customer text.
    CONSTRAINT "ProductEvent_eventName_check" CHECK ("eventName" ~ '^[a-z][a-z_]*(\.[a-z][a-z_]*){1,3}$' AND length("eventName") <= 64),
    CONSTRAINT "ProductEvent_module_check" CHECK ("module" ~ '^[a-z][a-z_]*$' AND length("module") <= 32),
    CONSTRAINT "ProductEvent_action_check" CHECK ("action" ~ '^[a-z][a-z_]*$' AND length("action") <= 32)
);

-- CreateTable
CREATE TABLE "PlatformErrorEvent" (
    "id" TEXT NOT NULL,
    "status" INTEGER NOT NULL,
    "code" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "routePattern" TEXT NOT NULL,
    "module" TEXT,
    "orgId" TEXT,
    "requestId" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlatformErrorEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PlatformUserAccess_userId_key" ON "PlatformUserAccess"("userId");
CREATE INDEX "PlatformUserAccess_status_idx" ON "PlatformUserAccess"("status");

CREATE INDEX "PlatformAuditEvent_occurredAt_idx" ON "PlatformAuditEvent"("occurredAt");
CREATE INDEX "PlatformAuditEvent_actorUserId_occurredAt_idx" ON "PlatformAuditEvent"("actorUserId", "occurredAt");
CREATE INDEX "PlatformAuditEvent_targetOrgId_occurredAt_idx" ON "PlatformAuditEvent"("targetOrgId", "occurredAt");
CREATE INDEX "PlatformAuditEvent_action_occurredAt_idx" ON "PlatformAuditEvent"("action", "occurredAt");

CREATE INDEX "ProductEvent_createdAt_idx" ON "ProductEvent"("createdAt");
CREATE INDEX "ProductEvent_orgId_createdAt_idx" ON "ProductEvent"("orgId", "createdAt");
CREATE INDEX "ProductEvent_module_createdAt_idx" ON "ProductEvent"("module", "createdAt");
CREATE INDEX "ProductEvent_eventName_createdAt_idx" ON "ProductEvent"("eventName", "createdAt");
CREATE INDEX "ProductEvent_userId_createdAt_idx" ON "ProductEvent"("userId", "createdAt");

CREATE INDEX "PlatformErrorEvent_occurredAt_idx" ON "PlatformErrorEvent"("occurredAt");
CREATE INDEX "PlatformErrorEvent_code_occurredAt_idx" ON "PlatformErrorEvent"("code", "occurredAt");
CREATE INDEX "PlatformErrorEvent_orgId_occurredAt_idx" ON "PlatformErrorEvent"("orgId", "occurredAt");
CREATE INDEX "PlatformErrorEvent_module_occurredAt_idx" ON "PlatformErrorEvent"("module", "occurredAt");

-- Record-activity windows across organisations (no occurredAt-only index existed).
-- On a large production AuditEvent this is a locking CREATE INDEX: build it
-- CONCURRENTLY by hand first in a maintenance window (the IF NOT EXISTS then skips).
CREATE INDEX IF NOT EXISTS "AuditEvent_occurredAt_idx" ON "AuditEvent"("occurredAt");

-- AddForeignKey
ALTER TABLE "PlatformUserAccess" ADD CONSTRAINT "PlatformUserAccess_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
