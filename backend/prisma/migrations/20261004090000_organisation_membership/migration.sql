-- Enterprise programme, step M1 (additive schema). Nothing here rewrites or
-- removes a row: every column is nullable or defaulted, every index and
-- foreign key is new, and the one NOT NULL column lands on a table that is
-- empty (checked below). Backfill happens in the M2/M3 scripts under
-- backend/scripts/enterprise, not in this migration.

-- ExtraServicesConfig gains an owner. It had no orgId and was read for every
-- tenant; the column is NOT NULL without a default, so the migration refuses
-- to run against a database where rows exist (a §134 stop, decided by hand).
DO $$
BEGIN
  IF (SELECT count(*) FROM "ExtraServicesConfig") > 0 THEN
    RAISE EXCEPTION 'ExtraServicesConfig has rows: assign them an organisation before adding orgId NOT NULL';
  END IF;
END $$;

-- AlterTable
ALTER TABLE "ApiClient" ADD COLUMN     "membershipId" TEXT;

-- AlterTable
ALTER TABLE "BackgroundJob" ADD COLUMN     "membershipId" TEXT;

-- AlterTable
ALTER TABLE "ExtraServicesConfig" ADD COLUMN     "orgId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "InvitationToken" ADD COLUMN     "membershipId" TEXT;

-- AlterTable
ALTER TABLE "Notification" ADD COLUMN     "membershipId" TEXT;

-- AlterTable
ALTER TABLE "Organisation" ADD COLUMN     "createdByUserId" TEXT,
ADD COLUMN     "kind" TEXT NOT NULL DEFAULT 'company',
ADD COLUMN     "slug" TEXT;

-- AlterTable
ALTER TABLE "ProjectAssignment" ADD COLUMN     "orgId" TEXT;

-- AlterTable
ALTER TABLE "RefreshSession" ADD COLUMN     "membershipId" TEXT;

-- AlterTable
ALTER TABLE "SsoTicket" ADD COLUMN     "membershipId" TEXT;

-- CreateTable
CREATE TABLE "OrganizationMembership" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'member',
    "isAdmin" BOOLEAN NOT NULL DEFAULT false,
    "isOwner" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'active',
    "invitedById" TEXT,
    "invitationId" TEXT,
    "joinedAt" TIMESTAMP(3),
    "leftAt" TIMESTAMP(3),
    "lastActiveAt" TIMESTAMP(3),
    "defaultProjectId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrganizationMembership_pkey" PRIMARY KEY ("id")
);

-- A guest (a party member) can only be external_party and never administers
-- or owns the workspace. Prisma cannot express a CHECK, so it lives here; the
-- service repeats the rule so the error is a 400 rather than a 500.
ALTER TABLE "OrganizationMembership" ADD CONSTRAINT "OrganizationMembership_guest_check"
    CHECK ("kind" <> 'guest' OR ("role" = 'external_party' AND NOT "isAdmin" AND NOT "isOwner"));

-- CreateIndex
CREATE INDEX "OrganizationMembership_userId_status_idx" ON "OrganizationMembership"("userId", "status");

-- CreateIndex
CREATE INDEX "OrganizationMembership_orgId_status_idx" ON "OrganizationMembership"("orgId", "status");

-- CreateIndex
CREATE INDEX "OrganizationMembership_orgId_isOwner_idx" ON "OrganizationMembership"("orgId", "isOwner");

-- CreateIndex
CREATE UNIQUE INDEX "OrganizationMembership_orgId_userId_key" ON "OrganizationMembership"("orgId", "userId");

-- CreateIndex
CREATE INDEX "ApiClient_membershipId_idx" ON "ApiClient"("membershipId");

-- CreateIndex
CREATE UNIQUE INDEX "CostCode_id_orgId_key" ON "CostCode"("id", "orgId");

-- CreateIndex
CREATE UNIQUE INDEX "CustomFieldset_id_orgId_key" ON "CustomFieldset"("id", "orgId");

-- CreateIndex
CREATE UNIQUE INDEX "ExtraServicesConfig_orgId_label_key" ON "ExtraServicesConfig"("orgId", "label");

-- CreateIndex
CREATE UNIQUE INDEX "FormTemplate_id_orgId_key" ON "FormTemplate"("id", "orgId");

-- CreateIndex
CREATE INDEX "InvitationToken_membershipId_idx" ON "InvitationToken"("membershipId");

-- CreateIndex
CREATE INDEX "Notification_membershipId_idx" ON "Notification"("membershipId");

-- CreateIndex
CREATE UNIQUE INDEX "Organisation_slug_key" ON "Organisation"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "PermissionTemplate_id_orgId_key" ON "PermissionTemplate"("id", "orgId");

-- CreateIndex
CREATE UNIQUE INDEX "Project_id_orgId_key" ON "Project"("id", "orgId");

-- CreateIndex
CREATE INDEX "ProjectAssignment_orgId_userId_idx" ON "ProjectAssignment"("orgId", "userId");

-- CreateIndex
CREATE INDEX "RefreshSession_membershipId_idx" ON "RefreshSession"("membershipId");

-- CreateIndex
CREATE INDEX "SsoTicket_membershipId_idx" ON "SsoTicket"("membershipId");

-- AddForeignKey
ALTER TABLE "OrganizationMembership" ADD CONSTRAINT "OrganizationMembership_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrganizationMembership" ADD CONSTRAINT "OrganizationMembership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RefreshSession" ADD CONSTRAINT "RefreshSession_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "OrganizationMembership"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvitationToken" ADD CONSTRAINT "InvitationToken_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "OrganizationMembership"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExtraServicesConfig" ADD CONSTRAINT "ExtraServicesConfig_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "OrganizationMembership"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SsoTicket" ADD CONSTRAINT "SsoTicket_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "OrganizationMembership"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApiClient" ADD CONSTRAINT "ApiClient_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "OrganizationMembership"("id") ON DELETE SET NULL ON UPDATE CASCADE;
