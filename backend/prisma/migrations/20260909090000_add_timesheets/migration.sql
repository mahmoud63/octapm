-- OCTA-FLD-TIME-037: workers, crews, timesheets and time entries.

CREATE TABLE "Worker" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "companyId" TEXT,
  "userId" TEXT,
  "name" TEXT NOT NULL,
  "employeeNumber" TEXT,
  "trade" TEXT,
  "classification" TEXT,
  "hourlyRate" DECIMAL(18,2),
  "overtimeMultiplier" DOUBLE PRECISION NOT NULL DEFAULT 1.5,
  "status" TEXT NOT NULL DEFAULT 'active',
  "notes" TEXT,
  "createdBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Worker_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Worker_orgId_employeeNumber_key" ON "Worker"("orgId", "employeeNumber");
CREATE INDEX "Worker_orgId_status_idx" ON "Worker"("orgId", "status");
CREATE INDEX "Worker_companyId_idx" ON "Worker"("companyId");
CREATE INDEX "Worker_userId_idx" ON "Worker"("userId");
ALTER TABLE "Worker"
  ADD CONSTRAINT "Worker_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "Worker_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "Worker_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "Crew" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "companyId" TEXT,
  "partyId" TEXT,
  "foremanUserId" TEXT,
  "defaultCostCodeId" TEXT,
  "defaultActivityId" TEXT,
  "status" TEXT NOT NULL DEFAULT 'active',
  "createdBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Crew_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Crew_projectId_name_key" ON "Crew"("projectId", "name");
CREATE INDEX "Crew_orgId_idx" ON "Crew"("orgId");
CREATE INDEX "Crew_projectId_status_idx" ON "Crew"("projectId", "status");
ALTER TABLE "Crew"
  ADD CONSTRAINT "Crew_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "Crew_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "Crew_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "CrewMember" (
  "id" TEXT NOT NULL,
  "crewId" TEXT NOT NULL,
  "workerId" TEXT NOT NULL,
  "role" TEXT NOT NULL DEFAULT 'member',
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CrewMember_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CrewMember_crewId_workerId_key" ON "CrewMember"("crewId", "workerId");
CREATE INDEX "CrewMember_workerId_idx" ON "CrewMember"("workerId");
ALTER TABLE "CrewMember"
  ADD CONSTRAINT "CrewMember_crewId_fkey" FOREIGN KEY ("crewId") REFERENCES "Crew"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "CrewMember_workerId_fkey" FOREIGN KEY ("workerId") REFERENCES "Worker"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "Timesheet" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "date" DATE NOT NULL,
  "crewId" TEXT,
  "partyId" TEXT,
  "companyId" TEXT,
  "status" TEXT NOT NULL DEFAULT 'draft',
  "notes" TEXT,
  "regularHours" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "overtimeHours" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "totalCost" DECIMAL(18,2) NOT NULL DEFAULT 0,
  "submittedBy" TEXT,
  "submittedAt" TIMESTAMP(3),
  "approvedBy" TEXT,
  "approvedAt" TIMESTAMP(3),
  "rejectedBy" TEXT,
  "rejectedAt" TIMESTAMP(3),
  "rejectionReason" TEXT,
  "postedAt" TIMESTAMP(3),
  "clientRequestId" TEXT,
  "createdBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Timesheet_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Timesheet_projectId_clientRequestId_key" ON "Timesheet"("projectId", "clientRequestId");
CREATE INDEX "Timesheet_orgId_idx" ON "Timesheet"("orgId");
CREATE INDEX "Timesheet_projectId_date_idx" ON "Timesheet"("projectId", "date");
CREATE INDEX "Timesheet_projectId_status_idx" ON "Timesheet"("projectId", "status");
CREATE INDEX "Timesheet_crewId_idx" ON "Timesheet"("crewId");
CREATE INDEX "Timesheet_companyId_idx" ON "Timesheet"("companyId");
ALTER TABLE "Timesheet"
  ADD CONSTRAINT "Timesheet_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "Timesheet_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "Timesheet_crewId_fkey" FOREIGN KEY ("crewId") REFERENCES "Crew"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "TimeEntry" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "timesheetId" TEXT NOT NULL,
  "workerId" TEXT NOT NULL,
  "activityId" TEXT,
  "costCodeId" TEXT,
  "budgetLineId" TEXT,
  "locationId" TEXT,
  "timeType" TEXT NOT NULL DEFAULT 'regular',
  "hours" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "startTime" TEXT,
  "endTime" TEXT,
  "rate" DECIMAL(18,2),
  "amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
  "postedAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
  "notes" TEXT,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TimeEntry_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "TimeEntry_orgId_idx" ON "TimeEntry"("orgId");
CREATE INDEX "TimeEntry_timesheetId_idx" ON "TimeEntry"("timesheetId");
CREATE INDEX "TimeEntry_workerId_idx" ON "TimeEntry"("workerId");
CREATE INDEX "TimeEntry_projectId_activityId_idx" ON "TimeEntry"("projectId", "activityId");
CREATE INDEX "TimeEntry_projectId_costCodeId_idx" ON "TimeEntry"("projectId", "costCodeId");
ALTER TABLE "TimeEntry"
  ADD CONSTRAINT "TimeEntry_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "TimeEntry_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "TimeEntry_timesheetId_fkey" FOREIGN KEY ("timesheetId") REFERENCES "Timesheet"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "TimeEntry_workerId_fkey" FOREIGN KEY ("workerId") REFERENCES "Worker"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "TimeEntry_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "Activity"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "TimeEntry_costCodeId_fkey" FOREIGN KEY ("costCodeId") REFERENCES "CostCode"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "TimeEntry_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;
