-- Strengthen schedule-driven procurement dates and material traceability.

ALTER TABLE "ProcurementPackage"
  ADD COLUMN "requiredTiming" TEXT NOT NULL DEFAULT 'activity_start',
  ADD COLUMN "needOffsetDays" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "latestOrderDate" TIMESTAMP(3);

UPDATE "ProcurementPackage"
SET "latestOrderDate" = "requiredOnSiteDate" - (
  ("leadWeeks" * INTERVAL '7 days') + ("bufferDays" * INTERVAL '1 day')
)
WHERE "requiredOnSiteDate" IS NOT NULL;

ALTER TABLE "DeliveryReceipt"
  ADD COLUMN "dailyReportId" TEXT;

ALTER TABLE "DeliveryReceiptLine"
  ADD COLUMN "dailyReportId" TEXT;

ALTER TABLE "ActivityMaterialUsage"
  ADD COLUMN "dailyReportId" TEXT;

CREATE INDEX "ProcurementPackage_projectId_requiredOnSiteDate_idx" ON "ProcurementPackage"("projectId", "requiredOnSiteDate");
CREATE INDEX "ProcurementPackage_projectId_latestOrderDate_idx" ON "ProcurementPackage"("projectId", "latestOrderDate");
CREATE INDEX "DeliveryReceipt_dailyReportId_idx" ON "DeliveryReceipt"("dailyReportId");
CREATE INDEX "DeliveryReceiptLine_dailyReportId_idx" ON "DeliveryReceiptLine"("dailyReportId");
CREATE INDEX "ActivityMaterialUsage_dailyReportId_idx" ON "ActivityMaterialUsage"("dailyReportId");

WITH ranked_package_alerts AS (
  SELECT
    "id",
    ROW_NUMBER() OVER (
      PARTITION BY "projectId", "packageId"
      ORDER BY "updatedAt" DESC, "createdAt" DESC, "id" DESC
    ) AS rn
  FROM "ProcurementLeadTimeAlert"
  WHERE "packageId" IS NOT NULL
)
UPDATE "ProcurementLeadTimeAlert" alert
SET
  "packageId" = NULL,
  "status" = CASE WHEN alert."status" = 'resolved' THEN alert."status" ELSE 'resolved' END,
  "resolvedAt" = COALESCE(alert."resolvedAt", NOW()),
  "reason" = CONCAT(alert."reason", ' (duplicate package alert deduplicated during migration)')
FROM ranked_package_alerts ranked
WHERE alert."id" = ranked."id"
  AND ranked.rn > 1;

CREATE UNIQUE INDEX "ProcurementLeadTimeAlert_projectId_packageId_key" ON "ProcurementLeadTimeAlert"("projectId", "packageId");

ALTER TABLE "DeliveryReceipt" ADD CONSTRAINT "DeliveryReceipt_dailyReportId_fkey" FOREIGN KEY ("dailyReportId") REFERENCES "DailyReport"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "DeliveryReceiptLine" ADD CONSTRAINT "DeliveryReceiptLine_dailyReportId_fkey" FOREIGN KEY ("dailyReportId") REFERENCES "DailyReport"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ActivityMaterialUsage" ADD CONSTRAINT "ActivityMaterialUsage_dailyReportId_fkey" FOREIGN KEY ("dailyReportId") REFERENCES "DailyReport"("id") ON DELETE SET NULL ON UPDATE CASCADE;
