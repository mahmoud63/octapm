jest.mock("../../config/db", () => ({ prisma: {} }));

const { ruleCheck, measure, levelOf, revisionLabel, RULE_STATUS } = require("../bim-5d.service");

const column = { ifcType: "IFCCOLUMN", name: "Column C02-001", typeName: "Concrete Column:600x600", netVolume: 2.84, netArea: null, length: 3.6 };
const boqItem = { id: "b2", code: "B-200", unit: "m3" };
const rule = { quantityField: "netVolume", allowedTypes: ["IFCCOLUMN", "IFCSLAB"], factor: 1, rounding: 3, unit: "m3", includeText: null, excludeText: "Raft" };

describe("BIM/5D deterministic measurement (BIM-5)", () => {
  test("a column measured by the item's rule is VALID; the quantity is the measured property x factor, rounded", () => {
    expect(ruleCheck({ element: column, link: { quantityField: "netVolume" }, rule, boqItem })).toEqual({ status: RULE_STATUS.VALID, reasons: [] });
    expect(measure({ element: column, rule, boqItem })).toEqual({ quantityField: "netVolume", rawQuantity: 2.84, factor: 1, quantity: 2.84, unit: "m3" });
    expect(measure({ element: { ...column, netVolume: 2.83456 }, rule: { ...rule, factor: 1.05, rounding: 2 }, boqItem }).quantity).toBe(2.98);
  });

  test("a type the item does not measure, another property, a missing property, an excluded name: INVALID", () => {
    expect(ruleCheck({ element: { ...column, ifcType: "IFCWALL" }, link: { quantityField: "netVolume" }, rule, boqItem }).status).toBe("INVALID");
    expect(ruleCheck({ element: column, link: { quantityField: "length" }, rule, boqItem }).status).toBe("INVALID");
    expect(ruleCheck({ element: { ...column, netVolume: null }, link: null, rule, boqItem }).status).toBe("INVALID");
    expect(ruleCheck({ element: { ...column, name: "Raft pour 1" }, link: null, rule, boqItem }).status).toBe("INVALID");
  });

  test("a zero quantity or a unit needing a conversion that is not set: WARNING; no rule: NOT_CONFIGURED", () => {
    expect(ruleCheck({ element: { ...column, netVolume: 0 }, link: null, rule, boqItem }).status).toBe("WARNING");
    const areaRule = { ...rule, quantityField: "netArea", allowedTypes: [], unit: "m3" };
    expect(ruleCheck({ element: { ...column, netArea: 4 }, link: null, rule: areaRule, boqItem }).status).toBe("WARNING");
    expect(ruleCheck({ element: column, link: null, rule: null, boqItem }).status).toBe("NOT_CONFIGURED");
  });

  test("storeys and locations match on their level number; revisions are labelled R01, R02", () => {
    expect(["Level 01", "L3", "level 03", "Ground floor", "B1", "Roof", "Tower A"].map(levelOf)).toEqual([1, 3, 3, 0, -1, 99, null]);
    expect([1, 6, 12].map(revisionLabel)).toEqual(["R01", "R06", "R12"]);
  });
});
