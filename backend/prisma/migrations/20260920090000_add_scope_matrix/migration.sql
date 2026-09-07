-- The scope and responsibility matrix (OCTA-SUB-SCOPE-054).
--
-- Construction disputes come overwhelmingly from unclear scope boundaries.
-- The matrix makes each boundary an explicit row with a named party, and the
-- lists the brief asks for -- scope, responsibility, inclusions, exclusions,
-- clarifications and interfaces -- share one table because they are all
-- statements about the same boundary and the contract generator walks them in
-- a single pass.

-- CreateTable
CREATE TABLE "ScopeMatrix" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "commitmentId" TEXT,
    "bidPackageId" TEXT,
    "title" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "notes" TEXT,
    "agreedAt" TIMESTAMP(3),
    "agreedBy" TEXT,
    "createdBy" TEXT,
    "updatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScopeMatrix_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScopeMatrixItem" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "matrixId" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'scope',
    "section" TEXT,
    "description" TEXT NOT NULL,
    "responsibility" TEXT,
    "notes" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScopeMatrixItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ScopeMatrix_commitmentId_key" ON "ScopeMatrix"("commitmentId");

-- CreateIndex
CREATE UNIQUE INDEX "ScopeMatrix_bidPackageId_key" ON "ScopeMatrix"("bidPackageId");

-- CreateIndex
CREATE INDEX "ScopeMatrix_orgId_idx" ON "ScopeMatrix"("orgId");

-- CreateIndex
CREATE INDEX "ScopeMatrix_projectId_status_idx" ON "ScopeMatrix"("projectId", "status");

-- CreateIndex
CREATE INDEX "ScopeMatrixItem_orgId_idx" ON "ScopeMatrixItem"("orgId");

-- CreateIndex
CREATE INDEX "ScopeMatrixItem_matrixId_kind_sortOrder_idx" ON "ScopeMatrixItem"("matrixId", "kind", "sortOrder");

-- AddForeignKey
ALTER TABLE "ScopeMatrix" ADD CONSTRAINT "ScopeMatrix_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScopeMatrix" ADD CONSTRAINT "ScopeMatrix_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScopeMatrix" ADD CONSTRAINT "ScopeMatrix_commitmentId_fkey" FOREIGN KEY ("commitmentId") REFERENCES "Commitment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScopeMatrix" ADD CONSTRAINT "ScopeMatrix_bidPackageId_fkey" FOREIGN KEY ("bidPackageId") REFERENCES "BidPackage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScopeMatrixItem" ADD CONSTRAINT "ScopeMatrixItem_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScopeMatrixItem" ADD CONSTRAINT "ScopeMatrixItem_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScopeMatrixItem" ADD CONSTRAINT "ScopeMatrixItem_matrixId_fkey" FOREIGN KEY ("matrixId") REFERENCES "ScopeMatrix"("id") ON DELETE CASCADE ON UPDATE CASCADE;
