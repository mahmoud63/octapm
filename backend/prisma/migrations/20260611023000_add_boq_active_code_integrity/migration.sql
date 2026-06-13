-- Enforce one normalized active BOQ item code per project while preserving
-- inactive revision rows as historical comparison data.

CREATE TABLE IF NOT EXISTS "BoqItemCodeIntegrityReport" (
  "id" TEXT NOT NULL DEFAULT ('boq-code-report-' || md5(random()::text || clock_timestamp()::text)),
  "projectId" TEXT NOT NULL,
  "normalizedCode" TEXT NOT NULL,
  "activeItemCount" INTEGER NOT NULL,
  "activeItemIds" JSONB NOT NULL,
  "codeVariants" JSONB NOT NULL,
  "reason" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "BoqItemCodeIntegrityReport_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "BoqItemCodeIntegrityReport_projectId_idx"
ON "BoqItemCodeIntegrityReport"("projectId");

CREATE INDEX IF NOT EXISTS "BoqItemCodeIntegrityReport_createdAt_idx"
ON "BoqItemCodeIntegrityReport"("createdAt");

ALTER TABLE "BoqItem"
ADD COLUMN IF NOT EXISTS "activeCodeKey" TEXT;

WITH duplicate_active_codes AS (
  SELECT
    "projectId",
    UPPER(regexp_replace(BTRIM("code"), '[[:space:]]+', ' ', 'g')) AS "normalizedCode",
    COUNT(*)::INTEGER AS "activeItemCount",
    ARRAY_AGG("id" ORDER BY "createdAt", "id") AS "activeItemIds",
    ARRAY_AGG(DISTINCT "code" ORDER BY "code") AS "codeVariants"
  FROM "BoqItem"
  WHERE "isActive" = true
    AND NULLIF(BTRIM(COALESCE("code", '')), '') IS NOT NULL
  GROUP BY
    "projectId",
    UPPER(regexp_replace(BTRIM("code"), '[[:space:]]+', ' ', 'g'))
  HAVING COUNT(*) > 1
)
INSERT INTO "BoqItemCodeIntegrityReport" (
  "projectId",
  "normalizedCode",
  "activeItemCount",
  "activeItemIds",
  "codeVariants",
  "reason"
)
SELECT
  "projectId",
  "normalizedCode",
  "activeItemCount",
  to_jsonb("activeItemIds"),
  to_jsonb("codeVariants"),
  'duplicate_active_boq_code_before_unique_constraint'
FROM duplicate_active_codes;

DO $$
DECLARE
  duplicate_count INTEGER;
BEGIN
  SELECT COUNT(*)
    INTO duplicate_count
    FROM (
      SELECT
        "projectId",
        UPPER(regexp_replace(BTRIM("code"), '[[:space:]]+', ' ', 'g')) AS "normalizedCode"
      FROM "BoqItem"
      WHERE "isActive" = true
        AND NULLIF(BTRIM(COALESCE("code", '')), '') IS NOT NULL
      GROUP BY
        "projectId",
        UPPER(regexp_replace(BTRIM("code"), '[[:space:]]+', ' ', 'g'))
      HAVING COUNT(*) > 1
    ) duplicates;

  IF duplicate_count > 0 THEN
    RAISE EXCEPTION 'Cannot add active BOQ code uniqueness; % duplicate normalized active code group(s) were written to BoqItemCodeIntegrityReport', duplicate_count;
  END IF;
END $$;

UPDATE "BoqItem"
SET "code" = NULLIF(
  UPPER(regexp_replace(BTRIM("code"), '[[:space:]]+', ' ', 'g')),
  ''
)
WHERE "code" IS NOT NULL;

UPDATE "BoqItem"
SET "activeCodeKey" = CASE
  WHEN "isActive" = true AND "code" IS NOT NULL THEN "code"
  ELSE NULL
END
WHERE "activeCodeKey" IS DISTINCT FROM CASE
  WHEN "isActive" = true AND "code" IS NOT NULL THEN "code"
  ELSE NULL
END;

CREATE OR REPLACE FUNCTION "normalize_boq_item_code"()
RETURNS trigger AS $$
BEGIN
  IF NEW."code" IS NOT NULL THEN
    NEW."code" := NULLIF(
      UPPER(regexp_replace(BTRIM(NEW."code"), '[[:space:]]+', ' ', 'g')),
      ''
    );
  END IF;

  IF NEW."isActive" = true AND NEW."code" IS NOT NULL THEN
    NEW."activeCodeKey" := NEW."code";
  ELSE
    NEW."activeCodeKey" := NULL;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "BoqItem_normalize_code_trigger" ON "BoqItem";

CREATE TRIGGER "BoqItem_normalize_code_trigger"
BEFORE INSERT OR UPDATE OF "code", "isActive"
ON "BoqItem"
FOR EACH ROW
EXECUTE FUNCTION "normalize_boq_item_code"();

ALTER TABLE "BoqItem"
DROP CONSTRAINT IF EXISTS "BoqItem_code_normalized_check";

ALTER TABLE "BoqItem"
ADD CONSTRAINT "BoqItem_code_normalized_check"
CHECK (
  "code" IS NULL
  OR "code" = UPPER(regexp_replace(BTRIM("code"), '[[:space:]]+', ' ', 'g'))
);

ALTER TABLE "BoqItem"
DROP CONSTRAINT IF EXISTS "BoqItem_active_code_key_matches_code_check";

ALTER TABLE "BoqItem"
ADD CONSTRAINT "BoqItem_active_code_key_matches_code_check"
CHECK (
  (
    ("isActive" = false OR "code" IS NULL)
    AND "activeCodeKey" IS NULL
  )
  OR (
    "isActive" = true
    AND "code" IS NOT NULL
    AND "activeCodeKey" = "code"
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS "BoqItem_projectId_activeCodeKey_key"
ON "BoqItem"("projectId", "activeCodeKey");

CREATE UNIQUE INDEX IF NOT EXISTS "BoqItem_projectId_active_code_key"
ON "BoqItem"("projectId", "code")
WHERE "isActive" = true AND "code" IS NOT NULL;
