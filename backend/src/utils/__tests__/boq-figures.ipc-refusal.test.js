/**
 * An IPC certification refused for want of a PM override states the
 * certification review as error.details — worked from the BOQ rows and
 * their allocations. withheldError leaves it out for a caller who may not
 * read the BOQ and hands a BOQ reader the error untouched (owner check,
 * 2026-09-29). The live proof is
 * services/__live__/ipc-certify-refusal-boq-withholding.live.test.js.
 */
const { HttpError } = require("../http-error");
const { IPC_REVIEW_REFUSALS, IPC_REVIEW_WITHHELD, withheldError } = require("../boq-figures");

const REVIEW = Object.freeze({
  currentClaimedAmount: 18041.57,
  previousCertifiedAmount: 0,
  cumulativeCertifiedAmount: 18041.57,
  earnedAmount: 1804.16,
  approvedLimitAmount: 18041.57,
  overEarnedAmount: 16237.41,
  overApprovedLimitAmount: 0,
  overApprovedQuantity: 0,
  overrideLineCount: 1,
  missingProgressEvidenceCount: 0,
  hasMissingProgressEvidence: false,
  requiresPmOverride: true,
});

const NO_BOQ = { boq: false, budget: false };
const COST_READER = { boq: false, budget: true };
const BOQ_READER = { boq: true, budget: true };

const refusals = [
  [400, "IPC_PM_OVERRIDE_REASON_REQUIRED", "A PM override reason is required when IPC certification exceeds earned or approved value"],
  [403, "IPC_PM_OVERRIDE_REQUIRED", "Only a Project Manager can certify an IPC period with over-limit values"],
];

describe("withheldError — an IPC certification refused for want of a PM override", () => {
  it("names exactly the two refusals that carry the review", () => {
    expect([...IPC_REVIEW_REFUSALS].sort()).toEqual(["IPC_PM_OVERRIDE_REASON_REQUIRED", "IPC_PM_OVERRIDE_REQUIRED"]);
  });

  it.each(refusals)("%s %s: a BOQ reader is given the same error, untouched", (status, code, message) => {
    const error = new HttpError(status, code, message, { ...REVIEW });
    expect(withheldError(error, BOQ_READER)).toBe(error);
  });

  it.each(refusals)("%s %s: without BOQ read — cost readers too — the review is left out, the reason stays", (status, code, message) => {
    for (const access of [NO_BOQ, COST_READER]) {
      const error = new HttpError(status, code, message, { ...REVIEW });
      const withheld = withheldError(error, access);
      expect(withheld).toBeInstanceOf(HttpError);
      expect([withheld.status, withheld.code, withheld.message]).toEqual([status, code, message]);
      expect(withheld.details).toEqual({ boqWithheld: { keys: ["certificationReview"], reason: IPC_REVIEW_WITHHELD } });
      expect(withheld.stack).toBe(error.stack);
      const text = JSON.stringify(withheld.details);
      for (const figure of ["18041.57", "1804.16", "16237.41", "overrideLineCount", "earnedAmount", "approvedLimitAmount"]) {
        expect([figure, text.includes(figure)]).toEqual([figure, false]);
      }
      // The error thrown is not rewritten.
      expect(error.details).toEqual(REVIEW);
    }
  });

  it("leaves the certificate's own figures on the other IPC refusals untouched", () => {
    const payment = new HttpError(400, "IPC_PAYMENT_EXCEEDS_PAYABLE_BALANCE", "Payment amount cannot exceed the current payable balance", { balanceDue: 1200 });
    const release = new HttpError(400, "IPC_RETENTION_RELEASE_EXCEEDS_HELD", "Retention release cannot exceed the retained balance", { retainedBalance: 900 });
    const workflow = new HttpError(409, "WORKFLOW_RUNNING", "A workflow is deciding this record");
    workflow.details = { instanceId: "i-1", templateId: "t-1", currentStepKey: "s-1" };
    for (const error of [payment, release, workflow]) {
      expect(withheldError(error, NO_BOQ)).toBe(error);
    }
  });
});
