// The validator library express-validator itself uses (its checks are compared by identity).
// eslint-disable-next-line import/no-dynamic-require
const validatorLib = require(require.resolve("validator", { paths: [require.resolve("express-validator")] }));
const { createApp } = require("../../app");
const { rejectNullBytes } = require("../../middleware/reject-null-bytes");
const { scalarFigure, INT4_MAX, INT4_MIN, MONEY_FIGURE_MAX } = require("../../utils/figure-input");
const { MONEY_MAX } = require("../../utils/money");
const { dateInput, dateOnlyInput } = require("../../utils/date-input");

/**
 * CERT-2, robustness: every route of the real application, read from its
 * mounted routers.
 *
 * - every multer middleware is followed by the NUL / lone-surrogate guard (a
 *   multipart body is parsed inside the route, after the application-level
 *   guard has run);
 * - every body chain with a numeric check or sanitizer checks first that the
 *   figure is one value (scalarFigure): isFloat()/isInt() take an array
 *   element by element and the services read Number([1,1]) || 0 as 0;
 * - no body or query chain checks a date with validator's isISO8601 / isDate /
 *   isRFC3339 — each uses dateInput (or dateOnlyInput): isISO8601 lets through
 *   "20261001", "2026-W40", "2026-275", which Date cannot read (a 500).
 *
 * The daily-report, site-diary and meeting routes are held to both since
 * CERT-2 evidence-6 (their 44 figure chains took [1,1], [5] and []).
 */

const normalise = (value) => value.replace(/:([A-Za-z0-9_]+)/g, "{$1}").replace(/\/{2,}/g, "/").replace(/\/$/, "") || "/";
const mountPath = (layer) => {
  let source = layer.regexp.source;
  if (source === "^\\/?(?=\\/|$)") return "";
  source = source
    .replace(/^\^/, "")
    .replace(/\\\/\?\(\?=\\\/\|\$\)$/, "")
    .replace(/\(\?=\\\/\|\$\)$/, "")
    .replace(/\\\/\?\$$/, "")
    .replace(/\\\//g, "/");
  let k = 0;
  return source
    .replace(/\(\?:\/\(\[\^\/\]\+\?\)\)/g, () => `/{${layer.keys[k++]?.name || "param"}}`)
    .replace(/\(\[\^\/\]\+\?\)/g, () => `{${layer.keys[k++]?.name || "param"}}`)
    .replace(/\\\./g, ".")
    .replace(/\^/g, "")
    .replace(/\$/g, "")
    .replace(/\?/g, "");
};

const collectRoutes = () => {
  const app = createApp();
  const routes = [];
  const walk = (stack, prefix = "") => {
    for (const layer of stack) {
      if (layer.route) {
        const template = normalise(`${prefix}${layer.route.path}`);
        for (const method of Object.keys(layer.route.methods)) {
          routes.push({ key: `${method.toUpperCase()} ${template}`, template, handles: layer.route.stack.map((l) => l.handle) });
        }
        continue;
      }
      if (layer.name === "router" && layer.handle?.stack) walk(layer.handle.stack, normalise(`${prefix}${mountPath(layer)}`));
    }
  };
  walk(app._router.stack);
  return routes;
};

const chainsOf = (route) =>
  route.handles
    .map((handle) => handle?.builder?.build?.())
    .filter(Boolean)
    .map((context) => ({ fields: context.fields, locations: context.locations, items: context.stack }));

/** express-validator's isString() is a custom check of its own: recognised by what it accepts. */
const isStringCheck = (item) => {
  if (item?.constructor?.name !== "CustomValidation" || item.negated || typeof item.validator !== "function") return false;
  try {
    return item.validator("x") === true && item.validator(["x"]) === false && item.validator({}) === false && item.validator(5) === false;
  } catch {
    return false;
  }
};
const TEXT_SANITIZERS = new Set([validatorLib.trim, validatorLib.ltrim, validatorLib.rtrim, validatorLib.escape, validatorLib.unescape, validatorLib.stripLow, validatorLib.blacklist, validatorLib.whitelist, validatorLib.normalizeEmail]);
const TEXT_CHECKS = new Set([validatorLib.isLength, validatorLib.isEmpty, validatorLib.matches, validatorLib.isEmail, validatorLib.isURL, validatorLib.contains, validatorLib.isAlphanumeric, validatorLib.isAlpha, validatorLib.isMobilePhone, validatorLib.isHexColor]);
const SHAPE_CHECKS = new Set([validatorLib.isIn, validatorLib.isUUID, validatorLib.isBoolean, validatorLib.isInt, validatorLib.isFloat, validatorLib.isNumeric, validatorLib.isDecimal, validatorLib.isJSON]);
const NUMERIC_CHECKS = new Set([validatorLib.isFloat, validatorLib.isInt, validatorLib.isNumeric, validatorLib.isDecimal]);
const NUMERIC_SANITIZERS = new Set([validatorLib.toInt, validatorLib.toFloat]);
const STANDARD_DATE_CHECKS = new Set([validatorLib.isISO8601, validatorLib.isDate, validatorLib.isRFC3339]);

describe("input-shape guards on every route (CERT-2)", () => {
  let routes;
  beforeAll(() => {
    routes = collectRoutes();
  });

  it("reads the application's routes", () => {
    expect(routes.length).toBeGreaterThan(500);
    expect(routes.some((r) => r.key === "POST /api/v1/projects/{projectId}/attachments")).toBe(true);
  });

  it("every multer middleware is followed by the NUL / lone-surrogate guard", () => {
    const uploads = routes.filter((r) => r.handles.some((h) => h?.name === "multerMiddleware"));
    expect(uploads.length).toBeGreaterThanOrEqual(15);
    const unguarded = uploads.filter((r) => r.handles.some((h, i) => h?.name === "multerMiddleware" && r.handles[i + 1] !== rejectNullBytes)).map((r) => r.key);
    expect(unguarded).toEqual([]);
  });

  it("every body figure chain checks the figure is one value before its numeric check", () => {
    const unguarded = [];
    let figures = 0;
    for (const route of routes) {
      for (const chain of chainsOf(route)) {
        if (!chain.locations.includes("body")) continue;
        const numeric = chain.items.findIndex((item) => NUMERIC_CHECKS.has(item.validator) || NUMERIC_SANITIZERS.has(item.sanitizer));
        if (numeric === -1) continue;
        figures += 1;
        const guard = chain.items.findIndex((item) => item.validator === scalarFigure);
        if (guard === -1 || guard > numeric) unguarded.push(`${route.key} [${chain.fields}]`);
      }
    }
    expect(figures).toBeGreaterThan(300);
    expect(unguarded).toEqual([]);
  });

  it("no body or query chain checks a date with isISO8601 / isDate / isRFC3339; dates go through dateInput", () => {
    const standard = [];
    let dates = 0;
    for (const route of routes) {
      for (const chain of chainsOf(route)) {
        if (chain.items.some((item) => STANDARD_DATE_CHECKS.has(item.validator))) standard.push(`${route.key} [${chain.fields}]`);
        if (chain.items.some((item) => item.validator === dateInput || item.validator === dateOnlyInput)) dates += 1;
      }
    }
    expect(dates).toBeGreaterThan(250);
    expect(standard).toEqual([]);
  });

  // The three tests below (robustness-6) leave out the daily-report, site-diary
  // and meeting routes: their chains are the evidence group's to bring onto
  // isString, bail() and the column bounds.
  const EVIDENCE_GROUP_ROUTES = /\/(daily-reports|site-diaries|meetings)(\/|$)/;

  /**
   * robustness-6: a text chain without a string check let an array or an
   * object through. trim() sanitizes an array element by element, so
   * ["a","b"] reached the write — after the register's next reference had
   * been drawn — and an object became "[object Object]" and was stored as an
   * RFI's subject. Every body chain that sanitizes or checks text checks
   * first that the value is one string (isString), before any sanitizer.
   */
  it("every body text chain checks the value is one string before its first sanitizer", () => {
    const unguarded = [];
    let texts = 0;
    for (const route of routes) {
      if (EVIDENCE_GROUP_ROUTES.test(route.template)) continue;
      for (const chain of chainsOf(route)) {
        if (!chain.locations.includes("body")) continue;
        const sanitizer = chain.items.findIndex((item) => TEXT_SANITIZERS.has(item.sanitizer));
        const textCheck = chain.items.findIndex((item) => TEXT_CHECKS.has(item.validator));
        if (sanitizer === -1 && textCheck === -1) continue;
        // a chain that checks another shape (an enumeration, an identifier, a list) is not a text chain
        if (sanitizer === -1 && chain.items.some((item) => SHAPE_CHECKS.has(item.validator) || (item.constructor.name === "CustomValidation" && !isStringCheck(item)))) continue;
        texts += 1;
        const string = chain.items.findIndex(isStringCheck);
        const first = [sanitizer, textCheck].filter((i) => i !== -1).reduce((a, b) => Math.min(a, b));
        if (string === -1 || (sanitizer !== -1 && string > sanitizer)) unguarded.push(`${route.key} [${chain.fields}]${string === -1 ? "" : ` (isString at ${string}, first text item at ${first})`}`);
      }
    }
    expect(texts).toBeGreaterThan(1000);
    expect(unguarded).toEqual([]);
  });

  /**
   * robustness-6: scalarFigure refuses an array or an object, but the chain
   * ran on and the numeric check after it converted the value to a string —
   * multer's object for a field "x[k]" has no prototype and cannot be, so the
   * request answered 500. A refused figure stops its chain.
   */
  it("every scalarFigure guard is followed by bail()", () => {
    const unbailed = [];
    let guards = 0;
    for (const route of routes) {
      if (EVIDENCE_GROUP_ROUTES.test(route.template)) continue;
      for (const chain of chainsOf(route)) {
        chain.items.forEach((item, i) => {
          if (item.validator !== scalarFigure) return;
          guards += 1;
          if (chain.items[i + 1]?.constructor?.name !== "Bail") unbailed.push(`${route.key} [${chain.fields}]`);
        });
      }
    }
    expect(guards).toBeGreaterThan(400);
    expect(unbailed).toEqual([]);
  });

  /**
   * robustness-6: an integer beyond an Int column (2^31) passed the door and
   * failed in the query engine; "1e400" passed an unbounded isFloat() as
   * Infinity and was stored as 0 or as NULL in a Decimal(18,2) column. Every
   * integer chain is bounded to the INT4 range, every float chain to a finite
   * maximum no larger than what a Decimal(18,2) column holds.
   */
  it("every isInt is bounded to the INT4 range and every isFloat / isDecimal / isNumeric to a finite maximum", () => {
    const unbounded = [];
    let ints = 0;
    let floats = 0;
    const bound = (item, key) => item.options?.[0]?.[key];
    for (const route of routes) {
      if (EVIDENCE_GROUP_ROUTES.test(route.template)) continue;
      for (const chain of chainsOf(route)) {
        if (!chain.locations.includes("body")) continue;
        for (const item of chain.items) {
          if (item.negated) continue;
          if (item.validator === validatorLib.isInt) {
            ints += 1;
            const max = bound(item, "max") ?? bound(item, "lt");
            const min = bound(item, "min") ?? bound(item, "gt");
            if (!(max <= INT4_MAX) || !(min >= INT4_MIN)) unbounded.push(`${route.key} [${chain.fields}] isInt(${JSON.stringify(item.options?.[0] || {})})`);
          }
          if ([validatorLib.isFloat, validatorLib.isDecimal, validatorLib.isNumeric].includes(item.validator)) {
            floats += 1;
            const max = bound(item, "max") ?? bound(item, "lt");
            if (!(Number.isFinite(max) && max <= MONEY_FIGURE_MAX)) unbounded.push(`${route.key} [${chain.fields}] ${item.validator.name}(${JSON.stringify(item.options?.[0] || {})})`);
          }
        }
      }
    }
    expect(ints).toBeGreaterThan(100);
    expect(floats).toBeGreaterThan(100);
    expect(unbounded).toEqual([]);
  });

  it("MONEY_FIGURE_MAX is the largest double that a Decimal(18,2) holds; 9999999999999999.99 itself reads as 1e16", () => {
    expect(MONEY_FIGURE_MAX).toBe(9999999999999998);
    expect(Number("9999999999999999.99")).toBe(1e16);
    expect(MONEY_FIGURE_MAX < Number(MONEY_MAX)).toBe(true);
    expect(validatorLib.isFloat("9999999999999998", { max: MONEY_FIGURE_MAX })).toBe(true);
    expect(validatorLib.isFloat("9999999999999999.99", { max: MONEY_FIGURE_MAX })).toBe(false);
    expect(validatorLib.isFloat("1e400", { min: 0, max: MONEY_FIGURE_MAX })).toBe(false);
    expect(validatorLib.isInt("2147483648", { min: 0, max: INT4_MAX })).toBe(false);
    expect(validatorLib.isInt("-2147483649", { min: INT4_MIN, max: INT4_MAX })).toBe(false);
  });

  it("the public bid portal checks a line's rate (one figure, finite, 0 or more) and the transmittal door its ref and notes", () => {
    const chainFor = (key, field) => chainsOf(routes.find((r) => r.key === key)).find((chain) => chain.fields.includes(field));
    const rate = chainFor("PUT /api/v1/public/bids/{token}/bid", "lines.*.rate");
    expect(rate).toBeDefined();
    const check = rate.items.find((item) => item.constructor.name === "CustomValidation").validator;
    for (const value of [12.5, "12.50", "1,250.00", "0", 0, "", null]) expect(check(value)).toBe(true);
    for (const value of [[1, 1], ["5"], { n: 1 }, true, "1e400", "-1", -1, "12abc", "Infinity", 1e17]) expect(() => check(value)).toThrow();
    for (const field of ["ref", "notes", "subject", "sender", "recipient"]) expect(chainFor("POST /api/v1/projects/{projectId}/transmittals", field).items.some(isStringCheck)).toBe(true);
    for (const field of ["notes", "subject", "sender", "recipient"]) expect(chainFor("PATCH /api/v1/projects/{projectId}/transmittals/{transmittalId}", field).items.some(isStringCheck)).toBe(true);
  });

  it("GET /search checks every date it reads, its aliases included, and PATCH /auth/me/account checks dob", () => {
    const fieldsWithDateInput = (key) =>
      chainsOf(routes.find((r) => r.key === key))
        .filter((chain) => chain.items.some((item) => item.validator === dateInput))
        .flatMap((chain) => chain.fields);
    expect(fieldsWithDateInput("GET /api/v1/search")).toEqual(expect.arrayContaining(["dateFrom", "dateTo", "from", "to", "updatedAfter", "updatedBefore"]));
    expect(fieldsWithDateInput("PATCH /api/v1/auth/me/account")).toEqual(["dob"]);
  });

  it("the daily-report, site-diary and meeting routes: every figure chain is one value, every date chain dateInput (CERT-2 evidence-6)", () => {
    const SITE = /\/(daily-reports|site-diaries|meetings)(\/|$)/;
    const site = routes.filter((r) => SITE.test(r.template));
    const figures = [];
    const unguarded = [];
    const dates = [];
    for (const route of site) {
      for (const chain of chainsOf(route)) {
        const numeric = chain.items.findIndex((item) => NUMERIC_CHECKS.has(item.validator) || NUMERIC_SANITIZERS.has(item.sanitizer));
        if (chain.locations.includes("body") && numeric !== -1) {
          figures.push(`${route.key} [${chain.fields}]`);
          const guard = chain.items.findIndex((item) => item.validator === scalarFigure);
          if (guard === -1 || guard > numeric) unguarded.push(`${route.key} [${chain.fields}]`);
        }
        if (chain.items.some((item) => item.validator === dateInput || item.validator === dateOnlyInput)) dates.push(`${route.key} [${chain.fields}]`);
      }
    }
    // 51 body figure chains — 13 + 13 of a daily report (moneyBody's progress.actualCost among them), 9 + 9 of a
    // site diary, 2 agenda sortOrder, 5 of an action item's raise-change-event — and 40 date chains (34 of the
    // three payloads, 6 list filters). 44 of the figure chains took [1,1], [5] and [] before evidence-6.
    // trivial-7 added 8, each guarded: an equipment line's own rate (create and update, on both
    // records: 4) and a site diary's weatherJson temperatureC and rainfallMm (create and update: 4).
    expect(figures.length).toBe(59);
    expect(unguarded).toEqual([]);
    expect(dates.length).toBe(40);
  });
});
