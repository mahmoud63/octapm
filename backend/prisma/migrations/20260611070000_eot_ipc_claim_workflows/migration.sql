-- TASK-V3-P1-commercial-eot-delay-claim-workflow
-- TASK-V3-P1-commercial-ipc-payment-controls
-- Add EOT claim workflow evidence metadata and IPC certification override snapshots.
-- Pre-deploy checklist:
--   1. Take a PostgreSQL backup/snapshot before applying.
--   2. Dry-run on a staging clone and reconcile approved EOT and certified IPC records.
--   3. Confirm PM/Finance approval permissions before enabling the workflow UI.

ALTER TABLE "EotClaim"
  ADD COLUMN "submittedBy" TEXT,
  ADD COLUMN "submittedAt" TIMESTAMP(3),
  ADD COLUMN "approvedBy" TEXT,
  ADD COLUMN "approvedAt" TIMESTAMP(3),
  ADD COLUMN "rejectedBy" TEXT,
  ADD COLUMN "rejectedAt" TIMESTAMP(3),
  ADD COLUMN "rejectionReason" TEXT,
  ADD COLUMN "officialAt" TIMESTAMP(3),
  ADD COLUMN "revisedCompletionRecommendation" TIMESTAMP(3),
  ADD COLUMN "cumulativeApprovedEotDays" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "entitlementSummaryJson" JSONB NOT NULL DEFAULT '{}'::jsonb;

UPDATE "EotClaim"
SET
  "submittedAt" = CASE WHEN "status" IN ('submitted', 'approved', 'rejected') THEN "createdAt" ELSE NULL END,
  "approvedAt" = CASE WHEN "status" = 'approved' THEN "updatedAt" ELSE NULL END,
  "officialAt" = CASE WHEN "status" = 'approved' THEN "updatedAt" ELSE NULL END,
  "rejectedAt" = CASE WHEN "status" = 'rejected' THEN "updatedAt" ELSE NULL END,
  "cumulativeApprovedEotDays" = CASE WHEN "status" = 'approved' THEN COALESCE("eotDaysGranted", 0) ELSE 0 END,
  "entitlementSummaryJson" = jsonb_build_object(
    'claimedDelayDays', COALESCE("delayDays", 0),
    'eotDaysGranted', COALESCE("eotDaysGranted", 0),
    'ldLiability', COALESCE("ldLiability", 0),
    'backfill', true
  );

CREATE INDEX "EotClaim_projectId_status_idx"
  ON "EotClaim"("projectId", "status");

ALTER TABLE "IpcCertificate"
  ADD COLUMN "earnedValueAtCertification" DECIMAL(18, 2) NOT NULL DEFAULT 0,
  ADD COLUMN "approvedLimitAtCertification" DECIMAL(18, 2) NOT NULL DEFAULT 0,
  ADD COLUMN "overCertificationAmount" DECIMAL(18, 2) NOT NULL DEFAULT 0,
  ADD COLUMN "certificationOverrideReason" TEXT,
  ADD COLUMN "certificationOverrideBy" TEXT,
  ADD COLUMN "certificationOverrideAt" TIMESTAMP(3);

UPDATE "IpcCertificate"
SET
  "earnedValueAtCertification" = CASE WHEN "status" IN ('certified', 'paid') THEN COALESCE("totalCert", 0) ELSE 0 END,
  "approvedLimitAtCertification" = CASE WHEN "status" IN ('certified', 'paid') THEN COALESCE("totalCert", 0) ELSE 0 END,
  "overCertificationAmount" = 0;

ALTER TABLE "IpcCertificate"
  ADD CONSTRAINT "IpcCertificate_certification_review_money_nonnegative" CHECK (
    "earnedValueAtCertification" >= 0 AND
    "approvedLimitAtCertification" >= 0 AND
    "overCertificationAmount" >= 0
  ) NOT VALID;
