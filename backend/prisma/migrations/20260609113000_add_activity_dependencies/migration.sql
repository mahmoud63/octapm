-- Structured CPM dependency records.
-- Existing Activity.predecessors text is retained for compatibility, but
-- dependency rows are now the persisted source of truth for CPM logic.

CREATE TABLE "ActivityDependency" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "predecessorId" TEXT NOT NULL,
    "successorId" TEXT NOT NULL,
    "relationshipType" TEXT NOT NULL DEFAULT 'FS',
    "lagDays" INTEGER NOT NULL DEFAULT 0,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "importSource" TEXT,
    "externalPredecessorRef" TEXT,
    "externalSuccessorRef" TEXT,
    "importMetadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ActivityDependency_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ActivityDependency_relationshipType_check" CHECK ("relationshipType" IN ('FS', 'SS', 'FF', 'SF')),
    CONSTRAINT "ActivityDependency_source_check" CHECK ("source" IN ('manual', 'import', 'ai', 'migration')),
    CONSTRAINT "ActivityDependency_no_self_link" CHECK ("predecessorId" <> "successorId")
);

CREATE UNIQUE INDEX "ActivityDependency_projectId_predecessorId_successorId_key"
ON "ActivityDependency"("projectId", "predecessorId", "successorId");

CREATE INDEX "ActivityDependency_projectId_idx" ON "ActivityDependency"("projectId");
CREATE INDEX "ActivityDependency_predecessorId_idx" ON "ActivityDependency"("predecessorId");
CREATE INDEX "ActivityDependency_successorId_idx" ON "ActivityDependency"("successorId");
CREATE INDEX "ActivityDependency_projectId_successorId_idx" ON "ActivityDependency"("projectId", "successorId");

ALTER TABLE "ActivityDependency" ADD CONSTRAINT "ActivityDependency_projectId_fkey"
FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ActivityDependency" ADD CONSTRAINT "ActivityDependency_predecessorId_fkey"
FOREIGN KEY ("predecessorId") REFERENCES "Activity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ActivityDependency" ADD CONSTRAINT "ActivityDependency_successorId_fkey"
FOREIGN KEY ("successorId") REFERENCES "Activity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

WITH split_predecessors AS (
    SELECT
        succ."id" AS "successorId",
        succ."projectId",
        trim(part) AS "rawPart"
    FROM "Activity" succ
    CROSS JOIN LATERAL regexp_split_to_table(COALESCE(succ."predecessors", ''), ',') AS part
    WHERE trim(part) <> ''
),
parsed AS (
    SELECT
        "successorId",
        "projectId",
        "rawPart",
        CASE
            WHEN "rawPart" LIKE '%:%' THEN trim(split_part("rawPart", ':', 1))
            ELSE trim(split_part("rawPart", ' ', 1))
        END AS "predRef",
        CASE
            WHEN "rawPart" LIKE '%:%' THEN upper(NULLIF(trim(split_part("rawPart", ':', 2)), ''))
            ELSE upper(NULLIF(substring("rawPart" FROM '^\S+\s+([A-Za-z]{2})'), ''))
        END AS "relationshipType",
        CASE
            WHEN "rawPart" LIKE '%:%' THEN NULLIF(trim(split_part("rawPart", ':', 3)), '')
            ELSE NULLIF(substring("rawPart" FROM '([+-][0-9]+)\s*$'), '')
        END AS "lagRaw"
    FROM split_predecessors
),
resolved AS (
    SELECT
        parsed.*,
        pred."id" AS "predecessorId"
    FROM parsed
    JOIN "Activity" pred
      ON pred."projectId" = parsed."projectId"
     AND (
        pred."id" = parsed."predRef"
        OR pred."wbsCode" = parsed."predRef"
        OR pred."p6ActivityId" = parsed."predRef"
     )
),
deduped AS (
    SELECT DISTINCT ON ("projectId", "predecessorId", "successorId")
        "projectId",
        "predecessorId",
        "successorId",
        CASE
            WHEN "relationshipType" IN ('FS', 'SS', 'FF', 'SF') THEN "relationshipType"
            ELSE 'FS'
        END AS "relationshipType",
        CASE
            WHEN COALESCE("lagRaw", '') ~ '^[+-]?[0-9]+$' THEN "lagRaw"::INTEGER
            ELSE 0
        END AS "lagDays",
        "rawPart",
        md5("projectId" || ':' || "predecessorId" || ':' || "successorId") AS "hash"
    FROM resolved
    WHERE "predecessorId" <> "successorId"
)
INSERT INTO "ActivityDependency" (
    "id",
    "projectId",
    "predecessorId",
    "successorId",
    "relationshipType",
    "lagDays",
    "source",
    "externalPredecessorRef",
    "externalSuccessorRef",
    "importMetadata",
    "createdAt",
    "updatedAt"
)
SELECT
    substr("hash", 1, 8) || '-' || substr("hash", 9, 4) || '-' || substr("hash", 13, 4) || '-' || substr("hash", 17, 4) || '-' || substr("hash", 21, 12),
    "projectId",
    "predecessorId",
    "successorId",
    "relationshipType",
    "lagDays",
    'migration',
    "rawPart",
    "successorId",
    jsonb_build_object('legacyPredecessor', "rawPart"),
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM deduped
ON CONFLICT ("projectId", "predecessorId", "successorId") DO NOTHING;
