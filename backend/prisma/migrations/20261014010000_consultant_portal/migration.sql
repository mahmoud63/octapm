-- AlterTable
ALTER TABLE "ProjectParty" ADD COLUMN     "discipline" TEXT;

-- AlterTable
ALTER TABLE "ProjectPartyMember" ADD COLUMN     "isPrimaryReviewer" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "jobTitle" TEXT,
ADD COLUMN     "projectRole" TEXT;

-- AlterTable
ALTER TABLE "InvitationToken" ADD COLUMN     "detailsJson" JSONB NOT NULL DEFAULT '{}';

-- CreateTable
CREATE TABLE "ExternalSubmission" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "ref" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "sourceRef" TEXT,
    "title" TEXT NOT NULL,
    "activityId" TEXT,
    "partyId" TEXT NOT NULL,
    "responsibleUserId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'submitted',
    "revision" INTEGER NOT NULL DEFAULT 1,
    "currentCycle" INTEGER NOT NULL DEFAULT 1,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "decision" TEXT,
    "firstSubmittedAt" TIMESTAMP(3) NOT NULL,
    "lastSubmittedAt" TIMESTAMP(3) NOT NULL,
    "lastRespondedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "closedBy" TEXT,
    "closeReason" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExternalSubmission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExternalReviewCycle" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "submissionId" TEXT NOT NULL,
    "cycle" INTEGER NOT NULL,
    "revision" INTEGER NOT NULL,
    "partyId" TEXT NOT NULL,
    "responsibleUserId" TEXT NOT NULL,
    "coverNote" TEXT,
    "snapshotJson" JSONB NOT NULL DEFAULT '{}',
    "issuedDocumentIdsJson" JSONB NOT NULL DEFAULT '[]',
    "submittedBy" TEXT,
    "submittedAt" TIMESTAMP(3) NOT NULL,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "firstOpenedAt" TIMESTAMP(3),
    "firstOpenedBy" TEXT,
    "status" TEXT NOT NULL DEFAULT 'open',
    "decision" TEXT,
    "decisionLabel" TEXT,
    "responseComment" TEXT,
    "respondedAt" TIMESTAMP(3),
    "respondedBy" TEXT,
    "acknowledgedAt" TIMESTAMP(3),
    "acknowledgedBy" TEXT,
    "withdrawnAt" TIMESTAMP(3),
    "withdrawnBy" TEXT,
    "withdrawReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExternalReviewCycle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExternalSubmissionRecipient" (
    "id" TEXT NOT NULL,
    "submissionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "partyId" TEXT,
    "role" TEXT NOT NULL,
    "addedBy" TEXT,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "removedAt" TIMESTAMP(3),

    CONSTRAINT "ExternalSubmissionRecipient_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExternalReviewMessage" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "submissionId" TEXT NOT NULL,
    "cycle" INTEGER NOT NULL,
    "authorId" TEXT,
    "authorSide" TEXT NOT NULL,
    "visibility" TEXT NOT NULL DEFAULT 'shared',
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExternalReviewMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProgressReport" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "ref" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'monthly',
    "period" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "revision" INTEGER NOT NULL DEFAULT 1,
    "activityId" TEXT,
    "createdBy" TEXT,
    "updatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProgressReport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ExternalSubmission_orgId_idx" ON "ExternalSubmission"("orgId");

-- CreateIndex
CREATE INDEX "ExternalSubmission_projectId_status_idx" ON "ExternalSubmission"("projectId", "status");

-- CreateIndex
CREATE INDEX "ExternalSubmission_projectId_sourceType_sourceId_idx" ON "ExternalSubmission"("projectId", "sourceType", "sourceId");

-- CreateIndex
CREATE INDEX "ExternalSubmission_partyId_status_idx" ON "ExternalSubmission"("partyId", "status");

-- CreateIndex
CREATE INDEX "ExternalSubmission_responsibleUserId_status_idx" ON "ExternalSubmission"("responsibleUserId", "status");

-- CreateIndex
CREATE INDEX "ExternalSubmission_activityId_idx" ON "ExternalSubmission"("activityId");

-- CreateIndex
CREATE UNIQUE INDEX "ExternalSubmission_projectId_number_key" ON "ExternalSubmission"("projectId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "ExternalSubmission_projectId_ref_key" ON "ExternalSubmission"("projectId", "ref");

-- CreateIndex
CREATE INDEX "ExternalReviewCycle_orgId_idx" ON "ExternalReviewCycle"("orgId");

-- CreateIndex
CREATE INDEX "ExternalReviewCycle_projectId_status_idx" ON "ExternalReviewCycle"("projectId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ExternalReviewCycle_submissionId_cycle_key" ON "ExternalReviewCycle"("submissionId", "cycle");

-- CreateIndex
CREATE INDEX "ExternalSubmissionRecipient_userId_idx" ON "ExternalSubmissionRecipient"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "ExternalSubmissionRecipient_submissionId_userId_key" ON "ExternalSubmissionRecipient"("submissionId", "userId");

-- CreateIndex
CREATE INDEX "ExternalReviewMessage_submissionId_createdAt_idx" ON "ExternalReviewMessage"("submissionId", "createdAt");

-- CreateIndex
CREATE INDEX "ExternalReviewMessage_orgId_idx" ON "ExternalReviewMessage"("orgId");

-- CreateIndex
CREATE INDEX "ProgressReport_orgId_idx" ON "ProgressReport"("orgId");

-- CreateIndex
CREATE INDEX "ProgressReport_activityId_idx" ON "ProgressReport"("activityId");

-- CreateIndex
CREATE UNIQUE INDEX "ProgressReport_projectId_number_key" ON "ProgressReport"("projectId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "ProgressReport_projectId_ref_key" ON "ProgressReport"("projectId", "ref");

-- AddForeignKey
ALTER TABLE "ExternalSubmission" ADD CONSTRAINT "ExternalSubmission_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExternalSubmission" ADD CONSTRAINT "ExternalSubmission_projectId_orgId_fkey" FOREIGN KEY ("projectId", "orgId") REFERENCES "Project"("id", "orgId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExternalSubmission" ADD CONSTRAINT "ExternalSubmission_partyId_fkey" FOREIGN KEY ("partyId") REFERENCES "ProjectParty"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExternalSubmission" ADD CONSTRAINT "ExternalSubmission_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "Activity"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExternalReviewCycle" ADD CONSTRAINT "ExternalReviewCycle_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExternalReviewCycle" ADD CONSTRAINT "ExternalReviewCycle_projectId_orgId_fkey" FOREIGN KEY ("projectId", "orgId") REFERENCES "Project"("id", "orgId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExternalReviewCycle" ADD CONSTRAINT "ExternalReviewCycle_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "ExternalSubmission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExternalSubmissionRecipient" ADD CONSTRAINT "ExternalSubmissionRecipient_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "ExternalSubmission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExternalReviewMessage" ADD CONSTRAINT "ExternalReviewMessage_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExternalReviewMessage" ADD CONSTRAINT "ExternalReviewMessage_projectId_orgId_fkey" FOREIGN KEY ("projectId", "orgId") REFERENCES "Project"("id", "orgId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExternalReviewMessage" ADD CONSTRAINT "ExternalReviewMessage_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "ExternalSubmission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProgressReport" ADD CONSTRAINT "ProgressReport_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProgressReport" ADD CONSTRAINT "ProgressReport_projectId_orgId_fkey" FOREIGN KEY ("projectId", "orgId") REFERENCES "Project"("id", "orgId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProgressReport" ADD CONSTRAINT "ProgressReport_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "Activity"("id") ON DELETE SET NULL ON UPDATE CASCADE;

