-- OCTA-FLD-DAILY-022: project daily log with typed sections, weather feed and distribution.

ALTER TABLE "Project"
  ADD COLUMN "latitude" DOUBLE PRECISION,
  ADD COLUMN "longitude" DOUBLE PRECISION,
  ADD COLUMN "timezone" TEXT,
  ADD COLUMN "dailyLogSettingsJson" JSONB NOT NULL DEFAULT '{}';

CREATE TABLE "DailyLog" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "date" DATE NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'open',
  "weatherJson" JSONB,
  "weatherSource" TEXT,
  "weatherFetchedAt" TIMESTAMP(3),
  "summary" TEXT,
  "submittedAt" TIMESTAMP(3),
  "submittedBy" TEXT,
  "approvedAt" TIMESTAMP(3),
  "approvedBy" TEXT,
  "distributedAt" TIMESTAMP(3),
  "distributionJson" JSONB,
  "pdfDocumentId" TEXT,
  "autoDistributeQueuedFor" TIMESTAMP(3),
  "createdBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DailyLog_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DailyLog_projectId_date_key" ON "DailyLog"("projectId", "date");
CREATE INDEX "DailyLog_orgId_idx" ON "DailyLog"("orgId");
CREATE INDEX "DailyLog_projectId_status_idx" ON "DailyLog"("projectId", "status");

ALTER TABLE "DailyLog"
  ADD CONSTRAINT "DailyLog_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "DailyLog_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "DailyLog_pdfDocumentId_fkey" FOREIGN KEY ("pdfDocumentId") REFERENCES "ProjectDocument"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "DailyLogManpower" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "dailyLogId" TEXT NOT NULL,
  "partyId" TEXT,
  "companyId" TEXT,
  "companyName" TEXT,
  "trade" TEXT NOT NULL,
  "workers" INTEGER NOT NULL DEFAULT 0,
  "hours" DOUBLE PRECISION NOT NULL DEFAULT 8,
  "activityId" TEXT,
  "locationId" TEXT,
  "notes" TEXT,
  "status" TEXT NOT NULL DEFAULT 'approved',
  "createdBy" TEXT,
  "submittedAt" TIMESTAMP(3),
  "reviewedBy" TEXT,
  "reviewedAt" TIMESTAMP(3),
  "rejectionReason" TEXT,
  "clientRequestId" TEXT,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DailyLogManpower_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DailyLogManpower_projectId_clientRequestId_key" ON "DailyLogManpower"("projectId", "clientRequestId");
CREATE INDEX "DailyLogManpower_dailyLogId_idx" ON "DailyLogManpower"("dailyLogId");
CREATE INDEX "DailyLogManpower_projectId_companyId_idx" ON "DailyLogManpower"("projectId", "companyId");
CREATE INDEX "DailyLogManpower_projectId_trade_idx" ON "DailyLogManpower"("projectId", "trade");
CREATE INDEX "DailyLogManpower_projectId_activityId_idx" ON "DailyLogManpower"("projectId", "activityId");
ALTER TABLE "DailyLogManpower" ADD CONSTRAINT "DailyLogManpower_dailyLogId_fkey" FOREIGN KEY ("dailyLogId") REFERENCES "DailyLog"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "DailyLogEquipment" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "dailyLogId" TEXT NOT NULL,
  "partyId" TEXT,
  "companyId" TEXT,
  "equipmentId" TEXT,
  "name" TEXT NOT NULL,
  "count" INTEGER NOT NULL DEFAULT 1,
  "hoursOperated" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "hoursIdle" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "activityId" TEXT,
  "locationId" TEXT,
  "notes" TEXT,
  "status" TEXT NOT NULL DEFAULT 'approved',
  "createdBy" TEXT,
  "submittedAt" TIMESTAMP(3),
  "reviewedBy" TEXT,
  "reviewedAt" TIMESTAMP(3),
  "rejectionReason" TEXT,
  "clientRequestId" TEXT,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DailyLogEquipment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DailyLogEquipment_projectId_clientRequestId_key" ON "DailyLogEquipment"("projectId", "clientRequestId");
CREATE INDEX "DailyLogEquipment_dailyLogId_idx" ON "DailyLogEquipment"("dailyLogId");
CREATE INDEX "DailyLogEquipment_projectId_equipmentId_idx" ON "DailyLogEquipment"("projectId", "equipmentId");
CREATE INDEX "DailyLogEquipment_projectId_activityId_idx" ON "DailyLogEquipment"("projectId", "activityId");
ALTER TABLE "DailyLogEquipment" ADD CONSTRAINT "DailyLogEquipment_dailyLogId_fkey" FOREIGN KEY ("dailyLogId") REFERENCES "DailyLog"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "DailyLogDelivery" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "dailyLogId" TEXT NOT NULL,
  "partyId" TEXT,
  "companyId" TEXT,
  "supplierName" TEXT,
  "description" TEXT NOT NULL,
  "quantity" DOUBLE PRECISION,
  "unit" TEXT,
  "poRef" TEXT,
  "receivedBy" TEXT,
  "deliveredAt" TIMESTAMP(3),
  "activityId" TEXT,
  "notes" TEXT,
  "status" TEXT NOT NULL DEFAULT 'approved',
  "createdBy" TEXT,
  "submittedAt" TIMESTAMP(3),
  "reviewedBy" TEXT,
  "reviewedAt" TIMESTAMP(3),
  "rejectionReason" TEXT,
  "clientRequestId" TEXT,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DailyLogDelivery_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DailyLogDelivery_projectId_clientRequestId_key" ON "DailyLogDelivery"("projectId", "clientRequestId");
CREATE INDEX "DailyLogDelivery_dailyLogId_idx" ON "DailyLogDelivery"("dailyLogId");
CREATE INDEX "DailyLogDelivery_projectId_activityId_idx" ON "DailyLogDelivery"("projectId", "activityId");
ALTER TABLE "DailyLogDelivery" ADD CONSTRAINT "DailyLogDelivery_dailyLogId_fkey" FOREIGN KEY ("dailyLogId") REFERENCES "DailyLog"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "DailyLogVisitor" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "dailyLogId" TEXT NOT NULL,
  "partyId" TEXT,
  "name" TEXT NOT NULL,
  "company" TEXT,
  "purpose" TEXT,
  "arrivedAt" TIMESTAMP(3),
  "leftAt" TIMESTAMP(3),
  "notes" TEXT,
  "status" TEXT NOT NULL DEFAULT 'approved',
  "createdBy" TEXT,
  "submittedAt" TIMESTAMP(3),
  "reviewedBy" TEXT,
  "reviewedAt" TIMESTAMP(3),
  "rejectionReason" TEXT,
  "clientRequestId" TEXT,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DailyLogVisitor_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DailyLogVisitor_projectId_clientRequestId_key" ON "DailyLogVisitor"("projectId", "clientRequestId");
CREATE INDEX "DailyLogVisitor_dailyLogId_idx" ON "DailyLogVisitor"("dailyLogId");
ALTER TABLE "DailyLogVisitor" ADD CONSTRAINT "DailyLogVisitor_dailyLogId_fkey" FOREIGN KEY ("dailyLogId") REFERENCES "DailyLog"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "DailyLogDelay" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "dailyLogId" TEXT NOT NULL,
  "partyId" TEXT,
  "type" TEXT NOT NULL DEFAULT 'other',
  "description" TEXT NOT NULL,
  "hoursLost" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "activityId" TEXT,
  "locationId" TEXT,
  "source" TEXT NOT NULL DEFAULT 'manual',
  "weatherDelayId" TEXT,
  "notes" TEXT,
  "status" TEXT NOT NULL DEFAULT 'approved',
  "createdBy" TEXT,
  "submittedAt" TIMESTAMP(3),
  "reviewedBy" TEXT,
  "reviewedAt" TIMESTAMP(3),
  "rejectionReason" TEXT,
  "clientRequestId" TEXT,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DailyLogDelay_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DailyLogDelay_projectId_clientRequestId_key" ON "DailyLogDelay"("projectId", "clientRequestId");
CREATE INDEX "DailyLogDelay_dailyLogId_idx" ON "DailyLogDelay"("dailyLogId");
CREATE INDEX "DailyLogDelay_projectId_type_idx" ON "DailyLogDelay"("projectId", "type");
CREATE INDEX "DailyLogDelay_projectId_activityId_idx" ON "DailyLogDelay"("projectId", "activityId");
ALTER TABLE "DailyLogDelay" ADD CONSTRAINT "DailyLogDelay_dailyLogId_fkey" FOREIGN KEY ("dailyLogId") REFERENCES "DailyLog"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "DailyLogNote" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "dailyLogId" TEXT NOT NULL,
  "partyId" TEXT,
  "kind" TEXT NOT NULL DEFAULT 'general',
  "text" TEXT NOT NULL,
  "activityId" TEXT,
  "locationId" TEXT,
  "status" TEXT NOT NULL DEFAULT 'approved',
  "createdBy" TEXT,
  "submittedAt" TIMESTAMP(3),
  "reviewedBy" TEXT,
  "reviewedAt" TIMESTAMP(3),
  "rejectionReason" TEXT,
  "clientRequestId" TEXT,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DailyLogNote_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DailyLogNote_projectId_clientRequestId_key" ON "DailyLogNote"("projectId", "clientRequestId");
CREATE INDEX "DailyLogNote_dailyLogId_idx" ON "DailyLogNote"("dailyLogId");
CREATE INDEX "DailyLogNote_projectId_kind_idx" ON "DailyLogNote"("projectId", "kind");
ALTER TABLE "DailyLogNote" ADD CONSTRAINT "DailyLogNote_dailyLogId_fkey" FOREIGN KEY ("dailyLogId") REFERENCES "DailyLog"("id") ON DELETE CASCADE ON UPDATE CASCADE;
