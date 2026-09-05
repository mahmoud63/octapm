-- Permission templates: per-tool levels (none / read_only / standard / admin) plus
-- granular grants, assignable per user per project, with company admins.

ALTER TABLE "User" ADD COLUMN "isCompanyAdmin" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "PermissionTemplate" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "kind" TEXT NOT NULL DEFAULT 'internal',
  "clientType" TEXT,
  "baseRole" TEXT,
  "basePartyRole" TEXT,
  "isDefault" BOOLEAN NOT NULL DEFAULT false,
  "isSystem" BOOLEAN NOT NULL DEFAULT false,
  "status" TEXT NOT NULL DEFAULT 'active',
  "createdBy" TEXT,
  "updatedBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "PermissionTemplate_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PermissionTemplate_orgId_name_key" ON "PermissionTemplate"("orgId", "name");
CREATE INDEX "PermissionTemplate_orgId_status_idx" ON "PermissionTemplate"("orgId", "status");
CREATE INDEX "PermissionTemplate_orgId_kind_clientType_idx" ON "PermissionTemplate"("orgId", "kind", "clientType");

ALTER TABLE "PermissionTemplate"
  ADD CONSTRAINT "PermissionTemplate_orgId_fkey"
  FOREIGN KEY ("orgId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "PermissionTemplateTool" (
  "id" TEXT NOT NULL,
  "templateId" TEXT NOT NULL,
  "module" TEXT NOT NULL,
  "level" TEXT NOT NULL DEFAULT 'standard',

  CONSTRAINT "PermissionTemplateTool_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PermissionTemplateTool_templateId_module_key" ON "PermissionTemplateTool"("templateId", "module");
CREATE INDEX "PermissionTemplateTool_templateId_idx" ON "PermissionTemplateTool"("templateId");

ALTER TABLE "PermissionTemplateTool"
  ADD CONSTRAINT "PermissionTemplateTool_templateId_fkey"
  FOREIGN KEY ("templateId") REFERENCES "PermissionTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "PermissionTemplateGrant" (
  "id" TEXT NOT NULL,
  "templateId" TEXT NOT NULL,
  "module" TEXT NOT NULL,
  "action" TEXT,
  "transition" TEXT,
  "key" TEXT NOT NULL,

  CONSTRAINT "PermissionTemplateGrant_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PermissionTemplateGrant_templateId_key_key" ON "PermissionTemplateGrant"("templateId", "key");
CREATE INDEX "PermissionTemplateGrant_templateId_idx" ON "PermissionTemplateGrant"("templateId");

ALTER TABLE "PermissionTemplateGrant"
  ADD CONSTRAINT "PermissionTemplateGrant_templateId_fkey"
  FOREIGN KEY ("templateId") REFERENCES "PermissionTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "ProjectUserPermission" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "templateId" TEXT,
  "overridesJson" JSONB NOT NULL DEFAULT '{}',
  "assignedBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ProjectUserPermission_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ProjectUserPermission_projectId_userId_key" ON "ProjectUserPermission"("projectId", "userId");
CREATE INDEX "ProjectUserPermission_orgId_idx" ON "ProjectUserPermission"("orgId");
CREATE INDEX "ProjectUserPermission_userId_idx" ON "ProjectUserPermission"("userId");
CREATE INDEX "ProjectUserPermission_templateId_idx" ON "ProjectUserPermission"("templateId");

ALTER TABLE "ProjectUserPermission"
  ADD CONSTRAINT "ProjectUserPermission_orgId_fkey"
  FOREIGN KEY ("orgId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProjectUserPermission"
  ADD CONSTRAINT "ProjectUserPermission_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProjectUserPermission"
  ADD CONSTRAINT "ProjectUserPermission_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProjectUserPermission"
  ADD CONSTRAINT "ProjectUserPermission_templateId_fkey"
  FOREIGN KEY ("templateId") REFERENCES "PermissionTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ProjectParty" ADD COLUMN "permissionTemplateId" TEXT;
CREATE INDEX "ProjectParty_permissionTemplateId_idx" ON "ProjectParty"("permissionTemplateId");
ALTER TABLE "ProjectParty"
  ADD CONSTRAINT "ProjectParty_permissionTemplateId_fkey"
  FOREIGN KEY ("permissionTemplateId") REFERENCES "PermissionTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Seed the twelve system default templates for every existing organisation.
-- A template without tool rows inherits its base role/party policy exactly, so
-- these reproduce today's eight internal roles and four party profiles.
INSERT INTO "PermissionTemplate" ("id", "orgId", "name", "description", "kind", "clientType", "baseRole", "basePartyRole", "isDefault", "isSystem", "status", "createdAt", "updatedAt")
SELECT gen_random_uuid(), o."id", t."name", t."description", t."kind", t."clientType", t."baseRole", t."basePartyRole", true, true, 'active', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "Organisation" o
CROSS JOIN (
  VALUES
    ('Project Manager - Internal', 'Full project administration for the company''s own project managers.', 'internal', 'gc', 'pm', NULL),
    ('Planning Engineer - Internal', 'Schedule ownership, progress review, imports, and risk register.', 'internal', 'gc', 'planning_eng', NULL),
    ('Quantity Surveyor - Internal', 'BOQ, allocations, valuations, IPC preparation, and change orders.', 'internal', 'gc', 'qs', NULL),
    ('Cost Controller - Internal', 'Cost records, earned value, and exports.', 'internal', 'gc', 'cost_controller', NULL),
    ('Procurement - Internal', 'Suppliers, packages, purchase orders, and lead-time alerts.', 'internal', 'gc', 'procurement', NULL),
    ('Warehouse - Internal', 'Delivery receipts, material issue, and usage.', 'internal', 'gc', 'warehouse', NULL),
    ('Site Engineer - Internal', 'Daily reports, progress submissions, RFIs, submittals, NCRs, and safety.', 'internal', 'gc', 'site_engineer', NULL),
    ('Finance - Internal', 'IPC certification, invoices, payments, retention, and cost approvals.', 'internal', 'gc', 'finance', NULL),
    ('Owner / Client - External', 'Read access to progress, commercial, and documents; answers routed RFIs.', 'external', 'owner', NULL, 'owner'),
    ('Consultant - External', 'Reviews submittals, answers RFIs, uploads document revisions, chairs meetings.', 'external', 'consultant', NULL, 'consultant'),
    ('Contractor - External', 'Submits progress, daily reports, RFIs, submittals, and documents.', 'external', 'gc', NULL, 'contractor'),
    ('Subcontractor - External', 'Submits progress, daily reports, RFIs, submittals, and documents for its own scope.', 'external', 'subcontractor', NULL, 'subcontractor')
) AS t("name", "description", "kind", "clientType", "baseRole", "basePartyRole")
ON CONFLICT ("orgId", "name") DO NOTHING;
