-- Persist authenticated user profile and UI settings.

CREATE TABLE "UserSetting" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "profileUsername" TEXT,
  "profileBio" TEXT,
  "profileUrls" JSONB NOT NULL DEFAULT '[]',
  "dateOfBirth" TIMESTAMP(3),
  "language" TEXT NOT NULL DEFAULT 'en',
  "appearanceTheme" TEXT NOT NULL DEFAULT 'dark',
  "appearanceFont" TEXT NOT NULL DEFAULT 'inter',
  "displayItems" JSONB NOT NULL DEFAULT '["dashboard","projects","tasks","apps","chats","users","help-center"]',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "UserSetting_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "UserSetting_userId_key" ON "UserSetting"("userId");
CREATE INDEX "UserSetting_orgId_idx" ON "UserSetting"("orgId");
CREATE INDEX "UserSetting_orgId_userId_idx" ON "UserSetting"("orgId", "userId");

ALTER TABLE "UserSetting"
  ADD CONSTRAINT "UserSetting_orgId_fkey"
  FOREIGN KEY ("orgId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "UserSetting"
  ADD CONSTRAINT "UserSetting_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
