-- Add baseline fields for Gantt planned-vs-current overlay
ALTER TABLE "Activity"
ADD COLUMN "baselineStart" INTEGER,
ADD COLUMN "baselineFinish" INTEGER;
