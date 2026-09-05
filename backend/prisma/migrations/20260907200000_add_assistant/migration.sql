-- OCTA-AI-ASSIST-028: project knowledge assistant conversations and messages with citations.

CREATE TABLE "AssistantConversation" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "projectId" TEXT,
  "userId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "lastMessageAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AssistantConversation_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AssistantConversation_orgId_userId_lastMessageAt_idx" ON "AssistantConversation"("orgId", "userId", "lastMessageAt");
CREATE INDEX "AssistantConversation_projectId_idx" ON "AssistantConversation"("projectId");

ALTER TABLE "AssistantConversation"
  ADD CONSTRAINT "AssistantConversation_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "AssistantConversation_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "AssistantConversation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "AssistantMessage" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "conversationId" TEXT NOT NULL,
  "role" TEXT NOT NULL,
  "content" TEXT NOT NULL,
  "citationsJson" JSONB NOT NULL DEFAULT '[]',
  "actionsJson" JSONB NOT NULL DEFAULT '[]',
  "sourcesJson" JSONB NOT NULL DEFAULT '[]',
  "usageJson" JSONB,
  "provider" TEXT,
  "model" TEXT,
  "feedback" TEXT,
  "feedbackNote" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AssistantMessage_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AssistantMessage_conversationId_createdAt_idx" ON "AssistantMessage"("conversationId", "createdAt");

ALTER TABLE "AssistantMessage"
  ADD CONSTRAINT "AssistantMessage_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "AssistantConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
