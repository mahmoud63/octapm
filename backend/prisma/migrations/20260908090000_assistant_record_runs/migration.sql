-- OCTA-AI-RFI-029: AI runs on records (RFI drafts, suggested responses, thread summaries)
-- are stored as assistant conversations of a kind other than "chat".

ALTER TABLE "AssistantConversation"
  ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'chat',
  ADD COLUMN "recordType" TEXT,
  ADD COLUMN "recordId" TEXT;

CREATE INDEX "AssistantConversation_orgId_recordType_recordId_idx" ON "AssistantConversation"("orgId", "recordType", "recordId");
