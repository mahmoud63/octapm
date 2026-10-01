const { Prisma } = require("@prisma/client");
const { Decimal: PrismaRuntimeDecimal } = require("@prisma/client/runtime/library");
const { prisma } = require("../config/db");
const { HttpError } = require("../utils/http-error");
const { isPrismaDecimal } = require("../utils/money");
const { resolveReportingCutoff, resolveReportingTimeZone } = require("../utils/reporting-cutoff");
const auditService = require("./audit.service");
const progressService = require("./progress.service");
const uomService = require("./uom.service");

/**
 * Quantity progress entries (PC-6, OCTAPM_PROGRESS_MEASUREMENT.md §3).
 *
 * An entry says "so much of this BOQ item was installed on this activity on
 * this day". It is recorded by a person on site, by a daily log's quantities
 * section, by an import or by a progress submission, and it is NEVER
 * official by itself: the installed quantity of an item on an activity is
 * the sum of its APPROVED entries, and the one thing that approves an entry
 * is the approval of the progress submission that bundles it — the same
 * roles, the same gates and the same writer as every other progress figure
 * (progress.service approveProgressSubmissionWithClient, the one writer of
 * ActivityProgress). This service makes, lists, edits, removes and submits
 * entries, and reads the installed and planned figures the other waves
 * build on. It writes no ActivityProgress row, ever.
 *
 * Five quantities, five truths (owner rule): received, issued, installed,
 * certified and paid are never merged and never summed across units. This
 * file holds the installed one. Every figure here is per BOQ item in that
 * item's unit: an entry's unit must be the item's unit code or a spelling
 * the organisation's unit master maps to it (no conversions exist, so none
 * are made), and the sums are Decimal(18,3) — the column's own scale —
 * never floating-point.
 *
 * Provenance ("PROGRESS SOURCE"): every entry carries where it came from
 * (source), who recorded it and when, the daily log / submission / import it
 * came through, and who approved or rejected it and when.
 *
 * A per-item quantity is BOQ-derived (binding BOQ-access rule): the routes
 * pass every answer through utils/boq-figures.withheldQuantityEntries, which
 * leaves a member without boq:read the entry's existence, status, activity,
 * date and provenance, and withholds its quantity, unit, item and
 * allocation. This service builds the full answer; it never decides who sees
 * it.
 */

const Decimal = typeof Prisma?.Decimal === "function" ? Prisma.Decimal : PrismaRuntimeDecimal;

const QUANTITY_SCALE = 3; // Decimal(18, 3)
const ENTITY_TYPE = "quantity_progress_entry";
const ENTRY_STATUSES = Object.freeze(["draft", "submitted", "approved", "rejected"]);
const ENTRY_SOURCES = Object.freeze(["submission", "daily_log", "manual", "import"]);
const CREATABLE_STATUSES = Object.freeze(["draft", "submitted"]);
const EDITABLE_STATUSES = Object.freeze(["draft", "submitted"]);
const ALLOCATION_COUNTED_STATUS = "approved";
const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})/;

const trimOrNull = (value) => {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text || null;
};

const toIso = (value) => (value ? new Date(value).toISOString() : null);

const dateKey = (value) => (value ? new Date(value).toISOString().slice(0, 10) : null);

// ─── quantities (Decimal, three places) ────────────────────────────────────

const isBlank = (value) => value === undefined || value === null || value === "";

/** A Decimal at the column's scale; null for nothing; throws for a non-number. */
const quantityDecimal = (value, field = "quantity") => {
  if (isBlank(value)) return null;
  if (typeof value === "number" && !Number.isFinite(value)) {
    throw new HttpError(400, "QUANTITY_INVALID", `${field} must be a finite number`, { field });
  }
  let decimal;
  try {
    decimal = isPrismaDecimal(value) ? value : new Decimal(typeof value === "string" ? value.trim() : value);
  } catch {
    throw new HttpError(400, "QUANTITY_INVALID", `${field} must be a number`, { field });
  }
  if (!decimal.isFinite()) {
    throw new HttpError(400, "QUANTITY_INVALID", `${field} must be a finite number`, { field });
  }
  return decimal.toDecimalPlaces(QUANTITY_SCALE);
};

const sumQuantities = (values) =>
  values.reduce((total, value) => total.plus(quantityDecimal(value) ?? new Decimal(0)), new Decimal(0)).toDecimalPlaces(QUANTITY_SCALE);

/**
 * A quantity entry states work done: zero is no work, and no work is no
 * entry (integration item 7 — the CHECK admits quantity = 0, and a zero
 * entry would be approved, counted as an entry behind an official figure and
 * listed on the PDF as a quantity installed). Refused on create and on edit,
 * here and in the daily log's quantities section, after the negative rule.
 */
const ZERO_QUANTITY_MESSAGE = "A quantity must be greater than zero; record nothing for no work";
const assertPositiveQuantity = (quantity, field = "quantity") => {
  if (quantity && quantity.isZero()) throw new HttpError(400, "QUANTITY_INVALID", ZERO_QUANTITY_MESSAGE, { field });
};

/** The JSON form of a quantity: a number at three places (never used for arithmetic). */
const quantityNumber = (value) => {
  const decimal = quantityDecimal(value);
  return decimal === null ? null : Number(decimal.toFixed(QUANTITY_SCALE));
};

// ─── dates ─────────────────────────────────────────────────────────────────

/** The calendar day an entry is dated (a Date at UTC midnight for @db.Date). */
const parseEntryDate = (value, field = "date") => {
  const text = trimOrNull(value);
  if (!text) throw new HttpError(400, "QUANTITY_DATE_REQUIRED", `${field} is required (the calendar day the work was done)`, { field });
  const match = DATE_ONLY.exec(text);
  if (!match) throw new HttpError(400, "INVALID_DATE", `${field} is invalid`, { field });
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    throw new HttpError(400, "INVALID_DATE", `${field} is invalid`, { field });
  }
  return date;
};

/**
 * The instant a cutoff means: a Date is taken as it is; a calendar date is
 * the end of that day in the project's reporting zone (the EV rule, owner
 * decision D1) so the installed figure at a period's cutoff is selected
 * against the same instant EV selects its progress against.
 */
const resolveCutoffInstant = async ({ cutoffDate, project, tx }) => {
  if (!cutoffDate) return null;
  if (cutoffDate instanceof Date) {
    if (Number.isNaN(cutoffDate.getTime())) throw new HttpError(400, "INVALID_DATE", "cutoffDate is invalid");
    return cutoffDate;
  }
  const organisation = project?.orgId && tx.organisation?.findUnique ? await tx.organisation.findUnique({ where: { id: project.orgId } }) : null;
  const zone = resolveReportingTimeZone({ project, organisation });
  try {
    return resolveReportingCutoff({ value: cutoffDate, timeZone: zone.timeZone, timeZoneSource: zone.source }).cutoffDate;
  } catch {
    throw new HttpError(400, "INVALID_DATE", "cutoffDate is invalid");
  }
};

// ─── lookups ───────────────────────────────────────────────────────────────

const ensureProject = async ({ orgId, projectId }, tx = prisma) => {
  const project = await tx.project.findFirst({ where: { id: projectId, orgId } });
  if (!project) throw new HttpError(404, "PROJECT_NOT_FOUND", "Project not found");
  return project;
};

const ensureActivity = async ({ projectId, activityId }, tx = prisma) => {
  const activity = await tx.activity.findFirst({ where: { id: activityId, projectId, isActive: true } });
  if (!activity) throw new HttpError(404, "ACTIVITY_NOT_FOUND", "Activity not found");
  return activity;
};

const ensureBoqItem = async ({ projectId, boqItemId }, tx = prisma) => {
  const item = await tx.boqItem.findFirst({ where: { id: boqItemId, projectId, isActive: true } });
  if (!item) throw new HttpError(404, "BOQ_ITEM_NOT_FOUND", "BOQ item not found");
  return item;
};

const ensureLocation = async ({ projectId, locationId }, tx = prisma) => {
  const location = await tx.location.findFirst({ where: { id: locationId, projectId } });
  if (!location) throw new HttpError(404, "LOCATION_NOT_FOUND", "Location not found on this project");
  return location;
};

const ensureAllocation = async ({ projectId, activityId, boqItemId, allocationId }, tx = prisma) => {
  const allocation = await tx.activityBoqAllocation.findFirst({ where: { id: allocationId, projectId } });
  if (!allocation) throw new HttpError(404, "ALLOCATION_NOT_FOUND", "Allocation not found");
  if (allocation.activityId !== activityId || allocation.boqItemId !== boqItemId) {
    throw new HttpError(400, "QUANTITY_ALLOCATION_MISMATCH", "The allocation named does not map this BOQ item to this activity", {
      allocationId,
      activityId,
      boqItemId,
    });
  }
  return allocation;
};

// ─── the unit rule ─────────────────────────────────────────────────────────

/**
 * The unit an item is measured in: its normalised code, else what its unit
 * spelling resolves to under the organisation's master, else the spelling
 * itself (an item whose unit nobody recognises still has one).
 */
const itemUnit = (item, index) => {
  const code = trimOrNull(item.unitCode) || uomService.normaliseWith(index, item.unit);
  return { code, typed: trimOrNull(item.unit), key: uomService.unitKey(code || item.unit) };
};

/**
 * The unit an entry is recorded in must be the item's: the item's code, or a
 * spelling the organisation's unit master maps to that code (an alias).
 * Nothing is converted — there is no conversion table, and an installed
 * figure in another unit would be a second truth. An entry that names no
 * unit is in the item's. Returns the unit code the entry is stored under.
 */
const resolveEntryUnit = ({ unit, item, index }) => {
  const target = itemUnit(item, index);
  const typed = trimOrNull(unit);
  if (!typed) {
    if (!target.code && !target.typed) {
      throw new HttpError(400, "QUANTITY_UNIT_REQUIRED", "The BOQ item has no unit; name the unit the quantity is measured in", { boqItemId: item.id });
    }
    return target.code || target.typed;
  }
  const resolved = uomService.normaliseWith(index, typed);
  const matches = target.code ? resolved === target.code || uomService.unitKey(typed) === uomService.unitKey(target.code) : uomService.unitKey(typed) === target.key;
  if (!matches) {
    throw new HttpError(400, "QUANTITY_UNIT_MISMATCH", `The quantity is in "${typed}" but the BOQ item is measured in "${target.code || target.typed}"; no conversion is made`, {
      unit: typed,
      unitCode: resolved,
      itemUnit: target.typed,
      itemUnitCode: target.code,
      boqItemId: item.id,
    });
  }
  return target.code || target.typed;
};

// ─── serialisation ─────────────────────────────────────────────────────────

const ENTRY_INCLUDE = Object.freeze({
  activity: { select: { id: true, name: true, activityCode: true, p6ActivityId: true, wbsCode: true } },
  boqItem: { select: { id: true, code: true, ref: true, description: true, unit: true, unitCode: true } },
  location: { select: { id: true, name: true, code: true } },
  submission: { select: { id: true, status: true, source: true, pctComplete: true } },
});

const serializeEntry = (row) => ({
  id: row.id,
  projectId: row.projectId,
  activityId: row.activityId,
  boqItemId: row.boqItemId,
  allocationId: row.allocationId || null,
  locationId: row.locationId || null,
  quantity: quantityNumber(row.quantity),
  unitCode: row.unitCode,
  date: dateKey(row.date),
  source: row.source,
  status: row.status,
  submissionId: row.submissionId || null,
  dailyLogId: row.dailyLogId || null,
  dailyLogQuantityId: row.dailyLogQuantityId || null,
  approvedBy: row.approvedBy || null,
  approvedAt: toIso(row.approvedAt),
  rejectedBy: row.rejectedBy || null,
  rejectedAt: toIso(row.rejectedAt),
  rejectionReason: row.rejectionReason || null,
  clientRequestId: row.clientRequestId || null,
  note: row.note || null,
  createdBy: row.createdBy || null,
  createdAt: toIso(row.createdAt),
  updatedAt: toIso(row.updatedAt),
  // PROGRESS SOURCE: where the figure came from, who recorded it, when, the
  // record it came through, and — once official — who made it so and when.
  provenance: {
    source: row.source,
    recordedBy: row.createdBy || null,
    recordedAt: toIso(row.createdAt),
    submissionId: row.submissionId || null,
    dailyLogId: row.dailyLogId || null,
    dailyLogQuantityId: row.dailyLogQuantityId || null,
    official: row.status === "approved",
    approvedBy: row.approvedBy || null,
    approvedAt: toIso(row.approvedAt),
    rejectedBy: row.rejectedBy || null,
    rejectedAt: toIso(row.rejectedAt),
  },
  activity: row.activity
    ? { id: row.activity.id, name: row.activity.name, code: row.activity.activityCode || row.activity.p6ActivityId || row.activity.wbsCode || null }
    : undefined,
  boqItem: row.boqItem
    ? { id: row.boqItem.id, code: row.boqItem.code || row.boqItem.ref || null, description: row.boqItem.description, unit: row.boqItem.unit, unitCode: row.boqItem.unitCode }
    : undefined,
  location: row.location ? { id: row.location.id, name: row.location.name, code: row.location.code } : row.locationId ? undefined : null,
  submission: row.submission ? { id: row.submission.id, status: row.submission.status, source: row.submission.source, pctComplete: row.submission.pctComplete } : row.submissionId ? undefined : null,
});

const auditSummary = (row, extra = {}) => ({
  activityId: row.activityId,
  boqItemId: row.boqItemId,
  quantity: quantityNumber(row.quantity),
  unitCode: row.unitCode,
  date: dateKey(row.date),
  source: row.source,
  status: row.status,
  ...extra,
});

// ─── allocation comparison (raw, a warning, never a block) ─────────────────

/**
 * Σ approved, active allocation quantity of an item on an activity — what
 * the planner mapped — and whether every such allocation is in one unit.
 */
const allocationQuantityFor = async ({ projectId, activityId, boqItemId }, tx = prisma) => {
  const rows = await tx.activityBoqAllocation.findMany({
    where: { projectId, activityId, boqItemId, status: ALLOCATION_COUNTED_STATUS, isActive: true },
    select: { id: true, quantity: true, unitCode: true },
  });
  return { allocations: rows, quantity: sumQuantities(rows.map((row) => row.quantity)) };
};

/** An entry recorded through the route names an item the activity has an approved, active allocation of (400 QUANTITY_ITEM_NOT_ALLOCATED). */
const assertItemAllocated = async ({ projectId, activityId, boqItemId }, tx = prisma) => {
  const { allocations } = await allocationQuantityFor({ projectId, activityId, boqItemId }, tx);
  if (allocations.length) return allocations;
  throw new HttpError(400, "QUANTITY_ITEM_NOT_ALLOCATED", "The activity has no approved allocation of this BOQ item; pick one of the activity's allocated items", {
    activityId,
    boqItemId,
  });
};

const approvedInstalledFor = async ({ projectId, activityId, boqItemId }, tx = prisma) => {
  const rows = await tx.quantityProgressEntry.findMany({
    where: { projectId, activityId, boqItemId, status: "approved" },
    select: { quantity: true },
  });
  return sumQuantities(rows.map((row) => row.quantity));
};

/**
 * Over-installation is real information, not an error (§3): an entry that
 * would take the approved installed quantity past the allocation — or names
 * an item the activity has no approved allocation of — is accepted with a
 * warning that states the raw comparison. No exception row, no block, no
 * change to anything (those are PC-7b's).
 */
const allocationWarnings = async ({ projectId, activityId, boqItemId, quantity, excludeEntryId = null }, tx = prisma) => {
  const warnings = [];
  const allocation = await allocationQuantityFor({ projectId, activityId, boqItemId }, tx);
  if (!allocation.allocations.length) {
    warnings.push({
      code: "QUANTITY_NO_APPROVED_ALLOCATION",
      message: "The activity has no approved allocation of this BOQ item; the entry is recorded against the item and the activity as named",
      activityId,
      boqItemId,
    });
    return warnings;
  }
  const approvedRows = await tx.quantityProgressEntry.findMany({
    where: { projectId, activityId, boqItemId, status: "approved", ...(excludeEntryId ? { id: { not: excludeEntryId } } : {}) },
    select: { quantity: true },
  });
  const approved = sumQuantities(approvedRows.map((row) => row.quantity));
  const wouldBe = approved.plus(quantity).toDecimalPlaces(QUANTITY_SCALE);
  if (wouldBe.greaterThan(allocation.quantity)) {
    warnings.push({
      code: "QUANTITY_OVER_ALLOCATION",
      message: `Approved installed ${approved.toFixed(QUANTITY_SCALE)} plus this entry ${quantityDecimal(quantity).toFixed(QUANTITY_SCALE)} exceeds the approved allocation ${allocation.quantity.toFixed(QUANTITY_SCALE)} of this item on this activity (a raw comparison; nothing is blocked or changed)`,
      activityId,
      boqItemId,
      allocationQuantity: quantityNumber(allocation.quantity),
      approvedQuantity: quantityNumber(approved),
      entryQuantity: quantityNumber(quantity),
      wouldBe: quantityNumber(wouldBe),
    });
  }
  return warnings;
};

// ─── the statuses ──────────────────────────────────────────────────────────

const normalizeStatus = (value, allowed = CREATABLE_STATUSES, fallback = "draft") => {
  const status = trimOrNull(value)?.toLowerCase() || fallback;
  if (!allowed.includes(status)) {
    throw new HttpError(400, "QUANTITY_ENTRY_STATUS_INVALID", `Quantity entry status must be one of: ${allowed.join(", ")}`, { status });
  }
  return status;
};

const normalizeSource = (value, fallback = "manual") => {
  const source = trimOrNull(value)?.toLowerCase() || fallback;
  if (!ENTRY_SOURCES.includes(source)) {
    throw new HttpError(400, "QUANTITY_ENTRY_SOURCE_INVALID", `Quantity entry source must be one of: ${ENTRY_SOURCES.join(", ")}`, { source });
  }
  return source;
};

const isUniqueViolation = (error) => error?.code === "P2002";

/**
 * An approved entry is source data for an official figure and a rejected
 * one is its trail: neither is edited or removed (a correction is a
 * rejection plus a new entry, §3). An entry bundled into a pending
 * submission is the submission's figure: it is not changed under it.
 */
const assertEditable = (entry) => {
  if (!EDITABLE_STATUSES.includes(entry.status)) {
    throw new HttpError(409, "QUANTITY_ENTRY_LOCKED", `A ${entry.status} quantity entry is not changed; record a correction as a new entry`, {
      entryId: entry.id,
      status: entry.status,
    });
  }
  if (entry.submissionId && entry.submission && entry.submission.status !== "rejected") {
    throw new HttpError(409, "QUANTITY_ENTRY_BUNDLED", "This entry is part of a progress submission awaiting approval; reject the submission first", {
      entryId: entry.id,
      submissionId: entry.submissionId,
      submissionStatus: entry.submission.status,
    });
  }
};

/** Its creator may change a pending entry; so may anyone who may approve progress. */
const assertMayManage = ({ entry, userId, canApprove }) => {
  if (canApprove) return;
  if (entry.createdBy && userId && entry.createdBy === userId) return;
  throw new HttpError(403, "QUANTITY_ENTRY_FORBIDDEN", "Only the person who recorded this entry, or a progress approver, can change it", {
    entryId: entry.id,
  });
};

// ─── create ────────────────────────────────────────────────────────────────

const requestIdFor = (entry, index, batchId, count) => {
  const own = trimOrNull(entry.clientRequestId);
  if (own) return own;
  if (!batchId) return null;
  return count === 1 ? batchId : `${batchId}:${index}`;
};

const createEntriesWithClient = async ({
  tx,
  orgId,
  projectId,
  userId,
  userRole,
  entries,
  source,
  status,
  clientRequestId,
  dailyLogId,
  submissionId,
  internal = false,
  assignmentRule = true,
}) => {
  const project = await ensureProject({ orgId, projectId }, tx);
  const index = await uomService.loadUnitIndex(orgId, tx);
  const batchId = trimOrNull(clientRequestId);
  const defaultSource = normalizeSource(source);
  const defaultStatus = normalizeStatus(status);

  // Replays first: the same clientRequestId answers with the entry it made.
  const requestIds = entries.map((entry, i) => requestIdFor(entry, i, batchId, entries.length));
  const duplicates = requestIds.filter((id, i) => id && requestIds.indexOf(id) !== i);
  if (duplicates.length) {
    throw new HttpError(400, "QUANTITY_CLIENT_REQUEST_DUPLICATE", "Two entries in one request carry the same clientRequestId", { clientRequestIds: [...new Set(duplicates)] });
  }
  const wanted = requestIds.filter(Boolean);
  const replayed = wanted.length
    ? await tx.quantityProgressEntry.findMany({ where: { projectId, clientRequestId: { in: wanted } }, include: ENTRY_INCLUDE })
    : [];
  const replayById = new Map(replayed.map((row) => [row.clientRequestId, row]));

  const fresh = entries.map((entry, i) => ({ entry, i })).filter(({ i }) => !(requestIds[i] && replayById.has(requestIds[i])));
  const activityIds = [...new Set(fresh.map(({ entry }) => trimOrNull(entry.activityId)).filter(Boolean))];
  if (fresh.length && assignmentRule) {
    // The same rule as a progress submission: a site engineer records on the
    // activities assigned to them; a PM or planning engineer on any. The daily
    // log applies it when a row is recorded (daily-log.service), so its
    // minting passes assignmentRule: false — the rows were each admitted.
    await progressService.assertProgressSubmitAllowed({ projectId, activityIds, userId, userRole, tx });
  }

  const results = new Array(entries.length);
  const warnings = [];
  for (const row of replayed) {
    const i = requestIds.indexOf(row.clientRequestId);
    results[i] = { row, replayed: true };
  }
  const now = new Date();
  for (const { entry, i } of fresh) {
    const activityId = trimOrNull(entry.activityId);
    const boqItemId = trimOrNull(entry.boqItemId);
    if (!activityId) throw new HttpError(400, "VALIDATION_ERROR", `entries[${i}].activityId is required`);
    if (!boqItemId) throw new HttpError(400, "VALIDATION_ERROR", `entries[${i}].boqItemId is required`);
    await ensureActivity({ projectId, activityId }, tx);
    const item = await ensureBoqItem({ projectId, boqItemId }, tx);
    const quantity = quantityDecimal(entry.quantity, `entries[${i}].quantity`);
    if (quantity === null) throw new HttpError(400, "QUANTITY_INVALID", `entries[${i}].quantity is required`, { field: `entries[${i}].quantity` });
    if (quantity.isNegative()) {
      throw new HttpError(400, "QUANTITY_NEGATIVE", "A quantity entry is never negative; a correction is a rejection plus a new entry", { field: `entries[${i}].quantity` });
    }
    // The daily log's minting (`internal`) carries rows the section admitted
    // (it refuses zero itself); a row recorded before this rule still mints.
    if (!internal) assertPositiveQuantity(quantity, `entries[${i}].quantity`);
    // The direct route records against an item the activity is mapped to —
    // an approved, active allocation — exactly as the daily log's quantities
    // section does (DAILY_LOG_QUANTITY_NOT_ALLOCATED); a figure on an
    // unmapped pairing has no planned quantity to stand against and would
    // reach the approver as a bundle with nothing behind it. The daily log's
    // minting (`internal`) admitted its rows at recording time.
    if (!internal) await assertItemAllocated({ projectId, activityId, boqItemId }, tx);
    const unitCode = resolveEntryUnit({ unit: entry.unitCode ?? entry.unit, item, index });
    const date = parseEntryDate(entry.date, `entries[${i}].date`);
    const locationId = trimOrNull(entry.locationId);
    if (locationId) await ensureLocation({ projectId, locationId }, tx);
    const allocationId = trimOrNull(entry.allocationId);
    if (allocationId) await ensureAllocation({ projectId, activityId, boqItemId, allocationId }, tx);
    const entryStatus = entry.status !== undefined ? normalizeStatus(entry.status) : defaultStatus;
    const entrySource = entry.source !== undefined ? normalizeSource(entry.source, defaultSource) : defaultSource;

    // PROGRESS SOURCE is the server's to state: the record an entry came
    // through (its submission, daily log and daily-log row) and who recorded
    // it are taken from an entry only when this service's own callers say so
    // (`internal`, the daily log's minting) — never from a client's body,
    // which could otherwise attach an entry to a pending submission and have
    // it approved with that bundle, or claim a daily log it never came from.
    const links = internal
      ? {
          submissionId: trimOrNull(entry.submissionId) || trimOrNull(submissionId) || null,
          dailyLogId: trimOrNull(entry.dailyLogId) || trimOrNull(dailyLogId) || null,
          dailyLogQuantityId: trimOrNull(entry.dailyLogQuantityId) || null,
          createdBy: trimOrNull(entry.createdBy) || userId || null,
        }
      : { submissionId: trimOrNull(submissionId) || null, dailyLogId: trimOrNull(dailyLogId) || null, dailyLogQuantityId: null, createdBy: userId || null };

    const row = await tx.quantityProgressEntry.create({
      data: {
        orgId,
        projectId,
        activityId,
        boqItemId,
        allocationId,
        locationId,
        unitCode,
        quantity,
        date,
        source: entrySource,
        ...links,
        status: entryStatus,
        clientRequestId: requestIds[i],
        note: trimOrNull(entry.note),
      },
      include: ENTRY_INCLUDE,
    });
    await auditService.recordEvent({
      tx,
      orgId,
      projectId,
      entityType: ENTITY_TYPE,
      entityId: row.id,
      action: auditService.ACTIONS.CREATED,
      actorId: userId,
      occurredAt: now,
      newStatus: row.status,
      newSummary: auditSummary(row),
      summary: {
        transition: row.status === "draft" ? "quantity_entry.create_draft" : "quantity_entry.submit",
        ...auditSummary(row, { dailyLogId: row.dailyLogId, submissionId: row.submissionId, clientRequestId: row.clientRequestId }),
      },
    });
    for (const warning of await allocationWarnings({ projectId, activityId, boqItemId, quantity }, tx)) {
      warnings.push({ ...warning, entryId: row.id });
    }
    results[i] = { row, replayed: false };
  }

  return {
    projectId: project.id,
    entries: results.map(({ row, replayed: wasReplayed }) => ({ ...serializeEntry(row), replayed: wasReplayed })),
    created: results.filter((result) => !result.replayed).length,
    replayed: results.filter((result) => result.replayed).length,
    warnings,
  };
};

/**
 * Records entries. `entries` is one or more { activityId, boqItemId, quantity,
 * date, unit?/unitCode?, allocationId?, locationId?, note?, status?,
 * clientRequestId? }; `status` (draft, the default, or submitted), `source`
 * (manual, import; daily_log and submission are the callers' own) and
 * `clientRequestId` apply to every entry that does not say its own (a batch
 * id is suffixed ":<index>" when there are several). An entry whose
 * clientRequestId was seen before on this project is answered with the
 * entry it made, unchanged — the (projectId, clientRequestId) unique index
 * decides, so two requests racing make one row: the loser's unique violation
 * is answered by running once more, which finds the winner's row.
 */
const createEntries = async ({ orgId, projectId, userId, userRole = null, entries, source = "manual", status = "draft", clientRequestId = null, dailyLogId = null, submissionId = null, tx = null, internal = false, assignmentRule = true }) => {
  if (!Array.isArray(entries) || !entries.length) {
    throw new HttpError(400, "VALIDATION_ERROR", "entries must be a non-empty array");
  }
  const params = { orgId, projectId, userId, userRole, entries, source, status, clientRequestId, dailyLogId, submissionId, internal, assignmentRule };
  if (tx) return createEntriesWithClient({ ...params, tx });
  try {
    return await prisma.$transaction((client) => createEntriesWithClient({ ...params, tx: client }));
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    return prisma.$transaction((client) => createEntriesWithClient({ ...params, tx: client }));
  }
};

// ─── list / get ────────────────────────────────────────────────────────────

const listEntries = async ({ orgId, projectId, filters = {} }) => {
  await ensureProject({ orgId, projectId });
  const where = { projectId, orgId };
  if (filters.activityId) where.activityId = filters.activityId;
  if (filters.boqItemId) where.boqItemId = filters.boqItemId;
  if (filters.status) where.status = normalizeStatus(filters.status, ENTRY_STATUSES);
  if (filters.source) where.source = normalizeSource(filters.source);
  if (filters.submissionId) where.submissionId = filters.submissionId;
  if (filters.dailyLogId) where.dailyLogId = filters.dailyLogId;
  if (filters.locationId) where.locationId = filters.locationId;
  if (filters.from || filters.to) {
    where.date = {};
    if (filters.from) where.date.gte = parseEntryDate(filters.from, "from");
    if (filters.to) where.date.lte = parseEntryDate(filters.to, "to");
  }
  const rows = await prisma.quantityProgressEntry.findMany({
    where,
    include: ENTRY_INCLUDE,
    orderBy: [{ date: "desc" }, { createdAt: "desc" }],
  });
  return rows.map(serializeEntry);
};

const findEntry = async ({ orgId, projectId, entryId }, tx = prisma) => {
  const row = await tx.quantityProgressEntry.findFirst({ where: { id: entryId, projectId, orgId }, include: ENTRY_INCLUDE });
  if (!row) throw new HttpError(404, "QUANTITY_ENTRY_NOT_FOUND", "Quantity entry not found");
  return row;
};

const getEntry = async ({ orgId, projectId, entryId }) => {
  await ensureProject({ orgId, projectId });
  return serializeEntry(await findEntry({ orgId, projectId, entryId }));
};

// ─── patch / delete / submit ───────────────────────────────────────────────

/**
 * Changes a pending entry's quantity, unit, date, location, allocation or
 * note. The activity and the item are what the entry IS: to move a quantity
 * to another item or activity, remove the entry and record another.
 */
const updateEntry = async ({ orgId, projectId, entryId, userId, canApprove = false, payload = {} }) =>
  prisma.$transaction(async (tx) => {
    await ensureProject({ orgId, projectId }, tx);
    const entry = await findEntry({ orgId, projectId, entryId }, tx);
    assertMayManage({ entry, userId, canApprove });
    assertEditable(entry);
    if (payload.activityId !== undefined && trimOrNull(payload.activityId) !== entry.activityId) {
      throw new HttpError(400, "QUANTITY_ENTRY_IMMUTABLE_FIELD", "An entry's activity is not changed; remove the entry and record another", { field: "activityId" });
    }
    if (payload.boqItemId !== undefined && trimOrNull(payload.boqItemId) !== entry.boqItemId) {
      throw new HttpError(400, "QUANTITY_ENTRY_IMMUTABLE_FIELD", "An entry's BOQ item is not changed; remove the entry and record another", { field: "boqItemId" });
    }
    if (payload.status !== undefined) {
      throw new HttpError(400, "QUANTITY_ENTRY_IMMUTABLE_FIELD", "An entry's status moves through submit, approve and reject, not through an edit", { field: "status" });
    }

    const data = {};
    if (payload.quantity !== undefined) {
      const quantity = quantityDecimal(payload.quantity);
      if (quantity === null) throw new HttpError(400, "QUANTITY_INVALID", "quantity must be a number", { field: "quantity" });
      if (quantity.isNegative()) throw new HttpError(400, "QUANTITY_NEGATIVE", "A quantity entry is never negative; a correction is a rejection plus a new entry", { field: "quantity" });
      assertPositiveQuantity(quantity);
      data.quantity = quantity;
    }
    if (payload.unitCode !== undefined || payload.unit !== undefined) {
      const item = await ensureBoqItem({ projectId, boqItemId: entry.boqItemId }, tx);
      const index = await uomService.loadUnitIndex(orgId, tx);
      data.unitCode = resolveEntryUnit({ unit: payload.unitCode ?? payload.unit, item, index });
    }
    if (payload.date !== undefined) data.date = parseEntryDate(payload.date);
    if (payload.note !== undefined) data.note = trimOrNull(payload.note);
    if (payload.locationId !== undefined) {
      const locationId = trimOrNull(payload.locationId);
      if (locationId) await ensureLocation({ projectId, locationId }, tx);
      data.locationId = locationId;
    }
    if (payload.allocationId !== undefined) {
      const allocationId = trimOrNull(payload.allocationId);
      if (allocationId) await ensureAllocation({ projectId, activityId: entry.activityId, boqItemId: entry.boqItemId, allocationId }, tx);
      data.allocationId = allocationId;
    }
    if (!Object.keys(data).length) {
      return { entry: serializeEntry(entry), warnings: [] };
    }

    const row = await tx.quantityProgressEntry.update({ where: { id: entry.id }, data, include: ENTRY_INCLUDE });
    await auditService.recordEvent({
      tx,
      orgId,
      projectId,
      entityType: ENTITY_TYPE,
      entityId: row.id,
      action: auditService.ACTIONS.UPDATED,
      actorId: userId,
      oldStatus: entry.status,
      newStatus: row.status,
      oldSummary: auditSummary(entry),
      newSummary: auditSummary(row),
      summary: { transition: "quantity_entry.update", fields: Object.keys(data), ...auditSummary(row) },
    });
    const warnings = data.quantity !== undefined
      ? (await allocationWarnings({ projectId, activityId: row.activityId, boqItemId: row.boqItemId, quantity: row.quantity, excludeEntryId: row.id }, tx)).map((warning) => ({ ...warning, entryId: row.id }))
      : [];
    return { entry: serializeEntry(row), warnings };
  });

/** Removes a pending entry. It was never official, so nothing it fed changes. */
const deleteEntry = async ({ orgId, projectId, entryId, userId, canApprove = false }) =>
  prisma.$transaction(async (tx) => {
    await ensureProject({ orgId, projectId }, tx);
    const entry = await findEntry({ orgId, projectId, entryId }, tx);
    assertMayManage({ entry, userId, canApprove });
    assertEditable(entry);
    await tx.quantityProgressEntry.delete({ where: { id: entry.id } });
    await auditService.recordEvent({
      tx,
      orgId,
      projectId,
      entityType: ENTITY_TYPE,
      entityId: entry.id,
      action: auditService.ACTIONS.DELETED,
      actorId: userId,
      oldStatus: entry.status,
      oldSummary: auditSummary(entry),
      summary: { transition: "quantity_entry.delete", ...auditSummary(entry) },
    });
    return { deleted: true, id: entry.id };
  });

/**
 * draft → submitted: the entry is put forward for the approvers. The
 * assignment rule applies to the person submitting. Submitting a submitted
 * entry again is a no-op; an approved or rejected one is history.
 */
const submitEntry = async ({ orgId, projectId, entryId, userId, userRole = null, canApprove = false }) =>
  prisma.$transaction(async (tx) => {
    await ensureProject({ orgId, projectId }, tx);
    const entry = await findEntry({ orgId, projectId, entryId }, tx);
    if (entry.status === "submitted") return { entry: serializeEntry(entry), submitted: false };
    if (entry.status !== "draft") {
      throw new HttpError(409, "QUANTITY_ENTRY_NOT_SUBMITTABLE", `A ${entry.status} quantity entry is not submitted again`, { entryId: entry.id, status: entry.status });
    }
    assertMayManage({ entry, userId, canApprove });
    await progressService.assertProgressSubmitAllowed({ projectId, activityIds: [entry.activityId], userId, userRole, tx });
    const row = await tx.quantityProgressEntry.update({ where: { id: entry.id }, data: { status: "submitted" }, include: ENTRY_INCLUDE });
    await auditService.recordEvent({
      tx,
      orgId,
      projectId,
      entityType: ENTITY_TYPE,
      entityId: row.id,
      action: auditService.ACTIONS.STATUS_CHANGED,
      actorId: userId,
      oldStatus: entry.status,
      newStatus: row.status,
      oldSummary: auditSummary(entry),
      newSummary: auditSummary(row),
      summary: { transition: "quantity_entry.submit", ...auditSummary(row) },
    });
    return { entry: serializeEntry(row), submitted: true };
  });

// ─── the read helpers the other waves build on ─────────────────────────────

const approvedEntriesWhere = ({ projectId, orgId, cutoff }) => ({
  projectId,
  orgId,
  status: "approved",
  ...(cutoff ? { approvedAt: { lte: cutoff } } : {}),
});

/**
 * Installed quantity per activity: Map activityId → { installed: [{ boqItemId,
 * unitCode, quantity }], asOf }. Σ approved entries (approvedAt ≤ cutoff when
 * one is given) per BOQ item — one line per item in that item's unit, never
 * summed across items or units. An activity with no approved entry is not
 * in the map.
 */
const installedByActivity = async ({ orgId, projectId, activityIds = null, cutoffDate = null, tx = prisma }) => {
  const project = await ensureProject({ orgId, projectId }, tx);
  const cutoff = await resolveCutoffInstant({ cutoffDate, project, tx });
  const rows = await tx.quantityProgressEntry.findMany({
    where: { ...approvedEntriesWhere({ projectId, orgId, cutoff }), ...(activityIds ? { activityId: { in: activityIds } } : {}) },
    select: { activityId: true, boqItemId: true, unitCode: true, quantity: true, approvedAt: true },
  });
  const byActivity = new Map();
  for (const row of rows) {
    const activity = byActivity.get(row.activityId) || { lines: new Map(), lastApprovedAt: null };
    const key = `${row.boqItemId}\u0000${row.unitCode}`;
    const line = activity.lines.get(key) || { boqItemId: row.boqItemId, unitCode: row.unitCode, quantity: new Decimal(0), entries: 0 };
    line.quantity = line.quantity.plus(quantityDecimal(row.quantity));
    line.entries += 1;
    activity.lines.set(key, line);
    if (row.approvedAt && (!activity.lastApprovedAt || row.approvedAt > activity.lastApprovedAt)) activity.lastApprovedAt = row.approvedAt;
    byActivity.set(row.activityId, activity);
  }
  const asOf = toIso(cutoff) || toIso(new Date());
  const result = new Map();
  for (const [activityId, activity] of byActivity) {
    result.set(activityId, {
      installed: [...activity.lines.values()].map((line) => ({ boqItemId: line.boqItemId, unitCode: line.unitCode, quantity: quantityNumber(line.quantity), entries: line.entries })),
      asOf,
      lastApprovedAt: toIso(activity.lastApprovedAt),
    });
  }
  return result;
};

/**
 * Installed quantity per BOQ item: Map boqItemId → { quantity, unitCode,
 * entries, lastApprovedAt } — Σ approved entries (approvedAt ≤ cutoff when
 * one is given) over every activity, in the item's unit. An item whose
 * approved entries somehow carry two units is reported in neither: it
 * answers { quantity: null, unitCode: null, units: [...] } so nothing is
 * summed across units.
 */
const installedByBoqItem = async ({ orgId, projectId, boqItemIds = null, cutoffDate = null, tx = prisma }) => {
  const project = await ensureProject({ orgId, projectId }, tx);
  const cutoff = await resolveCutoffInstant({ cutoffDate, project, tx });
  const rows = await tx.quantityProgressEntry.findMany({
    where: { ...approvedEntriesWhere({ projectId, orgId, cutoff }), ...(boqItemIds ? { boqItemId: { in: boqItemIds } } : {}) },
    select: { boqItemId: true, unitCode: true, quantity: true, approvedAt: true },
  });
  const byItem = new Map();
  for (const row of rows) {
    const item = byItem.get(row.boqItemId) || { byUnit: new Map(), entries: 0, lastApprovedAt: null };
    item.byUnit.set(row.unitCode, (item.byUnit.get(row.unitCode) || new Decimal(0)).plus(quantityDecimal(row.quantity)));
    item.entries += 1;
    if (row.approvedAt && (!item.lastApprovedAt || row.approvedAt > item.lastApprovedAt)) item.lastApprovedAt = row.approvedAt;
    byItem.set(row.boqItemId, item);
  }
  const asOf = toIso(cutoff) || toIso(new Date());
  const result = new Map();
  for (const [boqItemId, item] of byItem) {
    const units = [...item.byUnit.keys()];
    result.set(
      boqItemId,
      units.length === 1
        ? { quantity: quantityNumber(item.byUnit.get(units[0])), unitCode: units[0], entries: item.entries, lastApprovedAt: toIso(item.lastApprovedAt), asOf }
        : { quantity: null, unitCode: null, units, entries: item.entries, lastApprovedAt: toIso(item.lastApprovedAt), asOf, notAvailable: { reason: "Approved entries are in more than one unit; nothing is summed across units" } },
    );
  }
  return result;
};

/**
 * The planned quantity a quantity-method activity's percentage is worked
 * against: the figure typed on the method configuration when there is one
 * (basis method_config), else Σ approved, active allocation quantity of the
 * activity (basis approved_allocations — only when every allocation is in
 * one unit, since nothing is summed across units), else none. A client's
 * quantityPlanned never comes into it.
 */
const PLANNED_ALLOCATION_SELECT = Object.freeze({ id: true, activityId: true, boqItemId: true, quantity: true, unitCode: true, boqItem: { select: { unit: true, unitCode: true } } });

const plannedQuantityFor = async ({ orgId, projectId, activityId, tx = prisma }) => {
  await ensureProject({ orgId, projectId }, tx);
  const config = await tx.activityProgressMethod.findFirst({ where: { projectId, activityId } });
  const typed = quantityDecimal(config?.plannedQuantity);
  if (typed && typed.greaterThan(0)) return plannedFrom(config, []);
  const allocations = await tx.activityBoqAllocation.findMany({
    where: { projectId, activityId, status: ALLOCATION_COUNTED_STATUS, isActive: true },
    select: PLANNED_ALLOCATION_SELECT,
  });
  return plannedFrom(config, allocations);
};

/** The rule of plannedQuantityFor on rows already read (one activity's method row and approved, active allocations). */
const plannedFrom = (config, allocations) => {
  const typed = quantityDecimal(config?.plannedQuantity);
  if (typed && typed.greaterThan(0)) {
    return { planned: quantityNumber(typed), unitCode: trimOrNull(config.quantityUnit), basis: "method_config", method: config.method };
  }
  if (!allocations.length) {
    return { planned: null, unitCode: null, basis: "none", method: config?.method || null, reason: "No typed planned quantity and no approved allocation" };
  }
  const units = [...new Set(allocations.map((row) => trimOrNull(row.unitCode) || trimOrNull(row.boqItem?.unitCode) || trimOrNull(row.boqItem?.unit) || null))];
  if (units.length !== 1) {
    return {
      planned: null,
      unitCode: null,
      basis: "none",
      method: config?.method || null,
      units,
      reason: "The approved allocations are in more than one unit; type the planned quantity on the method configuration",
    };
  }
  return {
    planned: quantityNumber(sumQuantities(allocations.map((row) => row.quantity))),
    unitCode: units[0],
    basis: "approved_allocations",
    method: config?.method || null,
    allocationIds: allocations.map((row) => row.id),
  };
};

// ─── what the activity register carries (PC-6 integration) ────────────────

/**
 * The quantity figures of the activities named, for the activity register
 * and the Progress screen (GET /activities, GET /activities/{id}): Map
 * activityId → {
 *   installedQuantity: { installed: [{ boqItemId, code, description, unitCode,
 *     quantity, entries }], asOf, lastApprovedAt, basis } — Σ approved entries
 *     per BOQ item, in the item's unit, never summed across items or units;
 *   plannedQuantity: { planned, unitCode, basis, reason? } — plannedQuantityFor;
 *   pendingQuantityEntries: the submitted entries no open submission holds —
 *     what a planner can still put forward (bundle) for approval.
 * }
 * A fixed number of queries for any number of activities. Nothing here is
 * official and nothing is written; the route withholds all three from a
 * member who may not read the BOQ (utils/boq-figures withheldActivity).
 */
const INSTALLED_BASIS = "Σ approved quantity progress entries per BOQ item (only approval counts)";
const activityQuantityFigures = async ({ orgId, projectId, activityIds, tx = prisma }) => {
  const result = new Map();
  const ids = [...new Set((activityIds || []).filter(Boolean))];
  if (!ids.length) return result;
  const [installed, configs, allocations, pending] = await Promise.all([
    installedByActivity({ orgId, projectId, activityIds: ids, tx }),
    tx.activityProgressMethod.findMany({ where: { projectId, activityId: { in: ids } } }),
    tx.activityBoqAllocation.findMany({ where: { projectId, activityId: { in: ids }, status: ALLOCATION_COUNTED_STATUS, isActive: true }, select: PLANNED_ALLOCATION_SELECT }),
    tx.quantityProgressEntry.findMany({ where: { projectId, orgId, activityId: { in: ids }, status: "submitted" }, include: ENTRY_INCLUDE, orderBy: [{ date: "asc" }, { createdAt: "asc" }] }),
  ]);
  const itemIds = [...new Set([...installed.values()].flatMap((entry) => entry.installed.map((line) => line.boqItemId)))];
  const items = itemIds.length
    ? await tx.boqItem.findMany({ where: { id: { in: itemIds }, projectId }, select: { id: true, code: true, ref: true, description: true } })
    : [];
  const itemById = new Map(items.map((item) => [item.id, item]));
  const configByActivity = new Map(configs.map((row) => [row.activityId, row]));
  for (const activityId of ids) {
    const figure = installed.get(activityId) || null;
    result.set(activityId, {
      installedQuantity: {
        installed: (figure?.installed || []).map((line) => ({
          boqItemId: line.boqItemId,
          code: itemById.get(line.boqItemId)?.code || itemById.get(line.boqItemId)?.ref || null,
          description: itemById.get(line.boqItemId)?.description ?? null,
          unitCode: line.unitCode,
          quantity: line.quantity,
          entries: line.entries,
        })),
        asOf: figure?.asOf || null,
        lastApprovedAt: figure?.lastApprovedAt || null,
        basis: INSTALLED_BASIS,
      },
      plannedQuantity: plannedFrom(configByActivity.get(activityId) || null, allocations.filter((row) => row.activityId === activityId)),
      pendingQuantityEntries: pending.filter((entry) => entry.activityId === activityId && !isOpenlyBundled(entry)).map(serializeEntry),
    });
  }
  return result;
};

// ─── the activity's allocated items (the site's picker) ────────────────────

/**
 * The BOQ items an activity has an approved, active allocation of — what a
 * person on site records installed quantity against. One line per item, in
 * the item's unit, with the allocation it was picked from (the single
 * approved one; null and `allocationIds` when there are several) and Σ the
 * approved allocation quantity. The route withholds the code, the
 * allocation and the quantity from a member who may not read the BOQ
 * (utils/boq-figures.withheldAllocatedItems): such a member is given the id,
 * the description and the unit — the least that lets them pick an item and
 * name the unit — and nothing of the bill's figures.
 */
const allocatedItemsFor = async ({ orgId, projectId, activityId, tx = prisma }) => {
  await ensureProject({ orgId, projectId }, tx);
  const activity = await ensureActivity({ projectId, activityId }, tx);
  const index = await uomService.loadUnitIndex(orgId, tx);
  const allocations = await tx.activityBoqAllocation.findMany({
    where: { projectId, activityId, status: ALLOCATION_COUNTED_STATUS, isActive: true, boqItem: { isActive: true } },
    select: { id: true, boqItemId: true, quantity: true, boqItem: { select: { id: true, code: true, ref: true, description: true, unit: true, unitCode: true, sortOrder: true } } },
    orderBy: { createdAt: "asc" },
  });
  const byItem = new Map();
  for (const row of allocations) {
    const line = byItem.get(row.boqItemId) || { item: row.boqItem, allocationIds: [], quantity: new Decimal(0) };
    line.allocationIds.push(row.id);
    line.quantity = line.quantity.plus(quantityDecimal(row.quantity) ?? new Decimal(0));
    byItem.set(row.boqItemId, line);
  }
  const items = [...byItem.values()].map(({ item, allocationIds, quantity }) => {
    const unit = itemUnit(item, index);
    return {
      id: item.id,
      code: item.code || item.ref || null,
      description: item.description,
      unit: item.unit,
      unitCode: unit.code || unit.typed || null,
      allocationId: allocationIds.length === 1 ? allocationIds[0] : null,
      allocationIds,
      allocatedQuantity: quantityNumber(quantity),
    };
  });
  return { activityId: activity.id, activity: { id: activity.id, name: activity.name, code: activity.activityCode || activity.p6ActivityId || activity.wbsCode || null }, items };
};

// ─── the daily log's quantities section (§4) ──────────────────────────────
//
// A row of the daily log's quantities section (DailyLogQuantity) is the site
// record; the QuantityProgressEntry it mints when the log is submitted is the
// pending progress figure, and only the progress approval writer makes that
// official. These helpers keep the two in step and are called by
// daily-log.service inside its own transactions.

/**
 * What a quantities row may name: an item the activity has an approved
 * allocation of (else 400 DAILY_LOG_QUANTITY_NOT_ALLOCATED), the allocation
 * when one is given (one of those), and a unit that is the item's or an
 * alias. Returns the resolved allocationId (the single approved one when
 * none was named) and the unit code the row is stored under.
 */
const resolveDailyLogQuantity = async ({ tx = prisma, orgId, projectId, activityId, boqItemId, allocationId = null, unit = null }) => {
  const item = await ensureBoqItem({ projectId, boqItemId }, tx);
  const { allocations } = await allocationQuantityFor({ projectId, activityId, boqItemId }, tx);
  if (!allocations.length) {
    throw new HttpError(400, "DAILY_LOG_QUANTITY_NOT_ALLOCATED", "The activity has no approved allocation of this BOQ item; pick one of the activity's allocated items", {
      activityId,
      boqItemId,
    });
  }
  const wanted = trimOrNull(allocationId);
  if (wanted && !allocations.some((row) => row.id === wanted)) {
    throw new HttpError(400, "QUANTITY_ALLOCATION_MISMATCH", "The allocation named does not map this BOQ item to this activity", { allocationId: wanted, activityId, boqItemId });
  }
  const index = await uomService.loadUnitIndex(orgId, tx);
  return {
    item,
    allocationId: wanted || (allocations.length === 1 ? allocations[0].id : null),
    unitCode: resolveEntryUnit({ unit, item, index }),
  };
};

const entriesForDailyLogRows = async ({ tx = prisma, rowIds }) =>
  rowIds.length
    ? tx.quantityProgressEntry.findMany({ where: { dailyLogQuantityId: { in: rowIds } }, include: ENTRY_INCLUDE, orderBy: { createdAt: "asc" } })
    : [];

const isOpenlyBundled = (entry) => Boolean(entry.submissionId && entry.submission && entry.submission.status !== "rejected");

/**
 * Whether the row may be changed or removed, by the state of its entry: an
 * approved or rejected entry locks the row (409 DAILY_LOG_QUANTITY_LOCKED —
 * the correction is a new row); an entry bundled into a pending submission
 * holds it (409 QUANTITY_ENTRY_BUNDLED). Returns the free pending entry, or
 * null when the row has none yet.
 */
const dailyLogRowEntryGate = async ({ tx = prisma, rowId }) => {
  const entries = await entriesForDailyLogRows({ tx, rowIds: [rowId] });
  const settled = entries.find((entry) => !EDITABLE_STATUSES.includes(entry.status));
  if (settled) {
    throw new HttpError(409, "DAILY_LOG_QUANTITY_LOCKED", `This quantity is ${settled.status} progress; record a correction as a new row`, {
      dailyLogQuantityId: rowId,
      entryId: settled.id,
      entryStatus: settled.status,
    });
  }
  const bundled = entries.find(isOpenlyBundled);
  if (bundled) {
    throw new HttpError(409, "QUANTITY_ENTRY_BUNDLED", "This quantity is part of a progress submission awaiting approval; reject the submission first", {
      dailyLogQuantityId: rowId,
      entryId: bundled.id,
      submissionId: bundled.submissionId,
      submissionStatus: bundled.submission.status,
    });
  }
  return entries[0] || null;
};

const rowEntryData = (row, log) => ({
  allocationId: row.allocationId || null,
  locationId: row.locationId || null,
  unitCode: row.unitCode,
  quantity: quantityDecimal(row.quantity),
  date: parseEntryDate(dateKey(log.date)),
  note: trimOrNull(row.notes),
});

/** A free pending entry is made to match its row again (an edit before approval). */
const syncDailyLogRowEntry = async ({ tx = prisma, orgId, projectId, row, log, entry, actorId }) => {
  if (!entry) return null;
  const data = rowEntryData(row, log);
  const updated = await tx.quantityProgressEntry.update({ where: { id: entry.id }, data, include: ENTRY_INCLUDE });
  await auditService.recordEvent({
    tx,
    orgId,
    projectId,
    entityType: ENTITY_TYPE,
    entityId: updated.id,
    action: auditService.ACTIONS.UPDATED,
    actorId,
    oldStatus: entry.status,
    newStatus: updated.status,
    oldSummary: auditSummary(entry),
    newSummary: auditSummary(updated),
    summary: { transition: "quantity_entry.daily_log_sync", dailyLogId: log.id, dailyLogQuantityId: row.id, ...auditSummary(updated) },
  });
  return updated;
};

/**
 * A free pending entry goes with its row (never a pending ghost); an entry
 * bundled into a pending submission holds the row (409 QUANTITY_ENTRY_BUNDLED);
 * an approved or rejected one stays as the trail, its link to the row nulled
 * by the database (SET NULL) when the row goes.
 */
const deleteDailyLogRowEntry = async ({ tx = prisma, orgId, projectId, row, actorId, transition = "quantity_entry.daily_log_row_deleted", reason = null, entries = null }) => {
  const found = entries || (await entriesForDailyLogRows({ tx, rowIds: [row.id] }));
  const bundled = found.find((candidate) => EDITABLE_STATUSES.includes(candidate.status) && isOpenlyBundled(candidate));
  if (bundled) {
    throw new HttpError(409, "QUANTITY_ENTRY_BUNDLED", "This quantity is part of a progress submission awaiting approval; reject the submission first", {
      dailyLogQuantityId: row.id,
      entryId: bundled.id,
      submissionId: bundled.submissionId,
      submissionStatus: bundled.submission.status,
    });
  }
  const entry = found.find((candidate) => EDITABLE_STATUSES.includes(candidate.status));
  if (!entry) return null;
  await tx.quantityProgressEntry.delete({ where: { id: entry.id } });
  await auditService.recordEvent({
    tx,
    orgId,
    projectId,
    entityType: ENTITY_TYPE,
    entityId: entry.id,
    action: auditService.ACTIONS.DELETED,
    actorId,
    oldStatus: entry.status,
    reason: reason || undefined,
    oldSummary: auditSummary(entry),
    summary: { transition, dailyLogQuantityId: row.id, ...auditSummary(entry) },
  });
  return entry;
};

/**
 * The site team's per-row review rejects a row (§4.1: a row rejected by the
 * site team does not count). Its free pending entry goes with that decision
 * — deleted, never left as a free pending figure a date bundle would pick
 * up and the writer make official. An entry already approved progress locks
 * the row (409 DAILY_LOG_QUANTITY_LOCKED — the site team cannot reject
 * what the approver made official; the correction is a new row); one
 * bundled into a pending submission holds it (409 QUANTITY_ENTRY_BUNDLED);
 * one rejected by the approver stays as the trail.
 */
const rejectDailyLogRowEntry = async ({ tx = prisma, orgId, projectId, row, actorId, reason = null }) => {
  const entries = await entriesForDailyLogRows({ tx, rowIds: [row.id] });
  const official = entries.find((entry) => entry.status === "approved");
  if (official) {
    throw new HttpError(409, "DAILY_LOG_QUANTITY_LOCKED", "This quantity is approved progress; record a correction as a new row", {
      dailyLogQuantityId: row.id,
      entryId: official.id,
      entryStatus: official.status,
    });
  }
  return deleteDailyLogRowEntry({ tx, orgId, projectId, row, actorId, transition: "quantity_entry.daily_log_row_rejected", reason, entries });
};

/**
 * Submitting the daily log: one submitted entry (source daily_log) per
 * quantities row, dated the log's day, recorded by the row's author and
 * linked by dailyLogId + dailyLogQuantityId. A row that already has an entry
 * keeps it: a free pending one is synced to the row, a bundled, approved or
 * rejected one is left alone. A row that no longer counts (`retiredRows`:
 * draft, or rejected by the site team) has its free pending entry deleted —
 * a figure the site withdrew is never left pending for a date bundle. The
 * same call closes the day at approval and mints the rows a submitted log
 * takes afterwards, so no counted row of a closed day is left unminted.
 * Nothing here is official: the entries wait for the progress approval
 * writer like every other entry.
 */
const mintDailyLogEntries = async ({ tx = prisma, orgId, projectId, log, rows, actor, retiredRows = [] }) => {
  const result = { minted: [], synced: [], kept: [], retired: [] };
  for (const row of retiredRows) {
    const entries = await entriesForDailyLogRows({ tx, rowIds: [row.id] });
    const free = entries.find((entry) => EDITABLE_STATUSES.includes(entry.status) && !isOpenlyBundled(entry));
    if (!free) continue;
    await deleteDailyLogRowEntry({ tx, orgId, projectId, row, actorId: actor?.id || null, transition: "quantity_entry.daily_log_row_retired", entries: [free] });
    result.retired.push(free.id);
  }
  if (!rows.length) return result;
  const existing = await entriesForDailyLogRows({ tx, rowIds: rows.map((row) => row.id) });
  const byRow = new Map();
  for (const entry of existing) {
    if (!byRow.has(entry.dailyLogQuantityId)) byRow.set(entry.dailyLogQuantityId, []);
    byRow.get(entry.dailyLogQuantityId).push(entry);
  }
  const fresh = [];
  for (const row of rows) {
    const entries = byRow.get(row.id) || [];
    const free = entries.find((entry) => EDITABLE_STATUSES.includes(entry.status) && !isOpenlyBundled(entry));
    if (free) {
      const synced = await syncDailyLogRowEntry({ tx, orgId, projectId, row, log, entry: free, actorId: actor?.id || null });
      if (synced.status === "draft") {
        await tx.quantityProgressEntry.update({ where: { id: synced.id }, data: { status: "submitted" } });
      }
      result.synced.push(synced.id);
    } else if (entries.length) {
      result.kept.push(...entries.map((entry) => entry.id));
    } else {
      fresh.push(row);
    }
  }
  if (fresh.length) {
    const created = await createEntriesWithClient({
      tx,
      orgId,
      projectId,
      userId: actor?.id || null,
      userRole: actor?.role || null,
      entries: fresh.map((row) => ({
        activityId: row.activityId,
        boqItemId: row.boqItemId,
        ...rowEntryData(row, log),
        date: dateKey(log.date),
        dailyLogId: log.id,
        dailyLogQuantityId: row.id,
        createdBy: row.createdBy || null,
        clientRequestId: `daily_log:${row.id}`,
      })),
      source: "daily_log",
      status: "submitted",
      clientRequestId: null,
      dailyLogId: log.id,
      submissionId: null,
      internal: true,
      assignmentRule: false,
    });
    result.minted.push(...created.entries.map((entry) => entry.id));
    result.warnings = created.warnings;
  }
  return result;
};

module.exports = {
  ENTITY_TYPE,
  ENTRY_SOURCES,
  allocatedItemsFor,
  resolveDailyLogQuantity,
  entriesForDailyLogRows,
  dailyLogRowEntryGate,
  syncDailyLogRowEntry,
  deleteDailyLogRowEntry,
  rejectDailyLogRowEntry,
  mintDailyLogEntries,
  ENTRY_STATUSES,
  CREATABLE_STATUSES,
  QUANTITY_SCALE,
  quantityDecimal,
  assertPositiveQuantity,
  ZERO_QUANTITY_MESSAGE,
  quantityNumber,
  sumQuantities,
  parseEntryDate,
  resolveEntryUnit,
  serializeEntry,
  allocationWarnings,
  approvedInstalledFor,
  allocationQuantityFor,
  createEntries,
  listEntries,
  getEntry,
  updateEntry,
  deleteEntry,
  submitEntry,
  installedByActivity,
  installedByBoqItem,
  plannedQuantityFor,
  plannedFrom,
  activityQuantityFigures,
  ENTRY_INCLUDE,
};
