-- D-ID-1 identity batch (CERT-3): credential epoch, workspace-scoped SSO
-- links, and SSO auto-provisioning retired.

-- A counter every credential event bumps; tokens carry it and are refused
-- once it moves (owner decision Q6).
ALTER TABLE "User" ADD COLUMN "credentialEpoch" INTEGER NOT NULL DEFAULT 0;

-- SSO links belong to the workspace whose provider made them (owner decision Q2).
ALTER TABLE "OrganizationMembership" ADD COLUMN "ssoSubject" TEXT;
ALTER TABLE "OrganizationMembership" ADD COLUMN "ssoLinkedAt" TIMESTAMP(3);
CREATE UNIQUE INDEX "OrganizationMembership_orgId_ssoSubject_key" ON "OrganizationMembership"("orgId", "ssoSubject");

-- Existing global links move to the identity's home workspace, the one whose
-- provider most plausibly made them. A subject that another person homed in
-- the same workspace also carries is not copied (that person re-links).
UPDATE "OrganizationMembership" AS m
SET "ssoSubject" = u."ssoSubject", "ssoLinkedAt" = u."ssoLinkedAt"
FROM "User" AS u
WHERE m."userId" = u."id"
  AND m."orgId" = u."orgId"
  AND u."ssoSubject" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM "User" AS other
    WHERE other."orgId" = u."orgId" AND other."id" <> u."id" AND other."ssoSubject" = u."ssoSubject"
  );

-- SSO no longer creates identities or memberships (owner decision Q1).
ALTER TABLE "Organisation" ALTER COLUMN "ssoAutoProvision" SET DEFAULT false;
UPDATE "Organisation" SET "ssoAutoProvision" = false WHERE "ssoAutoProvision" = true;
