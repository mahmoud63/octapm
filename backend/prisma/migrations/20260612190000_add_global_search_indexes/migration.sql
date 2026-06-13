CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS "Project_search_name_trgm_idx" ON "Project" USING GIN ("name" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "Project_search_contractNumber_trgm_idx" ON "Project" USING GIN ("contractNumber" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "Activity_search_name_trgm_idx" ON "Activity" USING GIN ("name" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "Activity_search_activityCode_trgm_idx" ON "Activity" USING GIN ("activityCode" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "Activity_search_p6ActivityId_trgm_idx" ON "Activity" USING GIN ("p6ActivityId" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "BoqItem_search_description_trgm_idx" ON "BoqItem" USING GIN ("description" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "BoqItem_search_code_trgm_idx" ON "BoqItem" USING GIN ("code" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "Rfi_search_ref_trgm_idx" ON "Rfi" USING GIN ("ref" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "Rfi_search_subject_trgm_idx" ON "Rfi" USING GIN ("subject" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "Submittal_search_ref_trgm_idx" ON "Submittal" USING GIN ("ref" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "Submittal_search_title_trgm_idx" ON "Submittal" USING GIN ("title" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "DrawingRecord_search_number_trgm_idx" ON "DrawingRecord" USING GIN ("drawingNumber" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "DrawingRecord_search_title_trgm_idx" ON "DrawingRecord" USING GIN ("title" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "DocumentRevision_search_title_trgm_idx" ON "DocumentRevision" USING GIN ("title" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "DocumentRevision_search_documentNumber_trgm_idx" ON "DocumentRevision" USING GIN ("documentNumber" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "DocumentRevision_search_fileName_trgm_idx" ON "DocumentRevision" USING GIN ("fileName" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "ChangeOrder_search_ref_trgm_idx" ON "ChangeOrder" USING GIN ("ref" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "ChangeOrder_search_description_trgm_idx" ON "ChangeOrder" USING GIN ("description" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "IpcCertificate_search_period_trgm_idx" ON "IpcCertificate" USING GIN ("period" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "Risk_search_ref_trgm_idx" ON "Risk" USING GIN ("ref" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "Risk_search_description_trgm_idx" ON "Risk" USING GIN ("description" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "ProcurementPackage_search_packageNumber_trgm_idx" ON "ProcurementPackage" USING GIN ("packageNumber" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "ProcurementPackage_search_title_trgm_idx" ON "ProcurementPackage" USING GIN ("title" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "LongLeadItem_search_item_trgm_idx" ON "LongLeadItem" USING GIN ("item" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "Meeting_search_meetingNumber_trgm_idx" ON "Meeting" USING GIN ("meetingNumber" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "Meeting_search_title_trgm_idx" ON "Meeting" USING GIN ("title" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "Task_search_taskNumber_trgm_idx" ON "Task" USING GIN ("taskNumber" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "Task_search_title_trgm_idx" ON "Task" USING GIN ("title" gin_trgm_ops);
