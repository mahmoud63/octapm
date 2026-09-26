-- Enterprise programme, step M7 — the organisation key on ApprovalWorkflowEvent (wave ENT-3).
--
-- ApprovalWorkflowEvent carried a bare orgId beside its project key (the
-- matrix's "REL (org) + CFK" row). Batch 3 made the project key composite;
-- this adds the org-side key the same way, NOT VALID then validated, after
-- validate-composite-fks.js counted 0 orphaned rows. Idempotent.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = '"ApprovalWorkflowEvent"'::regclass AND conname = 'ApprovalWorkflowEvent_orgId_fkey') THEN
    ALTER TABLE "ApprovalWorkflowEvent" ADD CONSTRAINT "ApprovalWorkflowEvent_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE NOT VALID;
  END IF;
END $$;
ALTER TABLE "ApprovalWorkflowEvent" VALIDATE CONSTRAINT "ApprovalWorkflowEvent_orgId_fkey";
