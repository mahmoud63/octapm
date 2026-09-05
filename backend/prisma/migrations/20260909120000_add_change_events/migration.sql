-- OCTA-COM-CE-038: change events, their lines and RFQs.

CREATE TABLE "ChangeEvent" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "number" INTEGER NOT NULL,
  "ref" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "description" TEXT,
  "type" TEXT NOT NULL DEFAULT 'other',
  "origin" TEXT NOT NULL DEFAULT 'manual',
  "sourceRecordType" TEXT,
  "sourceRecordId" TEXT,
  "status" TEXT NOT NULL DEFAULT 'open',
  "activityId" TEXT,
  "locationId" TEXT,
  "romAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
  "scheduleImpactDays" INTEGER NOT NULL DEFAULT 0,
  "ownerChange" BOOLEAN NOT NULL DEFAULT true,
  "changeOrderId" TEXT,
  "convertedAt" TIMESTAMP(3),
  "closedAt" TIMESTAMP(3),
  "closedBy" TEXT,
  "voidReason" TEXT,
  "notes" TEXT,
  "createdBy" TEXT,
  "updatedBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ChangeEvent_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ChangeEvent_projectId_number_key" ON "ChangeEvent"("projectId", "number");
CREATE UNIQUE INDEX "ChangeEvent_projectId_ref_key" ON "ChangeEvent"("projectId", "ref");
CREATE INDEX "ChangeEvent_orgId_idx" ON "ChangeEvent"("orgId");
CREATE INDEX "ChangeEvent_projectId_status_idx" ON "ChangeEvent"("projectId", "status");
CREATE INDEX "ChangeEvent_projectId_sourceRecordType_sourceRecordId_idx" ON "ChangeEvent"("projectId", "sourceRecordType", "sourceRecordId");
ALTER TABLE "ChangeEvent"
  ADD CONSTRAINT "ChangeEvent_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "ChangeEvent_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "ChangeEvent_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "Activity"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "ChangeEvent_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "ChangeEvent_changeOrderId_fkey" FOREIGN KEY ("changeOrderId") REFERENCES "ChangeOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "ChangeEventLine" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "changeEventId" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "costCodeId" TEXT,
  "budgetLineId" TEXT,
  "activityId" TEXT,
  "commitmentId" TEXT,
  "quantity" DOUBLE PRECISION NOT NULL DEFAULT 1,
  "unit" TEXT,
  "unitCost" DECIMAL(18,2) NOT NULL DEFAULT 0,
  "romAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
  "quotedAmount" DECIMAL(18,2),
  "quotedRfqId" TEXT,
  "notes" TEXT,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ChangeEventLine_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ChangeEventLine_orgId_idx" ON "ChangeEventLine"("orgId");
CREATE INDEX "ChangeEventLine_changeEventId_idx" ON "ChangeEventLine"("changeEventId");
CREATE INDEX "ChangeEventLine_projectId_activityId_idx" ON "ChangeEventLine"("projectId", "activityId");
CREATE INDEX "ChangeEventLine_projectId_costCodeId_idx" ON "ChangeEventLine"("projectId", "costCodeId");
ALTER TABLE "ChangeEventLine"
  ADD CONSTRAINT "ChangeEventLine_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "ChangeEventLine_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "ChangeEventLine_changeEventId_fkey" FOREIGN KEY ("changeEventId") REFERENCES "ChangeEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "ChangeEventLine_costCodeId_fkey" FOREIGN KEY ("costCodeId") REFERENCES "CostCode"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "ChangeEventLine_budgetLineId_fkey" FOREIGN KEY ("budgetLineId") REFERENCES "BudgetLine"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "ChangeEventLine_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "Activity"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "ChangeEventLine_commitmentId_fkey" FOREIGN KEY ("commitmentId") REFERENCES "Commitment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "Rfq" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "changeEventId" TEXT NOT NULL,
  "number" INTEGER NOT NULL,
  "ref" TEXT NOT NULL,
  "commitmentId" TEXT,
  "vendorCompanyId" TEXT,
  "companyName" TEXT NOT NULL,
  "contactName" TEXT,
  "contactEmail" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "dueDate" TIMESTAMP(3),
  "instructions" TEXT,
  "lineIdsJson" JSONB NOT NULL DEFAULT '[]',
  "status" TEXT NOT NULL DEFAULT 'sent',
  "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "viewedAt" TIMESTAMP(3),
  "lastAccessAt" TIMESTAMP(3),
  "quotedAt" TIMESTAMP(3),
  "quoteTotal" DECIMAL(18,2),
  "quoteLinesJson" JSONB NOT NULL DEFAULT '[]',
  "quoteNotes" TEXT,
  "quoteValidUntil" TIMESTAMP(3),
  "quoteLeadTimeDays" INTEGER,
  "quotedBy" TEXT,
  "declinedReason" TEXT,
  "acceptedAt" TIMESTAMP(3),
  "acceptedBy" TEXT,
  "rejectedAt" TIMESTAMP(3),
  "rejectedReason" TEXT,
  "commitmentChangeOrderId" TEXT,
  "remindersSent" INTEGER NOT NULL DEFAULT 0,
  "createdBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Rfq_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Rfq_tokenHash_key" ON "Rfq"("tokenHash");
CREATE UNIQUE INDEX "Rfq_changeEventId_number_key" ON "Rfq"("changeEventId", "number");
CREATE UNIQUE INDEX "Rfq_projectId_ref_key" ON "Rfq"("projectId", "ref");
CREATE INDEX "Rfq_orgId_idx" ON "Rfq"("orgId");
CREATE INDEX "Rfq_projectId_status_idx" ON "Rfq"("projectId", "status");
CREATE INDEX "Rfq_changeEventId_status_idx" ON "Rfq"("changeEventId", "status");
CREATE INDEX "Rfq_commitmentId_idx" ON "Rfq"("commitmentId");
ALTER TABLE "Rfq"
  ADD CONSTRAINT "Rfq_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "Rfq_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "Rfq_changeEventId_fkey" FOREIGN KEY ("changeEventId") REFERENCES "ChangeEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "Rfq_commitmentId_fkey" FOREIGN KEY ("commitmentId") REFERENCES "Commitment"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "Rfq_vendorCompanyId_fkey" FOREIGN KEY ("vendorCompanyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "Rfq_commitmentChangeOrderId_fkey" FOREIGN KEY ("commitmentChangeOrderId") REFERENCES "CommitmentChangeOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;
