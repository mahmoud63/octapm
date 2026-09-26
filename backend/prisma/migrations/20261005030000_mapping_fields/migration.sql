-- Project-controls programme, wave PC-3 (BOQ ↔ activity mapping).
-- ActivityBoqAllocation is the mapping model and stays so: five nullable or
-- defaulted columns, two indexes and one self-referencing foreign key are
-- added; nothing is rewritten. The partial unique index
-- ActivityBoqAllocation_active_pair_key (one active row per project, item
-- and activity) remains the uniqueness truth and is not touched here.
--
-- basis: which of quantity, amount and weight the user typed. Every legacy
-- row is stamped 'amount' — the figure EV and IPC always read — so a later
-- rate change on the item leaves its amount alone.

-- AlterTable
ALTER TABLE "ActivityBoqAllocation" ADD COLUMN     "basis" TEXT NOT NULL DEFAULT 'amount',
ADD COLUMN     "confidence" DOUBLE PRECISION,
ADD COLUMN     "importBatchId" TEXT,
ADD COLUMN     "suggestedBy" TEXT,
ADD COLUMN     "supersededByAllocationId" TEXT;

-- CreateIndex
CREATE INDEX "ActivityBoqAllocation_importBatchId_idx" ON "ActivityBoqAllocation"("importBatchId");

-- CreateIndex
CREATE INDEX "ActivityBoqAllocation_supersededByAllocationId_idx" ON "ActivityBoqAllocation"("supersededByAllocationId");

-- AddForeignKey
ALTER TABLE "ActivityBoqAllocation" ADD CONSTRAINT "ActivityBoqAllocation_supersededByAllocationId_fkey" FOREIGN KEY ("supersededByAllocationId") REFERENCES "ActivityBoqAllocation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
