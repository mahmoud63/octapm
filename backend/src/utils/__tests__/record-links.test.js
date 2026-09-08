const { RECORD_WORKSPACE, recordWorkspacePath } = require("../record-links");

describe("record-links", () => {
  it("opens the record's workspace module with the record pre-selected", () => {
    expect(
      recordWorkspacePath({ projectId: "p1", recordType: "rfi", recordId: "r-1" }),
    ).toBe("/projects/p1/doc-control/rfi?recordId=r-1&source=rfi");
    expect(
      recordWorkspacePath({ projectId: "p1", recordType: "ncr", recordId: "n 1" }),
    ).toBe("/projects/p1/quality/ncr?recordId=n%201&source=ncr");
    expect(recordWorkspacePath({ projectId: "p1", recordType: "meeting" })).toBe(
      "/projects/p1/meetings",
    );
  });

  // The module dashboards decide which record to open from `source`, not from
  // `recordId` alone. A link without it lands on the right tab and opens
  // nothing — which is what every notification and comment link used to do.
  it("names the record type, because that is what opens the record", () => {
    for (const recordType of ["sub_pay_app", "commitment", "change_order", "direct_cost"]) {
      expect(recordWorkspacePath({ projectId: "p1", recordType, recordId: "x" })).toContain(
        `&source=${recordType}`,
      );
    }
  });

  it("sends tasks to the tasks page and unknown types to the project root", () => {
    expect(
      recordWorkspacePath({ projectId: "p1", recordType: "task", recordId: "t1" }),
    ).toBe("/tasks?recordId=t1");
    expect(
      recordWorkspacePath({ projectId: "p1", recordType: "invoice", recordId: "x" }),
    ).toBe("/projects/p1?recordId=x&source=invoice");
    expect(recordWorkspacePath({ projectId: null, recordType: "rfi" })).toBeNull();
  });

  it("uses only module slugs that exist in the workspace", () => {
    const slugs = new Set([
      "schedule",
      "site-reporting",
      "cost",
      "commercial",
      "procurement",
      "quality",
      "doc-control",
      "meetings",
      "activities",
      "equipment",
      "locations",
      "photos",
      "team",
      "reports",
      "overview",
      "boq",
      "bim",
    ]);
    for (const target of Object.values(RECORD_WORKSPACE)) {
      if (target.path) continue;
      expect(slugs.has(target.module)).toBe(true);
    }
  });
});
