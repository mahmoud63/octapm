-- Owner decision R5-2 (2026-09-30): record where a cost record's stored forecast came from — entered (a caller
-- supplied it) or default (the initial default max(budget, actual)). Additive and nullable: no existing row or
-- figure changes; NULL means the source was not recorded and is treated as entered. Reversible by dropping the
-- column. Generated with `prisma migrate diff` from the previous schema.
-- AlterTable
ALTER TABLE "CostRecord" ADD COLUMN     "forecastSource" TEXT;
