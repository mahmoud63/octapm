/**
 * Every record a comment files under the BOQ module is one of the bill's own
 * records for notifications: a comment or @mention on it reaches only a
 * reader of the BOQ (owner F1, 2026-09-28). A record type added to the BOQ
 * module later cannot slip past the rule unnoticed.
 */
jest.mock("../../config/db", () => ({ prisma: {} }));

const { RECORD_TYPE_MODULES } = require("../attachment.service");
const { BOQ_RECORD_TYPES, isBoqRecord } = require("../notification.service");

describe("the BOQ-record notification rule covers the BOQ module's commentable records", () => {
  it("each record type whose module is boq is a BOQ record", () => {
    const boqModuleTypes = Object.entries(RECORD_TYPE_MODULES)
      .filter(([, moduleName]) => moduleName === "boq")
      .map(([recordType]) => recordType);
    expect(boqModuleTypes).toContain("boq_item");
    for (const recordType of boqModuleTypes) {
      expect([recordType, isBoqRecord(recordType)]).toEqual([recordType, true]);
    }
  });

  it("the rule names the allocation, the revision and the item, and nothing else", () => {
    expect([...BOQ_RECORD_TYPES].sort()).toEqual(["activity_boq_allocation", "boq_item", "boq_revision"]);
    expect(isBoqRecord("rfi")).toBe(false);
    expect(isBoqRecord(null)).toBe(false);
  });
});
