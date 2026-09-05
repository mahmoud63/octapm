-- OCTA-FLD-PUNCH-013: punch list with a state machine and an event ledger.
-- Every legacy DefectRecord becomes a PunchItem (linked through
-- legacyDefectId); its attachments, pins, comments, follows and activity
-- links move with it so nothing is lost. DefectRecord stays readable.

CREATE TABLE "PunchItem" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "number" INTEGER NOT NULL,
  "ref" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "description" TEXT,
  "status" TEXT NOT NULL DEFAULT 'draft',
  "priority" TEXT NOT NULL DEFAULT 'normal',
  "trade" TEXT,
  "activityId" TEXT,
  "locationId" TEXT,
  "locationText" TEXT,
  "sheetId" TEXT,
  "assigneeCompanyId" TEXT,
  "assigneeUserId" TEXT,
  "managerUserId" TEXT,
  "finalApproverUserId" TEXT,
  "ballInCourtUserId" TEXT,
  "dueDate" TIMESTAMP(3),
  "openedAt" TIMESTAMP(3),
  "readyAt" TIMESTAMP(3),
  "closedAt" TIMESTAMP(3),
  "closedBy" TEXT,
  "reopenCount" INTEGER NOT NULL DEFAULT 0,
  "disputeReason" TEXT,
  "distributedAt" TIMESTAMP(3),
  "legacyDefectId" TEXT,
  "createdBy" TEXT,
  "updatedBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "PunchItem_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PunchItem_legacyDefectId_key" ON "PunchItem"("legacyDefectId");
CREATE UNIQUE INDEX "PunchItem_projectId_ref_key" ON "PunchItem"("projectId", "ref");
CREATE UNIQUE INDEX "PunchItem_projectId_number_key" ON "PunchItem"("projectId", "number");
CREATE INDEX "PunchItem_orgId_idx" ON "PunchItem"("orgId");
CREATE INDEX "PunchItem_projectId_status_idx" ON "PunchItem"("projectId", "status");
CREATE INDEX "PunchItem_projectId_assigneeCompanyId_status_idx" ON "PunchItem"("projectId", "assigneeCompanyId", "status");
CREATE INDEX "PunchItem_projectId_locationId_idx" ON "PunchItem"("projectId", "locationId");
CREATE INDEX "PunchItem_projectId_dueDate_idx" ON "PunchItem"("projectId", "dueDate");
CREATE INDEX "PunchItem_sheetId_idx" ON "PunchItem"("sheetId");
CREATE INDEX "PunchItem_assigneeUserId_idx" ON "PunchItem"("assigneeUserId");
CREATE INDEX "PunchItem_managerUserId_idx" ON "PunchItem"("managerUserId");
CREATE INDEX "PunchItem_finalApproverUserId_idx" ON "PunchItem"("finalApproverUserId");
CREATE INDEX "PunchItem_ballInCourtUserId_idx" ON "PunchItem"("ballInCourtUserId");

ALTER TABLE "PunchItem" ADD CONSTRAINT "PunchItem_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PunchItem" ADD CONSTRAINT "PunchItem_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PunchItem" ADD CONSTRAINT "PunchItem_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "Activity"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PunchItem" ADD CONSTRAINT "PunchItem_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PunchItem" ADD CONSTRAINT "PunchItem_sheetId_fkey" FOREIGN KEY ("sheetId") REFERENCES "Sheet"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PunchItem" ADD CONSTRAINT "PunchItem_assigneeCompanyId_fkey" FOREIGN KEY ("assigneeCompanyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PunchItem" ADD CONSTRAINT "PunchItem_assigneeUserId_fkey" FOREIGN KEY ("assigneeUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PunchItem" ADD CONSTRAINT "PunchItem_managerUserId_fkey" FOREIGN KEY ("managerUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PunchItem" ADD CONSTRAINT "PunchItem_finalApproverUserId_fkey" FOREIGN KEY ("finalApproverUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PunchItem" ADD CONSTRAINT "PunchItem_ballInCourtUserId_fkey" FOREIGN KEY ("ballInCourtUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "PunchItemEvent" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "punchItemId" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "fromStatus" TEXT,
  "toStatus" TEXT,
  "reason" TEXT,
  "actorId" TEXT,
  "actorRole" TEXT,
  "metadataJson" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "PunchItemEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PunchItemEvent_orgId_idx" ON "PunchItemEvent"("orgId");
CREATE INDEX "PunchItemEvent_punchItemId_createdAt_idx" ON "PunchItemEvent"("punchItemId", "createdAt");
CREATE INDEX "PunchItemEvent_projectId_createdAt_idx" ON "PunchItemEvent"("projectId", "createdAt");

ALTER TABLE "PunchItemEvent" ADD CONSTRAINT "PunchItemEvent_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PunchItemEvent" ADD CONSTRAINT "PunchItemEvent_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PunchItemEvent" ADD CONSTRAINT "PunchItemEvent_punchItemId_fkey" FOREIGN KEY ("punchItemId") REFERENCES "PunchItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill from DefectRecord (numbering follows creation order per project).
INSERT INTO "PunchItem" (
  "id", "orgId", "projectId", "number", "ref", "title", "description", "status", "priority", "trade",
  "activityId", "locationText", "assigneeCompanyId", "assigneeUserId", "managerUserId", "finalApproverUserId",
  "ballInCourtUserId", "dueDate", "openedAt", "closedAt", "legacyDefectId", "createdAt", "updatedAt"
)
SELECT gen_random_uuid()::text,
       p."orgId",
       d."projectId",
       row_number() OVER (PARTITION BY d."projectId" ORDER BY d."createdAt", d."id"),
       'PL-' || lpad((row_number() OVER (PARTITION BY d."projectId" ORDER BY d."createdAt", d."id"))::text, 3, '0'),
       d."title",
       d."notes",
       CASE WHEN d."status" = 'closed' THEN 'closed' ELSE 'open' END,
       CASE d."severity" WHEN 'critical' THEN 'urgent' WHEN 'major' THEN 'high' ELSE 'normal' END,
       d."trade",
       d."activityId",
       d."location",
       d."assigneeCompanyId",
       d."assigneeUserId",
       d."ownerUserId",
       d."approverUserId",
       d."ballInCourtUserId",
       COALESCE(d."dueDate", d."targetCloseBy"),
       d."createdAt",
       d."closedDate",
       d."id",
       d."createdAt",
       NOW()
FROM "DefectRecord" d
JOIN "Project" p ON p."id" = d."projectId"
ON CONFLICT ("legacyDefectId") DO NOTHING;

INSERT INTO "PunchItemEvent" ("id", "orgId", "projectId", "punchItemId", "action", "toStatus", "metadataJson", "createdAt")
SELECT gen_random_uuid()::text, i."orgId", i."projectId", i."id", 'migrated', i."status",
       jsonb_build_object('legacyDefectId', i."legacyDefectId", 'legacyRef', d."ref"), i."createdAt"
FROM "PunchItem" i
JOIN "DefectRecord" d ON d."id" = i."legacyDefectId";

-- Carry the defect's linked data across to the punch item.
INSERT INTO "Attachment" ("id", "orgId", "projectId", "recordType", "recordId", "documentId", "role", "caption", "sortOrder", "source", "uploadedBy", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, a."orgId", a."projectId", 'punch_item', i."id", a."documentId", a."role", a."caption", a."sortOrder", 'migrated_defect', a."uploadedBy", a."createdAt", NOW()
FROM "Attachment" a
JOIN "PunchItem" i ON i."legacyDefectId" = a."recordId" AND a."recordType" = 'defect'
ON CONFLICT ("recordType", "recordId", "documentId") DO NOTHING;

UPDATE "Pin" pin SET "recordType" = 'punch_item', "recordId" = i."id"
FROM "PunchItem" i WHERE pin."recordType" = 'defect' AND pin."recordId" = i."legacyDefectId";

UPDATE "Comment" c SET "recordType" = 'punch_item', "recordId" = i."id"
FROM "PunchItem" i WHERE c."recordType" = 'defect' AND c."recordId" = i."legacyDefectId";

UPDATE "RecordSubscription" s SET "recordType" = 'punch_item', "recordId" = i."id"
FROM "PunchItem" i WHERE s."recordType" = 'defect' AND s."recordId" = i."legacyDefectId";

INSERT INTO "WorkflowActivityLink" ("id", "projectId", "recordType", "recordId", "activityId", "relationType", "scheduleImpactDays", "notes", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, l."projectId", 'punch_item', i."id", l."activityId", l."relationType", l."scheduleImpactDays", l."notes", l."createdAt", NOW()
FROM "WorkflowActivityLink" l
JOIN "PunchItem" i ON i."legacyDefectId" = l."recordId" AND l."recordType" = 'defect'
ON CONFLICT DO NOTHING;
