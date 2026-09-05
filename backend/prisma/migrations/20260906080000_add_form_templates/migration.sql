-- OCTA-QA-TEMPLATE-014: checklist / template engine for inspections, ITPs,
-- forms and toolbox talks. Every legacy ItpRecord becomes an instance of a
-- system "migrated" ITP template for its point type (hold points block
-- progress approval). Attachments, pins, comments, follows and activity links
-- move with it; ItpRecord stays readable.

CREATE TABLE "FormTemplate" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "projectId" TEXT,
  "sourceTemplateId" TEXT,
  "type" TEXT NOT NULL DEFAULT 'inspection',
  "name" TEXT NOT NULL,
  "description" TEXT,
  "trade" TEXT,
  "version" INTEGER NOT NULL DEFAULT 1,
  "status" TEXT NOT NULL DEFAULT 'active',
  "isSystem" BOOLEAN NOT NULL DEFAULT false,
  "settingsJson" JSONB NOT NULL DEFAULT '{}',
  "createdBy" TEXT,
  "updatedBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "FormTemplate_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "FormTemplate_orgId_projectId_type_status_idx" ON "FormTemplate"("orgId", "projectId", "type", "status");
CREATE INDEX "FormTemplate_projectId_status_idx" ON "FormTemplate"("projectId", "status");

ALTER TABLE "FormTemplate" ADD CONSTRAINT "FormTemplate_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FormTemplate" ADD CONSTRAINT "FormTemplate_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "FormSection" (
  "id" TEXT NOT NULL,
  "templateId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "description" TEXT,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,

  CONSTRAINT "FormSection_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "FormSection_templateId_sortOrder_idx" ON "FormSection"("templateId", "sortOrder");
ALTER TABLE "FormSection" ADD CONSTRAINT "FormSection_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "FormTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "FormItem" (
  "id" TEXT NOT NULL,
  "templateId" TEXT NOT NULL,
  "sectionId" TEXT NOT NULL,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "label" TEXT NOT NULL,
  "description" TEXT,
  "responseType" TEXT NOT NULL DEFAULT 'pass_fail',
  "required" BOOLEAN NOT NULL DEFAULT true,
  "photoRequired" BOOLEAN NOT NULL DEFAULT false,
  "isHoldPoint" BOOLEAN NOT NULL DEFAULT false,
  "inspectionPointType" TEXT,
  "optionsJson" JSONB,
  "reference" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "FormItem_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "FormItem_templateId_idx" ON "FormItem"("templateId");
CREATE INDEX "FormItem_sectionId_sortOrder_idx" ON "FormItem"("sectionId", "sortOrder");
ALTER TABLE "FormItem" ADD CONSTRAINT "FormItem_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "FormTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FormItem" ADD CONSTRAINT "FormItem_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "FormSection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "FormInstance" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "templateId" TEXT NOT NULL,
  "templateVersion" INTEGER NOT NULL DEFAULT 1,
  "number" INTEGER NOT NULL,
  "ref" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'scheduled',
  "outcome" TEXT,
  "activityId" TEXT,
  "locationId" TEXT,
  "sheetId" TEXT,
  "assigneeUserId" TEXT,
  "assigneeCompanyId" TEXT,
  "inspectorUserId" TEXT,
  "approverUserId" TEXT,
  "ballInCourtUserId" TEXT,
  "scheduledFor" TIMESTAMP(3),
  "dueDate" TIMESTAMP(3),
  "recurrenceJson" JSONB,
  "startedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "completedBy" TEXT,
  "closedAt" TIMESTAMP(3),
  "closedBy" TEXT,
  "reopenReason" TEXT,
  "summaryJson" JSONB,
  "clientRequestId" TEXT,
  "clientCreatedAt" TIMESTAMP(3),
  "deviceId" TEXT,
  "legacyItpId" TEXT,
  "createdBy" TEXT,
  "updatedBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "FormInstance_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "FormInstance_legacyItpId_key" ON "FormInstance"("legacyItpId");
CREATE UNIQUE INDEX "FormInstance_projectId_ref_key" ON "FormInstance"("projectId", "ref");
CREATE UNIQUE INDEX "FormInstance_projectId_clientRequestId_key" ON "FormInstance"("projectId", "clientRequestId");
CREATE INDEX "FormInstance_orgId_idx" ON "FormInstance"("orgId");
CREATE INDEX "FormInstance_projectId_status_idx" ON "FormInstance"("projectId", "status");
CREATE INDEX "FormInstance_projectId_type_status_idx" ON "FormInstance"("projectId", "type", "status");
CREATE INDEX "FormInstance_projectId_activityId_type_idx" ON "FormInstance"("projectId", "activityId", "type");
CREATE INDEX "FormInstance_projectId_scheduledFor_idx" ON "FormInstance"("projectId", "scheduledFor");
CREATE INDEX "FormInstance_templateId_idx" ON "FormInstance"("templateId");
CREATE INDEX "FormInstance_assigneeUserId_idx" ON "FormInstance"("assigneeUserId");
CREATE INDEX "FormInstance_ballInCourtUserId_idx" ON "FormInstance"("ballInCourtUserId");
CREATE INDEX "FormInstance_assigneeCompanyId_idx" ON "FormInstance"("assigneeCompanyId");

ALTER TABLE "FormInstance" ADD CONSTRAINT "FormInstance_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FormInstance" ADD CONSTRAINT "FormInstance_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FormInstance" ADD CONSTRAINT "FormInstance_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "FormTemplate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FormInstance" ADD CONSTRAINT "FormInstance_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "Activity"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "FormInstance" ADD CONSTRAINT "FormInstance_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "FormInstance" ADD CONSTRAINT "FormInstance_sheetId_fkey" FOREIGN KEY ("sheetId") REFERENCES "Sheet"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "FormInstance" ADD CONSTRAINT "FormInstance_assigneeUserId_fkey" FOREIGN KEY ("assigneeUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "FormInstance" ADD CONSTRAINT "FormInstance_assigneeCompanyId_fkey" FOREIGN KEY ("assigneeCompanyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "FormInstance" ADD CONSTRAINT "FormInstance_inspectorUserId_fkey" FOREIGN KEY ("inspectorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "FormInstance" ADD CONSTRAINT "FormInstance_approverUserId_fkey" FOREIGN KEY ("approverUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "FormInstance" ADD CONSTRAINT "FormInstance_ballInCourtUserId_fkey" FOREIGN KEY ("ballInCourtUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "FormItemResponse" (
  "id" TEXT NOT NULL,
  "instanceId" TEXT NOT NULL,
  "itemId" TEXT NOT NULL,
  "value" TEXT,
  "numberValue" DOUBLE PRECISION,
  "note" TEXT,
  "isDeficient" BOOLEAN NOT NULL DEFAULT false,
  "deficiencyRecordType" TEXT,
  "deficiencyRecordId" TEXT,
  "answeredBy" TEXT,
  "answeredAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "FormItemResponse_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "FormItemResponse_instanceId_itemId_key" ON "FormItemResponse"("instanceId", "itemId");
CREATE INDEX "FormItemResponse_itemId_idx" ON "FormItemResponse"("itemId");
CREATE INDEX "FormItemResponse_deficiencyRecordType_deficiencyRecordId_idx" ON "FormItemResponse"("deficiencyRecordType", "deficiencyRecordId");
ALTER TABLE "FormItemResponse" ADD CONSTRAINT "FormItemResponse_instanceId_fkey" FOREIGN KEY ("instanceId") REFERENCES "FormInstance"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FormItemResponse" ADD CONSTRAINT "FormItemResponse_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "FormItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "Signature" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "recordType" TEXT NOT NULL DEFAULT 'form_instance',
  "recordId" TEXT NOT NULL,
  "instanceId" TEXT,
  "itemId" TEXT,
  "role" TEXT NOT NULL,
  "userId" TEXT,
  "signerName" TEXT NOT NULL,
  "signerCompany" TEXT,
  "documentId" TEXT,
  "signedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "ipAddress" TEXT,
  "userAgent" TEXT,

  CONSTRAINT "Signature_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Signature_recordType_recordId_idx" ON "Signature"("recordType", "recordId");
CREATE INDEX "Signature_projectId_idx" ON "Signature"("projectId");
CREATE INDEX "Signature_instanceId_idx" ON "Signature"("instanceId");
ALTER TABLE "Signature" ADD CONSTRAINT "Signature_instanceId_fkey" FOREIGN KEY ("instanceId") REFERENCES "FormInstance"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Signature" ADD CONSTRAINT "Signature_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "FormItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Signature" ADD CONSTRAINT "Signature_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Signature" ADD CONSTRAINT "Signature_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "ProjectDocument"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ─── Legacy ITP register → instances of a system template per point type ───
INSERT INTO "FormTemplate" ("id", "orgId", "projectId", "type", "name", "description", "version", "status", "isSystem", "settingsJson", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text,
       p."orgId",
       x."projectId",
       'itp',
       CASE x."pointType" WHEN 'hold' THEN 'ITP hold point (migrated)' WHEN 'witness' THEN 'ITP witness point (migrated)' ELSE 'ITP review point (migrated)' END,
       'Created automatically from the legacy inspection & test plan register.',
       1, 'active', true,
       jsonb_build_object('requireSignatures', '[]'::jsonb, 'legacyPointType', x."pointType"),
       NOW(), NOW()
FROM (SELECT DISTINCT "projectId", COALESCE("pointType", 'hold') AS "pointType" FROM "ItpRecord") x
JOIN "Project" p ON p."id" = x."projectId";

INSERT INTO "FormSection" ("id", "templateId", "title", "sortOrder")
SELECT gen_random_uuid()::text, t."id", 'Inspection point', 0
FROM "FormTemplate" t
WHERE t."isSystem" AND t."settingsJson" ? 'legacyPointType';

INSERT INTO "FormItem" ("id", "templateId", "sectionId", "sortOrder", "label", "responseType", "required", "photoRequired", "isHoldPoint", "inspectionPointType", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, s."templateId", s."id", 0, 'Inspection point result', 'pass_fail', true, false,
       (t."settingsJson"->>'legacyPointType') = 'hold',
       t."settingsJson"->>'legacyPointType',
       NOW(), NOW()
FROM "FormSection" s
JOIN "FormTemplate" t ON t."id" = s."templateId"
WHERE t."isSystem" AND t."settingsJson" ? 'legacyPointType';

INSERT INTO "FormInstance" (
  "id", "orgId", "projectId", "templateId", "templateVersion", "number", "ref", "type", "title", "status", "outcome",
  "activityId", "assigneeUserId", "assigneeCompanyId", "inspectorUserId", "approverUserId", "ballInCourtUserId",
  "scheduledFor", "dueDate", "startedAt", "completedAt", "legacyItpId", "createdAt", "updatedAt"
)
SELECT gen_random_uuid()::text,
       t."orgId",
       r."projectId",
       t."id",
       1,
       row_number() OVER (PARTITION BY r."projectId" ORDER BY r."createdAt", r."id"),
       r."ref",
       'itp',
       r."title",
       CASE WHEN r."status" = 'pending' THEN 'scheduled' ELSE 'complete' END,
       CASE r."status" WHEN 'passed' THEN 'pass' WHEN 'waived' THEN 'pass' WHEN 'failed' THEN 'fail' ELSE NULL END,
       r."activityId",
       r."assigneeUserId",
       r."assigneeCompanyId",
       r."assigneeUserId",
       r."approverUserId",
       r."ballInCourtUserId",
       r."inspectionDate",
       r."dueDate",
       CASE WHEN r."status" <> 'pending' THEN r."createdAt" END,
       CASE WHEN r."status" <> 'pending' THEN r."updatedAt" END,
       r."id",
       r."createdAt",
       NOW()
FROM "ItpRecord" r
JOIN "FormTemplate" t
  ON t."projectId" = r."projectId" AND t."isSystem" AND t."settingsJson"->>'legacyPointType' = COALESCE(r."pointType", 'hold')
ON CONFLICT ("legacyItpId") DO NOTHING;

INSERT INTO "FormItemResponse" ("id", "instanceId", "itemId", "value", "isDeficient", "note", "answeredAt", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, i."id", fi."id",
       CASE r."status" WHEN 'passed' THEN 'pass' WHEN 'failed' THEN 'fail' WHEN 'waived' THEN 'na' END,
       r."status" = 'failed',
       r."notes",
       COALESCE(r."inspectionDate", r."updatedAt"),
       NOW(), NOW()
FROM "FormInstance" i
JOIN "ItpRecord" r ON r."id" = i."legacyItpId"
JOIN "FormItem" fi ON fi."templateId" = i."templateId"
WHERE r."status" <> 'pending'
ON CONFLICT ("instanceId", "itemId") DO NOTHING;

UPDATE "FormInstance" i
SET "summaryJson" = jsonb_build_object(
  'total', 1,
  'required', 1,
  'answered', CASE WHEN i."status" = 'complete' THEN 1 ELSE 0 END,
  'passed', CASE WHEN i."outcome" = 'pass' THEN 1 ELSE 0 END,
  'failed', CASE WHEN i."outcome" = 'fail' THEN 1 ELSE 0 END,
  'na', 0,
  'deficient', CASE WHEN i."outcome" = 'fail' THEN 1 ELSE 0 END,
  'holdPointsOpen', CASE
    WHEN i."outcome" = 'pass' THEN 0
    WHEN EXISTS (SELECT 1 FROM "FormItem" fi WHERE fi."templateId" = i."templateId" AND fi."isHoldPoint") THEN 1
    ELSE 0 END
)
WHERE i."legacyItpId" IS NOT NULL;

-- Carry the ITP's linked data across to the instance.
INSERT INTO "Attachment" ("id", "orgId", "projectId", "recordType", "recordId", "documentId", "role", "caption", "sortOrder", "source", "uploadedBy", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, a."orgId", a."projectId", 'form_instance', i."id", a."documentId", a."role", a."caption", a."sortOrder", 'migrated_itp', a."uploadedBy", a."createdAt", NOW()
FROM "Attachment" a
JOIN "FormInstance" i ON i."legacyItpId" = a."recordId" AND a."recordType" = 'itp'
ON CONFLICT ("recordType", "recordId", "documentId") DO NOTHING;

UPDATE "Pin" pin SET "recordType" = 'form_instance', "recordId" = i."id"
FROM "FormInstance" i WHERE pin."recordType" = 'itp' AND pin."recordId" = i."legacyItpId";

UPDATE "Comment" c SET "recordType" = 'form_instance', "recordId" = i."id"
FROM "FormInstance" i WHERE c."recordType" = 'itp' AND c."recordId" = i."legacyItpId";

UPDATE "RecordSubscription" s SET "recordType" = 'form_instance', "recordId" = i."id"
FROM "FormInstance" i WHERE s."recordType" = 'itp' AND s."recordId" = i."legacyItpId";

INSERT INTO "WorkflowActivityLink" ("id", "projectId", "recordType", "recordId", "activityId", "relationType", "scheduleImpactDays", "notes", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, l."projectId", 'form_instance', i."id", l."activityId", l."relationType", l."scheduleImpactDays", l."notes", l."createdAt", NOW()
FROM "WorkflowActivityLink" l
JOIN "FormInstance" i ON i."legacyItpId" = l."recordId" AND l."recordType" = 'itp'
ON CONFLICT DO NOTHING;
