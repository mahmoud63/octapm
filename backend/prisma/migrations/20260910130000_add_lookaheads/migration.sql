-- OCTA-SCH-LOOKAHEAD-041: lookaheads (short-interval plans) seeded from the master schedule.

CREATE TABLE "Lookahead" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "number" INTEGER NOT NULL,
  "ref" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "startDate" DATE NOT NULL,
  "weeks" INTEGER NOT NULL DEFAULT 3,
  "weekStartDay" INTEGER NOT NULL DEFAULT 1,
  "status" TEXT NOT NULL DEFAULT 'draft',
  "filterJson" JSONB NOT NULL DEFAULT '{}',
  "notes" TEXT,
  "publishedBy" TEXT,
  "publishedAt" TIMESTAMP(3),
  "archivedBy" TEXT,
  "archivedAt" TIMESTAMP(3),
  "refreshedAt" TIMESTAMP(3),
  "rolledFromId" TEXT,
  "createdBy" TEXT,
  "updatedBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Lookahead_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Lookahead_projectId_number_key" ON "Lookahead"("projectId", "number");
CREATE UNIQUE INDEX "Lookahead_projectId_ref_key" ON "Lookahead"("projectId", "ref");
CREATE INDEX "Lookahead_orgId_idx" ON "Lookahead"("orgId");
CREATE INDEX "Lookahead_projectId_status_idx" ON "Lookahead"("projectId", "status");
CREATE INDEX "Lookahead_projectId_startDate_idx" ON "Lookahead"("projectId", "startDate");
ALTER TABLE "Lookahead"
  ADD CONSTRAINT "Lookahead_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "Lookahead_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "LookaheadItem" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "lookaheadId" TEXT NOT NULL,
  "activityId" TEXT,
  "source" TEXT NOT NULL DEFAULT 'schedule',
  "name" TEXT NOT NULL,
  "wbsCode" TEXT,
  "plannedStart" DATE NOT NULL,
  "plannedFinish" DATE NOT NULL,
  "scheduleStart" DATE,
  "scheduleFinish" DATE,
  "datesEdited" BOOLEAN NOT NULL DEFAULT false,
  "crewId" TEXT,
  "companyId" TEXT,
  "assigneeUserId" TEXT,
  "locationId" TEXT,
  "quantity" DOUBLE PRECISION,
  "unit" TEXT,
  "status" TEXT NOT NULL DEFAULT 'planned',
  "pctComplete" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "varianceReason" TEXT,
  "constraint" TEXT,
  "constraintStatus" TEXT NOT NULL DEFAULT 'none',
  "constraintOwnerUserId" TEXT,
  "constraintDueDate" DATE,
  "constraintClearedAt" TIMESTAMP(3),
  "notes" TEXT,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "carriedFromItemId" TEXT,
  "createdBy" TEXT,
  "updatedBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "LookaheadItem_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "LookaheadItem_orgId_idx" ON "LookaheadItem"("orgId");
CREATE INDEX "LookaheadItem_lookaheadId_sortOrder_idx" ON "LookaheadItem"("lookaheadId", "sortOrder");
CREATE INDEX "LookaheadItem_projectId_activityId_idx" ON "LookaheadItem"("projectId", "activityId");
CREATE INDEX "LookaheadItem_projectId_plannedStart_idx" ON "LookaheadItem"("projectId", "plannedStart");
CREATE INDEX "LookaheadItem_projectId_constraintStatus_idx" ON "LookaheadItem"("projectId", "constraintStatus");
ALTER TABLE "LookaheadItem"
  ADD CONSTRAINT "LookaheadItem_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "LookaheadItem_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "LookaheadItem_lookaheadId_fkey" FOREIGN KEY ("lookaheadId") REFERENCES "Lookahead"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "LookaheadItem_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "Activity"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "LookaheadItem_crewId_fkey" FOREIGN KEY ("crewId") REFERENCES "Crew"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "LookaheadItem_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;
