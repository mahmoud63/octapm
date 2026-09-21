-- Shared state for running several API tasks at once. Additive only: three
-- new tables, nothing existing is altered.

-- The socket.io Postgres adapter's overflow table for payloads larger than a
-- NOTIFY can carry. The adapter queries it by this exact, unquoted name.
-- CreateTable
CREATE TABLE "socket_io_attachments" (
    "id" BIGSERIAL NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "payload" BYTEA,

    CONSTRAINT "socket_io_attachments_pkey" PRIMARY KEY ("id")
);

-- Failed sign-in counts by email and by address, shared by every task.
-- CreateTable
CREATE TABLE "AuthThrottle" (
    "scope" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "failures" INTEGER NOT NULL DEFAULT 0,
    "backoffUntil" TIMESTAMP(3),
    "lockedUntil" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AuthThrottle_pkey" PRIMARY KEY ("scope","key")
);

-- Rate-limit counters. UNLOGGED: a counter is worthless after a crash, and
-- skipping the write-ahead log keeps each hit to one cheap upsert. (Prisma's
-- diff cannot express UNLOGGED and does not report it as drift.)
-- CreateTable
CREATE UNLOGGED TABLE "RateLimitBucket" (
    "key" TEXT NOT NULL,
    "count" INTEGER NOT NULL,
    "resetAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RateLimitBucket_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE INDEX "AuthThrottle_updatedAt_idx" ON "AuthThrottle"("updatedAt");

-- CreateIndex
CREATE INDEX "RateLimitBucket_resetAt_idx" ON "RateLimitBucket"("resetAt");
