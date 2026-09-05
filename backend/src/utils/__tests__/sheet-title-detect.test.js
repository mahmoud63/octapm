const {
  detectSheetMetadata,
  disciplineFor,
  normalizeNumber,
  sortKeyFor,
} = require("../sheet-title-detect");

describe("sheet title-block detection", () => {
  it("reads keyword-labelled title blocks with high confidence", () => {
    const text = [
      "GENERAL NOTES",
      "1. ALL DIMENSIONS IN MILLIMETRES",
      "PROJECT: RIVERSIDE TOWER",
      "CLIENT: ACME DEVELOPMENTS LTD",
      "SHEET TITLE: LEVEL 3 FLOOR PLAN",
      "SCALE 1:100 @ A1",
      "DATE 12/08/2026",
      "DWG NO. A-103",
      "REV C",
    ].join("\n");
    const meta = detectSheetMetadata(text);
    expect(meta.number).toBe("A-103");
    expect(meta.title).toBe("LEVEL 3 FLOOR PLAN");
    expect(meta.revision).toBe("C");
    expect(meta.discipline).toBe("Architectural");
    expect(meta.fields.number.confidence).toBeGreaterThanOrEqual(0.9);
    expect(meta.fields.title.confidence).toBeGreaterThanOrEqual(0.8);
    expect(meta.confidence).toBeGreaterThanOrEqual(0.8);
    expect(meta.textStatus).toBe("ready");
  });

  it("falls back to a standalone number line and a shouting title line", () => {
    const text = [
      "SECTION A-A",
      "TYPICAL BEAM REINFORCEMENT",
      "Drawn by JS",
      "Checked MK",
      "S-201",
    ].join("\n");
    const meta = detectSheetMetadata(text);
    expect(meta.number).toBe("S-201");
    expect(meta.fields.number.source).toBe("standalone");
    expect(meta.discipline).toBe("Structural");
    expect(meta.title).toBe("TYPICAL BEAM REINFORCEMENT");
    expect(meta.fields.title.confidence).toBeLessThan(0.8);
  });

  it("ignores paper sizes, scales, dates and standards when hunting for numbers", () => {
    const meta = detectSheetMetadata("SCALE 1:50\nA1\nISO 9001\n14/02/2026\nSHEET NO: M-4.02\nTITLE: HVAC LAYOUT");
    expect(meta.number).toBe("M-4.02");
    expect(meta.discipline).toBe("Mechanical");
    expect(meta.title).toBe("HVAC LAYOUT");
  });

  it("handles pages without a text layer", () => {
    const meta = detectSheetMetadata("", { pageNumber: 7, fallbackDiscipline: "Electrical" });
    expect(meta).toMatchObject({
      number: null,
      title: "Page 7",
      revision: null,
      discipline: "Electrical",
      confidence: 0,
      textStatus: "no_text",
    });
  });

  it("gives every page a usable title even when nothing is detected", () => {
    const meta = detectSheetMetadata("lorem ipsum dolor sit amet", { pageNumber: 3 });
    expect(meta.number).toBeNull();
    expect(meta.title).toBe("Page 3");
  });

  it("normalises numbers and sorts them naturally", () => {
    expect(normalizeNumber(" a - 101 ")).toBe("A-101");
    expect(disciplineFor("FP-201")).toBe("Fire Protection");
    expect(disciplineFor("ZZ-1")).toBeNull();
    const sorted = ["A-101", "A-1001", "A-2", "S-1"].sort((a, b) => sortKeyFor(a).localeCompare(sortKeyFor(b)));
    expect(sorted).toEqual(["A-2", "A-101", "A-1001", "S-1"]);
  });
});
