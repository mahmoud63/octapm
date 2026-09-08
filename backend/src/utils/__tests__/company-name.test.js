const { normalizeCompanyName, sameCompanyName } = require("../company-name");

describe("company name matching", () => {
  it("treats case as typing, not identity", () => {
    // The three the brief names explicitly.
    expect(sameCompanyName("ABC Steel LLC", "abc steel llc")).toBe(true);
    expect(sameCompanyName("ABC Steel LLC", "ABC STEEL LLC")).toBe(true);
    expect(sameCompanyName("abc steel llc", "ABC STEEL LLC")).toBe(true);
  });

  it("folds punctuation that decorates an abbreviation", () => {
    expect(normalizeCompanyName("ABC Steel L.L.C.")).toBe("abc steel llc");
    expect(sameCompanyName("ABC Steel L.L.C.", "ABC Steel LLC")).toBe(true);
    expect(sameCompanyName("O'Brien Contracting", "OBrien Contracting")).toBe(true);
  });

  it("treats a hyphen as the space it stands in for", () => {
    expect(sameCompanyName("Al-Rashid Trading", "Al Rashid Trading")).toBe(true);
    expect(normalizeCompanyName("Al-Rashid Trading")).toBe("al rashid trading");
  });

  it("ignores stray and doubled whitespace", () => {
    expect(normalizeCompanyName("  Meridian   Concrete  Services ")).toBe("meridian concrete services");
    expect(sameCompanyName("  Meridian   Concrete  Services ", "Meridian Concrete Services")).toBe(true);
  });

  it("does NOT merge different legal forms", () => {
    // Different entities, different liability. Merging these because the
    // trading name matches would be a guess with contractual consequences —
    // it belongs to a person, via the duplicate report.
    expect(sameCompanyName("ABC Steel LLC", "ABC Steel Ltd")).toBe(false);
    expect(sameCompanyName("ABC Steel Limited", "ABC Steel LLC")).toBe(false);
    expect(sameCompanyName("ABC Steel", "ABC Steel Inc")).toBe(false);
  });

  it("does NOT merge on weak similarity", () => {
    expect(sameCompanyName("ABC Steel", "ABC Steelworks")).toBe(false);
    expect(sameCompanyName("Gulf Ready Mix", "Gulf Ready Mix Concrete")).toBe(false);
    expect(sameCompanyName("Meridian Concrete", "Meridian Concrete Services")).toBe(false);
  });

  it("never matches a blank name to another blank one", () => {
    expect(normalizeCompanyName("")).toBe("");
    expect(normalizeCompanyName("   ")).toBe("");
    expect(normalizeCompanyName(null)).toBe("");
    expect(sameCompanyName("", "")).toBe(false);
    expect(sameCompanyName(null, undefined)).toBe(false);
  });
});
