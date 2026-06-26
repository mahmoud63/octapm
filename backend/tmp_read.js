const xlsx = require("@e965/xlsx");
const path = require("path");

const filePath = path.join(__dirname, "../docs/boq-fail.xls");

try {
  const workbook = xlsx.readFile(filePath);
  const sheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[sheetName];
  const json = xlsx.utils.sheet_to_json(worksheet, { header: 1 });
  
  console.log(`Total rows: ${json.length}`);
  
  // Try to find the header row or just dump the first few rows
  console.log("First 10 rows:");
  console.log(JSON.stringify(json.slice(0, 10), null, 2));

  // Let's count items that look like BOQ items
  let longDescriptions = 0;
  let strangeCharacters = 0;
  
  json.forEach((row, i) => {
    row.forEach(cell => {
      if (typeof cell === "string") {
        if (cell.length > 500) longDescriptions++;
        if (cell.includes("\"") || cell.includes("\\") || cell.includes("\n")) strangeCharacters++;
      }
    });
  });

  console.log(`Cells with >500 chars: ${longDescriptions}`);
  console.log(`Cells with quotes/newlines/slashes: ${strangeCharacters}`);

} catch (error) {
  console.error("Error reading file:", error.message);
}
