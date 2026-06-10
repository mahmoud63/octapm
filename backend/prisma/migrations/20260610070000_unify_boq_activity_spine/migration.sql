-- Unify legacy BOQ-generated activity rows onto the official schedule
-- Activity + ActivityBoqAllocation spine. BoqActivity remains only as
-- AI suggestion/history storage and no longer carries live project value.

ALTER TABLE "BoqActivity"
  ADD COLUMN IF NOT EXISTS "status" TEXT NOT NULL DEFAULT 'draft_suggestion',
  ADD COLUMN IF NOT EXISTS "acceptedActivityId" TEXT,
  ADD COLUMN IF NOT EXISTS "acceptedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "acceptedBy" TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'BoqActivity_status_check'
  ) THEN
    ALTER TABLE "BoqActivity"
      ADD CONSTRAINT "BoqActivity_status_check"
      CHECK ("status" IN ('draft_suggestion', 'accepted', 'rejected'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "BoqActivity_projectId_status_idx"
ON "BoqActivity"("projectId", "status");

CREATE INDEX IF NOT EXISTS "BoqActivity_acceptedActivityId_idx"
ON "BoqActivity"("acceptedActivityId");

CREATE INDEX IF NOT EXISTS "Activity_projectId_wbsCode_idx"
ON "Activity"("projectId", "wbsCode");

ALTER TABLE "BoqActivity"
  ADD CONSTRAINT "BoqActivity_acceptedActivityId_fkey"
  FOREIGN KEY ("acceptedActivityId") REFERENCES "Activity"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

WITH legacy AS (
  SELECT
    ba.*,
    bi."qty" AS boq_qty,
    bi."amount" AS boq_amount,
    COALESCE(existing_activity."id", lower(
      substr(md5('pmcopilots:boq-activity:activity:' || ba."id"), 1, 8) || '-' ||
      substr(md5('pmcopilots:boq-activity:activity:' || ba."id"), 9, 4) || '-' ||
      substr(md5('pmcopilots:boq-activity:activity:' || ba."id"), 13, 4) || '-' ||
      substr(md5('pmcopilots:boq-activity:activity:' || ba."id"), 17, 4) || '-' ||
      substr(md5('pmcopilots:boq-activity:activity:' || ba."id"), 21, 12)
    )) AS activity_id,
    lower(
      substr(md5('pmcopilots:boq-activity:allocation:' || ba."id"), 1, 8) || '-' ||
      substr(md5('pmcopilots:boq-activity:allocation:' || ba."id"), 9, 4) || '-' ||
      substr(md5('pmcopilots:boq-activity:allocation:' || ba."id"), 13, 4) || '-' ||
      substr(md5('pmcopilots:boq-activity:allocation:' || ba."id"), 17, 4) || '-' ||
      substr(md5('pmcopilots:boq-activity:allocation:' || ba."id"), 21, 12)
    ) AS allocation_id,
    GREATEST(COALESCE(ba."quantity", 0), 0) AS raw_quantity,
    GREATEST(
      COALESCE(NULLIF(ba."budget", 0), COALESCE(ba."quantity", 0) * COALESCE(ba."rate", 0), 0),
      0
    ) AS raw_amount
  FROM "BoqActivity" ba
  JOIN "BoqItem" bi ON bi."id" = ba."boqItemId"
  LEFT JOIN LATERAL (
    SELECT a."id"
    FROM "Activity" a
    WHERE a."projectId" = ba."projectId"
      AND COALESCE(a."isActive", true) = true
      AND (
        a."wbsCode" = ba."activityCode"
        OR a."p6ActivityId" = ba."activityCode"
      )
    ORDER BY a."createdAt" ASC NULLS LAST, a."id" ASC
    LIMIT 1
  ) existing_activity ON true
),
scaled AS (
  SELECT
    legacy.*,
    SUM(raw_quantity) OVER (PARTITION BY "boqItemId") AS item_raw_quantity,
    SUM(raw_amount) OVER (PARTITION BY "boqItemId") AS item_raw_amount
  FROM legacy
),
normalized AS (
  SELECT
    scaled.*,
    CASE
      WHEN COALESCE(item_raw_quantity, 0) > COALESCE(boq_qty, 0)
        AND item_raw_quantity > 0
      THEN raw_quantity * COALESCE(boq_qty, 0) / item_raw_quantity
      ELSE raw_quantity
    END AS allocation_quantity,
    CASE
      WHEN COALESCE(item_raw_amount, 0) > COALESCE(boq_amount, 0)
        AND item_raw_amount > 0
      THEN raw_amount * COALESCE(boq_amount, 0) / item_raw_amount
      ELSE raw_amount
    END AS allocation_amount
  FROM scaled
)
INSERT INTO "Activity" (
  "id",
  "projectId",
  "name",
  "wbsCode",
  "duration",
  "budget",
  "isMilestone",
  "isCritical",
  "predecessors",
  "isActive",
  "sortOrder",
  "createdAt",
  "updatedAt"
)
SELECT
  n.activity_id,
  n."projectId",
  n."activityName",
  n."activityCode",
  0,
  n.allocation_amount,
  false,
  false,
  CASE
    WHEN NULLIF(n."predecessorCode", '') IS NULL THEN NULL
    ELSE n."predecessorCode" || ' ' || COALESCE(NULLIF(n."dependencyType", ''), 'FS')
  END,
  true,
  n."sortOrder",
  COALESCE(n."createdAt", CURRENT_TIMESTAMP),
  COALESCE(n."updatedAt", CURRENT_TIMESTAMP)
FROM normalized n
WHERE NOT EXISTS (
  SELECT 1 FROM "Activity" existing WHERE existing."id" = n.activity_id
);

WITH legacy AS (
  SELECT
    ba.*,
    bi."qty" AS boq_qty,
    bi."amount" AS boq_amount,
    COALESCE(existing_activity."id", lower(
      substr(md5('pmcopilots:boq-activity:activity:' || ba."id"), 1, 8) || '-' ||
      substr(md5('pmcopilots:boq-activity:activity:' || ba."id"), 9, 4) || '-' ||
      substr(md5('pmcopilots:boq-activity:activity:' || ba."id"), 13, 4) || '-' ||
      substr(md5('pmcopilots:boq-activity:activity:' || ba."id"), 17, 4) || '-' ||
      substr(md5('pmcopilots:boq-activity:activity:' || ba."id"), 21, 12)
    )) AS activity_id,
    lower(
      substr(md5('pmcopilots:boq-activity:allocation:' || ba."id"), 1, 8) || '-' ||
      substr(md5('pmcopilots:boq-activity:allocation:' || ba."id"), 9, 4) || '-' ||
      substr(md5('pmcopilots:boq-activity:allocation:' || ba."id"), 13, 4) || '-' ||
      substr(md5('pmcopilots:boq-activity:allocation:' || ba."id"), 17, 4) || '-' ||
      substr(md5('pmcopilots:boq-activity:allocation:' || ba."id"), 21, 12)
    ) AS allocation_id,
    GREATEST(COALESCE(ba."quantity", 0), 0) AS raw_quantity,
    GREATEST(
      COALESCE(NULLIF(ba."budget", 0), COALESCE(ba."quantity", 0) * COALESCE(ba."rate", 0), 0),
      0
    ) AS raw_amount
  FROM "BoqActivity" ba
  JOIN "BoqItem" bi ON bi."id" = ba."boqItemId"
  LEFT JOIN LATERAL (
    SELECT a."id"
    FROM "Activity" a
    WHERE a."projectId" = ba."projectId"
      AND COALESCE(a."isActive", true) = true
      AND (
        a."wbsCode" = ba."activityCode"
        OR a."p6ActivityId" = ba."activityCode"
      )
    ORDER BY a."createdAt" ASC NULLS LAST, a."id" ASC
    LIMIT 1
  ) existing_activity ON true
),
scaled AS (
  SELECT
    legacy.*,
    SUM(raw_quantity) OVER (PARTITION BY "boqItemId") AS item_raw_quantity,
    SUM(raw_amount) OVER (PARTITION BY "boqItemId") AS item_raw_amount
  FROM legacy
),
normalized AS (
  SELECT
    scaled.*,
    CASE
      WHEN COALESCE(item_raw_quantity, 0) > COALESCE(boq_qty, 0)
        AND item_raw_quantity > 0
      THEN raw_quantity * COALESCE(boq_qty, 0) / item_raw_quantity
      ELSE raw_quantity
    END AS allocation_quantity,
    CASE
      WHEN COALESCE(item_raw_amount, 0) > COALESCE(boq_amount, 0)
        AND item_raw_amount > 0
      THEN raw_amount * COALESCE(boq_amount, 0) / item_raw_amount
      ELSE raw_amount
    END AS allocation_amount
  FROM scaled
)
INSERT INTO "ActivityBoqAllocation" (
  "id",
  "projectId",
  "boqItemId",
  "activityId",
  "quantity",
  "amount",
  "weight",
  "source",
  "status",
  "isActive",
  "notes",
  "createdAt",
  "updatedAt"
)
SELECT
  n.allocation_id,
  n."projectId",
  n."boqItemId",
  n.activity_id,
  n.allocation_quantity,
  n.allocation_amount,
  CASE
    WHEN COALESCE(n.boq_amount, 0) > 0
    THEN n.allocation_amount / n.boq_amount * 100
    ELSE 0
  END,
  CASE WHEN n."isManual" THEN 'manual' ELSE 'ai' END,
  'submitted',
  true,
  'Backfilled from legacy BoqActivity; requires review before official EV/IPC use.',
  COALESCE(n."createdAt", CURRENT_TIMESTAMP),
  COALESCE(n."updatedAt", CURRENT_TIMESTAMP)
FROM normalized n
WHERE NOT EXISTS (
  SELECT 1
  FROM "ActivityBoqAllocation" existing
  WHERE existing."projectId" = n."projectId"
    AND existing."boqItemId" = n."boqItemId"
    AND existing."activityId" = n.activity_id
    AND existing."isActive" = true
);

WITH mapped AS (
  SELECT
    ba."id",
    COALESCE(existing_activity."id", lower(
      substr(md5('pmcopilots:boq-activity:activity:' || ba."id"), 1, 8) || '-' ||
      substr(md5('pmcopilots:boq-activity:activity:' || ba."id"), 9, 4) || '-' ||
      substr(md5('pmcopilots:boq-activity:activity:' || ba."id"), 13, 4) || '-' ||
      substr(md5('pmcopilots:boq-activity:activity:' || ba."id"), 17, 4) || '-' ||
      substr(md5('pmcopilots:boq-activity:activity:' || ba."id"), 21, 12)
    )) AS activity_id
  FROM "BoqActivity" ba
  LEFT JOIN LATERAL (
    SELECT a."id"
    FROM "Activity" a
    WHERE a."projectId" = ba."projectId"
      AND (
        a."wbsCode" = ba."activityCode"
        OR a."p6ActivityId" = ba."activityCode"
      )
    ORDER BY a."createdAt" ASC NULLS LAST, a."id" ASC
    LIMIT 1
  ) existing_activity ON true
)
UPDATE "BoqActivity" ba
SET
  "status" = 'accepted',
  "acceptedActivityId" = mapped.activity_id,
  "acceptedAt" = COALESCE(ba."acceptedAt", CURRENT_TIMESTAMP)
FROM mapped
WHERE mapped."id" = ba."id"
  AND ba."status" = 'draft_suggestion';
