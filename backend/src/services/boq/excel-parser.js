const XLSX = require("@e965/xlsx");
const { HttpError } = require("../../utils/http-error");
const { assertMoneyInput } = require("../../utils/money");
const { normalizeBoqCode } = require("../../utils/boq-code");

const REQUIRED_HEADERS = ["code", "description", "quantity", "unit", "rate"];
const HEADER_ALIASES = {
  "item no": "code",
  "item no.": "code",
  "item number": "code",
  "item code": "code",
  item: "code",
  "s.n.": "code",
  "s.n": "code",
  sn: "code",
  "sr no": "code",
  "sr. no.": "code",
  "ref": "code",
  no: "code",
  "no.": "code",
  desc: "description",
  "item description": "description",
  "work description": "description",
  "description of work": "description",
  "description of works": "description",
  uom: "unit",
  "unit of measure": "unit",
  "unit of measurement": "unit",
  qty: "quantity",
  "qty.": "quantity",
  "unit rate": "rate",
  "unit price": "rate",
  "rate per unit": "rate",
  total: "amount",
  "total amount": "amount",
  "line total": "amount",
};

// A validation failure on a big workbook must come back as one readable
// answer, not one line per row of a 7,000-row tender bill.
const MAX_REPORTED_ERRORS = 200;

// "Unit Rate ($)", "Amount (AED)": the currency in brackets is a label, not a
// different column.
function normalizeHeader(header) {
  return (header ?? "")
    .toString()
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

const isNumeric = (value) =>
  value !== "" && value !== null && value !== undefined && Number.isFinite(Number(value));

function parseWorkbookRows(workbook) {
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });

  if (rows.length < 2) {
    throw new HttpError(400, "BOQ_VALIDATION_FAILED", "File appears empty");
  }

  let headerRowIdx = 0;
  let columnMap = {};

  for (let i = 0; i < Math.min(5, rows.length); i += 1) {
    const rowHeaders = rows[i].map(normalizeHeader);
    const map = {};
    rowHeaders.forEach((header, index) => {
      const canonical = HEADER_ALIASES[header] || header;
      if (REQUIRED_HEADERS.includes(canonical)) map[canonical] = index;
    });
    if (Object.keys(map).length >= 3) {
      headerRowIdx = i;
      columnMap = map;
      break;
    }
  }

  const missing = REQUIRED_HEADERS.filter(
    (header) => columnMap[header] === undefined && header !== "amount",
  );
  if (missing.length > 0) {
    throw new HttpError(
      400,
      "BOQ_VALIDATION_FAILED",
      `Missing required columns: ${missing.join(", ")}`,
      {
        errors: [
          {
            code: "MISSING_COLUMNS",
            message: `Columns not found: ${missing.join(", ")}`,
          },
        ],
      },
    );
  }

  const dataRows = rows.slice(headerRowIdx + 1);
  const parsed = [];

  for (let i = 0; i < dataRows.length; i += 1) {
    const row = dataRows[i];
    const rawCode = row[columnMap.code];
    const rawDesc = row[columnMap.description];
    const rawQty = row[columnMap.quantity];
    const rawUnit = row[columnMap.unit];
    const rawRate = row[columnMap.rate];

    if (!rawCode && !rawDesc && !rawQty && !rawUnit && !rawRate) continue;
    if (!rawQty && !rawRate) continue;
    // A second header line under the first ("In figure" / "In words" beneath
    // "Rate") has words where the numbers go and no item code: a label, not
    // a row to price.
    if (!rawCode && !isNumeric(rawQty) && !isNumeric(rawRate)) continue;

    parsed.push({
      rowIndex: i + headerRowIdx + 2,
      code: normalizeBoqCode(rawCode),
      description: rawDesc?.toString().trim() || "",
      quantity: rawQty,
      unit: rawUnit?.toString().trim() || "",
      rate: rawRate,
    });
  }

  return parsed;
}

const parseExcelBuffer = (buffer) =>
  parseWorkbookRows(XLSX.read(buffer, { type: "buffer" }));

const parseExcelFile = (filePath) => parseWorkbookRows(XLSX.readFile(filePath));

function parseExcelInput(input) {
  if (Buffer.isBuffer(input)) return parseExcelBuffer(input);
  if (typeof input === "string") return parseExcelFile(input);
  if (input?.path) return parseExcelFile(input.path);
  if (Buffer.isBuffer(input?.buffer)) return parseExcelBuffer(input.buffer);
  throw new HttpError(400, "NO_FILE", "No file uploaded");
}

function validateBoqRows(rows) {
  const errors = [];
  const seenCodes = new Map();

  rows.forEach((row) => {
    const rowIndex = row.rowIndex;

    if (!row.code) {
      errors.push({
        row: rowIndex,
        field: "code",
        message: "Code is required",
      });
    }
    if (!row.description) {
      errors.push({
        row: rowIndex,
        field: "description",
        message: "Description is required",
      });
    }
    if (!row.unit) {
      errors.push({
        row: rowIndex,
        field: "unit",
        message: "Unit is required",
      });
    }

    const quantity = Number(row.quantity);
    if (Number.isNaN(quantity) || quantity <= 0) {
      errors.push({
        row: rowIndex,
        field: "quantity",
        message: "Quantity must be a positive number",
      });
    }

    const rate = Number(row.rate);
    if (Number.isNaN(rate) || rate < 0) {
      errors.push({
        row: rowIndex,
        field: "rate",
        message: "Rate must be a non-negative number",
      });
    } else {
      try {
        assertMoneyInput("rate", row.rate);
      } catch (error) {
        errors.push({ row: rowIndex, field: "rate", message: error.message });
      }
    }

    if (row.description && row.description.length > 500) {
      errors.push({
        row: rowIndex,
        field: "description",
        message: "Description exceeds 500 characters",
      });
    }

    if (row.code) {
      const key = normalizeBoqCode(row.code);
      if (seenCodes.has(key)) {
        errors.push({
          row: rowIndex,
          field: "code",
          message: `Duplicate code "${row.code}" - also on row ${seenCodes.get(
            key,
          )}`,
        });
      } else {
        seenCodes.set(key, rowIndex);
      }
    }
  });

  return {
    valid: errors.length === 0,
    errors: errors.slice(0, MAX_REPORTED_ERRORS),
    errorCount: errors.length,
    truncated: errors.length > MAX_REPORTED_ERRORS,
  };
}

module.exports = {
  parseExcelInput,
  parseWorkbookRows,
  validateBoqRows,
};
