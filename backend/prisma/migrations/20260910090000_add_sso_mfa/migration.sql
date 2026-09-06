-- OCTA-SEC-AUTH-040: single sign-on (OIDC) per organisation and TOTP two-factor per user.

ALTER TABLE "Organisation"
  ADD COLUMN "ssoEnabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "ssoProvider" TEXT,
  ADD COLUMN "ssoIssuer" TEXT,
  ADD COLUMN "ssoClientId" TEXT,
  ADD COLUMN "ssoClientSecretEnc" TEXT,
  ADD COLUMN "ssoDomainsJson" JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN "ssoAutoProvision" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "ssoDefaultRole" TEXT NOT NULL DEFAULT 'site_engineer',
  ADD COLUMN "ssoRequired" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "ssoUpdatedAt" TIMESTAMP(3),
  ADD COLUMN "mfaRequired" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "User"
  ADD COLUMN "mfaEnabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "mfaSecretEnc" TEXT,
  ADD COLUMN "mfaPendingSecretEnc" TEXT,
  ADD COLUMN "mfaEnrolledAt" TIMESTAMP(3),
  ADD COLUMN "mfaBackupCodesJson" JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN "ssoSubject" TEXT,
  ADD COLUMN "ssoProvider" TEXT,
  ADD COLUMN "ssoLinkedAt" TIMESTAMP(3);

CREATE TABLE "SsoTicket" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "usedAt" TIMESTAMP(3),
  "ipAddress" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SsoTicket_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "SsoTicket_tokenHash_key" ON "SsoTicket"("tokenHash");
CREATE INDEX "SsoTicket_userId_idx" ON "SsoTicket"("userId");
CREATE INDEX "SsoTicket_expiresAt_idx" ON "SsoTicket"("expiresAt");
ALTER TABLE "SsoTicket"
  ADD CONSTRAINT "SsoTicket_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "SsoTicket_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
