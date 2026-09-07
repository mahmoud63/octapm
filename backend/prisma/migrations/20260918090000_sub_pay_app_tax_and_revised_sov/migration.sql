-- Subcontractor payment applications: tax, other deductions, and the revised
-- schedule of values (OCTA-COM-SUBPAY-052).
--
-- The over-billing rule is "previous + current may not exceed the scheduled
-- amount, unless an authorised contract modification says otherwise". The two
-- line columns are that "unless": what approved change orders added to the
-- line, and the ceiling that produced, snapshotted at the moment of the claim
-- the way capAmount and approvedPct already are.

-- AlterTable
ALTER TABLE "SubPayApp" ADD COLUMN     "otherDeductions" DECIMAL(18,2) NOT NULL DEFAULT 0,
ADD COLUMN     "otherDeductionsNote" TEXT,
ADD COLUMN     "taxAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
ADD COLUMN     "taxRate" DOUBLE PRECISION NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "SubPayAppLine" ADD COLUMN     "approvedChangeAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
ADD COLUMN     "revisedScheduledAmount" DECIMAL(18,2) NOT NULL DEFAULT 0;

-- Existing claims were made against the original schedule, and that is the
-- ceiling they were correctly measured against.
UPDATE "SubPayAppLine" SET "revisedScheduledAmount" = "scheduledAmount";
