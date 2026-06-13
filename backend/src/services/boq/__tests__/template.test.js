const { generateBoqTemplate } = require("../template");

describe("BOQ template generator", () => {
  it("creates a BOQ workbook with the expected columns and example rows", async () => {
    const workbook = await generateBoqTemplate();
    const sheet = workbook.getWorksheet("BOQ");

    expect(sheet).toBeTruthy();
    expect(sheet.getRow(1).values.slice(1, 7)).toEqual([
      "Code",
      "Description",
      "Quantity",
      "Unit",
      "Rate",
      "Amount",
    ]);
    expect(sheet.getRow(2).getCell("code").value).toBe("1.1");
  });
});
