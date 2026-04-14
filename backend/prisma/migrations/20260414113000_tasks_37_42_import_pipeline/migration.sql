-- AlterTable
ALTER TABLE "Activity"
ADD COLUMN "p6ActivityId" TEXT,
ADD COLUMN "calendarId" TEXT,
ADD COLUMN "originalDuration" INTEGER,
ADD COLUMN "remainingDuration" INTEGER,
ADD COLUMN "physComplete" DOUBLE PRECISION;

-- CreateIndex
CREATE INDEX "Activity_projectId_p6ActivityId_idx" ON "Activity"("projectId", "p6ActivityId");
