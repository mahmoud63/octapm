const { prisma } = require("../config/db");
const { HttpError } = require("../utils/http-error");

/**
 * Units of measure (project-controls wave PC-1, control-model doc §1.2).
 *
 * A bill arrives with units spelled every way a spreadsheet allows — "M3",
 * "cu.m", "m³", "Cum" — and nothing downstream can compare quantities until
 * they mean the same thing. The organisation keeps a master list of unit
 * codes with the spellings that map to each; `normalise` turns what was typed
 * into a code or null. What was typed is never rewritten: `BoqItem.unit`
 * stays as entered and `BoqItem.unitCode` holds the match, so a unit nobody
 * recognises is a warning the QS can act on, not a silent correction.
 *
 * An organisation that has not been seeded yet (older than this wave, or
 * provisioned before the seed call site lands) normalises against the default
 * list, so the answer is the same before and after `seedDefaultUnits` runs.
 */

const UNIT_STATUSES = Object.freeze({ ACTIVE: "active", ARCHIVED: "archived" });

const UNIT_DIMENSIONS = Object.freeze([
  "length",
  "area",
  "volume",
  "mass",
  "time",
  "count",
  "money",
]);

/** The list every organisation starts with (control-model doc §1.2). */
const DEFAULT_UNITS = Object.freeze([
  { code: "m", name: "Metre", dimension: "length", aliases: ["lm", "l.m", "lin.m", "metre", "meter", "mtr", "rm"] },
  { code: "m2", name: "Square metre", dimension: "area", aliases: ["sqm", "sq.m", "sq m", "m^2", "sm", "square metre", "square meter"] },
  { code: "m3", name: "Cubic metre", dimension: "volume", aliases: ["cum", "cu.m", "cu m", "m^3", "cbm", "cubic metre", "cubic meter"] },
  { code: "nr", name: "Number", dimension: "count", aliases: ["no", "no.", "nos", "num", "number", "each", "ea", "unit"] },
  { code: "kg", name: "Kilogram", dimension: "mass", aliases: ["kgs", "kilogram", "kilo"] },
  { code: "t", name: "Tonne", dimension: "mass", aliases: ["ton", "tonne", "tons", "tonnes", "mt"] },
  { code: "hr", name: "Hour", dimension: "time", aliases: ["h", "hour", "hours", "hrs"] },
  { code: "day", name: "Day", dimension: "time", aliases: ["days", "d"] },
  { code: "ls", name: "Lump sum", dimension: "money", aliases: ["l.s", "l.s.", "lump", "lumpsum", "lump sum"] },
  { code: "sum", name: "Sum", dimension: "money", aliases: ["ps", "p.s", "prov sum", "provisional sum"] },
  { code: "item", name: "Item", dimension: "count", aliases: ["itm", "items"] },
  { code: "l", name: "Litre", dimension: "volume", aliases: ["lt", "ltr", "litre", "liter", "litres"] },
  { code: "bag", name: "Bag", dimension: "count", aliases: ["bags"] },
  { code: "sheet", name: "Sheet", dimension: "count", aliases: ["sheets", "sht"] },
  { code: "roll", name: "Roll", dimension: "count", aliases: ["rolls"] },
  { code: "load", name: "Load", dimension: "count", aliases: ["loads", "trip", "trips"] },
  { code: "pcs", name: "Pieces", dimension: "count", aliases: ["pc", "piece", "pieces"] },
]);

const trimOrNull = (value) => {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text || null;
};

/**
 * The comparison form of a unit spelling: lower case, superscripts folded,
 * punctuation and spaces dropped. "M³", "m 3", "M.3" and "m3" all key to
 * "m3"; "Sq. M" keys to "sqm", which is an alias of m2.
 */
const unitKey = (value) => {
  const text = trimOrNull(value);
  if (!text) return null;
  return text
    .toLowerCase()
    .replace(/²/g, "2")
    .replace(/³/g, "3")
    .replace(/[\s._\-/()]/g, "")
    .replace(/[^a-z0-9^]/g, "");
};

const normalizeCode = (value) => {
  const code = trimOrNull(value);
  if (!code) {
    throw new HttpError(400, "UNIT_CODE_REQUIRED", "Unit code is required");
  }
  if (code.length > 16) {
    throw new HttpError(400, "UNIT_CODE_TOO_LONG", "Unit code must be 16 characters or fewer");
  }
  return code.toLowerCase();
};

const normalizeDimension = (value, fallback = "count") => {
  const dimension = trimOrNull(value)?.toLowerCase() || fallback;
  if (!UNIT_DIMENSIONS.includes(dimension)) {
    throw new HttpError(
      400,
      "UNIT_DIMENSION_INVALID",
      `Unit dimension must be one of: ${UNIT_DIMENSIONS.join(", ")}`,
    );
  }
  return dimension;
};

const normalizeAliases = (value) => {
  const list = Array.isArray(value) ? value : [];
  return [...new Set(list.map(trimOrNull).filter(Boolean).map((alias) => alias.toLowerCase()))];
};

const toIso = (value) => value?.toISOString?.() || value || null;

const serializeUnit = (unit) => ({
  id: unit.id,
  orgId: unit.orgId,
  code: unit.code,
  name: unit.name,
  aliases: Array.isArray(unit.aliasesJson) ? unit.aliasesJson : [],
  dimension: unit.dimension,
  isSystem: Boolean(unit.isSystem),
  status: unit.status,
  sortOrder: unit.sortOrder,
  createdAt: toIso(unit.createdAt),
  updatedAt: toIso(unit.updatedAt),
});

/** The default list in the row shape `createMany` takes. */
const defaultUnitRows = (orgId) =>
  DEFAULT_UNITS.map((unit, index) => ({
    orgId,
    code: unit.code,
    name: unit.name,
    aliasesJson: unit.aliases,
    dimension: unit.dimension,
    isSystem: true,
    status: UNIT_STATUSES.ACTIVE,
    sortOrder: index,
  }));

/**
 * Seeds the default units for one organisation. Idempotent: a code the
 * organisation already has is left exactly as it is (an operator may have
 * renamed it or added aliases), and only the missing codes are written.
 */
const seedDefaultUnits = async ({ tx = prisma, orgId }) => {
  if (!orgId) return { created: 0, existing: 0 };
  const existing = await tx.unitOfMeasure.findMany({
    where: { orgId },
    select: { code: true },
  });
  const present = new Set(existing.map((row) => row.code));
  const missing = defaultUnitRows(orgId).filter((row) => !present.has(row.code));
  if (missing.length) {
    await tx.unitOfMeasure.createMany({ data: missing, skipDuplicates: true });
  }
  return { created: missing.length, existing: existing.length };
};

/**
 * A lookup from every known spelling to a unit code, for one organisation.
 * Built once per upload rather than once per row. Falls back to the default
 * list when the organisation has no unit rows yet.
 */
const loadUnitIndex = async (orgId, tx = prisma) => {
  // A client without the model (an older generated client, or the mocked
  // Prisma the unit tests hand in) answers from the default list, as an
  // unseeded organisation does.
  const rows = orgId && tx.unitOfMeasure?.findMany
    ? await tx.unitOfMeasure.findMany({
        where: { orgId, status: UNIT_STATUSES.ACTIVE },
        orderBy: [{ sortOrder: "asc" }, { code: "asc" }],
      })
    : [];
  const units = rows.length
    ? rows.map((row) => ({ code: row.code, aliases: Array.isArray(row.aliasesJson) ? row.aliasesJson : [] }))
    : DEFAULT_UNITS;
  const map = new Map();
  // Codes win over aliases: an alias that collides with another unit's code
  // must never redirect a correctly typed unit.
  for (const unit of units) {
    const key = unitKey(unit.code);
    if (key && !map.has(key)) map.set(key, unit.code);
  }
  for (const unit of units) {
    for (const alias of unit.aliases || []) {
      const key = unitKey(alias);
      if (key && !map.has(key)) map.set(key, unit.code);
    }
  }
  return { map, seeded: rows.length > 0, size: units.length };
};

/** The unit code a spelling resolves to under a loaded index, or null. */
const normaliseWith = (index, unit) => {
  const key = unitKey(unit);
  if (!key) return null;
  return index.map.get(key) || null;
};

/**
 * Resolves one spelling for an organisation. The answer carries the spelling
 * back unchanged so a caller can store both, plus a warning when nothing
 * matched — the warning is the whole point: the unit is kept, the row is not
 * refused, and the QS sees what to fix.
 */
const normalise = async ({ orgId, unit, tx = prisma }) => {
  const index = await loadUnitIndex(orgId, tx);
  const unitCode = normaliseWith(index, unit);
  const typed = trimOrNull(unit);
  return {
    unit: typed,
    unitCode,
    warning:
      typed && !unitCode
        ? { code: "UNIT_UNRECOGNISED", message: `Unit "${typed}" is not in the organisation's unit list`, unit: typed }
        : null,
  };
};

/**
 * Normalises every row of an upload against one index and gathers the rows
 * whose unit nobody recognises, grouped by spelling so a 400-row bill with
 * one odd unit reports it once with its row numbers.
 */
const normaliseRows = (index, rows, { unitOf = (row) => row.unit, rowNumberOf = (row, i) => i + 1 } = {}) => {
  const unresolved = new Map();
  const codes = rows.map((row, i) => {
    const typed = trimOrNull(unitOf(row));
    const unitCode = normaliseWith(index, typed);
    if (typed && !unitCode) {
      const entry = unresolved.get(typed.toLowerCase()) || { unit: typed, rows: [], count: 0 };
      entry.rows.push(rowNumberOf(row, i));
      entry.count += 1;
      unresolved.set(typed.toLowerCase(), entry);
    }
    return unitCode;
  });
  const warnings = [...unresolved.values()].map((entry) => ({
    code: "UNIT_UNRECOGNISED",
    unit: entry.unit,
    count: entry.count,
    rows: entry.rows.slice(0, 50),
    message: `Unit "${entry.unit}" is not in the organisation's unit list (${entry.count} row${entry.count === 1 ? "" : "s"})`,
  }));
  return { codes, warnings };
};

const listUnits = async ({ orgId, query = {} }) => {
  const where = { orgId };
  if (!query.includeArchived) where.status = UNIT_STATUSES.ACTIVE;
  const rows = await prisma.unitOfMeasure.findMany({
    where,
    orderBy: [{ sortOrder: "asc" }, { code: "asc" }],
  });
  return {
    items: rows.map(serializeUnit),
    seeded: rows.length > 0,
    defaults: rows.length ? [] : DEFAULT_UNITS.map((unit) => ({ code: unit.code, name: unit.name, dimension: unit.dimension, aliases: unit.aliases })),
    summary: {
      total: rows.length,
      active: rows.filter((row) => row.status === UNIT_STATUSES.ACTIVE).length,
      archived: rows.filter((row) => row.status === UNIT_STATUSES.ARCHIVED).length,
    },
  };
};

const createUnit = async ({ orgId, payload = {} }) => {
  const code = normalizeCode(payload.code);
  const name = trimOrNull(payload.name) || code;
  if (name.length > 80) {
    throw new HttpError(400, "UNIT_NAME_TOO_LONG", "Unit name must be 80 characters or fewer");
  }
  const dimension = normalizeDimension(payload.dimension);
  const aliases = normalizeAliases(payload.aliases);

  const created = await prisma.$transaction(async (tx) => {
    // The first unit an organisation adds by hand lands beside the defaults,
    // not instead of them: normalisation must keep answering for m2 and m3.
    await seedDefaultUnits({ tx, orgId });
    const duplicate = await tx.unitOfMeasure.findFirst({
      where: { orgId, code },
      select: { id: true },
    });
    if (duplicate) {
      throw new HttpError(409, "UNIT_DUPLICATE_CODE", `Unit "${code}" already exists for this organisation`);
    }
    const last = await tx.unitOfMeasure.findFirst({
      where: { orgId },
      orderBy: { sortOrder: "desc" },
      select: { sortOrder: true },
    });
    return tx.unitOfMeasure.create({
      data: {
        orgId,
        code,
        name,
        aliasesJson: aliases,
        dimension,
        isSystem: false,
        status: UNIT_STATUSES.ACTIVE,
        sortOrder: last ? last.sortOrder + 1 : 0,
      },
    });
  });

  return serializeUnit(created);
};

module.exports = {
  DEFAULT_UNITS,
  UNIT_DIMENSIONS,
  UNIT_STATUSES,
  createUnit,
  listUnits,
  loadUnitIndex,
  normalise,
  normaliseRows,
  normaliseWith,
  seedDefaultUnits,
  serializeUnit,
  unitKey,
};
