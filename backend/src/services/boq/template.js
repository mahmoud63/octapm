const ExcelJS = require("exceljs");

async function generateBoqTemplate() {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("BOQ");

  sheet.columns = [
    { header: "Code", key: "code", width: 12 },
    { header: "Description", key: "description", width: 45 },
    { header: "Quantity", key: "quantity", width: 12 },
    { header: "Unit", key: "unit", width: 10 },
    { header: "Rate", key: "rate", width: 14 },
    { header: "Amount", key: "amount", width: 16 },
  ];

  const headerRow = sheet.getRow(1);
  headerRow.font = { bold: true, color: { argb: "FFFFFFFF" } };
  headerRow.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FF1E40AF" },
  };
  headerRow.alignment = { vertical: "middle", horizontal: "center" };
  headerRow.height = 22;

  const examples = [
    {
      code: "1.1",
      description: "Site Clearance and Demolition",
      quantity: 1200,
      unit: "m2",
      rate: 15,
      amount: 18000,
    },
    {
      code: "1.2",
      description: "Bulk Excavation",
      quantity: 3500,
      unit: "m3",
      rate: 22,
      amount: 77000,
    },
    {
      code: "2.1",
      description: "Reinforced Concrete Foundation",
      quantity: 450,
      unit: "m3",
      rate: 350,
      amount: 157500,
    },
  ];

  examples.forEach((row) => {
    const sheetRow = sheet.addRow(row);
    sheetRow.getCell("amount").numFmt = "#,##0.00";
    sheetRow.getCell("rate").numFmt = "#,##0.00";
    sheetRow.getCell("quantity").numFmt = "#,##0.##";
  });

  sheet.addRow([]);
  const noteRow = sheet.addRow([
    'Note: The "Amount" column is auto-calculated (Quantity x Rate). You may leave it blank.',
  ]);
  noteRow.font = { italic: true, color: { argb: "FF6B7280" } };
  sheet.mergeCells(`A${noteRow.number}:F${noteRow.number}`);

  return workbook;
}

module.exports = {
  generateBoqTemplate,
};
