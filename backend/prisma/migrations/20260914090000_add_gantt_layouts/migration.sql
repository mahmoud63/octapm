-- Saved Gantt layouts, shareable with the project team.
--
-- Written by hand rather than generated: `prisma migrate dev` also tries to
-- reconcile pre-existing drift in this schema (DocumentText.searchVector is a
-- generated column Prisma cannot model) and produces a 400-line migration that
-- fails. This one creates only the new table.

-- CreateTable
CREATE TABLE "GanttLayout" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "visibility" TEXT NOT NULL DEFAULT 'private',
    "layoutJson" JSONB NOT NULL,
    "createdBy" TEXT,
    "updatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GanttLayout_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "GanttLayout_projectId_createdBy_name_key" ON "GanttLayout"("projectId", "createdBy", "name");

-- CreateIndex
CREATE INDEX "GanttLayout_orgId_projectId_idx" ON "GanttLayout"("orgId", "projectId");

-- CreateIndex
CREATE INDEX "GanttLayout_orgId_createdBy_idx" ON "GanttLayout"("orgId", "createdBy");

-- AddForeignKey
ALTER TABLE "GanttLayout" ADD CONSTRAINT "GanttLayout_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GanttLayout" ADD CONSTRAINT "GanttLayout_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
