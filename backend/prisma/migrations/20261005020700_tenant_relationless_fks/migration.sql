-- Enterprise programme, step M7 — relations for the relation-less tables (wave ENT-3).
--
-- Ten tables carry an orgId with no foreign key behind it (the matrix's
-- REL rows: NotificationDeliveryAttempt, the six Bid* tables,
-- AssistantMessage, PrequalCriterion, EvaluationCriterion); they resolve
-- through an org-scoped parent, and the direct key makes the column
-- trustworthy. BoqItemCodeIntegrityReport names a project with no key at
-- all. validate-composite-fks.js counted 0 orphaned rows first. Added NOT
-- VALID then validated, idempotent.

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['NotificationDeliveryAttempt', 'BidPackageLine', 'BidAddendum', 'BidInvitation', 'BidQuestion', 'Bid', 'BidLine', 'AssistantMessage', 'PrequalCriterion', 'EvaluationCriterion'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = format('%I', t)::regclass AND conname = t || '_orgId_fkey') THEN
      EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY ("orgId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE NOT VALID', t, t || '_orgId_fkey');
    END IF;
  END LOOP;
END $$;

ALTER TABLE "NotificationDeliveryAttempt" VALIDATE CONSTRAINT "NotificationDeliveryAttempt_orgId_fkey";
ALTER TABLE "BidPackageLine" VALIDATE CONSTRAINT "BidPackageLine_orgId_fkey";
ALTER TABLE "BidAddendum" VALIDATE CONSTRAINT "BidAddendum_orgId_fkey";
ALTER TABLE "BidInvitation" VALIDATE CONSTRAINT "BidInvitation_orgId_fkey";
ALTER TABLE "BidQuestion" VALIDATE CONSTRAINT "BidQuestion_orgId_fkey";
ALTER TABLE "Bid" VALIDATE CONSTRAINT "Bid_orgId_fkey";
ALTER TABLE "BidLine" VALIDATE CONSTRAINT "BidLine_orgId_fkey";
ALTER TABLE "AssistantMessage" VALIDATE CONSTRAINT "AssistantMessage_orgId_fkey";
ALTER TABLE "PrequalCriterion" VALIDATE CONSTRAINT "PrequalCriterion_orgId_fkey";
ALTER TABLE "EvaluationCriterion" VALIDATE CONSTRAINT "EvaluationCriterion_orgId_fkey";

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = '"BoqItemCodeIntegrityReport"'::regclass AND conname = 'BoqItemCodeIntegrityReport_projectId_fkey') THEN
    ALTER TABLE "BoqItemCodeIntegrityReport" ADD CONSTRAINT "BoqItemCodeIntegrityReport_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE NOT VALID;
  END IF;
END $$;
ALTER TABLE "BoqItemCodeIntegrityReport" VALIDATE CONSTRAINT "BoqItemCodeIntegrityReport_projectId_fkey";
