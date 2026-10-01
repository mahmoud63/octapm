-- Project-controls programme, wave PC-7b (change intelligence, schema part),
-- OCTAPM_CHANGE_INTELLIGENCE.md §1, §5. One new table, new nullable columns,
-- new indexes and new keys — nothing else:
--
--   ProjectException — one REVIEWED exception (an overrun or a data-quality
--     gap). Derived and rebuildable: it carries the two figures it compared
--     (measured, limit) with the basis string of each owning figure, and
--     nothing reads it back into a figure — no column is added to CostRecord,
--     BudgetLine, Activity, ActivityProgress or any money table, and ChangeOrder
--     gains only two structure links, so no engine can write a forecast, a
--     budget, a schedule or a change order from an exception.
--   ChangeEvent — typed, nullable traceability beside the free-text
--     sourceRecordType / sourceRecordId pair (kept): rfiId, dailyLogId, ncrId
--     (→ NcrRecord), punchItemId, drawingRevisionId (→ SheetRevision),
--     submittalId, meetingActionItemId, exceptionId (→ ProjectException).
--   ChangeOrder — locationId (→ Location) and wbsNodeId (→ WbsNode).
--   Rfi.changeOrderId — the existing bare string becomes a foreign key
--     → ChangeOrder. scripts/project-controls/change-link-census.js (read-only,
--     2026-10-01, octapm_verify): 94 RFIs, 10 non-null values, 10 naming a
--     change order of the RFI's own project, 0 cross-project, 0 orphaned. Run
--     it again right before applying: an orphan written since makes this
--     migration fail as a whole (the key validates every row), never half-apply.
--
-- Tenancy as ENT-3: (projectId, orgId) → Project(id, orgId) plus
-- orgId → Organisation on ProjectException, and the master key
-- (costCodeId, orgId) → CostCode(id, orgId). ON DELETE: org / project CASCADE;
-- every other new key SET NULL (links a row outlives).
--
-- Additive only: no existing column, index, constraint, enum or default is
-- touched (every added column is nullable), so no existing row or figure can
-- change. Reversible by dropping the table, the columns and the keys.
-- Generated with `prisma migrate diff` from the schema at 694f248 to this one
-- (ref uniques excluded — they are 20261005060100) and kept verbatim below
-- (38 statements), followed by three hand-written statements under the marked
-- line at the end (Prisma's datamodel cannot express them); proven on a
-- throwaway database by scripts/db/verify-additive-migration.js and
-- scripts/db/prove-project-exceptions-constraints.js.

-- AlterTable
ALTER TABLE "ChangeOrder" ADD COLUMN     "locationId" TEXT,
ADD COLUMN     "wbsNodeId" TEXT;

-- AlterTable
ALTER TABLE "ChangeEvent" ADD COLUMN     "dailyLogId" TEXT,
ADD COLUMN     "drawingRevisionId" TEXT,
ADD COLUMN     "exceptionId" TEXT,
ADD COLUMN     "meetingActionItemId" TEXT,
ADD COLUMN     "ncrId" TEXT,
ADD COLUMN     "punchItemId" TEXT,
ADD COLUMN     "rfiId" TEXT,
ADD COLUMN     "submittalId" TEXT;

-- CreateTable
CREATE TABLE "ProjectException" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "subjectType" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "secondarySubjectType" TEXT,
    "secondarySubjectId" TEXT,
    "wbsNodeId" TEXT,
    "locationId" TEXT,
    "costCodeId" TEXT,
    "measured" DECIMAL(18,3) NOT NULL,
    "limit" DECIMAL(18,3) NOT NULL,
    "unitCode" TEXT,
    "measuredBasis" TEXT NOT NULL,
    "limitBasis" TEXT NOT NULL,
    "detectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "resolvedReason" TEXT,
    "changeEventId" TEXT,
    "snoozedUntil" TIMESTAMP(3),
    "snoozedBy" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewedBy" TEXT,
    "reviewNote" TEXT,
    "dataJson" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectException_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProjectException_projectId_kind_resolvedAt_idx" ON "ProjectException"("projectId", "kind", "resolvedAt");

-- CreateIndex
CREATE INDEX "ProjectException_orgId_resolvedAt_idx" ON "ProjectException"("orgId", "resolvedAt");

-- CreateIndex
CREATE INDEX "ProjectException_projectId_subjectType_subjectId_idx" ON "ProjectException"("projectId", "subjectType", "subjectId");

-- CreateIndex
CREATE INDEX "ProjectException_changeEventId_idx" ON "ProjectException"("changeEventId");

-- CreateIndex
CREATE INDEX "ProjectException_wbsNodeId_idx" ON "ProjectException"("wbsNodeId");

-- CreateIndex
CREATE INDEX "ProjectException_locationId_idx" ON "ProjectException"("locationId");

-- CreateIndex
CREATE INDEX "ProjectException_costCodeId_idx" ON "ProjectException"("costCodeId");

-- CreateIndex
CREATE INDEX "ChangeOrder_locationId_idx" ON "ChangeOrder"("locationId");

-- CreateIndex
CREATE INDEX "ChangeOrder_wbsNodeId_idx" ON "ChangeOrder"("wbsNodeId");

-- CreateIndex
CREATE INDEX "Rfi_changeOrderId_idx" ON "Rfi"("changeOrderId");

-- CreateIndex
CREATE INDEX "ChangeEvent_rfiId_idx" ON "ChangeEvent"("rfiId");

-- CreateIndex
CREATE INDEX "ChangeEvent_dailyLogId_idx" ON "ChangeEvent"("dailyLogId");

-- CreateIndex
CREATE INDEX "ChangeEvent_ncrId_idx" ON "ChangeEvent"("ncrId");

-- CreateIndex
CREATE INDEX "ChangeEvent_punchItemId_idx" ON "ChangeEvent"("punchItemId");

-- CreateIndex
CREATE INDEX "ChangeEvent_drawingRevisionId_idx" ON "ChangeEvent"("drawingRevisionId");

-- CreateIndex
CREATE INDEX "ChangeEvent_submittalId_idx" ON "ChangeEvent"("submittalId");

-- CreateIndex
CREATE INDEX "ChangeEvent_meetingActionItemId_idx" ON "ChangeEvent"("meetingActionItemId");

-- CreateIndex
CREATE INDEX "ChangeEvent_exceptionId_idx" ON "ChangeEvent"("exceptionId");

-- AddForeignKey
ALTER TABLE "ChangeOrder" ADD CONSTRAINT "ChangeOrder_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChangeOrder" ADD CONSTRAINT "ChangeOrder_wbsNodeId_fkey" FOREIGN KEY ("wbsNodeId") REFERENCES "WbsNode"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Rfi" ADD CONSTRAINT "Rfi_changeOrderId_fkey" FOREIGN KEY ("changeOrderId") REFERENCES "ChangeOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChangeEvent" ADD CONSTRAINT "ChangeEvent_rfiId_fkey" FOREIGN KEY ("rfiId") REFERENCES "Rfi"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChangeEvent" ADD CONSTRAINT "ChangeEvent_dailyLogId_fkey" FOREIGN KEY ("dailyLogId") REFERENCES "DailyLog"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChangeEvent" ADD CONSTRAINT "ChangeEvent_ncrId_fkey" FOREIGN KEY ("ncrId") REFERENCES "NcrRecord"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChangeEvent" ADD CONSTRAINT "ChangeEvent_punchItemId_fkey" FOREIGN KEY ("punchItemId") REFERENCES "PunchItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChangeEvent" ADD CONSTRAINT "ChangeEvent_drawingRevisionId_fkey" FOREIGN KEY ("drawingRevisionId") REFERENCES "SheetRevision"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChangeEvent" ADD CONSTRAINT "ChangeEvent_submittalId_fkey" FOREIGN KEY ("submittalId") REFERENCES "Submittal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChangeEvent" ADD CONSTRAINT "ChangeEvent_meetingActionItemId_fkey" FOREIGN KEY ("meetingActionItemId") REFERENCES "MeetingActionItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChangeEvent" ADD CONSTRAINT "ChangeEvent_exceptionId_fkey" FOREIGN KEY ("exceptionId") REFERENCES "ProjectException"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectException" ADD CONSTRAINT "ProjectException_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectException" ADD CONSTRAINT "ProjectException_projectId_orgId_fkey" FOREIGN KEY ("projectId", "orgId") REFERENCES "Project"("id", "orgId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectException" ADD CONSTRAINT "ProjectException_wbsNodeId_fkey" FOREIGN KEY ("wbsNodeId") REFERENCES "WbsNode"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectException" ADD CONSTRAINT "ProjectException_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectException" ADD CONSTRAINT "ProjectException_costCodeId_orgId_fkey" FOREIGN KEY ("costCodeId", "orgId") REFERENCES "CostCode"("id", "orgId") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectException" ADD CONSTRAINT "ProjectException_changeEventId_fkey" FOREIGN KEY ("changeEventId") REFERENCES "ChangeEvent"("id") ON DELETE SET NULL ON UPDATE CASCADE;



-- ─────────────────────────────────────────────────────────────────────────────
-- HAND-WRITTEN below this line (not part of the `prisma migrate diff` output
-- above, which is kept byte-identical). Still additive: all three statements bind
-- the new ProjectException table only.
--
-- 1. OPEN-ROW UNIQUENESS. A subject has at most one OPEN exception per kind:
--    the engine upserts on this key and a second open row for the same gap is
--    refused by PostgreSQL. Partial (WHERE "resolvedAt" IS NULL) so a resolved
--    row never blocks the next open one, and the history of resolved rows
--    stays. The nullable secondary subject is COALESCEd to '' in the index
--    expression: a plain unique index treats NULLs as distinct, so two open
--    rows without a secondary subject would both slip past it.
-- 2. The master key to CostCode is SET NULL on costCodeId ONLY (column-list
--    form, PostgreSQL 15+), exactly as ENT-3 (20261005021000) did for
--    ChangeEventLine: orgId is NOT NULL and must stay. Prisma emits the plain
--    form, which would try to null orgId too and make every cost-code delete
--    fail on the exception row; the key is replaced under the same name.
-- ─────────────────────────────────────────────────────────────────────────────

-- CreateIndex (partial, expression)
CREATE UNIQUE INDEX "ProjectException_open_subject_key" ON "ProjectException"("projectId", "kind", "subjectType", "subjectId", COALESCE("secondarySubjectType", ''), COALESCE("secondarySubjectId", '')) WHERE "resolvedAt" IS NULL;

-- ReplaceForeignKey (SET NULL on costCodeId only)
ALTER TABLE "ProjectException" DROP CONSTRAINT "ProjectException_costCodeId_orgId_fkey";
ALTER TABLE "ProjectException" ADD CONSTRAINT "ProjectException_costCodeId_orgId_fkey" FOREIGN KEY ("costCodeId", "orgId") REFERENCES "CostCode"("id", "orgId") ON DELETE SET NULL ("costCodeId") ON UPDATE CASCADE;
