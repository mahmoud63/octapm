-- The newest 30-second step a TOTP code was accepted for, so the same code
-- cannot be accepted twice (RFC 6238 section 5.2) on one API task or across
-- several. Null until the first code is accepted. Additive only.
-- AlterTable
ALTER TABLE "User" ADD COLUMN     "mfaLastTotpStep" INTEGER;
