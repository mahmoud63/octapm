-- OCTA-PLAT-FIELDS-025: custom fields, fieldsets, record types and values.

CREATE TABLE "CustomFieldDefinition" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "projectId" TEXT,
  "recordType" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "description" TEXT,
  "type" TEXT NOT NULL,
  "optionsJson" JSONB,
  "required" BOOLEAN NOT NULL DEFAULT false,
  "hidden" BOOLEAN NOT NULL DEFAULT false,
  "defaultJson" JSONB,
  "validationJson" JSONB,
  "conditionJson" JSONB,
  "position" INTEGER NOT NULL DEFAULT 0,
  "status" TEXT NOT NULL DEFAULT 'active',
  "createdBy" TEXT,
  "updatedBy" TEXT,
  "archivedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CustomFieldDefinition_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CustomFieldDefinition_orgId_recordType_key_key" ON "CustomFieldDefinition"("orgId", "recordType", "key");
CREATE INDEX "CustomFieldDefinition_orgId_recordType_status_idx" ON "CustomFieldDefinition"("orgId", "recordType", "status");
CREATE INDEX "CustomFieldDefinition_projectId_idx" ON "CustomFieldDefinition"("projectId");

ALTER TABLE "CustomFieldDefinition"
  ADD CONSTRAINT "CustomFieldDefinition_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "CustomFieldDefinition_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "CustomFieldset" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "recordType" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "isDefault" BOOLEAN NOT NULL DEFAULT false,
  "fieldsJson" JSONB NOT NULL DEFAULT '[]',
  "status" TEXT NOT NULL DEFAULT 'active',
  "createdBy" TEXT,
  "updatedBy" TEXT,
  "archivedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CustomFieldset_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CustomFieldset_orgId_recordType_status_idx" ON "CustomFieldset"("orgId", "recordType", "status");

ALTER TABLE "CustomFieldset"
  ADD CONSTRAINT "CustomFieldset_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "ProjectFieldset" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "recordType" TEXT NOT NULL,
  "fieldsetId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ProjectFieldset_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ProjectFieldset_projectId_recordType_key" ON "ProjectFieldset"("projectId", "recordType");
CREATE INDEX "ProjectFieldset_fieldsetId_idx" ON "ProjectFieldset"("fieldsetId");

ALTER TABLE "ProjectFieldset"
  ADD CONSTRAINT "ProjectFieldset_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "ProjectFieldset_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "ProjectFieldset_fieldsetId_fkey" FOREIGN KEY ("fieldsetId") REFERENCES "CustomFieldset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "RecordTypeDefinition" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "tool" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "description" TEXT,
  "fieldsetId" TEXT,
  "settingsJson" JSONB,
  "position" INTEGER NOT NULL DEFAULT 0,
  "status" TEXT NOT NULL DEFAULT 'active',
  "createdBy" TEXT,
  "updatedBy" TEXT,
  "archivedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "RecordTypeDefinition_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "RecordTypeDefinition_orgId_tool_key_key" ON "RecordTypeDefinition"("orgId", "tool", "key");
CREATE INDEX "RecordTypeDefinition_orgId_tool_status_idx" ON "RecordTypeDefinition"("orgId", "tool", "status");

ALTER TABLE "RecordTypeDefinition"
  ADD CONSTRAINT "RecordTypeDefinition_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "RecordTypeDefinition_fieldsetId_fkey" FOREIGN KEY ("fieldsetId") REFERENCES "CustomFieldset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "CustomFieldValue" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "recordType" TEXT NOT NULL,
  "recordId" TEXT NOT NULL,
  "fieldId" TEXT NOT NULL,
  "valueJson" JSONB,
  "updatedBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CustomFieldValue_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CustomFieldValue_recordId_fieldId_key" ON "CustomFieldValue"("recordId", "fieldId");
CREATE INDEX "CustomFieldValue_projectId_recordType_idx" ON "CustomFieldValue"("projectId", "recordType");
CREATE INDEX "CustomFieldValue_orgId_recordType_recordId_idx" ON "CustomFieldValue"("orgId", "recordType", "recordId");
CREATE INDEX "CustomFieldValue_valueJson_idx" ON "CustomFieldValue" USING GIN ("valueJson" jsonb_path_ops);

ALTER TABLE "CustomFieldValue"
  ADD CONSTRAINT "CustomFieldValue_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "CustomFieldValue_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "CustomFieldValue_fieldId_fkey" FOREIGN KEY ("fieldId") REFERENCES "CustomFieldDefinition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Correspondence" ADD COLUMN "recordTypeKey" TEXT;
