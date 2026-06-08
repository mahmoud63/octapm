-- Activity-to-BOQ allocation spine.
-- The partial unique index prevents duplicate active allocation rows for the
-- same BOQ item and official schedule activity. Aggregate quantity/value
-- limits are enforced with triggers because they depend on sibling rows.

CREATE TABLE "ActivityBoqAllocation" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "boqItemId" TEXT NOT NULL,
    "activityId" TEXT NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "amount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "weight" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "status" TEXT NOT NULL DEFAULT 'draft',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "submittedBy" TEXT,
    "submittedAt" TIMESTAMP(3),
    "approvedBy" TEXT,
    "approvedAt" TIMESTAMP(3),
    "rejectedBy" TEXT,
    "rejectedAt" TIMESTAMP(3),
    "rejectedReason" TEXT,
    "createdBy" TEXT,
    "updatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ActivityBoqAllocation_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ActivityBoqAllocation_quantity_nonnegative" CHECK ("quantity" >= 0),
    CONSTRAINT "ActivityBoqAllocation_amount_nonnegative" CHECK ("amount" >= 0),
    CONSTRAINT "ActivityBoqAllocation_weight_nonnegative" CHECK ("weight" >= 0),
    CONSTRAINT "ActivityBoqAllocation_status_check" CHECK ("status" IN ('draft', 'submitted', 'approved', 'rejected')),
    CONSTRAINT "ActivityBoqAllocation_source_check" CHECK ("source" IN ('manual', 'import', 'ai', 'migration'))
);

ALTER TABLE "IpcItem" ADD COLUMN "allocationId" TEXT;

CREATE INDEX "ActivityBoqAllocation_projectId_idx" ON "ActivityBoqAllocation"("projectId");
CREATE INDEX "ActivityBoqAllocation_boqItemId_idx" ON "ActivityBoqAllocation"("boqItemId");
CREATE INDEX "ActivityBoqAllocation_activityId_idx" ON "ActivityBoqAllocation"("activityId");
CREATE INDEX "ActivityBoqAllocation_projectId_status_idx" ON "ActivityBoqAllocation"("projectId", "status");
CREATE UNIQUE INDEX "ActivityBoqAllocation_active_pair_key" ON "ActivityBoqAllocation"("projectId", "boqItemId", "activityId") WHERE "isActive" = true;
CREATE INDEX "IpcItem_allocationId_idx" ON "IpcItem"("allocationId");

ALTER TABLE "ActivityBoqAllocation" ADD CONSTRAINT "ActivityBoqAllocation_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ActivityBoqAllocation" ADD CONSTRAINT "ActivityBoqAllocation_boqItemId_fkey" FOREIGN KEY ("boqItemId") REFERENCES "BoqItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ActivityBoqAllocation" ADD CONSTRAINT "ActivityBoqAllocation_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "Activity"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "IpcItem" ADD CONSTRAINT "IpcItem_allocationId_fkey" FOREIGN KEY ("allocationId") REFERENCES "ActivityBoqAllocation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION validate_activity_boq_allocation()
RETURNS TRIGGER AS $$
DECLARE
    boq_project_id TEXT;
    activity_project_id TEXT;
    boq_qty DOUBLE PRECISION;
    boq_amount DOUBLE PRECISION;
    allocated_qty DOUBLE PRECISION;
    allocated_amount DOUBLE PRECISION;
BEGIN
    SELECT "projectId", "qty", "amount"
      INTO boq_project_id, boq_qty, boq_amount
      FROM "BoqItem"
     WHERE "id" = NEW."boqItemId";

    IF boq_project_id IS NULL THEN
      RAISE EXCEPTION 'BOQ item % not found', NEW."boqItemId";
    END IF;

    SELECT "projectId"
      INTO activity_project_id
      FROM "Activity"
     WHERE "id" = NEW."activityId";

    IF activity_project_id IS NULL THEN
      RAISE EXCEPTION 'Activity % not found', NEW."activityId";
    END IF;

    IF NEW."projectId" <> boq_project_id OR NEW."projectId" <> activity_project_id THEN
      RAISE EXCEPTION 'Allocation project must match BOQ item and activity project';
    END IF;

    SELECT COALESCE(SUM("quantity"), 0), COALESCE(SUM("amount"), 0)
      INTO allocated_qty, allocated_amount
      FROM "ActivityBoqAllocation"
     WHERE "boqItemId" = NEW."boqItemId"
       AND "isActive" = true;

    IF allocated_qty > COALESCE(boq_qty, 0) + 0.000001 THEN
      RAISE EXCEPTION 'Activity BOQ allocation quantity exceeds BOQ item quantity';
    END IF;

    IF allocated_amount > COALESCE(boq_amount, 0) + 0.01 THEN
      RAISE EXCEPTION 'Activity BOQ allocation amount exceeds BOQ item amount';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "ActivityBoqAllocation_validate"
AFTER INSERT OR UPDATE OF "projectId", "boqItemId", "activityId", "quantity", "amount", "isActive"
ON "ActivityBoqAllocation"
FOR EACH ROW
EXECUTE FUNCTION validate_activity_boq_allocation();

CREATE OR REPLACE FUNCTION validate_boq_item_allocation_capacity()
RETURNS TRIGGER AS $$
DECLARE
    allocated_qty DOUBLE PRECISION;
    allocated_amount DOUBLE PRECISION;
BEGIN
    SELECT COALESCE(SUM("quantity"), 0), COALESCE(SUM("amount"), 0)
      INTO allocated_qty, allocated_amount
      FROM "ActivityBoqAllocation"
     WHERE "boqItemId" = NEW."id"
       AND "isActive" = true;

    IF allocated_qty > COALESCE(NEW."qty", 0) + 0.000001 THEN
      RAISE EXCEPTION 'Existing BOQ activity allocations exceed the new BOQ item quantity';
    END IF;

    IF allocated_amount > COALESCE(NEW."amount", 0) + 0.01 THEN
      RAISE EXCEPTION 'Existing BOQ activity allocations exceed the new BOQ item amount';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "BoqItem_allocation_capacity_validate"
AFTER UPDATE OF "qty", "amount"
ON "BoqItem"
FOR EACH ROW
EXECUTE FUNCTION validate_boq_item_allocation_capacity();
