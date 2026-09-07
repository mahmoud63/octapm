-- Subcontractor prequalification (OCTA-SUB-PREQUAL-057).
-- One assessment per vendor company, held at the organisation so a
-- subcontractor is qualified once and reused on every project.

-- CreateTable
CREATE TABLE "VendorPrequalification" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "score" DECIMAL(5,2),
    "recommendation" TEXT,
    "validUntil" TIMESTAMP(3),
    "singleAwardLimit" DECIMAL(18,2),
    "conditions" TEXT,
    "decisionNote" TEXT,
    "submittedAt" TIMESTAMP(3),
    "decidedAt" TIMESTAMP(3),
    "decidedBy" TEXT,
    "createdBy" TEXT,
    "updatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VendorPrequalification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PrequalCriterion" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "prequalId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'capability',
    "weight" INTEGER NOT NULL DEFAULT 10,
    "maxScore" INTEGER NOT NULL DEFAULT 5,
    "score" INTEGER,
    "required" BOOLEAN NOT NULL DEFAULT true,
    "tracksExpiry" BOOLEAN NOT NULL DEFAULT false,
    "reference" TEXT,
    "expiresAt" TIMESTAMP(3),
    "note" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PrequalCriterion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "VendorPrequalification_companyId_key" ON "VendorPrequalification"("companyId");

-- CreateIndex
CREATE INDEX "VendorPrequalification_orgId_status_idx" ON "VendorPrequalification"("orgId", "status");

-- CreateIndex
CREATE INDEX "VendorPrequalification_orgId_validUntil_idx" ON "VendorPrequalification"("orgId", "validUntil");

-- CreateIndex
CREATE INDEX "PrequalCriterion_prequalId_idx" ON "PrequalCriterion"("prequalId");

-- CreateIndex
CREATE UNIQUE INDEX "PrequalCriterion_prequalId_key_key" ON "PrequalCriterion"("prequalId", "key");

-- AddForeignKey
ALTER TABLE "VendorPrequalification" ADD CONSTRAINT "VendorPrequalification_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VendorPrequalification" ADD CONSTRAINT "VendorPrequalification_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrequalCriterion" ADD CONSTRAINT "PrequalCriterion_prequalId_fkey" FOREIGN KEY ("prequalId") REFERENCES "VendorPrequalification"("id") ON DELETE CASCADE ON UPDATE CASCADE;
