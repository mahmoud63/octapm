const XLSX = require("xlsx");
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
});
