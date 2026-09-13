-- One cost-record projection row per (project, activity): every writer now holds the pair, and this is the last line (Phase 21D, CX21-474).
CREATE UNIQUE INDEX "CostRecord_projectId_activityId_key" ON "CostRecord"("projectId", "activityId");
