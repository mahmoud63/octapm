-- ENT-6 (acceptance §16): a workspace's defaults for the projects created in it.
-- Additive: a defaulted column and a nullable one, so every existing row
-- stays valid with no backfill; nothing reads them for an existing project.

-- AlterTable
ALTER TABLE "Organisation" ADD COLUMN     "defaultCurrency" TEXT NOT NULL DEFAULT 'USD',
ADD COLUMN     "defaultTimezone" TEXT;
