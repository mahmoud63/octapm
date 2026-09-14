-- One cost-record projection row per (project, activity): every writer now holds the pair, and this is the last line (Phase 21D, CX21-474).
-- A database that met the defect may already hold two rows for a pair. They are merged first (CX21-483, CX21-490): the row with the
-- most user-entered data is kept (highest budget, then the latest update); the derived actual is summed across the pair, and every
-- other figure — the seven categories, budget, forecast, committed, the through-date — keeps the largest value any of the rows held,
-- so nothing typed onto a duplicate is discarded (a figure typed twice is counted once). The others are then removed. Run the cost
-- reconciliation repair (POST /projects/{id}/cost/reconciliation/recompute) afterwards, which rebuilds actual and its through-date
-- from the ledger; committed is rebuilt by the next commitment change.
WITH ranked AS (
  SELECT id, "projectId", "activityId",
         ROW_NUMBER() OVER (PARTITION BY "projectId", "activityId" ORDER BY budget DESC, "updatedAt" DESC, id) AS rn
  FROM "CostRecord"
), merged AS (
  SELECT k.id AS keep_id,
         SUM(c.actual)              AS actual,
         MAX(c.budget)              AS budget,
         MAX(c.labour)              AS labour,
         MAX(c.material)            AS material,
         MAX(c.equipment)           AS equipment,
         MAX(c.subcontract)         AS subcontract,
         MAX(c.indirect)            AS indirect,
         MAX(c.overhead)            AS overhead,
         MAX(c.contingency)         AS contingency,
         MAX(c.forecast)            AS forecast,
         MAX(c.committed)           AS committed,
         MAX(c."actualThroughDate") AS "actualThroughDate"
  FROM ranked k
  JOIN ranked r ON r."projectId" = k."projectId" AND r."activityId" = k."activityId"
  JOIN "CostRecord" c ON c.id = r.id
  WHERE k.rn = 1
  GROUP BY k.id
  HAVING COUNT(*) > 1
)
UPDATE "CostRecord" c
SET actual = m.actual, budget = m.budget, labour = m.labour, material = m.material, equipment = m.equipment,
    subcontract = m.subcontract, indirect = m.indirect, overhead = m.overhead, contingency = m.contingency,
    forecast = m.forecast, committed = m.committed, "actualThroughDate" = m."actualThroughDate"
FROM merged m WHERE c.id = m.keep_id;

WITH ranked AS (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY "projectId", "activityId" ORDER BY budget DESC, "updatedAt" DESC, id) AS rn
  FROM "CostRecord"
)
DELETE FROM "CostRecord" WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

CREATE UNIQUE INDEX "CostRecord_projectId_activityId_key" ON "CostRecord"("projectId", "activityId");
