jest.mock("../../config/db", () => ({ prisma: {} }));

const fs = require("fs");
const os = require("os");
const path = require("path");
const { inspectIfcFile } = require("../bim.service");
const { _csvCell: csvCell } = require("../bim-5d-export.service");

const write = (name, text) => {
  const target = path.join(os.tmpdir(), `octapm-bim-import-${process.pid}-${name}`);
  fs.writeFileSync(target, text, "latin1");
  return { path: target, size: Buffer.byteLength(text, "latin1"), originalname: name };
};
const header = (schema) => `ISO-10303-21;\nHEADER;\nFILE_DESCRIPTION(('ViewDefinition'),'2;1');\nFILE_NAME('x.ifc','2026-10-11',(''),(''),'','','');\nFILE_SCHEMA(('${schema}'));\nENDSEC;\nDATA;\nENDSEC;\nEND-ISO-10303-21;\n`;

describe("BIM import checks (BIM UX completion)", () => {
  test("an IFC2X3 or IFC4 STEP file passes and names its schema", async () => {
    await expect(inspectIfcFile(write("a.ifc", header("IFC4")))).resolves.toBe("IFC4");
    await expect(inspectIfcFile(write("b.ifc", header("IFC2X3")))).resolves.toBe("IFC2X3");
  });

  test("empty, not STEP, no IFC schema, or an unsupported schema is refused before storing", async () => {
    await expect(inspectIfcFile({ ...write("e.ifc", ""), size: 0 })).rejects.toMatchObject({ code: "BIM_FILE_EMPTY" });
    await expect(inspectIfcFile(write("t.ifc", "hello, not a model"))).rejects.toMatchObject({ code: "BIM_FILE_INVALID" });
    await expect(inspectIfcFile(write("s.ifc", header("AP214")))).rejects.toMatchObject({ code: "BIM_FILE_INVALID" });
    await expect(inspectIfcFile(write("x.ifc", header("IFC4X3_ADD2")))).rejects.toMatchObject({ code: "BIM_SCHEMA_UNSUPPORTED" });
  });

  test("CSV cells are quoted when needed and never start a formula", () => {
    expect(csvCell("B-200")).toBe("B-200");
    expect(csvCell("a,b")).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell("=HYPERLINK(1)")).toBe("'=HYPERLINK(1)");
    expect(csvCell("-296.13")).toBe("-296.13");
    expect(csvCell(null)).toBe("");
  });
});
