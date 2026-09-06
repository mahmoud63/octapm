-- OCTA-COMM-CONV-042: conversations (direct / group / record threads) and inbound email.

ALTER TABLE "Project"
  ADD COLUMN "inboundEmailToken" TEXT,
  ADD COLUMN "inboundEmailAutoLog" BOOLEAN NOT NULL DEFAULT false;
CREATE UNIQUE INDEX "Project_inboundEmailToken_key" ON "Project"("inboundEmailToken");

CREATE TABLE "Conversation" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "projectId" TEXT,
  "kind" TEXT NOT NULL DEFAULT 'group',
  "title" TEXT,
  "directKey" TEXT,
  "recordType" TEXT,
  "recordId" TEXT,
  "recordTitle" TEXT,
  "lastMessageAt" TIMESTAMP(3),
  "lastMessagePreview" TEXT,
  "messageCount" INTEGER NOT NULL DEFAULT 0,
  "archivedAt" TIMESTAMP(3),
  "archivedBy" TEXT,
  "createdBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Conversation_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Conversation_orgId_directKey_key" ON "Conversation"("orgId", "directKey");
CREATE INDEX "Conversation_orgId_lastMessageAt_idx" ON "Conversation"("orgId", "lastMessageAt");
CREATE INDEX "Conversation_projectId_kind_idx" ON "Conversation"("projectId", "kind");
CREATE INDEX "Conversation_orgId_recordType_recordId_idx" ON "Conversation"("orgId", "recordType", "recordId");
ALTER TABLE "Conversation"
  ADD CONSTRAINT "Conversation_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "Conversation_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "ConversationMember" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "conversationId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "role" TEXT NOT NULL DEFAULT 'member',
  "lastReadAt" TIMESTAMP(3),
  "starred" BOOLEAN NOT NULL DEFAULT false,
  "muted" BOOLEAN NOT NULL DEFAULT false,
  "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "leftAt" TIMESTAMP(3),
  CONSTRAINT "ConversationMember_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ConversationMember_conversationId_userId_key" ON "ConversationMember"("conversationId", "userId");
CREATE INDEX "ConversationMember_orgId_idx" ON "ConversationMember"("orgId");
CREATE INDEX "ConversationMember_userId_leftAt_idx" ON "ConversationMember"("userId", "leftAt");
ALTER TABLE "ConversationMember"
  ADD CONSTRAINT "ConversationMember_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "ConversationMember_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "ConversationMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "ConversationMessage" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "conversationId" TEXT NOT NULL,
  "authorId" TEXT,
  "kind" TEXT NOT NULL DEFAULT 'text',
  "body" TEXT NOT NULL,
  "mentionsJson" JSONB NOT NULL DEFAULT '[]',
  "linkedRecordType" TEXT,
  "linkedRecordId" TEXT,
  "linkedRecordTitle" TEXT,
  "linkedProjectId" TEXT,
  "inboundEmailId" TEXT,
  "editedAt" TIMESTAMP(3),
  "deletedAt" TIMESTAMP(3),
  "deletedBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ConversationMessage_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ConversationMessage_orgId_idx" ON "ConversationMessage"("orgId");
CREATE INDEX "ConversationMessage_conversationId_createdAt_idx" ON "ConversationMessage"("conversationId", "createdAt");
CREATE INDEX "ConversationMessage_authorId_idx" ON "ConversationMessage"("authorId");
ALTER TABLE "ConversationMessage"
  ADD CONSTRAINT "ConversationMessage_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "ConversationMessage_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "ConversationMessage_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "InboundEmail" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "projectId" TEXT,
  "provider" TEXT NOT NULL,
  "messageId" TEXT,
  "inReplyTo" TEXT,
  "referencesJson" JSONB NOT NULL DEFAULT '[]',
  "fromEmail" TEXT NOT NULL,
  "fromName" TEXT,
  "toJson" JSONB NOT NULL DEFAULT '[]',
  "ccJson" JSONB NOT NULL DEFAULT '[]',
  "subject" TEXT NOT NULL,
  "textBody" TEXT NOT NULL,
  "htmlBody" TEXT,
  "replyText" TEXT,
  "attachmentsJson" JSONB NOT NULL DEFAULT '[]',
  "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "status" TEXT NOT NULL DEFAULT 'received',
  "target" TEXT,
  "recordType" TEXT,
  "recordId" TEXT,
  "conversationId" TEXT,
  "commentId" TEXT,
  "messageRowId" TEXT,
  "correspondenceId" TEXT,
  "senderUserId" TEXT,
  "error" TEXT,
  "processedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "InboundEmail_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "InboundEmail_orgId_provider_messageId_key" ON "InboundEmail"("orgId", "provider", "messageId");
CREATE INDEX "InboundEmail_projectId_status_receivedAt_idx" ON "InboundEmail"("projectId", "status", "receivedAt");
CREATE INDEX "InboundEmail_orgId_receivedAt_idx" ON "InboundEmail"("orgId", "receivedAt");
CREATE INDEX "InboundEmail_recordType_recordId_idx" ON "InboundEmail"("recordType", "recordId");
ALTER TABLE "InboundEmail"
  ADD CONSTRAINT "InboundEmail_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "InboundEmail_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "InboundEmail_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
