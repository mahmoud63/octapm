-- OCTA-COMM-COMMENT-009: one Comment table for every record type, explicit
-- @mentions, and RecordSubscription (who follows which record). Existing
-- owners / reviewers / approvers / assignees / ball-in-court holders are
-- subscribed to their records so the first comment reaches the right people.

CREATE TABLE "Comment" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "recordType" TEXT NOT NULL,
  "recordId" TEXT NOT NULL,
  "parentId" TEXT,
  "authorId" TEXT,
  "body" TEXT NOT NULL,
  "editedAt" TIMESTAMP(3),
  "deletedAt" TIMESTAMP(3),
  "deletedBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "Comment_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Comment_orgId_idx" ON "Comment"("orgId");
CREATE INDEX "Comment_projectId_recordType_recordId_createdAt_idx" ON "Comment"("projectId", "recordType", "recordId", "createdAt");
CREATE INDEX "Comment_authorId_idx" ON "Comment"("authorId");
CREATE INDEX "Comment_parentId_idx" ON "Comment"("parentId");

ALTER TABLE "Comment"
  ADD CONSTRAINT "Comment_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Comment"
  ADD CONSTRAINT "Comment_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Comment"
  ADD CONSTRAINT "Comment_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Comment"
  ADD CONSTRAINT "Comment_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Comment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "CommentMention" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "commentId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "CommentMention_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CommentMention_commentId_userId_key" ON "CommentMention"("commentId", "userId");
CREATE INDEX "CommentMention_orgId_idx" ON "CommentMention"("orgId");
CREATE INDEX "CommentMention_userId_idx" ON "CommentMention"("userId");

ALTER TABLE "CommentMention"
  ADD CONSTRAINT "CommentMention_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CommentMention"
  ADD CONSTRAINT "CommentMention_commentId_fkey" FOREIGN KEY ("commentId") REFERENCES "Comment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CommentMention"
  ADD CONSTRAINT "CommentMention_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "RecordSubscription" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "recordType" TEXT NOT NULL,
  "recordId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "reason" TEXT NOT NULL DEFAULT 'manual',
  "muted" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "RecordSubscription_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "RecordSubscription_recordType_recordId_userId_key" ON "RecordSubscription"("recordType", "recordId", "userId");
CREATE INDEX "RecordSubscription_orgId_idx" ON "RecordSubscription"("orgId");
CREATE INDEX "RecordSubscription_projectId_recordType_recordId_idx" ON "RecordSubscription"("projectId", "recordType", "recordId");
CREATE INDEX "RecordSubscription_userId_muted_idx" ON "RecordSubscription"("userId", "muted");

ALTER TABLE "RecordSubscription"
  ADD CONSTRAINT "RecordSubscription_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RecordSubscription"
  ADD CONSTRAINT "RecordSubscription_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RecordSubscription"
  ADD CONSTRAINT "RecordSubscription_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: everyone already referenced on a record follows it.
DO $$
DECLARE
  entry RECORD;
  col TEXT;
BEGIN
  FOR entry IN
    SELECT * FROM (VALUES
      ('Rfi', 'rfi'),
      ('Submittal', 'submittal'),
      ('NcrRecord', 'ncr'),
      ('ItpRecord', 'itp'),
      ('DefectRecord', 'defect'),
      ('SafetyIncident', 'safety_incident'),
      ('MaterialTest', 'material_test'),
      ('DrawingRecord', 'drawing'),
      ('Transmittal', 'transmittal'),
      ('Correspondence', 'correspondence'),
      ('Risk', 'risk')
    ) AS v(table_name, record_type)
  LOOP
    FOREACH col IN ARRAY ARRAY['ownerUserId', 'reviewerUserId', 'approverUserId', 'assigneeUserId', 'ballInCourtUserId']
    LOOP
      EXECUTE format(
        'INSERT INTO "RecordSubscription" ("id", "orgId", "projectId", "recordType", "recordId", "userId", "reason", "muted", "createdAt", "updatedAt")
         SELECT gen_random_uuid()::text, p."orgId", r."projectId", %L, r."id", r.%I, ''assigned'', false, NOW(), NOW()
         FROM %I r
         JOIN "Project" p ON p."id" = r."projectId"
         JOIN "User" u ON u."id" = r.%I
         WHERE r.%I IS NOT NULL
         ON CONFLICT ("recordType", "recordId", "userId") DO NOTHING',
        entry.record_type, col, entry.table_name, col, col
      );
    END LOOP;
  END LOOP;
END $$;
