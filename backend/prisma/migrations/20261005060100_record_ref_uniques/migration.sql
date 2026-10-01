-- Project-controls programme, wave PC-7b — @@unique([projectId, ref]) on the
-- three project registers that lacked it among those PC-7b links to:
-- ChangeOrder, Risk and NcrRecord (ten other registers already carry it).
-- A reference is how a record is cited in a change event, a certificate or a
-- letter; two records sharing one in a project make the citation ambiguous.
--
-- scripts/project-controls/record-ref-duplicates.js (read-only dry run,
-- 2026-10-01, octapm_verify): ChangeOrder 315 rows / 0 duplicate groups,
-- Risk 8 / 0, NcrRecord 8 / 0. Run it again right before applying (exit 2 =
-- a duplicate appeared: do not apply). ProcurementOrder carries the same gap
-- but is NOT constrained here: it has 2 live duplicate (projectId, ref) groups
-- (4 rows) — a §134 stop that belongs to the owner (see
-- OCTAPM_CHANGE_INTELLIGENCE.md "PC-7b migrations").
--
-- Additive only: three unique indexes, no column, no existing constraint or
-- index touched, no row changed. Reversible by dropping the three indexes.
-- Generated with `prisma migrate diff` from the schema of
-- 20261005060000_project_exceptions to this one, kept verbatim (3 statements).

-- CreateIndex
CREATE UNIQUE INDEX "ChangeOrder_projectId_ref_key" ON "ChangeOrder"("projectId", "ref");

-- CreateIndex
CREATE UNIQUE INDEX "Risk_projectId_ref_key" ON "Risk"("projectId", "ref");

-- CreateIndex
CREATE UNIQUE INDEX "NcrRecord_projectId_ref_key" ON "NcrRecord"("projectId", "ref");

