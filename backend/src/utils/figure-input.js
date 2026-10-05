/**
 * A figure a client sends is ONE value (CERT-2).
 *
 * express-validator's isFloat() / isInt() / isNumeric() / isDecimal() check
 * an array element by element (and an empty array not at all), and the
 * services read a figure with Number(x) || 0. So [1,1] passed the door and
 * became 0 — a transfer receipt of [1,1] booked nothing in and wrote both
 * units off as a shortfall; a delivery's acceptedQty [1,1] stored a receipt
 * with no lines — while [5] became 5 and [] became 0, silently.
 *
 * Every body figure chain checks the shape first, the same way the id helpers
 * check an identifier is one string:
 *
 *   body("quantity").custom(scalarFigure).bail().isFloat({ min: 0, max: QUANTITY_MAX })
 *
 * A figure is a number or a string (a multipart form sends every field as a
 * string); what the string says is the format check's business that follows.
 * An array, an object or a boolean is refused 400 VALIDATION_ERROR naming the
 * field, before any service reads it.
 */
const isScalarFigure = (value) => typeof value === "number" || typeof value === "string";

const SCALAR_FIGURE_MESSAGE = "must be a single number";

/**
 * For an express-validator chain: .custom(scalarFigure).bail(). The bail
 * matters: without it the chain runs on, and the numeric check after it
 * turns the refused value into a string first — an object multer built for
 * a field "x[k]" has no prototype and cannot be, so the request answered
 * 500 "Cannot convert object to primitive value" (CERT-2, robustness-6).
 */
const scalarFigure = (value) => {
  if (!isScalarFigure(value)) throw new Error(SCALAR_FIGURE_MESSAGE);
  return true;
};

/**
 * What a figure's column holds, for the bound of its chain (CERT-2,
 * robustness-6): a number the door lets through must fit where the service
 * writes it. An integer beyond an Int (INT4) column failed in the query
 * engine at the write; "1e400" passed isFloat() unbounded and became
 * Infinity, stored as 0 or as NULL in a Decimal(18,2) column.
 *
 *   isInt({ min: 0, max: INT4_MAX })                   an Int column
 *   isFloat({ min: 0, max: MONEY_FIGURE_MAX })         a Decimal(18,2) amount
 *   isFloat({ min: 0, max: QUANTITY_MAX })             a quantity (stock-figures)
 *
 * MONEY_FIGURE_MAX is the largest double below Decimal(18,2)'s limit
 * 9999999999999999.99: isFloat() compares the value as a double, and
 * 9999999999999999.99 itself reads as 1e16, which the column cannot hold.
 * (moneyBody compares exactly, as a Decimal, for the routes that use it.)
 */
const INT4_MAX = 2147483647;
const INT4_MIN = -2147483648;
const MONEY_FIGURE_MAX = 9999999999999998;

module.exports = { scalarFigure, isScalarFigure, SCALAR_FIGURE_MESSAGE, INT4_MAX, INT4_MIN, MONEY_FIGURE_MAX };
