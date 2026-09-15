-- Phase 22B: a change order can name the budget lines its approved value lands on, with an explicit amount per line.
-- Empty means the existing rule applies (single budgetLineId, else the activity's lines, else the "Change orders" line).
ALTER TABLE "ChangeOrder" ADD COLUMN "budgetAllocationsJson" JSONB NOT NULL DEFAULT '[]';
