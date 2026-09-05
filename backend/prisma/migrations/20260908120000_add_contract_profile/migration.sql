-- OCTA-AI-CONTRACT-032: contract profile (form, notice periods, documents, extracted clauses).

CREATE TABLE "ContractProfile" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "form" TEXT NOT NULL DEFAULT 'custom',
  "delayNoticeDays" INTEGER NOT NULL DEFAULT 28,
  "claimParticularsDays" INTEGER NOT NULL DEFAULT 42,
  "variationNoticeDays" INTEGER NOT NULL DEFAULT 28,
  "responseDays" INTEGER NOT NULL DEFAULT 42,
  "paymentDays" INTEGER,
  "defectsLiabilityDays" INTEGER,
  "ldCapPct" DOUBLE PRECISION,
  "documentIds" JSONB NOT NULL DEFAULT '[]',
  "clausesJson" JSONB NOT NULL DEFAULT '[]',
  "extractedAt" TIMESTAMP(3),
  "extractedModel" TEXT,
  "confirmedBy" TEXT,
  "confirmedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ContractProfile_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ContractProfile_projectId_key" ON "ContractProfile"("projectId");
CREATE INDEX "ContractProfile_orgId_idx" ON "ContractProfile"("orgId");

ALTER TABLE "ContractProfile"
  ADD CONSTRAINT "ContractProfile_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "ContractProfile_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
