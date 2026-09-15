-- Phase 21D (CX21-544): the BOQ row that minted an activity, so a row's delete retires only what it created.
ALTER TABLE "Activity" ADD COLUMN "mintedByBoqItemId" TEXT;

CREATE INDEX "Activity_projectId_mintedByBoqItemId_idx" ON "Activity"("projectId", "mintedByBoqItemId");
