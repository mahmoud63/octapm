jest.mock("../../config/db", () => ({ prisma: {} }));

const { clockOf, actionWith, STATUS } = require("../external-review.service");
const sources = require("../external-review-sources");
const consultant = require("../consultant.service");

const H = 60 * 60 * 1000;
const D = 24 * H;

describe("External review engine (CONSULTANT V1): the clock", () => {
  const submittedAt = new Date("2026-10-11T10:34:00Z");
  const dueAt = new Date("2026-10-15T17:00:00Z");

  test("an unanswered cycle is open from its submission, not from the record's creation; overdue once past due", () => {
    const now = new Date(submittedAt.getTime() + 6 * D + 4 * H);
    const clock = clockOf({ submittedAt, dueAt, respondedAt: null, withdrawnAt: null }, now);
    expect(clock.open).toBe(true);
    expect(clock.openMs).toBe(6 * D + 4 * H);
    expect(clock.responseMs).toBeNull();
    expect(clock.overdue).toBe(true);
    expect(clock.overdueMs).toBe(now - dueAt);
  });

  test("an answered cycle stops the clock: response time = respondedAt − submittedAt; late answers keep how late they were", () => {
    const onTime = clockOf({ submittedAt, dueAt, respondedAt: new Date(submittedAt.getTime() + 2 * D), withdrawnAt: null }, new Date("2026-12-01T00:00:00Z"));
    expect(onTime).toMatchObject({ open: false, responseMs: 2 * D, overdue: false, overdueMs: 0, respondedLate: false });
    const late = clockOf({ submittedAt, dueAt, respondedAt: new Date(dueAt.getTime() + 3 * H), withdrawnAt: null }, new Date("2026-12-01T00:00:00Z"));
    expect(late).toMatchObject({ open: false, overdue: false, respondedLate: true, overdueMs: 3 * H });
  });

  test("not yet due is not overdue; a withdrawn cycle stops at withdrawal", () => {
    expect(clockOf({ submittedAt, dueAt, respondedAt: null, withdrawnAt: null }, new Date(submittedAt.getTime() + H)).overdue).toBe(false);
    const withdrawn = clockOf({ submittedAt, dueAt, respondedAt: null, withdrawnAt: new Date(submittedAt.getTime() + 5 * H) }, new Date("2026-12-01T00:00:00Z"));
    expect(withdrawn).toMatchObject({ open: false, openMs: 5 * H, overdue: false });
  });
});

describe("External review engine: who has the action", () => {
  const names = { partyName: "ABC Engineering", reviewerName: "Ahmed Hassan", contractorName: "Main Contractor" };
  test("the status alone decides it", () => {
    expect(actionWith(STATUS.SUBMITTED, names)).toEqual({ side: "consultant", label: "ABC Engineering", reviewer: "Ahmed Hassan" });
    expect(actionWith(STATUS.UNDER_REVIEW, names).side).toBe("consultant");
    for (const status of [STATUS.RETURNED, STATUS.REVISING, STATUS.RESPONDED]) expect(actionWith(status, names)).toMatchObject({ side: "contractor", label: "Main Contractor" });
    expect(actionWith(STATUS.ACKNOWLEDGED, names)).toMatchObject({ side: "none", label: "Closed" });
    expect(actionWith(STATUS.WITHDRAWN, names)).toMatchObject({ side: "none", label: "Withdrawn" });
  });
});

describe("External review engine: one set of decisions, workflow labels", () => {
  test("each record type offers the shared decisions under its own labels; comments are required where they must be", () => {
    expect(sources.decisionsFor("rfi").map((row) => row.label)).toEqual(["Approve", "Approve with Comments", "Reject / Return"]);
    expect(sources.decisionsFor("submittal").map((row) => row.label)).toEqual(["Approved", "Approved as Noted", "Revise and Resubmit", "Rejected"]);
    expect(sources.decisionsFor("progress_report").map((row) => row.label)).toEqual(["Accept", "Accept with Comments", "Return for Revision"]);
    expect(sources.decisionsFor("itp").map((row) => row.label)).toEqual(["Pass", "Pass with Comments", "Fail / Reject"]);
    expect(sources.decisionsFor("rfi").find((row) => row.value === "approved").commentRequired).toBe(false);
    expect(sources.decisionsFor("rfi").filter((row) => row.commentRequired).map((row) => row.value)).toEqual(["approved_with_comments", "returned"]);
    expect(sources.RETURNING).toEqual(["returned", "rejected"]);
  });
});

describe("Consultant access (templates and customisation)", () => {
  test("a selection becomes explicit template tools and grants: everything else none, review only where the module is visible", () => {
    const { tools, grants, reviews } = consultant.toolsAndGrants({ modules: { rfi: "read_only", submittal: "none", cost: "none" }, reviews: ["rfi", "submittal"], comment: false });
    expect(tools.rfi).toBe("read_only");
    expect(tools.submittal).toBe("none");
    expect(tools.cost).toBe("none");
    expect(tools.procurement).toBe("none");
    expect(tools.external_review).toBe("read_only");
    // Reviewing submittals needs reading them: dropped.
    expect(reviews).toEqual(["rfi"]);
    expect(grants).toEqual(["external_review|action:update", "external_review|action:approve", "external_review|transition:external_review.review_rfi"]);
  });

  test("a read-only consultant gets no decide grant; the lead template reviews every record type", () => {
    const readOnly = consultant.ACCESS_TEMPLATES.find((row) => row.key === "read_only");
    expect(consultant.toolsAndGrants(readOnly.selection).grants).toEqual([]);
    const lead = consultant.ACCESS_TEMPLATES.find((row) => row.key === "lead");
    expect(consultant.toolsAndGrants(lead.selection).reviews).toEqual(sources.SOURCE_TYPES);
    for (const template of consultant.ACCESS_TEMPLATES) {
      const { tools } = consultant.toolsAndGrants(template.selection);
      if (template.key !== "qs") expect(tools.boq).toBe("none");
      expect(tools.cost).toBe("none");
      expect(tools.procurement).toBe("none");
    }
  });
});
