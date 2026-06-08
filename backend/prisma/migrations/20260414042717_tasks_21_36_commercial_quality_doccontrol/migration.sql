-- AlterTable
ALTER TABLE "ChangeOrder" ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "NcrRecord" ADD COLUMN     "closedDate" TIMESTAMP(3),
ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "dueDate" TIMESTAMP(3),
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL;

-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "completionDate" TIMESTAMP(3),
ADD COLUMN     "ldRatePerDay" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "weatherAllowanceDays" INTEGER NOT NULL DEFAULT 20;

-- AlterTable
ALTER TABLE "Rfi" ADD COLUMN     "activityId" TEXT,
ADD COLUMN     "answeredBy" TEXT,
ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "question" TEXT,
ADD COLUMN     "raisedBy" TEXT,
ADD COLUMN     "response" TEXT,
ADD COLUMN     "responseRequiredBy" TIMESTAMP(3),
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL;

-- AlterTable
ALTER TABLE "SubValuation" ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "grossPayable" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "ref" TEXT NOT NULL,
ADD COLUMN     "retentionRate" DOUBLE PRECISION NOT NULL DEFAULT 5,
ADD COLUMN     "submittedDate" TIMESTAMP(3),
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL;

-- CreateTable
CREATE TABLE "BudgetRevision" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "ref" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "changeType" TEXT NOT NULL DEFAULT 'addition',
    "amount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "linkedChangeOrder" TEXT,
    "effectiveDate" TIMESTAMP(3),
    "cumulativeBudget" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BudgetRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CashFlowEntry" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "inflow" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "outflow" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "note" TEXT,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CashFlowEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EotClaim" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "ref" TEXT NOT NULL,
    "eventName" TEXT NOT NULL,
    "eventType" TEXT,
    "delayDays" INTEGER NOT NULL DEFAULT 0,
    "eotDaysGranted" INTEGER NOT NULL DEFAULT 0,
    "ldRatePerDay" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "ldLiability" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "affectedActivities" JSONB,
    "analysis" TEXT,
    "claimLetter" TEXT,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EotClaim_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WeatherDelay" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "description" TEXT NOT NULL,
    "delayDays" INTEGER NOT NULL DEFAULT 0,
    "contractual" BOOLEAN NOT NULL DEFAULT true,
    "monthKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WeatherDelay_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ItpRecord" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "activityId" TEXT,
    "ref" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "pointType" TEXT NOT NULL DEFAULT 'hold',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "inspectionDate" TIMESTAMP(3),
    "inspector" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ItpRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DefectRecord" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "activityId" TEXT,
    "ref" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "trade" TEXT,
    "location" TEXT,
    "severity" TEXT NOT NULL DEFAULT 'minor',
    "status" TEXT NOT NULL DEFAULT 'open',
    "assignee" TEXT,
    "targetCloseBy" TIMESTAMP(3),
    "closedDate" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DefectRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SafetyIncident" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "activityId" TEXT,
    "ref" TEXT NOT NULL,
    "incidentType" TEXT NOT NULL,
    "severity" TEXT,
    "title" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "lostDays" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'open',
    "investigation" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SafetyIncident_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MaterialTest" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "activityId" TEXT,
    "ref" TEXT NOT NULL,
    "testType" TEXT NOT NULL,
    "specValue" TEXT,
    "actualValue" TEXT,
    "result" TEXT NOT NULL DEFAULT 'pending',
    "testDate" TIMESTAMP(3),
    "labName" TEXT,
    "millCertRef" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MaterialTest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Submittal" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "activityId" TEXT,
    "ref" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "discipline" TEXT,
    "revision" TEXT NOT NULL DEFAULT 'A',
    "specRef" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "submittedOn" TIMESTAMP(3),
    "dueDate" TIMESTAMP(3),
    "reviewedOn" TIMESTAMP(3),
    "remarks" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Submittal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DrawingRecord" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "activityId" TEXT,
    "ref" TEXT NOT NULL,
    "drawingNumber" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "discipline" TEXT,
    "revision" TEXT NOT NULL DEFAULT '0',
    "purpose" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "issueDate" TIMESTAMP(3),
    "fileUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DrawingRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Transmittal" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "ref" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "sender" TEXT NOT NULL,
    "recipient" TEXT NOT NULL,
    "method" TEXT NOT NULL DEFAULT 'email',
    "status" TEXT NOT NULL DEFAULT 'pending_ack',
    "transmittedOn" TIMESTAMP(3),
    "acknowledgedOn" TIMESTAMP(3),
    "documentsJson" JSONB,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Transmittal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Correspondence" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "activityId" TEXT,
    "ref" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT,
    "contractualNotice" BOOLEAN NOT NULL DEFAULT false,
    "date" TIMESTAMP(3) NOT NULL,
    "responseRequiredBy" TIMESTAMP(3),
    "responseDate" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'open',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Correspondence_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BudgetRevision_projectId_idx" ON "BudgetRevision"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "BudgetRevision_projectId_ref_key" ON "BudgetRevision"("projectId", "ref");

-- CreateIndex
CREATE INDEX "CashFlowEntry_projectId_idx" ON "CashFlowEntry"("projectId");

-- CreateIndex
CREATE INDEX "EotClaim_projectId_idx" ON "EotClaim"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "EotClaim_projectId_ref_key" ON "EotClaim"("projectId", "ref");

-- CreateIndex
CREATE INDEX "WeatherDelay_projectId_idx" ON "WeatherDelay"("projectId");

-- CreateIndex
CREATE INDEX "ItpRecord_projectId_idx" ON "ItpRecord"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "ItpRecord_projectId_ref_key" ON "ItpRecord"("projectId", "ref");

-- CreateIndex
CREATE INDEX "DefectRecord_projectId_idx" ON "DefectRecord"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "DefectRecord_projectId_ref_key" ON "DefectRecord"("projectId", "ref");

-- CreateIndex
CREATE INDEX "SafetyIncident_projectId_idx" ON "SafetyIncident"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "SafetyIncident_projectId_ref_key" ON "SafetyIncident"("projectId", "ref");

-- CreateIndex
CREATE INDEX "MaterialTest_projectId_idx" ON "MaterialTest"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "MaterialTest_projectId_ref_key" ON "MaterialTest"("projectId", "ref");

-- CreateIndex
CREATE INDEX "Submittal_projectId_idx" ON "Submittal"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "Submittal_projectId_ref_key" ON "Submittal"("projectId", "ref");

-- CreateIndex
CREATE INDEX "DrawingRecord_projectId_idx" ON "DrawingRecord"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "DrawingRecord_projectId_ref_key" ON "DrawingRecord"("projectId", "ref");

-- CreateIndex
CREATE INDEX "Transmittal_projectId_idx" ON "Transmittal"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "Transmittal_projectId_ref_key" ON "Transmittal"("projectId", "ref");

-- CreateIndex
CREATE INDEX "Correspondence_projectId_idx" ON "Correspondence"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "Correspondence_projectId_ref_key" ON "Correspondence"("projectId", "ref");

-- CreateIndex
CREATE UNIQUE INDEX "Rfi_projectId_ref_key" ON "Rfi"("projectId", "ref");

-- CreateIndex
CREATE UNIQUE INDEX "SubValuation_projectId_ref_key" ON "SubValuation"("projectId", "ref");

-- AddForeignKey
ALTER TABLE "BudgetRevision" ADD CONSTRAINT "BudgetRevision_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashFlowEntry" ADD CONSTRAINT "CashFlowEntry_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EotClaim" ADD CONSTRAINT "EotClaim_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WeatherDelay" ADD CONSTRAINT "WeatherDelay_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItpRecord" ADD CONSTRAINT "ItpRecord_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItpRecord" ADD CONSTRAINT "ItpRecord_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "Activity"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DefectRecord" ADD CONSTRAINT "DefectRecord_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DefectRecord" ADD CONSTRAINT "DefectRecord_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "Activity"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SafetyIncident" ADD CONSTRAINT "SafetyIncident_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SafetyIncident" ADD CONSTRAINT "SafetyIncident_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "Activity"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaterialTest" ADD CONSTRAINT "MaterialTest_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaterialTest" ADD CONSTRAINT "MaterialTest_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "Activity"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Rfi" ADD CONSTRAINT "Rfi_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "Activity"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Submittal" ADD CONSTRAINT "Submittal_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Submittal" ADD CONSTRAINT "Submittal_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "Activity"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DrawingRecord" ADD CONSTRAINT "DrawingRecord_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DrawingRecord" ADD CONSTRAINT "DrawingRecord_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "Activity"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transmittal" ADD CONSTRAINT "Transmittal_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Correspondence" ADD CONSTRAINT "Correspondence_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Correspondence" ADD CONSTRAINT "Correspondence_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "Activity"("id") ON DELETE SET NULL ON UPDATE CASCADE;

