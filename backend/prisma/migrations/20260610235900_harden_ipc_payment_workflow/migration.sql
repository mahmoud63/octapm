-- TASK-P1-domain-improve-ipc-payment-workflow
-- Add explicit IPC invoice, payment, and retention release tracking.
-- Pre-deploy checklist:
--   1. Take a PostgreSQL backup/snapshot before applying.
--   2. Dry-run on a staging clone and reconcile existing IPC paid/certified totals.
--   3. Confirm finance users are prepared for invoice/payment status fields replacing direct paid status edits.

ALTER TABLE "IpcCertificate"
  ADD COLUMN "invoiceStatus" TEXT NOT NULL DEFAULT 'not_issued',
  ADD COLUMN "paymentStatus" TEXT NOT NULL DEFAULT 'unpaid',
  ADD COLUMN "retentionStatus" TEXT NOT NULL DEFAULT 'held',
  ADD COLUMN "amountPaid" DECIMAL(18, 2) NOT NULL DEFAULT 0,
  ADD COLUMN "retentionReleased" DECIMAL(18, 2) NOT NULL DEFAULT 0,
  ADD COLUMN "balanceDue" DECIMAL(18, 2) NOT NULL DEFAULT 0;

UPDATE "IpcCertificate"
SET
  "paymentStatus" = CASE
    WHEN "status" = 'paid' THEN 'paid'
    WHEN "status" = 'certified' THEN 'unpaid'
    ELSE 'unpaid'
  END,
  "amountPaid" = CASE
    WHEN "status" = 'paid' THEN COALESCE("netPayable", 0)
    ELSE 0
  END,
  "balanceDue" = CASE
    WHEN "status" = 'certified' THEN COALESCE("netPayable", 0)
    ELSE 0
  END,
  "retentionStatus" = CASE
    WHEN COALESCE("totalRet", 0) <= 0 THEN 'released'
    ELSE 'held'
  END;

CREATE TABLE "IpcInvoice" (
  "id" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "ipcCertificateId" TEXT NOT NULL,
  "invoiceNumber" TEXT NOT NULL,
  "invoiceDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "dueDate" TIMESTAMP(3),
  "grossAmount" DECIMAL(18, 2) NOT NULL DEFAULT 0,
  "retentionHeld" DECIMAL(18, 2) NOT NULL DEFAULT 0,
  "retentionReleased" DECIMAL(18, 2) NOT NULL DEFAULT 0,
  "netAmount" DECIMAL(18, 2) NOT NULL DEFAULT 0,
  "amountPaid" DECIMAL(18, 2) NOT NULL DEFAULT 0,
  "balanceDue" DECIMAL(18, 2) NOT NULL DEFAULT 0,
  "status" TEXT NOT NULL DEFAULT 'issued',
  "issuedBy" TEXT,
  "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "voidedBy" TEXT,
  "voidedAt" TIMESTAMP(3),
  "voidReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "IpcInvoice_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "IpcPayment" (
  "id" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "ipcCertificateId" TEXT NOT NULL,
  "invoiceId" TEXT,
  "paymentReference" TEXT NOT NULL,
  "paymentDate" TIMESTAMP(3) NOT NULL,
  "amount" DECIMAL(18, 2) NOT NULL DEFAULT 0,
  "paymentMethod" TEXT,
  "notes" TEXT,
  "receivedBy" TEXT,
  "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "IpcPayment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "IpcRetentionRelease" (
  "id" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "ipcCertificateId" TEXT NOT NULL,
  "releaseReference" TEXT NOT NULL,
  "releaseDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "amount" DECIMAL(18, 2) NOT NULL DEFAULT 0,
  "reason" TEXT,
  "releasedBy" TEXT,
  "releasedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "IpcRetentionRelease_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "IpcInvoice_projectId_invoiceNumber_key"
  ON "IpcInvoice"("projectId", "invoiceNumber");
CREATE UNIQUE INDEX "IpcInvoice_ipcCertificateId_key"
  ON "IpcInvoice"("ipcCertificateId");
CREATE INDEX "IpcInvoice_projectId_idx" ON "IpcInvoice"("projectId");
CREATE INDEX "IpcInvoice_projectId_status_idx" ON "IpcInvoice"("projectId", "status");

CREATE UNIQUE INDEX "IpcPayment_projectId_paymentReference_key"
  ON "IpcPayment"("projectId", "paymentReference");
CREATE INDEX "IpcPayment_projectId_idx" ON "IpcPayment"("projectId");
CREATE INDEX "IpcPayment_ipcCertificateId_idx" ON "IpcPayment"("ipcCertificateId");
CREATE INDEX "IpcPayment_invoiceId_idx" ON "IpcPayment"("invoiceId");
CREATE INDEX "IpcPayment_projectId_paymentDate_idx" ON "IpcPayment"("projectId", "paymentDate");

CREATE UNIQUE INDEX "IpcRetentionRelease_projectId_releaseReference_key"
  ON "IpcRetentionRelease"("projectId", "releaseReference");
CREATE INDEX "IpcRetentionRelease_projectId_idx" ON "IpcRetentionRelease"("projectId");
CREATE INDEX "IpcRetentionRelease_ipcCertificateId_idx" ON "IpcRetentionRelease"("ipcCertificateId");
CREATE INDEX "IpcRetentionRelease_projectId_releaseDate_idx"
  ON "IpcRetentionRelease"("projectId", "releaseDate");

CREATE INDEX "IpcCertificate_projectId_invoiceStatus_idx"
  ON "IpcCertificate"("projectId", "invoiceStatus");
CREATE INDEX "IpcCertificate_projectId_paymentStatus_idx"
  ON "IpcCertificate"("projectId", "paymentStatus");

ALTER TABLE "IpcInvoice"
  ADD CONSTRAINT "IpcInvoice_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "IpcInvoice"
  ADD CONSTRAINT "IpcInvoice_ipcCertificateId_fkey"
  FOREIGN KEY ("ipcCertificateId") REFERENCES "IpcCertificate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "IpcPayment"
  ADD CONSTRAINT "IpcPayment_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "IpcPayment"
  ADD CONSTRAINT "IpcPayment_ipcCertificateId_fkey"
  FOREIGN KEY ("ipcCertificateId") REFERENCES "IpcCertificate"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "IpcPayment"
  ADD CONSTRAINT "IpcPayment_invoiceId_fkey"
  FOREIGN KEY ("invoiceId") REFERENCES "IpcInvoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "IpcRetentionRelease"
  ADD CONSTRAINT "IpcRetentionRelease_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "IpcRetentionRelease"
  ADD CONSTRAINT "IpcRetentionRelease_ipcCertificateId_fkey"
  FOREIGN KEY ("ipcCertificateId") REFERENCES "IpcCertificate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "IpcCertificate"
  ADD CONSTRAINT "IpcCertificate_payment_money_nonnegative" CHECK (
    "amountPaid" >= 0 AND "retentionReleased" >= 0 AND "balanceDue" >= 0
  ) NOT VALID,
  ADD CONSTRAINT "IpcCertificate_invoice_status_valid" CHECK (
    "invoiceStatus" IN ('not_issued', 'issued', 'void')
  ) NOT VALID,
  ADD CONSTRAINT "IpcCertificate_payment_status_valid" CHECK (
    "paymentStatus" IN ('unpaid', 'partially_paid', 'paid')
  ) NOT VALID,
  ADD CONSTRAINT "IpcCertificate_retention_status_valid" CHECK (
    "retentionStatus" IN ('held', 'partially_released', 'released')
  ) NOT VALID;

ALTER TABLE "IpcInvoice"
  ADD CONSTRAINT "IpcInvoice_money_nonnegative" CHECK (
    "grossAmount" >= 0 AND "retentionHeld" >= 0 AND "retentionReleased" >= 0 AND
    "netAmount" >= 0 AND "amountPaid" >= 0 AND "balanceDue" >= 0
  ) NOT VALID,
  ADD CONSTRAINT "IpcInvoice_status_valid" CHECK (
    "status" IN ('issued', 'partially_paid', 'paid', 'void')
  ) NOT VALID;

ALTER TABLE "IpcPayment"
  ADD CONSTRAINT "IpcPayment_amount_money_positive" CHECK ("amount" > 0) NOT VALID;

ALTER TABLE "IpcRetentionRelease"
  ADD CONSTRAINT "IpcRetentionRelease_amount_money_positive" CHECK ("amount" > 0) NOT VALID;
