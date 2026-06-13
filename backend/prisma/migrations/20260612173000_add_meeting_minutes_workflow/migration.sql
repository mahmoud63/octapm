-- Project meeting minutes with agenda, attendees, decisions, action items,
-- distribution history, comments, notifications, and audit traceability.

CREATE TABLE "Meeting" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "activityId" TEXT,
  "meetingNumber" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "meetingType" TEXT NOT NULL DEFAULT 'coordination',
  "location" TEXT,
  "scheduledAt" TIMESTAMP(3),
  "startedAt" TIMESTAMP(3),
  "endedAt" TIMESTAMP(3),
  "status" TEXT NOT NULL DEFAULT 'draft',
  "objective" TEXT,
  "minutesText" TEXT,
  "nextMeetingAt" TIMESTAMP(3),
  "chairId" TEXT,
  "createdById" TEXT,
  "updatedById" TEXT,
  "distributedById" TEXT,
  "distributedAt" TIMESTAMP(3),
  "archivedAt" TIMESTAMP(3),
  "archivedBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "Meeting_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MeetingAttendee" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "meetingId" TEXT NOT NULL,
  "activityId" TEXT,
  "userId" TEXT,
  "projectPartyId" TEXT,
  "name" TEXT,
  "email" TEXT,
  "companyName" TEXT,
  "role" TEXT NOT NULL DEFAULT 'attendee',
  "attendanceStatus" TEXT NOT NULL DEFAULT 'invited',
  "distributionRequired" BOOLEAN NOT NULL DEFAULT true,
  "attendedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "MeetingAttendee_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MeetingAgendaItem" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "meetingId" TEXT NOT NULL,
  "activityId" TEXT,
  "presenterId" TEXT,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "title" TEXT NOT NULL,
  "notes" TEXT,
  "status" TEXT NOT NULL DEFAULT 'open',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "MeetingAgendaItem_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MeetingDecision" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "meetingId" TEXT NOT NULL,
  "activityId" TEXT,
  "decidedById" TEXT,
  "title" TEXT NOT NULL,
  "decision" TEXT NOT NULL,
  "impact" TEXT,
  "decidedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "MeetingDecision_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MeetingActionItem" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "meetingId" TEXT NOT NULL,
  "activityId" TEXT,
  "taskId" TEXT,
  "itemNumber" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "description" TEXT,
  "ownerId" TEXT,
  "ownerName" TEXT,
  "ownerEmail" TEXT,
  "dueDate" TIMESTAMP(3) NOT NULL,
  "priority" TEXT NOT NULL DEFAULT 'medium',
  "status" TEXT NOT NULL DEFAULT 'open',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "MeetingActionItem_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MeetingDistribution" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "meetingId" TEXT NOT NULL,
  "activityId" TEXT,
  "recipientUserId" TEXT,
  "projectPartyId" TEXT,
  "recipientName" TEXT,
  "recipientEmail" TEXT,
  "companyName" TEXT,
  "channel" TEXT NOT NULL DEFAULT 'email',
  "status" TEXT NOT NULL DEFAULT 'sent',
  "message" TEXT,
  "sentById" TEXT,
  "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "metadataJson" JSONB NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "MeetingDistribution_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MeetingComment" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "meetingId" TEXT NOT NULL,
  "activityId" TEXT,
  "authorId" TEXT,
  "body" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "MeetingComment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Meeting_projectId_meetingNumber_key" ON "Meeting"("projectId", "meetingNumber");
CREATE INDEX "Meeting_orgId_idx" ON "Meeting"("orgId");
CREATE INDEX "Meeting_projectId_idx" ON "Meeting"("projectId");
CREATE INDEX "Meeting_projectId_status_scheduledAt_idx" ON "Meeting"("projectId", "status", "scheduledAt");
CREATE INDEX "Meeting_projectId_meetingType_idx" ON "Meeting"("projectId", "meetingType");
CREATE INDEX "Meeting_activityId_idx" ON "Meeting"("activityId");
CREATE INDEX "Meeting_chairId_idx" ON "Meeting"("chairId");
CREATE INDEX "Meeting_createdById_idx" ON "Meeting"("createdById");
CREATE INDEX "Meeting_distributedAt_idx" ON "Meeting"("distributedAt");
CREATE INDEX "Meeting_archivedAt_idx" ON "Meeting"("archivedAt");

CREATE INDEX "MeetingAttendee_orgId_idx" ON "MeetingAttendee"("orgId");
CREATE INDEX "MeetingAttendee_projectId_idx" ON "MeetingAttendee"("projectId");
CREATE INDEX "MeetingAttendee_meetingId_idx" ON "MeetingAttendee"("meetingId");
CREATE INDEX "MeetingAttendee_activityId_idx" ON "MeetingAttendee"("activityId");
CREATE INDEX "MeetingAttendee_userId_idx" ON "MeetingAttendee"("userId");
CREATE INDEX "MeetingAttendee_projectPartyId_idx" ON "MeetingAttendee"("projectPartyId");
CREATE INDEX "MeetingAttendee_meetingId_attendanceStatus_idx" ON "MeetingAttendee"("meetingId", "attendanceStatus");

CREATE INDEX "MeetingAgendaItem_orgId_idx" ON "MeetingAgendaItem"("orgId");
CREATE INDEX "MeetingAgendaItem_projectId_idx" ON "MeetingAgendaItem"("projectId");
CREATE INDEX "MeetingAgendaItem_meetingId_sortOrder_idx" ON "MeetingAgendaItem"("meetingId", "sortOrder");
CREATE INDEX "MeetingAgendaItem_activityId_idx" ON "MeetingAgendaItem"("activityId");
CREATE INDEX "MeetingAgendaItem_presenterId_idx" ON "MeetingAgendaItem"("presenterId");

CREATE INDEX "MeetingDecision_orgId_idx" ON "MeetingDecision"("orgId");
CREATE INDEX "MeetingDecision_projectId_idx" ON "MeetingDecision"("projectId");
CREATE INDEX "MeetingDecision_meetingId_idx" ON "MeetingDecision"("meetingId");
CREATE INDEX "MeetingDecision_activityId_idx" ON "MeetingDecision"("activityId");
CREATE INDEX "MeetingDecision_decidedById_idx" ON "MeetingDecision"("decidedById");
CREATE INDEX "MeetingDecision_decidedAt_idx" ON "MeetingDecision"("decidedAt");

CREATE UNIQUE INDEX "MeetingActionItem_meetingId_itemNumber_key" ON "MeetingActionItem"("meetingId", "itemNumber");
CREATE INDEX "MeetingActionItem_orgId_idx" ON "MeetingActionItem"("orgId");
CREATE INDEX "MeetingActionItem_projectId_idx" ON "MeetingActionItem"("projectId");
CREATE INDEX "MeetingActionItem_meetingId_idx" ON "MeetingActionItem"("meetingId");
CREATE INDEX "MeetingActionItem_activityId_idx" ON "MeetingActionItem"("activityId");
CREATE INDEX "MeetingActionItem_taskId_idx" ON "MeetingActionItem"("taskId");
CREATE INDEX "MeetingActionItem_ownerId_idx" ON "MeetingActionItem"("ownerId");
CREATE INDEX "MeetingActionItem_projectId_status_dueDate_idx" ON "MeetingActionItem"("projectId", "status", "dueDate");

CREATE INDEX "MeetingDistribution_orgId_idx" ON "MeetingDistribution"("orgId");
CREATE INDEX "MeetingDistribution_projectId_idx" ON "MeetingDistribution"("projectId");
CREATE INDEX "MeetingDistribution_meetingId_idx" ON "MeetingDistribution"("meetingId");
CREATE INDEX "MeetingDistribution_activityId_idx" ON "MeetingDistribution"("activityId");
CREATE INDEX "MeetingDistribution_recipientUserId_idx" ON "MeetingDistribution"("recipientUserId");
CREATE INDEX "MeetingDistribution_projectPartyId_idx" ON "MeetingDistribution"("projectPartyId");
CREATE INDEX "MeetingDistribution_sentAt_idx" ON "MeetingDistribution"("sentAt");

CREATE INDEX "MeetingComment_orgId_idx" ON "MeetingComment"("orgId");
CREATE INDEX "MeetingComment_projectId_idx" ON "MeetingComment"("projectId");
CREATE INDEX "MeetingComment_meetingId_createdAt_idx" ON "MeetingComment"("meetingId", "createdAt");
CREATE INDEX "MeetingComment_activityId_idx" ON "MeetingComment"("activityId");
CREATE INDEX "MeetingComment_authorId_idx" ON "MeetingComment"("authorId");

ALTER TABLE "Meeting" ADD CONSTRAINT "Meeting_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Meeting" ADD CONSTRAINT "Meeting_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Meeting" ADD CONSTRAINT "Meeting_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "Activity"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Meeting" ADD CONSTRAINT "Meeting_chairId_fkey" FOREIGN KEY ("chairId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Meeting" ADD CONSTRAINT "Meeting_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Meeting" ADD CONSTRAINT "Meeting_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Meeting" ADD CONSTRAINT "Meeting_distributedById_fkey" FOREIGN KEY ("distributedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "MeetingAttendee" ADD CONSTRAINT "MeetingAttendee_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MeetingAttendee" ADD CONSTRAINT "MeetingAttendee_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MeetingAttendee" ADD CONSTRAINT "MeetingAttendee_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "Meeting"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MeetingAttendee" ADD CONSTRAINT "MeetingAttendee_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "Activity"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "MeetingAttendee" ADD CONSTRAINT "MeetingAttendee_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "MeetingAttendee" ADD CONSTRAINT "MeetingAttendee_projectPartyId_fkey" FOREIGN KEY ("projectPartyId") REFERENCES "ProjectParty"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "MeetingAgendaItem" ADD CONSTRAINT "MeetingAgendaItem_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MeetingAgendaItem" ADD CONSTRAINT "MeetingAgendaItem_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MeetingAgendaItem" ADD CONSTRAINT "MeetingAgendaItem_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "Meeting"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MeetingAgendaItem" ADD CONSTRAINT "MeetingAgendaItem_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "Activity"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "MeetingAgendaItem" ADD CONSTRAINT "MeetingAgendaItem_presenterId_fkey" FOREIGN KEY ("presenterId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "MeetingDecision" ADD CONSTRAINT "MeetingDecision_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MeetingDecision" ADD CONSTRAINT "MeetingDecision_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MeetingDecision" ADD CONSTRAINT "MeetingDecision_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "Meeting"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MeetingDecision" ADD CONSTRAINT "MeetingDecision_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "Activity"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "MeetingDecision" ADD CONSTRAINT "MeetingDecision_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "MeetingActionItem" ADD CONSTRAINT "MeetingActionItem_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MeetingActionItem" ADD CONSTRAINT "MeetingActionItem_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MeetingActionItem" ADD CONSTRAINT "MeetingActionItem_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "Meeting"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MeetingActionItem" ADD CONSTRAINT "MeetingActionItem_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "Activity"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "MeetingActionItem" ADD CONSTRAINT "MeetingActionItem_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "MeetingActionItem" ADD CONSTRAINT "MeetingActionItem_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "MeetingDistribution" ADD CONSTRAINT "MeetingDistribution_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MeetingDistribution" ADD CONSTRAINT "MeetingDistribution_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MeetingDistribution" ADD CONSTRAINT "MeetingDistribution_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "Meeting"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MeetingDistribution" ADD CONSTRAINT "MeetingDistribution_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "Activity"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "MeetingDistribution" ADD CONSTRAINT "MeetingDistribution_recipientUserId_fkey" FOREIGN KEY ("recipientUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "MeetingDistribution" ADD CONSTRAINT "MeetingDistribution_projectPartyId_fkey" FOREIGN KEY ("projectPartyId") REFERENCES "ProjectParty"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "MeetingDistribution" ADD CONSTRAINT "MeetingDistribution_sentById_fkey" FOREIGN KEY ("sentById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "MeetingComment" ADD CONSTRAINT "MeetingComment_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MeetingComment" ADD CONSTRAINT "MeetingComment_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MeetingComment" ADD CONSTRAINT "MeetingComment_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "Meeting"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MeetingComment" ADD CONSTRAINT "MeetingComment_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "Activity"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "MeetingComment" ADD CONSTRAINT "MeetingComment_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
