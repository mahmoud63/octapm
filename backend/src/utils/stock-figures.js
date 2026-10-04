const { HttpError } = require("./http-error");

/**
 * What a stock figure, and a stock movement's date, can be (CERT-2).
 *
 * A unit cost is kept to four decimals in Decimal(18,4) columns — the item's
 * unit cost, average and last price, a movement's unit cost, the cost
 * ledger's — so it has fourteen whole digits at most. A movement's value is a
 * Decimal(18,2): less than 10^16. A quantity is kept to four decimals in a
 * double, which holds fifteen significant digits exactly: eleven whole digits
 * at most. A unit cost of 1e15 failed at the write with a 500, and a quantity
 * of 1e15 was stored; each is refused before anything moves.
 *
 * The routes bound the same figures at the door (inventory, procurement's
 * goods receipt); these are the service's own checks, for every caller.
 */
const UNIT_COST_MAX = 99_999_999_999_999;
const QUANTITY_MAX = 99_999_999_999;
const VALUE_LIMIT = 1e16;
const asLimit = (value) => value.toLocaleString("en-US");

const assertQuantityBound = (value, field = "Quantity") => {
  if (Math.abs(value) > QUANTITY_MAX) {
    throw new HttpError(400, "INV_QUANTITY", `${field} must be at most ${asLimit(QUANTITY_MAX)}`);
  }
  return value;
};

const assertUnitCostBound = (value) => {
  if (value > UNIT_COST_MAX) {
    throw new HttpError(400, "INV_NUMBER", `Unit cost must be at most ${asLimit(UNIT_COST_MAX)}`);
  }
  return value;
};

/** What a movement of this quantity at this price is worth must fit the ledger's value column. */
const assertValueBound = (quantity, unitCost) => {
  if (!(Math.abs(Number(quantity)) * Number(unitCost || 0) < VALUE_LIMIT)) {
    throw new HttpError(400, "INV_VALUE_TOO_LARGE", "This movement is worth more than the stock ledger can record");
  }
};

/**
 * A date a movement carries — when it happened, when its batch expires — as a
 * Date, or null when none is given. Only a string that is a date (or a Date)
 * is one: "x", {"not":"x"} and [] became an invalid date that failed at the
 * write with a 500 (CERT-2). A year the database cannot store is no date
 * either. Refused before anything moves.
 */
const movementDate = (value, field) => {
  if (value === undefined || value === null || value === "") return null;
  const at = value instanceof Date ? value : typeof value === "string" ? new Date(value) : null;
  if (!at || Number.isNaN(at.getTime()) || at.getUTCFullYear() < 1 || at.getUTCFullYear() > 9999) {
    throw new HttpError(400, "INV_DATE_INVALID", `${field} must be a date`);
  }
  return at;
};

module.exports = {
  QUANTITY_MAX,
  UNIT_COST_MAX,
  VALUE_LIMIT,
  assertQuantityBound,
  assertUnitCostBound,
  assertValueBound,
  movementDate,
};
