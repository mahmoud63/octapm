-- Subcontractor performance evaluation (OCTA-SUB-PERF-058).
-- How a subcontractor performed on one subcontract, and — averaged across
-- their subcontracts — the history that informs the next time they bid.

-- CreateTable
CREATE TABLE "SubcontractorEvaluation" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "commitmentId" TEXT NOT NULL,
    "companyId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "score" DECIMAL(5,2),
    "wouldReuse" BOOLEAN,
    "summary" TEXT,
    "evaluatedBy" TEXT,
    "evaluatedAt" TIMESTAMP(3),
    "createdBy" TEXT,
    "updatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SubcontractorEvaluation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EvaluationCriterion" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "evaluationId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'delivery',
    "weight" INTEGER NOT NULL DEFAULT 10,
    "maxScore" INTEGER NOT NULL DEFAULT 5,
    "score" INTEGER,
    "overrideReason" TEXT,
    "note" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EvaluationCriterion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SubcontractorEvaluation_commitmentId_key" ON "SubcontractorEvaluation"("commitmentId");

-- CreateIndex
CREATE INDEX "SubcontractorEvaluation_orgId_companyId_status_idx" ON "SubcontractorEvaluation"("orgId", "companyId", "status");

-- CreateIndex
CREATE INDEX "SubcontractorEvaluation_projectId_idx" ON "SubcontractorEvaluation"("projectId");

-- CreateIndex
CREATE INDEX "EvaluationCriterion_evaluationId_idx" ON "EvaluationCriterion"("evaluationId");

-- CreateIndex
CREATE UNIQUE INDEX "EvaluationCriterion_evaluationId_key_key" ON "EvaluationCriterion"("evaluationId", "key");

-- AddForeignKey
ALTER TABLE "SubcontractorEvaluation" ADD CONSTRAINT "SubcontractorEvaluation_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubcontractorEvaluation" ADD CONSTRAINT "SubcontractorEvaluation_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubcontractorEvaluation" ADD CONSTRAINT "SubcontractorEvaluation_commitmentId_fkey" FOREIGN KEY ("commitmentId") REFERENCES "Commitment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvaluationCriterion" ADD CONSTRAINT "EvaluationCriterion_evaluationId_fkey" FOREIGN KEY ("evaluationId") REFERENCES "SubcontractorEvaluation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
