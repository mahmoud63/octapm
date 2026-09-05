-- OCTA-MOB-PWA-018: Web Push subscriptions, push preference, offline idempotency keys.

CREATE TABLE "PushSubscription" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "endpoint" TEXT NOT NULL,
  "p256dh" TEXT NOT NULL,
  "auth" TEXT NOT NULL,
  "userAgent" TEXT,
  "platform" TEXT,
  "failureCount" INTEGER NOT NULL DEFAULT 0,
  "lastUsedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PushSubscription_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PushSubscription_endpoint_key" ON "PushSubscription"("endpoint");
CREATE INDEX "PushSubscription_orgId_idx" ON "PushSubscription"("orgId");
CREATE INDEX "PushSubscription_userId_idx" ON "PushSubscription"("userId");

ALTER TABLE "PushSubscription"
  ADD CONSTRAINT "PushSubscription_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PushSubscription"
  ADD CONSTRAINT "PushSubscription_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "NotificationPreference" ADD COLUMN "pushEnabled" BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE "PunchItem" ADD COLUMN "clientRequestId" TEXT;
CREATE UNIQUE INDEX "PunchItem_projectId_clientRequestId_key" ON "PunchItem"("projectId", "clientRequestId");

ALTER TABLE "Attachment" ADD COLUMN "clientRequestId" TEXT;
CREATE INDEX "Attachment_projectId_clientRequestId_idx" ON "Attachment"("projectId", "clientRequestId");
