/**
 * A cost record's stored forecast and where it came from (owner decision R5-2,
 * 2026-09-30; docs/finance/OCTAPM_COST_POSTING_MODEL.md §1.6.1).
 *
 * CostRecord.forecastSource says which of two things the stored figure is:
 *
 * - 'entered' — a caller supplied it. 0 and "0" are forecasts, never
 *   "missing". It stands until a caller supplies another; no other write
 *   (a budget, a category, committed, a through-date, a ledger posting, a
 *   commitment recompute, an equipment posting) changes it.
 * - 'default' — no forecast was supplied when the record was made, so the
 *   server wrote the initial default max(0, budget, actual). Only a write that
 *   changes the record's budget re-derives it — max(0, new budget, current
 *   actual) — and it stays 'default'.
 * - NULL — the row predates the column: its source was not recorded. It is
 *   treated as entered (never re-derived) and labelled as not recorded.
 *
 * The server alone sets the source: a client that sends forecastSource is
 * refused at the route (VALIDATION_ERROR). The default is the cost module's own
 * projection; it is not the earned-value EAC (revised budget ÷ CPI, owner
 * decision D2), which never reads it.
 *
 * Pure: no database, no request. cost.service and every other creator of a
 * cost record use these, so one rule is written once.
 */
const { HttpError } = require("./http-error");
const { assertMoneyInput, isPrismaDecimal, toMoneyNumber } = require("./money");

const FORECAST_SOURCES = Object.freeze({ ENTERED: "entered", DEFAULT: "default" });

// The basis text every read of a cost record carries beside its forecast.
const FORECAST_BASIS = Object.freeze({
  entered: "Entered forecast",
  // "The budget" is the one the default was worked from: the activity's
  // approved allocation when the record was made (every creator passes it), or
  // the budget a later edit wrote on the record. The default is a stored
  // figure; it says so, and that it does not move with them afterwards.
  default:
    "Default forecast: the larger of the budget and the actual cost as they stood when it was set; it does not follow them afterwards (no forecast was entered)",
  notRecorded: "Stored forecast (its source was not recorded)",
});

// An echo of the row's own budget is not a change (the same half-cent
// tolerance the committed and actual echoes use).
const MONEY_ECHO = 0.005;

/** A forecast is supplied when the payload carries one at all — 0, "0" and "" included. */
const isForecastSupplied = (value) => value !== undefined && value !== null;

// An amount arrives as text, a number or a Decimal. Anything else (an array,
// an object, a boolean) is not one: [7] reads as "7" to a text check, passed
// it, and was then stored as 0 and marked entered.
const isAmountShaped = (value) => typeof value === "string" || typeof value === "number" || isPrismaDecimal(value);

/**
 * A supplied forecast as the amount to store. A value that is not an amount of
 * 0 or more (a word, "", NaN, a negative, too many decimals, an array, an
 * object) is refused as a business error naming the field — `Number(x) || 0`
 * turned every one of them into a stored 0 for any caller the route validator
 * did not stand in front of.
 */
const suppliedForecast = (value) => {
  let valid = value !== "" && isAmountShaped(value);
  if (valid) {
    try {
      assertMoneyInput("forecast", value);
    } catch {
      valid = false;
    }
  }
  if (!valid) throw new HttpError(400, "COST_RECORD_MONEY_INVALID", "forecast must be an amount of 0 or more");
  return toMoneyNumber(value);
};

/** The initial default: the larger of the budget and the actual, never below 0. */
const defaultForecast = ({ budget = 0, actual = 0 } = {}) =>
  Math.max(0, toMoneyNumber(budget ?? 0), toMoneyNumber(actual ?? 0));

/** The forecast and its source for a record being created. */
const forecastOnCreate = ({ payloadForecast, budget = 0, actual = 0 } = {}) =>
  isForecastSupplied(payloadForecast)
    ? { forecast: suppliedForecast(payloadForecast), forecastSource: FORECAST_SOURCES.ENTERED }
    : { forecast: defaultForecast({ budget, actual }), forecastSource: FORECAST_SOURCES.DEFAULT };

/**
 * What an edit of an existing record writes to its forecast: `{}` (nothing)
 * unless the edit supplies a forecast, or the stored one is the default and
 * this edit changes the budget. `budget` is the budget the edit writes
 * (undefined when it writes none).
 */
const forecastOnUpdate = ({ payloadForecast, existing, budget } = {}) => {
  if (isForecastSupplied(payloadForecast)) {
    return { forecast: suppliedForecast(payloadForecast), forecastSource: FORECAST_SOURCES.ENTERED };
  }
  // Entered, or not recorded (treated as entered): never touched by an edit
  // that does not supply a forecast.
  if (!existing || existing.forecastSource !== FORECAST_SOURCES.DEFAULT) return {};
  if (budget === undefined || budget === null) return {};
  const nextBudget = toMoneyNumber(budget);
  if (Math.abs(nextBudget - toMoneyNumber(existing.budget ?? 0)) <= MONEY_ECHO) return {};
  return {
    forecast: defaultForecast({ budget: nextBudget, actual: existing.actual }),
    forecastSource: FORECAST_SOURCES.DEFAULT,
  };
};

/**
 * What one record counts for in the cost records' projected final cost (GET
 * /cost/summary: totals.forecast, byPhase and the scenario cards). `budget`
 * is the record's budget as the summary reads it (its activity's approved
 * allocation).
 *
 * - An ENTERED forecast counts as entered — 0 included: a supplied value is
 *   never read as missing because it is falsy (R5-2) — and never below what
 *   the record has already cost (then the actual counts).
 * - A DEFAULT is not a forecast anybody made, so it is not counted as one:
 *   the record counts the larger of its budget and its actual as they are NOW.
 *   The stored default is that same rule frozen when it was set; trusting it
 *   froze the projection too — a record whose allocation moved afterwards
 *   went on counting the old one, and a record the ledger created counted its
 *   first posting. (A record with no forecast set always followed its budget
 *   here; a default keeps doing so.)
 * - A forecast whose source was not recorded (NULL, a row older than the
 *   column) is counted as it always was: the stored figure when it is above 0
 *   and not below actual, otherwise the larger of budget and actual.
 *
 * Every row written before the column has a NULL source, so no existing
 * project's figure moves.
 */
const projectedFinalCost = ({ forecast = 0, forecastSource = null, budget = 0, actual = 0 } = {}) => {
  const spent = toMoneyNumber(actual ?? 0);
  const stored = toMoneyNumber(forecast ?? 0);
  if (forecastSource === FORECAST_SOURCES.ENTERED) return Math.max(stored, spent);
  const unforecast = Math.max(toMoneyNumber(budget ?? 0), spent);
  if (forecastSource === FORECAST_SOURCES.DEFAULT) return unforecast;
  if (stored > 0 && stored >= spent) return stored;
  return unforecast;
};

/** The basis text of a stored forecast by its source. */
const forecastBasisOf = (source) => {
  if (source === FORECAST_SOURCES.ENTERED) return FORECAST_BASIS.entered;
  if (source === FORECAST_SOURCES.DEFAULT) return FORECAST_BASIS.default;
  return FORECAST_BASIS.notRecorded;
};

const knownSource = (source) =>
  source === FORECAST_SOURCES.ENTERED || source === FORECAST_SOURCES.DEFAULT ? source : null;

/** A cost record as every read serializes it: its forecast's source and basis beside the figure. */
const withForecastBasis = (record) => {
  if (!record || typeof record !== "object") return record;
  const forecastSource = knownSource(record.forecastSource);
  return { ...record, forecastSource, forecastBasis: forecastBasisOf(forecastSource) };
};

/** How many records' forecasts were entered, are the default, or were not recorded. */
const forecastSourceMix = (records = []) => {
  const mix = { entered: 0, default: 0, notRecorded: 0, total: 0 };
  for (const record of records) {
    const source = knownSource(record && record.forecastSource);
    if (source === FORECAST_SOURCES.ENTERED) mix.entered += 1;
    else if (source === FORECAST_SOURCES.DEFAULT) mix.default += 1;
    else mix.notRecorded += 1;
    mix.total += 1;
  }
  return mix;
};

module.exports = {
  FORECAST_SOURCES,
  FORECAST_BASIS,
  isAmountShaped,
  isForecastSupplied,
  suppliedForecast,
  defaultForecast,
  forecastOnCreate,
  forecastOnUpdate,
  projectedFinalCost,
  forecastBasisOf,
  withForecastBasis,
  forecastSourceMix,
};
