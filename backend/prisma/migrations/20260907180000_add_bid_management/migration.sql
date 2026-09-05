-- OCTA-PRE-BID-027: bid packages, invitations with portal tokens, Q&A, addenda, bids, leveling and award.

CREATE TABLE "BidPackage" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "number" INTEGER NOT NULL,
  "ref" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "description" TEXT,
  "instructions" TEXT,
  "status" TEXT NOT NULL DEFAULT 'draft',
  "dueAt" TIMESTAMP(3),
  "questionsDueAt" TIMESTAMP(3),
  "currency" TEXT NOT NULL DEFAULT 'USD',
  "boqSections" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "commitmentType" TEXT NOT NULL DEFAULT 'subcontract',
  "settingsJson" JSONB NOT NULL DEFAULT '{}',
  "createdBy" TEXT,
  "updatedBy" TEXT,
  "publishedAt" TIMESTAMP(3),
  "closedAt" TIMESTAMP(3),
  "awardedAt" TIMESTAMP(3),
  "awardedBidId" TEXT,
  "awardedCommitmentId" TEXT,
  "softAwardBidId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "BidPackage_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "BidPackage_projectId_ref_key" ON "BidPackage"("projectId", "ref");
CREATE INDEX "BidPackage_orgId_status_idx" ON "BidPackage"("orgId", "status");
CREATE INDEX "BidPackage_projectId_status_idx" ON "BidPackage"("projectId", "status");

ALTER TABLE "BidPackage"
  ADD CONSTRAINT "BidPackage_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "BidPackage_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "BidPackageLine" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "packageId" TEXT NOT NULL,
  "lineNumber" INTEGER NOT NULL,
  "boqItemId" TEXT,
  "section" TEXT,
  "code" TEXT,
  "description" TEXT NOT NULL,
  "unit" TEXT,
  "qty" DECIMAL(18,3) NOT NULL DEFAULT 1,
  "estimateRate" DECIMAL(18,2),
  "budgetLineId" TEXT,
  "costCodeId" TEXT,
  "activityId" TEXT,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "BidPackageLine_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "BidPackageLine_packageId_idx" ON "BidPackageLine"("packageId");

ALTER TABLE "BidPackageLine"
  ADD CONSTRAINT "BidPackageLine_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "BidPackage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "BidAddendum" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "packageId" TEXT NOT NULL,
  "number" INTEGER NOT NULL,
  "title" TEXT NOT NULL,
  "body" TEXT,
  "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "issuedBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "BidAddendum_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "BidAddendum_packageId_idx" ON "BidAddendum"("packageId");

ALTER TABLE "BidAddendum"
  ADD CONSTRAINT "BidAddendum_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "BidPackage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "BidInvitation" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "packageId" TEXT NOT NULL,
  "vendorCompanyId" TEXT,
  "companyName" TEXT NOT NULL,
  "contactName" TEXT,
  "contactEmail" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'invited',
  "invitedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "viewedAt" TIMESTAMP(3),
  "lastAccessAt" TIMESTAMP(3),
  "declinedReason" TEXT,
  "remindersSent" INTEGER NOT NULL DEFAULT 0,
  "createdBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "BidInvitation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "BidInvitation_tokenHash_key" ON "BidInvitation"("tokenHash");
CREATE UNIQUE INDEX "BidInvitation_packageId_contactEmail_key" ON "BidInvitation"("packageId", "contactEmail");
CREATE INDEX "BidInvitation_packageId_status_idx" ON "BidInvitation"("packageId", "status");

ALTER TABLE "BidInvitation"
  ADD CONSTRAINT "BidInvitation_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "BidPackage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "BidQuestion" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "packageId" TEXT NOT NULL,
  "invitationId" TEXT,
  "question" TEXT NOT NULL,
  "askedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "askedBy" TEXT,
  "answer" TEXT,
  "answeredAt" TIMESTAMP(3),
  "answeredBy" TEXT,
  "shared" BOOLEAN NOT NULL DEFAULT false,
  "status" TEXT NOT NULL DEFAULT 'open',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "BidQuestion_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "BidQuestion_packageId_status_idx" ON "BidQuestion"("packageId", "status");

ALTER TABLE "BidQuestion"
  ADD CONSTRAINT "BidQuestion_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "BidPackage"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "BidQuestion_invitationId_fkey" FOREIGN KEY ("invitationId") REFERENCES "BidInvitation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "Bid" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "packageId" TEXT NOT NULL,
  "invitationId" TEXT NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "status" TEXT NOT NULL DEFAULT 'draft',
  "total" DECIMAL(18,2) NOT NULL DEFAULT 0,
  "currency" TEXT,
  "notes" TEXT,
  "inclusions" TEXT,
  "exclusions" TEXT,
  "validityDays" INTEGER,
  "leadTimeDays" INTEGER,
  "documentId" TEXT,
  "submittedAt" TIMESTAMP(3),
  "submittedBy" TEXT,
  "withdrawnAt" TIMESTAMP(3),
  "awardedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Bid_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Bid_invitationId_key" ON "Bid"("invitationId");
CREATE INDEX "Bid_packageId_status_idx" ON "Bid"("packageId", "status");

ALTER TABLE "Bid"
  ADD CONSTRAINT "Bid_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "BidPackage"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "Bid_invitationId_fkey" FOREIGN KEY ("invitationId") REFERENCES "BidInvitation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "BidLine" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "bidId" TEXT NOT NULL,
  "packageLineId" TEXT NOT NULL,
  "rate" DECIMAL(18,2),
  "amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
  "included" BOOLEAN NOT NULL DEFAULT true,
  "note" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "BidLine_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "BidLine_bidId_packageLineId_key" ON "BidLine"("bidId", "packageLineId");

ALTER TABLE "BidLine"
  ADD CONSTRAINT "BidLine_bidId_fkey" FOREIGN KEY ("bidId") REFERENCES "Bid"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "BidLine_packageLineId_fkey" FOREIGN KEY ("packageLineId") REFERENCES "BidPackageLine"("id") ON DELETE CASCADE ON UPDATE CASCADE;
