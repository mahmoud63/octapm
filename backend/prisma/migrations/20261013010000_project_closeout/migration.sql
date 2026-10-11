-- CreateTable
CREATE TABLE "ProjectCloseout" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'in_progress',
    "substantialCompletionAt" TIMESTAMP(3),
    "substantialCompletionBy" TEXT,
    "substantialCompletionNote" TEXT,
    "handoverAt" TIMESTAMP(3),
    "handoverBy" TEXT,
    "handoverNote" TEXT,
    "finalCompletionAt" TIMESTAMP(3),
    "finalCompletionBy" TEXT,
    "finalCompletionNote" TEXT,
    "checkWaiversJson" JSONB NOT NULL DEFAULT '{}',
    "createdBy" TEXT,
    "updatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectCloseout_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CloseoutDeliverable" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "ref" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "required" BOOLEAN NOT NULL DEFAULT true,
    "status" TEXT NOT NULL DEFAULT 'outstanding',
    "responsibleCompanyId" TEXT,
    "responsibleUserId" TEXT,
    "activityId" TEXT,
    "locationId" TEXT,
    "dueDate" TIMESTAMP(3),
    "warrantyStart" TIMESTAMP(3),
    "warrantyMonths" INTEGER,
    "warrantyEnd" TIMESTAMP(3),
    "documentIdsJson" JSONB NOT NULL DEFAULT '[]',
    "submittedAt" TIMESTAMP(3),
    "submittedBy" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewedBy" TEXT,
    "reviewComment" TEXT,
    "waivedReason" TEXT,
    "createdBy" TEXT,
    "updatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CloseoutDeliverable_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProjectCloseout_projectId_key" ON "ProjectCloseout"("projectId");

-- CreateIndex
CREATE INDEX "ProjectCloseout_orgId_idx" ON "ProjectCloseout"("orgId");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectCloseout_projectId_orgId_key" ON "ProjectCloseout"("projectId", "orgId");

-- CreateIndex
CREATE INDEX "CloseoutDeliverable_orgId_idx" ON "CloseoutDeliverable"("orgId");

-- CreateIndex
CREATE INDEX "CloseoutDeliverable_projectId_status_idx" ON "CloseoutDeliverable"("projectId", "status");

-- CreateIndex
CREATE INDEX "CloseoutDeliverable_projectId_category_idx" ON "CloseoutDeliverable"("projectId", "category");

-- CreateIndex
CREATE INDEX "CloseoutDeliverable_activityId_idx" ON "CloseoutDeliverable"("activityId");

-- CreateIndex
CREATE UNIQUE INDEX "CloseoutDeliverable_projectId_ref_key" ON "CloseoutDeliverable"("projectId", "ref");

-- CreateIndex
CREATE UNIQUE INDEX "CloseoutDeliverable_projectId_number_key" ON "CloseoutDeliverable"("projectId", "number");

-- AddForeignKey
ALTER TABLE "ProjectCloseout" ADD CONSTRAINT "ProjectCloseout_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectCloseout" ADD CONSTRAINT "ProjectCloseout_projectId_orgId_fkey" FOREIGN KEY ("projectId", "orgId") REFERENCES "Project"("id", "orgId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CloseoutDeliverable" ADD CONSTRAINT "CloseoutDeliverable_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CloseoutDeliverable" ADD CONSTRAINT "CloseoutDeliverable_projectId_orgId_fkey" FOREIGN KEY ("projectId", "orgId") REFERENCES "Project"("id", "orgId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CloseoutDeliverable" ADD CONSTRAINT "CloseoutDeliverable_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "Activity"("id") ON DELETE SET NULL ON UPDATE CASCADE;

