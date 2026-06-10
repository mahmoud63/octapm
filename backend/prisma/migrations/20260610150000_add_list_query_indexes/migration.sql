CREATE INDEX "Activity_projectId_isActive_sortOrder_idx" ON "Activity"("projectId", "isActive", "sortOrder");
CREATE INDEX "Activity_projectId_isActive_category_idx" ON "Activity"("projectId", "isActive", "category");

CREATE INDEX "Rfi_projectId_status_createdAt_idx" ON "Rfi"("projectId", "status", "createdAt");
CREATE INDEX "Rfi_projectId_priority_createdAt_idx" ON "Rfi"("projectId", "priority", "createdAt");
CREATE INDEX "Rfi_projectId_dueDate_idx" ON "Rfi"("projectId", "dueDate");
CREATE INDEX "Rfi_projectId_updatedAt_idx" ON "Rfi"("projectId", "updatedAt");

CREATE INDEX "Submittal_projectId_status_createdAt_idx" ON "Submittal"("projectId", "status", "createdAt");
CREATE INDEX "Submittal_projectId_dueDate_idx" ON "Submittal"("projectId", "dueDate");
CREATE INDEX "Submittal_projectId_updatedAt_idx" ON "Submittal"("projectId", "updatedAt");

CREATE INDEX "CostRecord_projectId_updatedAt_idx" ON "CostRecord"("projectId", "updatedAt");
CREATE INDEX "CostRecord_projectId_actual_idx" ON "CostRecord"("projectId", "actual");
CREATE INDEX "CostRecord_projectId_forecast_idx" ON "CostRecord"("projectId", "forecast");
