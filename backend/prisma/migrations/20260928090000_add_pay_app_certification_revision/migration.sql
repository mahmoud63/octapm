-- Certifying a pay application posts actual cost, keyed on the application and
-- its line so a retry or a race posts once. Revoking that certification writes
-- negative mirrors rather than deleting, which means the original keys survive
-- — and a corrected re-certification would find them and post nothing.
--
-- The revision counter is what the re-posting keys on, so each certification of
-- the same application is a distinct economic event while remaining idempotent
-- within itself.
ALTER TABLE "SubPayApp" ADD COLUMN "certificationRevision" INTEGER NOT NULL DEFAULT 0;

-- Why a certification was revoked. Separate from voidReason: a revocation
-- returns the application to draft to be corrected, a void ends it.
ALTER TABLE "SubPayApp" ADD COLUMN "revokedReason" TEXT;
ALTER TABLE "SubPayApp" ADD COLUMN "revokedAt" TIMESTAMP(3);
ALTER TABLE "SubPayApp" ADD COLUMN "revokedBy" TEXT;
