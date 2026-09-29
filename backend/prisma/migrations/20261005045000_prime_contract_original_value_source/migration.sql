-- Owner decisions 1 + 4 (2026-09-29): record where a client contract's
-- original value came from. Additive and nullable: every existing row stays
-- valid, no amount is touched, and NULL (a row written before this column)
-- reads as unestablished until scripts/prime-contract-value-source-backfill.js
-- classifies it from the creation path.

-- AlterTable
ALTER TABLE "PrimeContract" ADD COLUMN     "originalValueSource" TEXT;
