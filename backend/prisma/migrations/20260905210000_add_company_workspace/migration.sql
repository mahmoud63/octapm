-- OCTA-ADM-COMPANY-007: company workspace masters.
-- Vendor profile on Company (suppliers defined once), org-level cost codes and
-- equipment masters, project templates, and links from project-level records.

ALTER TABLE "Company" ADD COLUMN "contactName" TEXT;
ALTER TABLE "Company" ADD COLUMN "isVendor" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Company" ADD COLUMN "trades" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "Company" ADD COLUMN "vendorProfileJson" JSONB NOT NULL DEFAULT '{}';
CREATE INDEX "Company_orgId_isVendor_idx" ON "Company"("orgId", "isVendor");

ALTER TABLE "ProcurementSupplier" ADD COLUMN "companyId" TEXT;
CREATE INDEX "ProcurementSupplier_companyId_idx" ON "ProcurementSupplier"("companyId");
ALTER TABLE "ProcurementSupplier"
  ADD CONSTRAINT "ProcurementSupplier_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "CostCode" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "category" TEXT NOT NULL DEFAULT 'other',
  "parentId" TEXT,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "status" TEXT NOT NULL DEFAULT 'active',
  "createdBy" TEXT,
  "updatedBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CostCode_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CostCode_orgId_code_key" ON "CostCode"("orgId", "code");
CREATE INDEX "CostCode_orgId_status_idx" ON "CostCode"("orgId", "status");
CREATE INDEX "CostCode_parentId_idx" ON "CostCode"("parentId");
ALTER TABLE "CostCode"
  ADD CONSTRAINT "CostCode_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CostCode"
  ADD CONSTRAINT "CostCode_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "CostCode"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "CompanyEquipment" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "category" TEXT,
  "rateType" TEXT NOT NULL DEFAULT 'daily',
  "rate" DECIMAL(18,2) NOT NULL DEFAULT 0,
  "notes" TEXT,
  "status" TEXT NOT NULL DEFAULT 'active',
  "createdBy" TEXT,
  "updatedBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CompanyEquipment_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CompanyEquipment_orgId_name_key" ON "CompanyEquipment"("orgId", "name");
CREATE INDEX "CompanyEquipment_orgId_status_idx" ON "CompanyEquipment"("orgId", "status");
ALTER TABLE "CompanyEquipment"
  ADD CONSTRAINT "CompanyEquipment_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Equipment" ADD COLUMN "companyEquipmentId" TEXT;
CREATE INDEX "Equipment_companyEquipmentId_idx" ON "Equipment"("companyEquipmentId");
ALTER TABLE "Equipment"
  ADD CONSTRAINT "Equipment_companyEquipmentId_fkey" FOREIGN KEY ("companyEquipmentId") REFERENCES "CompanyEquipment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "ProjectTemplate" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "settingsJson" JSONB NOT NULL DEFAULT '{}',
  "partiesJson" JSONB NOT NULL DEFAULT '[]',
  "foldersJson" JSONB NOT NULL DEFAULT '[]',
  "locationsJson" JSONB NOT NULL DEFAULT '[]',
  "assignmentsJson" JSONB NOT NULL DEFAULT '[]',
  "isDefault" BOOLEAN NOT NULL DEFAULT false,
  "status" TEXT NOT NULL DEFAULT 'active',
  "createdBy" TEXT,
  "updatedBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ProjectTemplate_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ProjectTemplate_orgId_name_key" ON "ProjectTemplate"("orgId", "name");
CREATE INDEX "ProjectTemplate_orgId_status_idx" ON "ProjectTemplate"("orgId", "status");
ALTER TABLE "ProjectTemplate"
  ADD CONSTRAINT "ProjectTemplate_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Project" ADD COLUMN "templateId" TEXT;
ALTER TABLE "Project" ADD COLUMN "documentFoldersJson" JSONB NOT NULL DEFAULT '[]';
CREATE INDEX "Project_templateId_idx" ON "Project"("templateId");
ALTER TABLE "Project"
  ADD CONSTRAINT "Project_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "ProjectTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Migrate project suppliers to org-level vendors (one Company per organisation
-- and supplier name, case-insensitive). Suppliers keep their project rows and
-- gain a companyId; the de-duplication report is served by the API.
INSERT INTO "Company" ("id", "orgId", "name", "contactName", "email", "phone", "address", "type", "isVendor", "trades", "vendorProfileJson", "status", "createdAt", "updatedAt")
SELECT gen_random_uuid(), grouped."orgId", grouped."name", grouped."contactName", grouped."email", grouped."phone", grouped."address",
       'vendor', true, ARRAY[]::TEXT[], '{}'::jsonb, 'active', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM (
  SELECT p."orgId",
         (array_agg(s."name" ORDER BY s."createdAt"))[1] AS "name",
         (array_agg(s."contactName" ORDER BY s."createdAt"))[1] AS "contactName",
         (array_agg(s."email" ORDER BY s."createdAt"))[1] AS "email",
         (array_agg(s."phone" ORDER BY s."createdAt"))[1] AS "phone",
         (array_agg(s."address" ORDER BY s."createdAt"))[1] AS "address"
  FROM "ProcurementSupplier" s
  JOIN "Project" p ON p."id" = s."projectId"
  GROUP BY p."orgId", lower(btrim(s."name"))
) AS grouped
WHERE NOT EXISTS (
  SELECT 1 FROM "Company" c WHERE c."orgId" = grouped."orgId" AND lower(btrim(c."name")) = lower(btrim(grouped."name"))
);

UPDATE "Company" c SET "isVendor" = true
WHERE EXISTS (
  SELECT 1 FROM "ProcurementSupplier" s JOIN "Project" p ON p."id" = s."projectId"
  WHERE p."orgId" = c."orgId" AND lower(btrim(s."name")) = lower(btrim(c."name"))
);

UPDATE "ProcurementSupplier" s SET "companyId" = c."id"
FROM "Project" p, "Company" c
WHERE p."id" = s."projectId" AND c."orgId" = p."orgId"
  AND lower(btrim(c."name")) = lower(btrim(s."name"))
  AND s."companyId" IS NULL;

UPDATE "Company" c SET "trades" = sub."trades"
FROM (
  SELECT s."companyId" AS id, array_agg(DISTINCT elem) AS "trades"
  FROM "ProcurementSupplier" s
  CROSS JOIN LATERAL jsonb_array_elements_text(
    CASE WHEN jsonb_typeof(s."tradeCategories") = 'array' THEN s."tradeCategories" ELSE '[]'::jsonb END
  ) AS elem
  WHERE s."companyId" IS NOT NULL
  GROUP BY s."companyId"
) AS sub
WHERE sub.id = c."id";

-- Equipment masters from distinct project equipment names.
INSERT INTO "CompanyEquipment" ("id", "orgId", "name", "rateType", "rate", "status", "createdAt", "updatedAt")
SELECT gen_random_uuid(), p."orgId", (array_agg(e."name" ORDER BY e."createdAt"))[1],
       (array_agg(e."rateType" ORDER BY e."createdAt"))[1], max(e."rate"), 'active', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "Equipment" e
JOIN "Project" p ON p."id" = e."projectId"
GROUP BY p."orgId", lower(btrim(e."name"))
ON CONFLICT ("orgId", "name") DO NOTHING;

UPDATE "Equipment" e SET "companyEquipmentId" = ce."id"
FROM "Project" p, "CompanyEquipment" ce
WHERE p."id" = e."projectId" AND ce."orgId" = p."orgId"
  AND lower(btrim(ce."name")) = lower(btrim(e."name"))
  AND e."companyEquipmentId" IS NULL;
