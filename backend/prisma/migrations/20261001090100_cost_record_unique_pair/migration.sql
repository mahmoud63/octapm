-- One cost-record projection row per (project, activity): every writer now holds the pair, and this is the last line (Phase 21D, CX21-474).
-- A database that met the defect may already hold two rows for a pair. They are merged first (CX21-483): the row with the
-- most user-entered data is kept (highest budget, then the latest update), the others' derived actual is folded into it, and
-- they are removed. Run the cost reconciliation repair (POST /projects/{id}/cost/reconciliation/recompute) afterwards, which
-- rebuilds actual and its through-date from the ledger; committed is rebuilt by the next commitment change.
WITH ranked AS (
  SELECT id, "projectId", "activityId", actual,
         ROW_NUMBER() OVER (PARTITION BY "projectId", "activityId" ORDER BY budget DESC, "updatedAt" DESC, id) AS rn
  FROM "CostRecord"
), folded AS (
  SELECT k.id AS keep_id, SUM(d.actual) AS extra
  FROM ranked k JOIN ranked d ON d."projectId" = k."projectId" AND d."activityId" = k."activityId" AND d.rn > 1
  WHERE k.rn = 1 GROUP BY k.id
)
UPDATE "CostRecord" c SET actual = c.actual + f.extra FROM folded f WHERE c.id = f.keep_id;

WITH ranked AS (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY "projectId", "activityId" ORDER BY budget DESC, "updatedAt" DESC, id) AS rn
  FROM "CostRecord"
)
DELETE FROM "CostRecord" WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

CREATE UNIQUE INDEX "CostRecord_projectId_activityId_key" ON "CostRecord"("projectId", "activityId");
