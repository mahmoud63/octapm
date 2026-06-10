-- TASK-P0-database-use-decimal-money-values
-- Production migration notes:
-- 1. Take a full pg_dump backup before applying this migration.
-- 2. Dry-run against a restored production snapshot and compare financial reports before/after.
-- 3. This migration rounds legacy double precision money to cents while casting to numeric(18,2).
-- 4. Rollback strategy: restore the pg_dump backup, or reverse these ALTER COLUMN statements to
--    DOUBLE PRECISION USING column::double precision if a restore is not required.

ALTER TABLE "Project"
  ALTER COLUMN "contractValue" TYPE DECIMAL(18, 2) USING ROUND("contractValue"::numeric, 2),
  ALTER COLUMN "ldRatePerDay" TYPE DECIMAL(18, 2) USING ROUND("ldRatePerDay"::numeric, 2);

ALTER TABLE "BoqItem"
  ALTER COLUMN "rate" TYPE DECIMAL(18, 2) USING ROUND("rate"::numeric, 2),
  ALTER COLUMN "amount" TYPE DECIMAL(18, 2) USING ROUND("amount"::numeric, 2);

ALTER TABLE "BoqRevision"
  ALTER COLUMN "totalAmount" TYPE DECIMAL(18, 2) USING ROUND("totalAmount"::numeric, 2);

ALTER TABLE "BoqActivity"
  ALTER COLUMN "rate" TYPE DECIMAL(18, 2) USING ROUND("rate"::numeric, 2),
  ALTER COLUMN "budget" TYPE DECIMAL(18, 2) USING ROUND("budget"::numeric, 2);

ALTER TABLE "Activity"
  ALTER COLUMN "budget" TYPE DECIMAL(18, 2) USING ROUND("budget"::numeric, 2);

ALTER TABLE "ActivityBoqAllocation"
  ALTER COLUMN "amount" TYPE DECIMAL(18, 2) USING ROUND("amount"::numeric, 2);

ALTER TABLE "ActivityProgress"
  ALTER COLUMN "actualCost" TYPE DECIMAL(18, 2) USING ROUND("actualCost"::numeric, 2);

ALTER TABLE "ProgressSubmission"
  ALTER COLUMN "actualCost" TYPE DECIMAL(18, 2) USING ROUND("actualCost"::numeric, 2);

ALTER TABLE "ScheduleRevision"
  ALTER COLUMN "totalBudget" TYPE DECIMAL(18, 2) USING ROUND("totalBudget"::numeric, 2);

ALTER TABLE "CostRecord"
  ALTER COLUMN "labour" TYPE DECIMAL(18, 2) USING ROUND("labour"::numeric, 2),
  ALTER COLUMN "material" TYPE DECIMAL(18, 2) USING ROUND("material"::numeric, 2),
  ALTER COLUMN "equipment" TYPE DECIMAL(18, 2) USING ROUND("equipment"::numeric, 2),
  ALTER COLUMN "subcontract" TYPE DECIMAL(18, 2) USING ROUND("subcontract"::numeric, 2),
  ALTER COLUMN "indirect" TYPE DECIMAL(18, 2) USING ROUND("indirect"::numeric, 2),
  ALTER COLUMN "overhead" TYPE DECIMAL(18, 2) USING ROUND("overhead"::numeric, 2),
  ALTER COLUMN "contingency" TYPE DECIMAL(18, 2) USING ROUND("contingency"::numeric, 2),
  ALTER COLUMN "budget" TYPE DECIMAL(18, 2) USING ROUND("budget"::numeric, 2),
  ALTER COLUMN "committed" TYPE DECIMAL(18, 2) USING ROUND("committed"::numeric, 2),
  ALTER COLUMN "actual" TYPE DECIMAL(18, 2) USING ROUND("actual"::numeric, 2),
  ALTER COLUMN "forecast" TYPE DECIMAL(18, 2) USING ROUND("forecast"::numeric, 2);

ALTER TABLE "ActivityCostLoading"
  ALTER COLUMN "plannedValue" TYPE DECIMAL(18, 2) USING ROUND("plannedValue"::numeric, 2);

ALTER TABLE "EvPeriodSnapshot"
  ALTER COLUMN "totalBudget" TYPE DECIMAL(18, 2) USING ROUND("totalBudget"::numeric, 2),
  ALTER COLUMN "pv" TYPE DECIMAL(18, 2) USING ROUND("pv"::numeric, 2),
  ALTER COLUMN "ev" TYPE DECIMAL(18, 2) USING ROUND("ev"::numeric, 2),
  ALTER COLUMN "ac" TYPE DECIMAL(18, 2) USING ROUND("ac"::numeric, 2),
  ALTER COLUMN "eac" TYPE DECIMAL(18, 2) USING ROUND("eac"::numeric, 2),
  ALTER COLUMN "sv" TYPE DECIMAL(18, 2) USING ROUND("sv"::numeric, 2),
  ALTER COLUMN "cv" TYPE DECIMAL(18, 2) USING ROUND("cv"::numeric, 2),
  ALTER COLUMN "etc" TYPE DECIMAL(18, 2) USING ROUND("etc"::numeric, 2);

ALTER TABLE "ChangeOrder"
  ALTER COLUMN "value" TYPE DECIMAL(18, 2) USING ROUND("value"::numeric, 2);

ALTER TABLE "ChangeOrderAllocationLink"
  ALTER COLUMN "amount" TYPE DECIMAL(18, 2) USING ROUND("amount"::numeric, 2);

ALTER TABLE "IpcItem"
  ALTER COLUMN "rate" TYPE DECIMAL(18, 2) USING ROUND("rate"::numeric, 2),
  ALTER COLUMN "previousCert" TYPE DECIMAL(18, 2) USING ROUND("previousCert"::numeric, 2),
  ALTER COLUMN "currentCert" TYPE DECIMAL(18, 2) USING ROUND("currentCert"::numeric, 2),
  ALTER COLUMN "cumulativeCert" TYPE DECIMAL(18, 2) USING ROUND("cumulativeCert"::numeric, 2),
  ALTER COLUMN "retention" TYPE DECIMAL(18, 2) USING ROUND("retention"::numeric, 2),
  ALTER COLUMN "netPayable" TYPE DECIMAL(18, 2) USING ROUND("netPayable"::numeric, 2);

ALTER TABLE "IpcItemProgressLink"
  ALTER COLUMN "certifiedAmount" TYPE DECIMAL(18, 2) USING ROUND("certifiedAmount"::numeric, 2),
  ALTER COLUMN "previousCertifiedAmount" TYPE DECIMAL(18, 2) USING ROUND("previousCertifiedAmount"::numeric, 2);

ALTER TABLE "IpcCertificate"
  ALTER COLUMN "totalCert" TYPE DECIMAL(18, 2) USING ROUND("totalCert"::numeric, 2),
  ALTER COLUMN "totalRet" TYPE DECIMAL(18, 2) USING ROUND("totalRet"::numeric, 2),
  ALTER COLUMN "netPayable" TYPE DECIMAL(18, 2) USING ROUND("netPayable"::numeric, 2);

ALTER TABLE "BurnRateEntry"
  ALTER COLUMN "amount" TYPE DECIMAL(18, 2) USING ROUND("amount"::numeric, 2);

ALTER TABLE "SubValuation"
  ALTER COLUMN "workDone" TYPE DECIMAL(18, 2) USING ROUND("workDone"::numeric, 2),
  ALTER COLUMN "materialsOnSite" TYPE DECIMAL(18, 2) USING ROUND("materialsOnSite"::numeric, 2),
  ALTER COLUMN "grossPayable" TYPE DECIMAL(18, 2) USING ROUND("grossPayable"::numeric, 2),
  ALTER COLUMN "retention" TYPE DECIMAL(18, 2) USING ROUND("retention"::numeric, 2),
  ALTER COLUMN "backCharges" TYPE DECIMAL(18, 2) USING ROUND("backCharges"::numeric, 2),
  ALTER COLUMN "netPayable" TYPE DECIMAL(18, 2) USING ROUND("netPayable"::numeric, 2);

ALTER TABLE "SubValuationActivityLink"
  ALTER COLUMN "amount" TYPE DECIMAL(18, 2) USING ROUND("amount"::numeric, 2);

ALTER TABLE "SubValuationAllocationLink"
  ALTER COLUMN "workDoneAmount" TYPE DECIMAL(18, 2) USING ROUND("workDoneAmount"::numeric, 2),
  ALTER COLUMN "materialsOnSiteAmount" TYPE DECIMAL(18, 2) USING ROUND("materialsOnSiteAmount"::numeric, 2),
  ALTER COLUMN "retentionAmount" TYPE DECIMAL(18, 2) USING ROUND("retentionAmount"::numeric, 2);

ALTER TABLE "BudgetRevision"
  ALTER COLUMN "amount" TYPE DECIMAL(18, 2) USING ROUND("amount"::numeric, 2),
  ALTER COLUMN "cumulativeBudget" TYPE DECIMAL(18, 2) USING ROUND("cumulativeBudget"::numeric, 2);

ALTER TABLE "CashFlowEntry"
  ALTER COLUMN "inflow" TYPE DECIMAL(18, 2) USING ROUND("inflow"::numeric, 2),
  ALTER COLUMN "outflow" TYPE DECIMAL(18, 2) USING ROUND("outflow"::numeric, 2);

ALTER TABLE "EotClaim"
  ALTER COLUMN "ldRatePerDay" TYPE DECIMAL(18, 2) USING ROUND("ldRatePerDay"::numeric, 2),
  ALTER COLUMN "ldLiability" TYPE DECIMAL(18, 2) USING ROUND("ldLiability"::numeric, 2);

ALTER TABLE "ProcurementOrder"
  ALTER COLUMN "value" TYPE DECIMAL(18, 2) USING ROUND("value"::numeric, 2);

ALTER TABLE "MaterialMaster"
  ALTER COLUMN "unitCost" TYPE DECIMAL(18, 2) USING ROUND("unitCost"::numeric, 2);

ALTER TABLE "Equipment"
  ALTER COLUMN "rate" TYPE DECIMAL(18, 2) USING ROUND("rate"::numeric, 2);

ALTER TABLE "ResourceAllocation"
  ALTER COLUMN "dailyRate" TYPE DECIMAL(18, 2) USING ROUND("dailyRate"::numeric, 2),
  ALTER COLUMN "totalCost" TYPE DECIMAL(18, 2) USING ROUND("totalCost"::numeric, 2);

ALTER TABLE "Invoice"
  ALTER COLUMN "amount" TYPE DECIMAL(18, 2) USING ROUND("amount"::numeric, 2);

ALTER TABLE "Project"
  ADD CONSTRAINT "Project_contractValue_money_nonnegative" CHECK ("contractValue" IS NULL OR "contractValue" >= 0) NOT VALID,
  ADD CONSTRAINT "Project_ldRatePerDay_money_nonnegative" CHECK ("ldRatePerDay" >= 0) NOT VALID;

ALTER TABLE "BoqItem"
  ADD CONSTRAINT "BoqItem_rate_money_nonnegative" CHECK ("rate" >= 0) NOT VALID,
  ADD CONSTRAINT "BoqItem_amount_money_nonnegative" CHECK ("amount" >= 0) NOT VALID;

ALTER TABLE "BoqRevision"
  ADD CONSTRAINT "BoqRevision_totalAmount_money_nonnegative" CHECK ("totalAmount" >= 0) NOT VALID;

ALTER TABLE "BoqActivity"
  ADD CONSTRAINT "BoqActivity_rate_money_nonnegative" CHECK ("rate" >= 0) NOT VALID,
  ADD CONSTRAINT "BoqActivity_budget_money_nonnegative" CHECK ("budget" >= 0) NOT VALID;

ALTER TABLE "Activity"
  ADD CONSTRAINT "Activity_budget_money_nonnegative" CHECK ("budget" >= 0) NOT VALID;

ALTER TABLE "ActivityBoqAllocation"
  ADD CONSTRAINT "ActivityBoqAllocation_amount_money_nonnegative" CHECK ("amount" >= 0) NOT VALID;

ALTER TABLE "ActivityProgress"
  ADD CONSTRAINT "ActivityProgress_actualCost_money_nonnegative" CHECK ("actualCost" IS NULL OR "actualCost" >= 0) NOT VALID;

ALTER TABLE "ProgressSubmission"
  ADD CONSTRAINT "ProgressSubmission_actualCost_money_nonnegative" CHECK ("actualCost" IS NULL OR "actualCost" >= 0) NOT VALID;

ALTER TABLE "ScheduleRevision"
  ADD CONSTRAINT "ScheduleRevision_totalBudget_money_nonnegative" CHECK ("totalBudget" >= 0) NOT VALID;

ALTER TABLE "CostRecord"
  ADD CONSTRAINT "CostRecord_money_nonnegative" CHECK (
    "labour" >= 0 AND "material" >= 0 AND "equipment" >= 0 AND "subcontract" >= 0 AND
    "indirect" >= 0 AND "overhead" >= 0 AND "contingency" >= 0 AND "budget" >= 0 AND
    "committed" >= 0 AND "actual" >= 0 AND "forecast" >= 0
  ) NOT VALID;

ALTER TABLE "ActivityCostLoading"
  ADD CONSTRAINT "ActivityCostLoading_plannedValue_money_nonnegative" CHECK ("plannedValue" >= 0) NOT VALID;

ALTER TABLE "ChangeOrder"
  ADD CONSTRAINT "ChangeOrder_value_money_nonnegative" CHECK ("value" >= 0) NOT VALID;

ALTER TABLE "ChangeOrderAllocationLink"
  ADD CONSTRAINT "ChangeOrderAllocationLink_amount_money_nonnegative" CHECK ("amount" >= 0) NOT VALID;

ALTER TABLE "IpcItem"
  ADD CONSTRAINT "IpcItem_money_nonnegative" CHECK (
    "rate" >= 0 AND "previousCert" >= 0 AND "currentCert" >= 0 AND "cumulativeCert" >= 0 AND
    "retention" >= 0 AND "netPayable" >= 0
  ) NOT VALID;

ALTER TABLE "IpcItemProgressLink"
  ADD CONSTRAINT "IpcItemProgressLink_money_nonnegative" CHECK (
    "certifiedAmount" >= 0 AND "previousCertifiedAmount" >= 0
  ) NOT VALID;

ALTER TABLE "IpcCertificate"
  ADD CONSTRAINT "IpcCertificate_money_nonnegative" CHECK (
    "totalCert" >= 0 AND "totalRet" >= 0 AND "netPayable" >= 0
  ) NOT VALID;

ALTER TABLE "BurnRateEntry"
  ADD CONSTRAINT "BurnRateEntry_amount_money_nonnegative" CHECK ("amount" >= 0) NOT VALID;

ALTER TABLE "SubValuation"
  ADD CONSTRAINT "SubValuation_money_nonnegative" CHECK (
    "workDone" >= 0 AND "materialsOnSite" >= 0 AND "grossPayable" >= 0 AND
    "retention" >= 0 AND "backCharges" >= 0 AND "netPayable" >= 0
  ) NOT VALID;

ALTER TABLE "SubValuationActivityLink"
  ADD CONSTRAINT "SubValuationActivityLink_amount_money_nonnegative" CHECK ("amount" >= 0) NOT VALID;

ALTER TABLE "SubValuationAllocationLink"
  ADD CONSTRAINT "SubValuationAllocationLink_money_nonnegative" CHECK (
    "workDoneAmount" >= 0 AND "materialsOnSiteAmount" >= 0 AND "retentionAmount" >= 0
  ) NOT VALID;

ALTER TABLE "BudgetRevision"
  ADD CONSTRAINT "BudgetRevision_amount_money_nonnegative" CHECK ("amount" >= 0) NOT VALID;

ALTER TABLE "CashFlowEntry"
  ADD CONSTRAINT "CashFlowEntry_money_nonnegative" CHECK ("inflow" >= 0 AND "outflow" >= 0) NOT VALID;

ALTER TABLE "EotClaim"
  ADD CONSTRAINT "EotClaim_money_nonnegative" CHECK ("ldRatePerDay" >= 0 AND "ldLiability" >= 0) NOT VALID;

ALTER TABLE "ProcurementOrder"
  ADD CONSTRAINT "ProcurementOrder_value_money_nonnegative" CHECK ("value" >= 0) NOT VALID;

ALTER TABLE "MaterialMaster"
  ADD CONSTRAINT "MaterialMaster_unitCost_money_nonnegative" CHECK ("unitCost" >= 0) NOT VALID;

ALTER TABLE "Equipment"
  ADD CONSTRAINT "Equipment_rate_money_nonnegative" CHECK ("rate" >= 0) NOT VALID;

ALTER TABLE "ResourceAllocation"
  ADD CONSTRAINT "ResourceAllocation_money_nonnegative" CHECK (
    ("dailyRate" IS NULL OR "dailyRate" >= 0) AND ("totalCost" IS NULL OR "totalCost" >= 0)
  ) NOT VALID;

ALTER TABLE "Invoice"
  ADD CONSTRAINT "Invoice_amount_money_nonnegative" CHECK ("amount" >= 0) NOT VALID;
