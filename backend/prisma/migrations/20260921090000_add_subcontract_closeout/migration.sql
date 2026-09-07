-- Subcontract closeout (OCTA-SUB-CLOSE-056).
--
-- What must be true before a subcontract is paid out and closed. Half the
-- checklist is derived from records the system already holds -- the punch
-- list, the insurance certificates, the payment applications -- and is never
-- stored. A row exists for the handover items somebody completes against
-- evidence, and for a derived check that has been waived, so a waiver
-- survives the thing it waived changing underneath it.

-- CreateTable
CREATE TABLE "SubcontractCloseout" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "commitmentId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "notes" TEXT,
    "completedAt" TIMESTAMP(3),
    "completedBy" TEXT,
    "createdBy" TEXT,
    "updatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SubcontractCloseout_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CloseoutItem" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "closeoutId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "required" BOOLEAN NOT NULL DEFAULT true,
    "status" TEXT NOT NULL DEFAULT 'outstanding',
    "documentId" TEXT,
    "note" TEXT,
    "waivedReason" TEXT,
    "completedAt" TIMESTAMP(3),
    "completedBy" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CloseoutItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SubcontractCloseout_commitmentId_key" ON "SubcontractCloseout"("commitmentId");

-- CreateIndex
CREATE INDEX "SubcontractCloseout_orgId_idx" ON "SubcontractCloseout"("orgId");

-- CreateIndex
CREATE INDEX "SubcontractCloseout_projectId_status_idx" ON "SubcontractCloseout"("projectId", "status");

-- CreateIndex
CREATE INDEX "CloseoutItem_orgId_idx" ON "CloseoutItem"("orgId");

-- CreateIndex
CREATE INDEX "CloseoutItem_closeoutId_sortOrder_idx" ON "CloseoutItem"("closeoutId", "sortOrder");

-- CreateIndex
CREATE INDEX "CloseoutItem_documentId_idx" ON "CloseoutItem"("documentId");

-- CreateIndex
CREATE UNIQUE INDEX "CloseoutItem_closeoutId_key_key" ON "CloseoutItem"("closeoutId", "key");

-- AddForeignKey
ALTER TABLE "SubcontractCloseout" ADD CONSTRAINT "SubcontractCloseout_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubcontractCloseout" ADD CONSTRAINT "SubcontractCloseout_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubcontractCloseout" ADD CONSTRAINT "SubcontractCloseout_commitmentId_fkey" FOREIGN KEY ("commitmentId") REFERENCES "Commitment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CloseoutItem" ADD CONSTRAINT "CloseoutItem_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CloseoutItem" ADD CONSTRAINT "CloseoutItem_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CloseoutItem" ADD CONSTRAINT "CloseoutItem_closeoutId_fkey" FOREIGN KEY ("closeoutId") REFERENCES "SubcontractCloseout"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CloseoutItem" ADD CONSTRAINT "CloseoutItem_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "ProjectDocument"("id") ON DELETE SET NULL ON UPDATE CASCADE;
