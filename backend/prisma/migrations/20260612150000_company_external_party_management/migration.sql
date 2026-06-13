-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "ProjectPartyRole" AS ENUM ('owner', 'consultant', 'contractor', 'subcontractor');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- CreateTable
CREATE TABLE "Company" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "legalName" TEXT,
  "tradeName" TEXT,
  "registrationNumber" TEXT,
  "taxNumber" TEXT,
  "type" TEXT NOT NULL DEFAULT 'external',
  "email" TEXT,
  "phone" TEXT,
  "website" TEXT,
  "address" TEXT,
  "status" TEXT NOT NULL DEFAULT 'active',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "Company_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompanyMembership" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "role" TEXT NOT NULL DEFAULT 'member',
  "status" TEXT NOT NULL DEFAULT 'active',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "CompanyMembership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectParty" (
  "id" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "role" "ProjectPartyRole" NOT NULL,
  "contactName" TEXT,
  "contactEmail" TEXT,
  "contactPhone" TEXT,
  "accessLevel" TEXT NOT NULL DEFAULT 'collaborator',
  "permissionProfile" TEXT,
  "permissionsJson" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "status" TEXT NOT NULL DEFAULT 'active',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ProjectParty_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectPartyMember" (
  "id" TEXT NOT NULL,
  "projectPartyId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "companyMembershipId" TEXT,
  "role" TEXT NOT NULL DEFAULT 'member',
  "status" TEXT NOT NULL DEFAULT 'active',
  "invitedAt" TIMESTAMP(3),
  "acceptedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ProjectPartyMember_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "InvitationToken"
  ADD COLUMN "companyId" TEXT,
  ADD COLUMN "projectPartyId" TEXT;

ALTER TABLE "Rfi"
  ADD COLUMN "ownerPartyId" TEXT,
  ADD COLUMN "reviewerPartyId" TEXT,
  ADD COLUMN "approverPartyId" TEXT;

ALTER TABLE "Submittal"
  ADD COLUMN "ownerPartyId" TEXT,
  ADD COLUMN "reviewerPartyId" TEXT,
  ADD COLUMN "approverPartyId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Company_orgId_name_key" ON "Company"("orgId", "name");
CREATE INDEX "Company_orgId_idx" ON "Company"("orgId");
CREATE INDEX "Company_orgId_status_idx" ON "Company"("orgId", "status");

CREATE UNIQUE INDEX "CompanyMembership_companyId_userId_key" ON "CompanyMembership"("companyId", "userId");
CREATE INDEX "CompanyMembership_orgId_idx" ON "CompanyMembership"("orgId");
CREATE INDEX "CompanyMembership_orgId_userId_idx" ON "CompanyMembership"("orgId", "userId");
CREATE INDEX "CompanyMembership_companyId_idx" ON "CompanyMembership"("companyId");
CREATE INDEX "CompanyMembership_userId_idx" ON "CompanyMembership"("userId");

CREATE UNIQUE INDEX "ProjectParty_projectId_companyId_role_key" ON "ProjectParty"("projectId", "companyId", "role");
CREATE INDEX "ProjectParty_projectId_idx" ON "ProjectParty"("projectId");
CREATE INDEX "ProjectParty_projectId_role_idx" ON "ProjectParty"("projectId", "role");
CREATE INDEX "ProjectParty_companyId_idx" ON "ProjectParty"("companyId");
CREATE INDEX "ProjectParty_status_idx" ON "ProjectParty"("status");

CREATE UNIQUE INDEX "ProjectPartyMember_projectPartyId_userId_key" ON "ProjectPartyMember"("projectPartyId", "userId");
CREATE INDEX "ProjectPartyMember_userId_projectPartyId_idx" ON "ProjectPartyMember"("userId", "projectPartyId");
CREATE INDEX "ProjectPartyMember_companyMembershipId_idx" ON "ProjectPartyMember"("companyMembershipId");
CREATE INDEX "ProjectPartyMember_status_idx" ON "ProjectPartyMember"("status");

CREATE INDEX "InvitationToken_companyId_idx" ON "InvitationToken"("companyId");
CREATE INDEX "InvitationToken_projectPartyId_idx" ON "InvitationToken"("projectPartyId");

CREATE INDEX "Rfi_ownerPartyId_idx" ON "Rfi"("ownerPartyId");
CREATE INDEX "Rfi_reviewerPartyId_idx" ON "Rfi"("reviewerPartyId");
CREATE INDEX "Rfi_approverPartyId_idx" ON "Rfi"("approverPartyId");

CREATE INDEX "Submittal_ownerPartyId_idx" ON "Submittal"("ownerPartyId");
CREATE INDEX "Submittal_reviewerPartyId_idx" ON "Submittal"("reviewerPartyId");
CREATE INDEX "Submittal_approverPartyId_idx" ON "Submittal"("approverPartyId");

-- AddForeignKey
ALTER TABLE "Company" ADD CONSTRAINT "Company_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CompanyMembership" ADD CONSTRAINT "CompanyMembership_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CompanyMembership" ADD CONSTRAINT "CompanyMembership_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CompanyMembership" ADD CONSTRAINT "CompanyMembership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ProjectParty" ADD CONSTRAINT "ProjectParty_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProjectParty" ADD CONSTRAINT "ProjectParty_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ProjectPartyMember" ADD CONSTRAINT "ProjectPartyMember_projectPartyId_fkey" FOREIGN KEY ("projectPartyId") REFERENCES "ProjectParty"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProjectPartyMember" ADD CONSTRAINT "ProjectPartyMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProjectPartyMember" ADD CONSTRAINT "ProjectPartyMember_companyMembershipId_fkey" FOREIGN KEY ("companyMembershipId") REFERENCES "CompanyMembership"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "InvitationToken" ADD CONSTRAINT "InvitationToken_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "InvitationToken" ADD CONSTRAINT "InvitationToken_projectPartyId_fkey" FOREIGN KEY ("projectPartyId") REFERENCES "ProjectParty"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Rfi" ADD CONSTRAINT "Rfi_ownerPartyId_fkey" FOREIGN KEY ("ownerPartyId") REFERENCES "ProjectParty"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Rfi" ADD CONSTRAINT "Rfi_reviewerPartyId_fkey" FOREIGN KEY ("reviewerPartyId") REFERENCES "ProjectParty"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Rfi" ADD CONSTRAINT "Rfi_approverPartyId_fkey" FOREIGN KEY ("approverPartyId") REFERENCES "ProjectParty"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Submittal" ADD CONSTRAINT "Submittal_ownerPartyId_fkey" FOREIGN KEY ("ownerPartyId") REFERENCES "ProjectParty"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Submittal" ADD CONSTRAINT "Submittal_reviewerPartyId_fkey" FOREIGN KEY ("reviewerPartyId") REFERENCES "ProjectParty"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Submittal" ADD CONSTRAINT "Submittal_approverPartyId_fkey" FOREIGN KEY ("approverPartyId") REFERENCES "ProjectParty"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill legacy project text parties into company-backed project parties.
WITH legacy_parties AS (
  SELECT "id" AS "projectId", "orgId", 'owner'::"ProjectPartyRole" AS "role", btrim("clientName") AS "name"
  FROM "Project"
  WHERE btrim(COALESCE("clientName", '')) <> ''
  UNION ALL
  SELECT "id" AS "projectId", "orgId", 'consultant'::"ProjectPartyRole" AS "role", btrim("consultantName") AS "name"
  FROM "Project"
  WHERE btrim(COALESCE("consultantName", '')) <> ''
  UNION ALL
  SELECT "id" AS "projectId", "orgId", 'contractor'::"ProjectPartyRole" AS "role", btrim("contractorName") AS "name"
  FROM "Project"
  WHERE btrim(COALESCE("contractorName", '')) <> ''
),
company_seeds AS (
  SELECT DISTINCT "orgId", "name"
  FROM legacy_parties
),
company_ids AS (
  SELECT
    "orgId",
    "name",
    (
      substr(md5('company:' || "orgId" || ':' || lower("name")), 1, 8) || '-' ||
      substr(md5('company:' || "orgId" || ':' || lower("name")), 9, 4) || '-' ||
      '5' || substr(md5('company:' || "orgId" || ':' || lower("name")), 14, 3) || '-' ||
      'a' || substr(md5('company:' || "orgId" || ':' || lower("name")), 18, 3) || '-' ||
      substr(md5('company:' || "orgId" || ':' || lower("name")), 21, 12)
    ) AS "id"
  FROM company_seeds
)
INSERT INTO "Company" ("id", "orgId", "name", "type", "status", "createdAt", "updatedAt")
SELECT "id", "orgId", "name", 'external', 'active', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM company_ids
ON CONFLICT ("orgId", "name") DO NOTHING;

WITH legacy_parties AS (
  SELECT "id" AS "projectId", "orgId", 'owner'::"ProjectPartyRole" AS "role", btrim("clientName") AS "name"
  FROM "Project"
  WHERE btrim(COALESCE("clientName", '')) <> ''
  UNION ALL
  SELECT "id" AS "projectId", "orgId", 'consultant'::"ProjectPartyRole" AS "role", btrim("consultantName") AS "name"
  FROM "Project"
  WHERE btrim(COALESCE("consultantName", '')) <> ''
  UNION ALL
  SELECT "id" AS "projectId", "orgId", 'contractor'::"ProjectPartyRole" AS "role", btrim("contractorName") AS "name"
  FROM "Project"
  WHERE btrim(COALESCE("contractorName", '')) <> ''
),
matched AS (
  SELECT
    lp."projectId",
    c."id" AS "companyId",
    lp."role"
  FROM legacy_parties lp
  JOIN "Company" c ON c."orgId" = lp."orgId" AND c."name" = lp."name"
),
party_ids AS (
  SELECT
    "projectId",
    "companyId",
    "role",
    (
      substr(md5('project-party:' || "projectId" || ':' || "companyId" || ':' || "role"::text), 1, 8) || '-' ||
      substr(md5('project-party:' || "projectId" || ':' || "companyId" || ':' || "role"::text), 9, 4) || '-' ||
      '5' || substr(md5('project-party:' || "projectId" || ':' || "companyId" || ':' || "role"::text), 14, 3) || '-' ||
      'a' || substr(md5('project-party:' || "projectId" || ':' || "companyId" || ':' || "role"::text), 18, 3) || '-' ||
      substr(md5('project-party:' || "projectId" || ':' || "companyId" || ':' || "role"::text), 21, 12)
    ) AS "id"
  FROM matched
)
INSERT INTO "ProjectParty" (
  "id",
  "projectId",
  "companyId",
  "role",
  "accessLevel",
  "permissionProfile",
  "permissionsJson",
  "status",
  "createdAt",
  "updatedAt"
)
SELECT
  "id",
  "projectId",
  "companyId",
  "role",
  'collaborator',
  'default_' || "role"::text,
  '{}'::jsonb,
  'active',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM party_ids
ON CONFLICT ("projectId", "companyId", "role") DO NOTHING;
