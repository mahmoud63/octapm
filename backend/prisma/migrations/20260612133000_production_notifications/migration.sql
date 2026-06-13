-- Production notification state, user preferences, and auditable delivery attempts.

CREATE TABLE "Notification" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "projectId" TEXT,
  "recipientUserId" TEXT NOT NULL,
  "actorId" TEXT,
  "type" TEXT NOT NULL,
  "category" TEXT NOT NULL,
  "event" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "message" TEXT NOT NULL,
  "priority" TEXT NOT NULL DEFAULT 'normal',
  "inAppVisible" BOOLEAN NOT NULL DEFAULT true,
  "readAt" TIMESTAMP(3),
  "archivedAt" TIMESTAMP(3),
  "dueAt" TIMESTAMP(3),
  "actionUrl" TEXT,
  "entityType" TEXT,
  "entityId" TEXT,
  "dedupeKey" TEXT,
  "metadataJson" JSONB NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "NotificationPreference" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "category" TEXT NOT NULL,
  "inAppEnabled" BOOLEAN NOT NULL DEFAULT true,
  "emailEnabled" BOOLEAN NOT NULL DEFAULT true,
  "digestEnabled" BOOLEAN NOT NULL DEFAULT false,
  "dueSoonDays" INTEGER NOT NULL DEFAULT 3,
  "quietHoursStart" TEXT,
  "quietHoursEnd" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "NotificationPreference_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "NotificationDeliveryAttempt" (
  "id" TEXT NOT NULL,
  "notificationId" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "channel" TEXT NOT NULL,
  "provider" TEXT,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "attemptNumber" INTEGER NOT NULL DEFAULT 1,
  "errorCode" TEXT,
  "errorMessage" TEXT,
  "nextAttemptAt" TIMESTAMP(3),
  "sentAt" TIMESTAMP(3),
  "metadataJson" JSONB NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "NotificationDeliveryAttempt_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Notification_dedupeKey_key" ON "Notification"("dedupeKey");
CREATE INDEX "Notification_orgId_idx" ON "Notification"("orgId");
CREATE INDEX "Notification_projectId_idx" ON "Notification"("projectId");
CREATE INDEX "Notification_recipientUserId_idx" ON "Notification"("recipientUserId");
CREATE INDEX "Notification_orgId_recipientUserId_createdAt_idx" ON "Notification"("orgId", "recipientUserId", "createdAt");
CREATE INDEX "Notification_orgId_recipientUserId_readAt_archivedAt_idx" ON "Notification"("orgId", "recipientUserId", "readAt", "archivedAt");
CREATE INDEX "Notification_orgId_recipientUserId_category_createdAt_idx" ON "Notification"("orgId", "recipientUserId", "category", "createdAt");
CREATE INDEX "Notification_entityType_entityId_idx" ON "Notification"("entityType", "entityId");
CREATE INDEX "Notification_dueAt_idx" ON "Notification"("dueAt");

CREATE UNIQUE INDEX "NotificationPreference_userId_category_key" ON "NotificationPreference"("userId", "category");
CREATE INDEX "NotificationPreference_orgId_idx" ON "NotificationPreference"("orgId");
CREATE INDEX "NotificationPreference_orgId_userId_idx" ON "NotificationPreference"("orgId", "userId");

CREATE INDEX "NotificationDeliveryAttempt_notificationId_idx" ON "NotificationDeliveryAttempt"("notificationId");
CREATE INDEX "NotificationDeliveryAttempt_orgId_userId_createdAt_idx" ON "NotificationDeliveryAttempt"("orgId", "userId", "createdAt");
CREATE INDEX "NotificationDeliveryAttempt_status_nextAttemptAt_idx" ON "NotificationDeliveryAttempt"("status", "nextAttemptAt");
CREATE INDEX "NotificationDeliveryAttempt_channel_status_idx" ON "NotificationDeliveryAttempt"("channel", "status");

ALTER TABLE "Notification"
  ADD CONSTRAINT "Notification_orgId_fkey"
  FOREIGN KEY ("orgId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Notification"
  ADD CONSTRAINT "Notification_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Notification"
  ADD CONSTRAINT "Notification_recipientUserId_fkey"
  FOREIGN KEY ("recipientUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Notification"
  ADD CONSTRAINT "Notification_actorId_fkey"
  FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "NotificationPreference"
  ADD CONSTRAINT "NotificationPreference_orgId_fkey"
  FOREIGN KEY ("orgId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "NotificationPreference"
  ADD CONSTRAINT "NotificationPreference_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "NotificationDeliveryAttempt"
  ADD CONSTRAINT "NotificationDeliveryAttempt_notificationId_fkey"
  FOREIGN KEY ("notificationId") REFERENCES "Notification"("id") ON DELETE CASCADE ON UPDATE CASCADE;
