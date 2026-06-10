-- CreateTable
CREATE TABLE "ChangeOrderActivityLink" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "changeOrderId" TEXT NOT NULL,
    "activityId" TEXT NOT NULL,
    "relationType" TEXT NOT NULL DEFAULT 'affected',
    "scheduleImpactDays" INTEGER NOT NULL DEFAULT 0,
    "floatImpactDays" INTEGER NOT NULL DEFAULT 0,
    "criticalPathImpact" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChangeOrderActivityLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChangeOrderAllocationLink" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "changeOrderId" TEXT NOT NULL,
    "allocationId" TEXT,
    "boqItemId" TEXT,
    "quantity" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "amount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChangeOrderAllocationLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IpcItemProgressLink" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "ipcItemId" TEXT NOT NULL,
    "allocationId" TEXT,
    "activityId" TEXT,
    "progressId" TEXT,
    "approvedPctComplete" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "approvedQuantityComplete" DOUBLE PRECISION,
    "certifiedQuantity" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "certifiedAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "previousCertifiedAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "cutoffDate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IpcItemProgressLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SubValuationActivityLink" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "subValuationId" TEXT NOT NULL,
    "activityId" TEXT NOT NULL,
    "relationType" TEXT NOT NULL DEFAULT 'work_scope',
    "quantity" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "amount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SubValuationActivityLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SubValuationAllocationLink" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "subValuationId" TEXT NOT NULL,
    "allocationId" TEXT,
    "boqItemId" TEXT,
    "quantity" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "workDoneAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "materialsOnSiteAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "retentionAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SubValuationAllocationLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EotClaimActivityLink" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "eotClaimId" TEXT NOT NULL,
    "activityId" TEXT NOT NULL,
    "delayStart" TIMESTAMP(3),
    "delayEnd" TIMESTAMP(3),
    "delayDays" INTEGER NOT NULL DEFAULT 0,
    "floatDays" INTEGER NOT NULL DEFAULT 0,
    "isCritical" BOOLEAN NOT NULL DEFAULT false,
    "criticalPathImpactDays" INTEGER NOT NULL DEFAULT 0,
    "cpmSnapshotJson" JSONB NOT NULL DEFAULT '{}'::jsonb,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EotClaimActivityLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EotClaimWeatherDelayLink" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "eotClaimId" TEXT NOT NULL,
    "weatherDelayId" TEXT NOT NULL,
    "delayStart" TIMESTAMP(3),
    "delayEnd" TIMESTAMP(3),
    "delayDays" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EotClaimWeatherDelayLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WeatherDelayActivityLink" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "weatherDelayId" TEXT NOT NULL,
    "activityId" TEXT NOT NULL,
    "delayStart" TIMESTAMP(3),
    "delayEnd" TIMESTAMP(3),
    "delayDays" INTEGER NOT NULL DEFAULT 0,
    "floatDays" INTEGER NOT NULL DEFAULT 0,
    "isCritical" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WeatherDelayActivityLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommercialCorrespondenceLink" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "recordType" TEXT NOT NULL,
    "recordId" TEXT NOT NULL,
    "correspondenceId" TEXT NOT NULL,
    "relationType" TEXT NOT NULL DEFAULT 'supporting',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CommercialCorrespondenceLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommercialAttachmentRef" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "recordType" TEXT NOT NULL,
    "recordId" TEXT NOT NULL,
    "fileName" TEXT,
    "fileUrl" TEXT,
    "storageKey" TEXT,
    "mimeType" TEXT,
    "description" TEXT,
    "uploadedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CommercialAttachmentRef_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "COActivityLink_unique" ON "ChangeOrderActivityLink"("changeOrderId", "activityId", "relationType");
CREATE INDEX "COActivityLink_project_idx" ON "ChangeOrderActivityLink"("projectId");
CREATE INDEX "COActivityLink_activity_idx" ON "ChangeOrderActivityLink"("activityId");
CREATE INDEX "COActivityLink_project_order_idx" ON "ChangeOrderActivityLink"("projectId", "changeOrderId");

CREATE UNIQUE INDEX "COAllocationLink_unique" ON "ChangeOrderAllocationLink"("changeOrderId", "allocationId");
CREATE INDEX "COAllocationLink_project_idx" ON "ChangeOrderAllocationLink"("projectId");
CREATE INDEX "COAllocationLink_allocation_idx" ON "ChangeOrderAllocationLink"("allocationId");
CREATE INDEX "COAllocationLink_boq_idx" ON "ChangeOrderAllocationLink"("boqItemId");
CREATE INDEX "COAllocationLink_project_order_idx" ON "ChangeOrderAllocationLink"("projectId", "changeOrderId");

CREATE UNIQUE INDEX "IpcProgressLink_unique" ON "IpcItemProgressLink"("ipcItemId", "progressId");
CREATE INDEX "IpcProgressLink_project_idx" ON "IpcItemProgressLink"("projectId");
CREATE INDEX "IpcProgressLink_allocation_idx" ON "IpcItemProgressLink"("allocationId");
CREATE INDEX "IpcProgressLink_activity_idx" ON "IpcItemProgressLink"("activityId");
CREATE INDEX "IpcProgressLink_progress_idx" ON "IpcItemProgressLink"("progressId");

CREATE UNIQUE INDEX "SubValActivityLink_unique" ON "SubValuationActivityLink"("subValuationId", "activityId", "relationType");
CREATE INDEX "SubValActivityLink_project_idx" ON "SubValuationActivityLink"("projectId");
CREATE INDEX "SubValActivityLink_activity_idx" ON "SubValuationActivityLink"("activityId");
CREATE INDEX "SubValActivityLink_project_val_idx" ON "SubValuationActivityLink"("projectId", "subValuationId");

CREATE UNIQUE INDEX "SubValAllocationLink_unique" ON "SubValuationAllocationLink"("subValuationId", "allocationId");
CREATE INDEX "SubValAllocationLink_project_idx" ON "SubValuationAllocationLink"("projectId");
CREATE INDEX "SubValAllocationLink_allocation_idx" ON "SubValuationAllocationLink"("allocationId");
CREATE INDEX "SubValAllocationLink_boq_idx" ON "SubValuationAllocationLink"("boqItemId");
CREATE INDEX "SubValAllocationLink_project_val_idx" ON "SubValuationAllocationLink"("projectId", "subValuationId");

CREATE UNIQUE INDEX "EotActivityLink_unique" ON "EotClaimActivityLink"("eotClaimId", "activityId");
CREATE INDEX "EotActivityLink_project_idx" ON "EotClaimActivityLink"("projectId");
CREATE INDEX "EotActivityLink_activity_idx" ON "EotClaimActivityLink"("activityId");
CREATE INDEX "EotActivityLink_project_claim_idx" ON "EotClaimActivityLink"("projectId", "eotClaimId");

CREATE UNIQUE INDEX "EotWeatherLink_unique" ON "EotClaimWeatherDelayLink"("eotClaimId", "weatherDelayId");
CREATE INDEX "EotWeatherLink_project_idx" ON "EotClaimWeatherDelayLink"("projectId");
CREATE INDEX "EotWeatherLink_weather_idx" ON "EotClaimWeatherDelayLink"("weatherDelayId");
CREATE INDEX "EotWeatherLink_project_claim_idx" ON "EotClaimWeatherDelayLink"("projectId", "eotClaimId");

CREATE UNIQUE INDEX "WeatherActivityLink_unique" ON "WeatherDelayActivityLink"("weatherDelayId", "activityId");
CREATE INDEX "WeatherActivityLink_project_idx" ON "WeatherDelayActivityLink"("projectId");
CREATE INDEX "WeatherActivityLink_activity_idx" ON "WeatherDelayActivityLink"("activityId");
CREATE INDEX "WeatherActivityLink_project_weather_idx" ON "WeatherDelayActivityLink"("projectId", "weatherDelayId");

CREATE UNIQUE INDEX "CommercialCorrespondenceLink_unique" ON "CommercialCorrespondenceLink"("recordType", "recordId", "correspondenceId");
CREATE INDEX "CommercialCorrespondenceLink_project_idx" ON "CommercialCorrespondenceLink"("projectId");
CREATE INDEX "CommercialCorrespondenceLink_record_idx" ON "CommercialCorrespondenceLink"("projectId", "recordType", "recordId");
CREATE INDEX "CommercialCorrespondenceLink_correspondence_idx" ON "CommercialCorrespondenceLink"("correspondenceId");

CREATE INDEX "CommercialAttachmentRef_project_idx" ON "CommercialAttachmentRef"("projectId");
CREATE INDEX "CommercialAttachmentRef_record_idx" ON "CommercialAttachmentRef"("projectId", "recordType", "recordId");

-- AddForeignKey
ALTER TABLE "ChangeOrderActivityLink" ADD CONSTRAINT "COActivityLink_project_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ChangeOrderActivityLink" ADD CONSTRAINT "COActivityLink_order_fkey" FOREIGN KEY ("changeOrderId") REFERENCES "ChangeOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ChangeOrderActivityLink" ADD CONSTRAINT "COActivityLink_activity_fkey" FOREIGN KEY ("activityId") REFERENCES "Activity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ChangeOrderAllocationLink" ADD CONSTRAINT "COAllocationLink_project_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ChangeOrderAllocationLink" ADD CONSTRAINT "COAllocationLink_order_fkey" FOREIGN KEY ("changeOrderId") REFERENCES "ChangeOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ChangeOrderAllocationLink" ADD CONSTRAINT "COAllocationLink_allocation_fkey" FOREIGN KEY ("allocationId") REFERENCES "ActivityBoqAllocation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ChangeOrderAllocationLink" ADD CONSTRAINT "COAllocationLink_boq_fkey" FOREIGN KEY ("boqItemId") REFERENCES "BoqItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "IpcItemProgressLink" ADD CONSTRAINT "IpcProgressLink_project_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "IpcItemProgressLink" ADD CONSTRAINT "IpcProgressLink_item_fkey" FOREIGN KEY ("ipcItemId") REFERENCES "IpcItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "IpcItemProgressLink" ADD CONSTRAINT "IpcProgressLink_allocation_fkey" FOREIGN KEY ("allocationId") REFERENCES "ActivityBoqAllocation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "IpcItemProgressLink" ADD CONSTRAINT "IpcProgressLink_activity_fkey" FOREIGN KEY ("activityId") REFERENCES "Activity"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "IpcItemProgressLink" ADD CONSTRAINT "IpcProgressLink_progress_fkey" FOREIGN KEY ("progressId") REFERENCES "ActivityProgress"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "SubValuationActivityLink" ADD CONSTRAINT "SubValActivityLink_project_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SubValuationActivityLink" ADD CONSTRAINT "SubValActivityLink_val_fkey" FOREIGN KEY ("subValuationId") REFERENCES "SubValuation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SubValuationActivityLink" ADD CONSTRAINT "SubValActivityLink_activity_fkey" FOREIGN KEY ("activityId") REFERENCES "Activity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SubValuationAllocationLink" ADD CONSTRAINT "SubValAllocationLink_project_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SubValuationAllocationLink" ADD CONSTRAINT "SubValAllocationLink_val_fkey" FOREIGN KEY ("subValuationId") REFERENCES "SubValuation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SubValuationAllocationLink" ADD CONSTRAINT "SubValAllocationLink_allocation_fkey" FOREIGN KEY ("allocationId") REFERENCES "ActivityBoqAllocation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SubValuationAllocationLink" ADD CONSTRAINT "SubValAllocationLink_boq_fkey" FOREIGN KEY ("boqItemId") REFERENCES "BoqItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "EotClaimActivityLink" ADD CONSTRAINT "EotActivityLink_project_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "EotClaimActivityLink" ADD CONSTRAINT "EotActivityLink_claim_fkey" FOREIGN KEY ("eotClaimId") REFERENCES "EotClaim"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EotClaimActivityLink" ADD CONSTRAINT "EotActivityLink_activity_fkey" FOREIGN KEY ("activityId") REFERENCES "Activity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "EotClaimWeatherDelayLink" ADD CONSTRAINT "EotWeatherLink_project_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "EotClaimWeatherDelayLink" ADD CONSTRAINT "EotWeatherLink_claim_fkey" FOREIGN KEY ("eotClaimId") REFERENCES "EotClaim"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EotClaimWeatherDelayLink" ADD CONSTRAINT "EotWeatherLink_weather_fkey" FOREIGN KEY ("weatherDelayId") REFERENCES "WeatherDelay"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "WeatherDelayActivityLink" ADD CONSTRAINT "WeatherActivityLink_project_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WeatherDelayActivityLink" ADD CONSTRAINT "WeatherActivityLink_weather_fkey" FOREIGN KEY ("weatherDelayId") REFERENCES "WeatherDelay"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WeatherDelayActivityLink" ADD CONSTRAINT "WeatherActivityLink_activity_fkey" FOREIGN KEY ("activityId") REFERENCES "Activity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CommercialCorrespondenceLink" ADD CONSTRAINT "CommercialCorrespondenceLink_project_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CommercialCorrespondenceLink" ADD CONSTRAINT "CommercialCorrespondenceLink_correspondence_fkey" FOREIGN KEY ("correspondenceId") REFERENCES "Correspondence"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CommercialAttachmentRef" ADD CONSTRAINT "CommercialAttachmentRef_project_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Backfill legacy single-activity change order references.
INSERT INTO "ChangeOrderActivityLink" (
    "id",
    "projectId",
    "changeOrderId",
    "activityId",
    "relationType",
    "scheduleImpactDays",
    "floatImpactDays",
    "criticalPathImpact",
    "createdAt",
    "updatedAt"
)
SELECT
    'co-act-' || md5(co."id" || co."activityId" || co."projectId"),
    co."projectId",
    co."id",
    co."activityId",
    'affected',
    COALESCE(co."scheduleImpact", 0),
    COALESCE(activity."totalFloat", 0),
    COALESCE(activity."isCritical", false) OR COALESCE(activity."totalFloat", 0) <= 0,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM "ChangeOrder" co
JOIN "Activity" activity
    ON activity."id" = co."activityId"
    AND activity."projectId" = co."projectId"
WHERE co."activityId" IS NOT NULL
ON CONFLICT DO NOTHING;

INSERT INTO "ChangeOrderAllocationLink" (
    "id",
    "projectId",
    "changeOrderId",
    "allocationId",
    "boqItemId",
    "quantity",
    "amount",
    "createdAt",
    "updatedAt"
)
SELECT
    'co-alloc-' || md5(co."id" || allocation."id"),
    co."projectId",
    co."id",
    allocation."id",
    allocation."boqItemId",
    0,
    0,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM "ChangeOrder" co
JOIN "ActivityBoqAllocation" allocation
    ON allocation."activityId" = co."activityId"
    AND allocation."projectId" = co."projectId"
    AND allocation."status" = 'approved'
    AND allocation."isActive" = true
WHERE co."activityId" IS NOT NULL
ON CONFLICT DO NOTHING;

-- Backfill IPC certification basis from the latest approved progress on each approved allocation activity.
INSERT INTO "IpcItemProgressLink" (
    "id",
    "projectId",
    "ipcItemId",
    "allocationId",
    "activityId",
    "progressId",
    "approvedPctComplete",
    "approvedQuantityComplete",
    "certifiedQuantity",
    "certifiedAmount",
    "previousCertifiedAmount",
    "cutoffDate",
    "createdAt",
    "updatedAt"
)
SELECT
    'ipc-progress-' || md5(item."id" || progress."id"),
    item."projectId",
    item."id",
    item."allocationId",
    allocation."activityId",
    progress."id",
    COALESCE(progress."pctComplete", 0),
    progress."quantityComplete",
    COALESCE(item."qty", 0),
    COALESCE(item."currentCert", 0),
    COALESCE(item."previousCert", 0),
    progress."updatedAt",
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM "IpcItem" item
JOIN "ActivityBoqAllocation" allocation
    ON allocation."id" = item."allocationId"
    AND allocation."projectId" = item."projectId"
JOIN LATERAL (
    SELECT progress_row.*
    FROM "ActivityProgress" progress_row
    WHERE progress_row."activityId" = allocation."activityId"
        AND progress_row."status" = 'approved'
    ORDER BY progress_row."updatedAt" DESC
    LIMIT 1
) progress ON true
WHERE item."allocationId" IS NOT NULL
ON CONFLICT DO NOTHING;

-- Backfill structured EOT activity links from legacy affectedActivities JSON snapshots.
INSERT INTO "EotClaimActivityLink" (
    "id",
    "projectId",
    "eotClaimId",
    "activityId",
    "delayDays",
    "floatDays",
    "isCritical",
    "criticalPathImpactDays",
    "cpmSnapshotJson",
    "createdAt",
    "updatedAt"
)
SELECT
    'eot-act-' || md5(claim."id" || (affected.value ->> 'id')),
    claim."projectId",
    claim."id",
    affected.value ->> 'id',
    COALESCE(claim."delayDays", 0),
    COALESCE(activity."totalFloat", 0),
    COALESCE(activity."isCritical", false) OR COALESCE(activity."totalFloat", 0) <= 0,
    GREATEST(0, COALESCE(claim."delayDays", 0) - GREATEST(0, COALESCE(activity."totalFloat", 0))),
    jsonb_build_object(
        'totalFloat', activity."totalFloat",
        'isCritical', activity."isCritical",
        'legacyAffectedActivity', affected.value
    ),
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM "EotClaim" claim
CROSS JOIN LATERAL jsonb_array_elements(
    CASE
        WHEN jsonb_typeof(claim."affectedActivities") = 'array' THEN claim."affectedActivities"
        ELSE '[]'::jsonb
    END
) affected(value)
JOIN "Activity" activity
    ON activity."id" = affected.value ->> 'id'
    AND activity."projectId" = claim."projectId"
ON CONFLICT DO NOTHING;
