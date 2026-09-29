/**
 * A payment certificate's certification records the certification review —
 * worked from the BOQ rows and their allocations — in the ipc_certificate
 * audit event's summary and the approval event's metadata, with the count
 * of the certificate's lines linked to progress evidence. GET /audit
 * (audit:read, every role) hands them back through withheldAuditHistory:
 * a caller who may not read the BOQ is given the event without them and a
 * `boqWithheld` marker; a BOQ reader is given the history untouched (owner
 * check, 2026-09-29). The live proof is
 * services/__live__/ipc-audit-history-boq-withholding.live.test.js.
 */
const { IPC_REVIEW_WITHHELD, withheldAuditHistory } = require("../boq-figures");

const REVIEW = Object.freeze({
  currentClaimedAmount: 14628.3,
  earnedAmount: 1804.16,
  approvedLimitAmount: 18041.57,
  overEarnedAmount: 12824.14,
  overApprovedLimitAmount: 0,
  overApprovedQuantity: 0,
  overrideLineCount: 1,
  missingProgressEvidenceCount: 0,
  requiresPmOverride: true,
});

const auditCertified = () => ({
  id: "a1",
  source: "audit",
  entityType: "ipc_certificate",
  recordType: "ipc_certificate",
  action: "certified",
  actorId: "u1",
  actorName: "LiveTest PM",
  oldSummary: { period: "P01", status: "submitted", totalCert: 14628.3 },
  newSummary: { period: "P01", status: "certified", totalCert: 14628.3, netPayable: 13896.89 },
  summary: {
    transition: "period.certify",
    period: "P01",
    totalCert: 14628.3,
    netPayable: 13896.89,
    progressLinks: 1,
    certificationReview: { ...REVIEW },
    overrideReason: "LiveTest override",
  },
  metadata: {},
});

const approvalCertified = () => ({
  id: "approval:w1",
  source: "approval",
  entityType: "ipc_certificate",
  recordType: "ipc_certificate",
  action: "certified",
  oldSummary: null,
  newSummary: null,
  summary: { workflowType: "ipc_certificate", decision: null, comment: null },
  metadata: {
    period: "P01",
    totalCert: 14628.3,
    netPayable: 13896.89,
    progressLinks: 1,
    certificationReview: { ...REVIEW },
    overrideReason: "LiveTest override",
  },
});

const submitted = () => ({
  id: "a0",
  source: "audit",
  entityType: "ipc_certificate",
  recordType: "ipc_certificate",
  action: "status_changed",
  summary: { transition: "period.submit", period: "P01", totalCert: 14628.3 },
  metadata: {},
});

const history = () => ({ events: [submitted(), auditCertified(), approvalCertified()], nextCursor: null });

const NO_BOQ = { boq: false, budget: false };
const COST_READER = { boq: false, budget: true };
const BOQ_READER = { boq: true, budget: true };
const MARKER = { keys: ["certificationReview", "progressLinks"], reason: IPC_REVIEW_WITHHELD };

describe("withheldAuditHistory — a payment certificate's certification review", () => {
  it("hands a BOQ reader the history untouched", () => {
    const built = history();
    expect(withheldAuditHistory(built, BOQ_READER)).toBe(built);
  });

  it.each([
    ["no BOQ, no cost", NO_BOQ],
    ["the cost module, no BOQ", COST_READER],
  ])("leaves the review and the progress-link count out for a caller with %s", (_name, access) => {
    const built = history();
    const snapshot = JSON.stringify(built);
    const answer = withheldAuditHistory(built, access);

    // The stored shape is not changed.
    expect(JSON.stringify(built)).toBe(snapshot);

    const [plain, audit, approval] = answer.events;
    // An event with nothing of the review is as built, with no marker.
    expect(plain).toBe(built.events[0]);

    // The business facts stay: who, when, the status, the totals, the reason.
    const { progressLinks: _a, certificationReview: _b, ...auditSummary } = built.events[1].summary;
    expect(audit).toEqual({ ...built.events[1], summary: auditSummary, boqWithheld: MARKER });
    const { progressLinks: _c, certificationReview: _d, ...approvalMetadata } = built.events[2].metadata;
    expect(approval).toEqual({ ...built.events[2], metadata: approvalMetadata, boqWithheld: MARKER });

    const text = JSON.stringify(answer);
    // The marker names what was left out; nothing of it is given.
    for (const secret of ["18041.57", "1804.16", "12824.14", "approvedLimitAmount", "earnedAmount", "overEarnedAmount", "overrideLineCount", "requiresPmOverride"]) {
      expect([secret, text.includes(secret)]).toEqual([secret, false]);
    }
    expect(text).toContain("LiveTest override");
    expect(text).toContain("14628.3");
  });
});
