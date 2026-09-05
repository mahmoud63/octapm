-- OCTA-PM-RFI-016: RFI upgrade — manager, assignees and distribution lists,
-- spec section, location, cost / schedule impact flags, a response thread
-- with one official answer, revisions on reopen, change-order conversion.

ALTER TABLE "Rfi"
  ADD COLUMN "managerUserId" TEXT,
  ADD COLUMN "createdBy" TEXT,
  ADD COLUMN "specSection" TEXT,
  ADD COLUMN "locationId" TEXT,
  ADD COLUMN "costImpact" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "costImpactAmount" DECIMAL(18,2),
  ADD COLUMN "scheduleImpactFlag" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "officialResponseId" TEXT,
  ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "changeOrderId" TEXT,
  ADD COLUMN "distributedAt" TIMESTAMP(3);

CREATE INDEX "Rfi_managerUserId_idx" ON "Rfi"("managerUserId");
CREATE INDEX "Rfi_projectId_createdBy_idx" ON "Rfi"("projectId", "createdBy");
CREATE INDEX "Rfi_locationId_idx" ON "Rfi"("locationId");

ALTER TABLE "Rfi" ADD CONSTRAINT "Rfi_managerUserId_fkey" FOREIGN KEY ("managerUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Rfi" ADD CONSTRAINT "Rfi_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "RfiAssignee" (
  "id" TEXT NOT NULL,
  "rfiId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "role" TEXT NOT NULL DEFAULT 'assignee',
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "addedBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "RfiAssignee_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "RfiAssignee_rfiId_userId_role_key" ON "RfiAssignee"("rfiId", "userId", "role");
CREATE INDEX "RfiAssignee_userId_idx" ON "RfiAssignee"("userId");
ALTER TABLE "RfiAssignee" ADD CONSTRAINT "RfiAssignee_rfiId_fkey" FOREIGN KEY ("rfiId") REFERENCES "Rfi"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RfiAssignee" ADD CONSTRAINT "RfiAssignee_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "RfiResponse" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "rfiId" TEXT NOT NULL,
  "authorId" TEXT,
  "body" TEXT NOT NULL,
  "isOfficial" BOOLEAN NOT NULL DEFAULT false,
  "revision" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "RfiResponse_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "RfiResponse_rfiId_createdAt_idx" ON "RfiResponse"("rfiId", "createdAt");
CREATE INDEX "RfiResponse_projectId_idx" ON "RfiResponse"("projectId");
ALTER TABLE "RfiResponse" ADD CONSTRAINT "RfiResponse_rfiId_fkey" FOREIGN KEY ("rfiId") REFERENCES "Rfi"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RfiResponse" ADD CONSTRAINT "RfiResponse_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill: the single assignee becomes the first assignee row, and an
-- existing answer becomes the official response of revision 0.
INSERT INTO "RfiAssignee" ("id", "rfiId", "userId", "role", "sortOrder", "createdAt")
SELECT gen_random_uuid()::text, r."id", r."assigneeUserId", 'assignee', 0, r."createdAt"
FROM "Rfi" r
WHERE r."assigneeUserId" IS NOT NULL
ON CONFLICT ("rfiId", "userId", "role") DO NOTHING;

INSERT INTO "RfiResponse" ("id", "orgId", "projectId", "rfiId", "authorId", "body", "isOfficial", "revision", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text,
       p."orgId",
       r."projectId",
       r."id",
       CASE WHEN EXISTS (SELECT 1 FROM "User" u WHERE u."id" = r."answeredBy") THEN r."answeredBy" ELSE NULL END,
       r."response",
       true,
       0,
       COALESCE(r."answeredDate", r."updatedAt"),
       NOW()
FROM "Rfi" r
JOIN "Project" p ON p."id" = r."projectId"
WHERE r."response" IS NOT NULL AND btrim(r."response") <> '' AND r."status" IN ('answered', 'closed');

UPDATE "Rfi" r
SET "officialResponseId" = x."id"
FROM "RfiResponse" x
WHERE x."rfiId" = r."id" AND x."isOfficial" AND r."officialResponseId" IS NULL;

UPDATE "Rfi" SET "scheduleImpactFlag" = true WHERE "scheduleImpact" > 0;
