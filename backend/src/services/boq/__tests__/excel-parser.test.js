const XLSX = require("@e965/xlsx");
const { parseExcelInput, validateBoqRows } = require("../excel-parser");

const makeWorkbookBuffer = (rows) => {
  const worksheet = XLSX.utils.aoa_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "BOQ");
  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
};

describe("BOQ Excel parser", () => {
  it("parses aliased BOQ headers from workbook buffers", () => {
    const rows = parseExcelInput(
      makeWorkbookBuffer([
        ["Item No", "Item Description", "Qty", "Unit", "Unit Rate"],
        ["1.1", "Excavation", 5, "m3", 100],
      ]),
    );

    expect(rows).toEqual([
      {
        rowIndex: 2,
        code: "1.1",
        description: "Excavation",
        quantity: 5,
        unit: "m3",
        rate: 100,
      },
    ]);
  });

  it("returns row-level validation errors for duplicate codes", () => {
    const result = validateBoqRows([
      {
        rowIndex: 2,
        code: " a   01 ",
        description: "Excavation",
        quantity: 5,
        unit: "m3",
        rate: 100,
      },
      {
        rowIndex: 3,
        code: "A 01",
        description: "Backfill",
        quantity: 4,
        unit: "m3",
        rate: 80,
      },
    ]);

    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(
      expect.objectContaining({
        row: 3,
        field: "code",
      }),
    );
  });

  it("normalizes BOQ code casing and internal spacing while parsing", () => {
    const rows = parseExcelInput(
      makeWorkbookBuffer([
        ["Code", "Description", "Quantity", "Unit", "Rate"],
        [" a   01 ", "Excavation", 5, "m3", 100],
      ]),
    );

    expect(rows[0].code).toBe("A 01");
  });

  it("keeps the first code column when a trailing Ref column follows it", () => {
    const rows = parseExcelInput(
      makeWorkbookBuffer([
        ["Item No.", "Description", "Unit", "Qty", "Rate", "Ref"],
        ["A1", "Excavation", "m3", 10, 5, "DWG-01"],
      ]),
    );

    expect(rows).toEqual([
      expect.objectContaining({ code: "A1", description: "Excavation", rate: 5 }),
    ]);
  });

  it("keeps the first code column when a trailing Item column follows it", () => {
    const rows = parseExcelInput(
      makeWorkbookBuffer([
        ["No.", "Description", "Unit", "Qty", "Rate", "Item"],
        ["A1", "Excavation", "m3", 10, 5, "Prelims"],
      ]),
    );

    expect(rows[0].code).toBe("A1");
  });

  it("falls back to an Item column only when nothing names the code", () => {
    const rows = parseExcelInput(
      makeWorkbookBuffer([
        ["Page", "Item", "Description", "Uom", "Quantity", "Rate"],
        [1, "1.1", "Excavation", "m3", 10, 5],
      ]),
    );

    expect(rows[0].code).toBe("1.1");
  });

  it("skips the label line under the header but reports a row with words for numbers", () => {
    const rows = parseExcelInput(
      makeWorkbookBuffer([
        ["S.N.", "Description", "Unit", "Quantity", "Rate per unit"],
        ["", "", "", "", "In Figure"],
        ["A1", "Excavation", "m3", 10, 5],
        ["", "Backfill", "m3", "TBD", "TBD"],
      ]),
    );

    expect(rows.map((row) => row.description)).toEqual(["Excavation", "Backfill"]);
    const result = validateBoqRows(rows);
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(
      expect.objectContaining({ row: 4, field: "quantity" }),
    );
    expect(result.errors).toContainEqual(
      expect.objectContaining({ row: 4, field: "code" }),
    );
  });
});
