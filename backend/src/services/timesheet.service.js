const ExcelJS = require("exceljs");
const { brandWorkbook } = require("../utils/export-branding");
const { prisma } = require("../config/db");
const { HttpError } = require("../utils/http-error");
const { recordWorkspacePath } = require("../utils/record-links");
const auditService = require("./audit.service");
const costLedger = require("./cost-ledger.service");
const notificationService = require("./notification.service");
const { isPartyScopedAccess } = require("./company-party.service");
const { assertMembers } = require("./tenant-references.service");
const { MONEY_MAX, toMoneyDecimal } = require("../utils/money");

/**
 * Timesheets and crews (OCTA-FLD-TIME-037).
 *
 *  - Workers are company-level people (optionally platform users) with a
 *    trade, classification and hourly rate; crews are project groups of
 *    workers with a default cost code / activity.
 *  - A timesheet is one day for one crew (or an ad-hoc set of workers);
 *    entries are hours per worker per activity / cost code / location and
 *    time type (regular, overtime, double).
 *  - draft → submitted → approved | rejected → draft. Submission requires an
 *    activity on every entry (the activity-linked spine); approval snapshots
 *    each worker's rate and POSTS the labour cost to the activity's cost
 *    record and to the cost code's labour budget line; reopening reverses
 *    exactly what was posted.
 *  - Party users (contractors, subcontractors) see and edit their own
 *    company's workers, crews and timesheets.
 */

const STATUS = Object.freeze({ DRAFT: "draft", SUBMITTED: "submitted", APPROVED: "approved", REJECTED: "rejected" });
const TIME_TYPES = Object.freeze(["regular", "overtime", "double"]);
const MAX_HOURS_PER_DAY = 24;
const MAX_OVERTIME_MULTIPLIER = 5;
/**
 * The largest hourly rate (CERT-2): a rate is stored on the worker as a
 * Decimal(18,2), and an approved entry posts it as the labour's unit cost (a
 * Decimal(18,4) on the cost ledger) beside the entry's amount, a Decimal(18,2)
 * of up to a day's hours at the highest overtime multiplier. The largest whole
 * rate all of them hold. 1e20 failed at the write with a 500.
 */
const RATE_MAX = Math.floor((1e16 - 1) / (MAX_HOURS_PER_DAY * MAX_OVERTIME_MULTIPLIER));

const trimOrNull = (value) => {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text || null;
};
const toIso = (value) => (value ? new Date(value).toISOString() : null);
const toNumber = (value, fallback = 0) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
};
const round2 = (value) => Math.round(toNumber(value) * 100) / 100;
const money = (value) => (value === null || value === undefined ? null : round2(Number(value)));
const uniqueIds = (values) => [...new Set((values || []).filter(Boolean))];

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const toDateOnly = (value) => {
  if (value instanceof Date) return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
  const text = String(value || "").slice(0, 10);
  if (!DATE_RE.test(text)) throw new HttpError(400, "TIMESHEET_DATE_INVALID", "Date must be YYYY-MM-DD");
  const date = new Date(`${text}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) throw new HttpError(400, "TIMESHEET_DATE_INVALID", "Date must be YYYY-MM-DD");
  return date;
};
const dateKey = (value) => new Date(value).toISOString().slice(0, 10);
const addDays = (date, days) => new Date(date.getTime() + days * 86_400_000);

const multiplierFor = (timeType, worker) => (timeType === "overtime" ? Math.max(1, toNumber(worker?.overtimeMultiplier, 1.5)) : timeType === "double" ? 2 : 1);

// ─── Visibility ───────────────────────────────────────────────────────────

const companyIdsFor = (viewer) => uniqueIds((viewer?.projectAccess?.partyAccess || []).map((party) => party.companyId));
const partyFor = (viewer) => {
  const party = (viewer?.projectAccess?.partyAccess || [])[0];
  return party ? { partyId: party.projectPartyId || null, companyId: party.companyId || null } : null;
};
const scoped = (viewer) => Boolean(viewer && isPartyScopedAccess(viewer.projectAccess || {}));

/** Party users see their company's rows and their own. */
const visibilityWhere = (viewer) => {
  if (!scoped(viewer)) return null;
  const companyIds = companyIdsFor(viewer);
  return { OR: [...(companyIds.length ? [{ companyId: { in: companyIds } }] : []), ...(viewer.id ? [{ createdBy: viewer.id }] : [])] };
};
const assertVisible = (row, viewer) => {
  if (!scoped(viewer)) return;
  const companyIds = companyIdsFor(viewer);
  if ((row.companyId && companyIds.includes(row.companyId)) || (viewer.id && row.createdBy === viewer.id)) return;
  throw new HttpError(403, "FORBIDDEN", "You do not have access to this record");
};

// ─── Serialisers ──────────────────────────────────────────────────────────

const workerOut = (row) => ({
  id: row.id,
  companyId: row.companyId || null,
  companyName: row.company?.name || null,
  userId: row.userId || null,
  name: row.name,
  employeeNumber: row.employeeNumber || null,
  trade: row.trade || null,
  classification: row.classification || null,
  hourlyRate: money(row.hourlyRate),
  overtimeMultiplier: toNumber(row.overtimeMultiplier, 1.5),
  status: row.status,
  notes: row.notes || null,
  crews: Array.isArray(row.crewMembers) ? row.crewMembers.map((member) => ({ id: member.crew?.id || member.crewId, name: member.crew?.name || null })) : undefined,
  createdAt: toIso(row.createdAt),
  updatedAt: toIso(row.updatedAt),
});

const crewOut = (row) => ({
  id: row.id,
  projectId: row.projectId,
  name: row.name,
  companyId: row.companyId || null,
  companyName: row.company?.name || null,
  partyId: row.partyId || null,
  foremanUserId: row.foremanUserId || null,
  defaultCostCodeId: row.defaultCostCodeId || null,
  defaultActivityId: row.defaultActivityId || null,
  status: row.status,
  members: (row.members || []).map((member) => ({ id: member.id, workerId: member.workerId, role: member.role, sortOrder: member.sortOrder, worker: member.worker ? workerOut(member.worker) : null })),
  memberCount: row._count?.members ?? (row.members || []).length,
  createdAt: toIso(row.createdAt),
  updatedAt: toIso(row.updatedAt),
});

const entryOut = (row) => ({
  id: row.id,
  workerId: row.workerId,
  worker: row.worker ? { id: row.worker.id, name: row.worker.name, trade: row.worker.trade || null, companyName: row.worker.company?.name || null } : null,
  activityId: row.activityId || null,
  activity: row.activity ? { id: row.activity.id, name: row.activity.name, code: row.activity.activityCode || row.activity.wbsCode || null } : null,
  costCodeId: row.costCodeId || null,
  costCode: row.costCode ? { id: row.costCode.id, code: row.costCode.code, name: row.costCode.name } : null,
  budgetLineId: row.budgetLineId || null,
  locationId: row.locationId || null,
  location: row.location ? { id: row.location.id, name: row.location.name, code: row.location.code || null } : null,
  timeType: row.timeType,
  hours: toNumber(row.hours),
  startTime: row.startTime || null,
  endTime: row.endTime || null,
  rate: money(row.rate),
  amount: money(row.amount) || 0,
  notes: row.notes || null,
  sortOrder: row.sortOrder,
});

const timesheetOut = (row, { withEntries = false } = {}) => ({
  id: row.id,
  projectId: row.projectId,
  date: dateKey(row.date),
  crewId: row.crewId || null,
  crew: row.crew ? { id: row.crew.id, name: row.crew.name } : null,
  partyId: row.partyId || null,
  companyId: row.companyId || null,
  status: row.status,
  notes: row.notes || null,
  regularHours: toNumber(row.regularHours),
  overtimeHours: toNumber(row.overtimeHours),
  totalHours: round2(toNumber(row.regularHours) + toNumber(row.overtimeHours)),
  totalCost: money(row.totalCost) || 0,
  entryCount: row._count?.entries ?? (Array.isArray(row.entries) ? row.entries.length : undefined),
  workerCount: Array.isArray(row.entries) ? uniqueIds(row.entries.map((entry) => entry.workerId)).length : undefined,
  submittedBy: row.submittedBy || null,
  submittedAt: toIso(row.submittedAt),
  approvedBy: row.approvedBy || null,
  approvedAt: toIso(row.approvedAt),
  rejectedBy: row.rejectedBy || null,
  rejectedAt: toIso(row.rejectedAt),
  rejectionReason: row.rejectionReason || null,
  postedAt: toIso(row.postedAt),
  createdBy: row.createdBy || null,
  path: recordWorkspacePath({ projectId: row.projectId, recordType: "timesheet", recordId: row.id }),
  entries: withEntries ? (row.entries || []).map(entryOut) : undefined,
  createdAt: toIso(row.createdAt),
  updatedAt: toIso(row.updatedAt),
});

const entryInclude = { worker: { include: { company: { select: { id: true, name: true } } } }, activity: { select: { id: true, name: true, activityCode: true, wbsCode: true } }, costCode: { select: { id: true, code: true, name: true } }, location: { select: { id: true, name: true, code: true } } };
const timesheetInclude = { crew: { select: { id: true, name: true } }, entries: { include: entryInclude, orderBy: { sortOrder: "asc" } } };

// ─── Workers ──────────────────────────────────────────────────────────────

const normalizeWorker = (payload, existing = null) => {
  const pick = (key, fallback = null) => (payload[key] !== undefined ? payload[key] : existing ? existing[key] : fallback);
  const name = trimOrNull(pick("name"));
  if (!name) throw new HttpError(400, "WORKER_NAME_REQUIRED", "The worker needs a name");
  const rate = pick("hourlyRate");
  const multiplier = toNumber(pick("overtimeMultiplier", 1.5), 1.5);
  if (multiplier < 1 || multiplier > MAX_OVERTIME_MULTIPLIER) throw new HttpError(400, "WORKER_MULTIPLIER_INVALID", "The overtime multiplier must be between 1 and 5");
  // A rate given is a number the rate's columns hold — checked for an import
  // row as for the form (CERT-2).
  if (payload.hourlyRate !== undefined && rate !== null && rate !== "" && !(Number(rate) >= 0 && Number(rate) <= RATE_MAX)) {
    throw new HttpError(400, "WORKER_RATE_INVALID", `The hourly rate must be a number from 0 to ${RATE_MAX.toLocaleString("en-US")}`);
  }
  return {
    name: name.slice(0, 200),
    companyId: trimOrNull(pick("companyId")),
    userId: trimOrNull(pick("userId")),
    employeeNumber: trimOrNull(pick("employeeNumber"))?.slice(0, 60) || null,
    trade: trimOrNull(pick("trade"))?.slice(0, 80) || null,
    classification: trimOrNull(pick("classification"))?.slice(0, 80) || null,
    hourlyRate: rate === null || rate === undefined || rate === "" ? null : Math.max(0, round2(rate)),
    overtimeMultiplier: multiplier,
    status: pick("status", "active") === "inactive" ? "inactive" : "active",
    notes: trimOrNull(pick("notes"))?.slice(0, 2000) || null,
  };
};

/**
 * What a worker names belongs to this organisation (CERT-2): its company is
 * one of the organisation's directory, and the platform user it is linked to
 * is a person of the organisation by membership (a person who belongs to
 * several companies is a valid reference in each of them). Another company's
 * person used to be stored as given while one who exists nowhere answered 500
 * from the database's foreign key, which told the two apart; an import, or an
 * edit, stored another company's company too, and the worker list then served
 * that company's name. Each is now answered as a reference that does not
 * exist. Checked when it is set or changed, so a worker whose person has since
 * left can still be edited for anything else.
 */
const assertWorkerRefs = async ({ orgId, data, existing = null }) => {
  if (data.companyId && data.companyId !== existing?.companyId) {
    const company = await prisma.company.findFirst({ where: { id: data.companyId, orgId }, select: { id: true } });
    if (!company) throw new HttpError(400, "WORKER_COMPANY_INVALID", "Unknown company");
  }
  if (data.userId && data.userId !== existing?.userId) {
    await assertMembers({ orgId, userIds: [data.userId], message: "The person is not a member of this organisation" });
  }
};

const listWorkers = async ({ orgId, query = {}, viewer = null }) => {
  const where = { orgId };
  if (query.status) where.status = query.status;
  if (query.companyId) where.companyId = query.companyId;
  if (scoped(viewer)) {
    const companyIds = companyIdsFor(viewer);
    where.companyId = { in: companyIds.length ? companyIds : ["__none__"] };
  }
  const q = trimOrNull(query.q);
  if (q) where.OR = [{ name: { contains: q, mode: "insensitive" } }, { employeeNumber: { contains: q, mode: "insensitive" } }, { trade: { contains: q, mode: "insensitive" } }];
  const rows = await prisma.worker.findMany({ where, include: { company: { select: { id: true, name: true } }, crewMembers: query.projectId ? { where: { crew: { projectId: query.projectId } }, include: { crew: { select: { id: true, name: true } } } } : false }, orderBy: [{ status: "asc" }, { name: "asc" }], take: 2000 });
  return { items: rows.map(workerOut), total: rows.length };
};

const createWorker = async ({ orgId, payload = {}, actor = null, viewer = null }) => {
  const data = normalizeWorker(payload);
  if (scoped(viewer)) {
    const party = partyFor(viewer);
    if (!party?.companyId) throw new HttpError(403, "FORBIDDEN", "Your party has no company to add workers to");
    data.companyId = party.companyId;
  }
  await assertWorkerRefs({ orgId, data });
  if (data.employeeNumber) {
    const clash = await prisma.worker.findFirst({ where: { orgId, employeeNumber: data.employeeNumber }, select: { id: true } });
    if (clash) throw new HttpError(409, "WORKER_NUMBER_EXISTS", `Employee number ${data.employeeNumber} is already used`);
  }
  const row = await prisma.worker.create({ data: { ...data, orgId, createdBy: actor?.id || null }, include: { company: { select: { id: true, name: true } } } });
  return workerOut(row);
};

const updateWorker = async ({ orgId, workerId, payload = {}, viewer = null }) => {
  const existing = await prisma.worker.findFirst({ where: { id: workerId, orgId } });
  if (!existing) throw new HttpError(404, "WORKER_NOT_FOUND", "Worker not found");
  if (scoped(viewer) && !companyIdsFor(viewer).includes(existing.companyId)) throw new HttpError(403, "FORBIDDEN", "You can only edit your company's workers");
  const data = normalizeWorker(payload, existing);
  if (scoped(viewer)) data.companyId = existing.companyId;
  await assertWorkerRefs({ orgId, data, existing });
  if (data.employeeNumber && data.employeeNumber !== existing.employeeNumber) {
    const clash = await prisma.worker.findFirst({ where: { orgId, employeeNumber: data.employeeNumber, id: { not: workerId } }, select: { id: true } });
    if (clash) throw new HttpError(409, "WORKER_NUMBER_EXISTS", `Employee number ${data.employeeNumber} is already used`);
  }
  const row = await prisma.worker.update({ where: { id: workerId }, data, include: { company: { select: { id: true, name: true } } } });
  return workerOut(row);
};

/** Rows `{ name, employeeNumber?, trade?, classification?, hourlyRate?, companyName? }` — matched on employee number, else on name + company. */
const importWorkers = async ({ orgId, rows = [], actor = null, viewer = null }) => {
  const party = scoped(viewer) ? partyFor(viewer) : null;
  const companies = await prisma.company.findMany({ where: { orgId }, select: { id: true, name: true } });
  const companyByName = new Map(companies.map((company) => [company.name.trim().toLowerCase(), company.id]));
  const results = { created: 0, updated: 0, skipped: 0, errors: [] };
  for (const [index, raw] of rows.slice(0, 1000).entries()) {
    try {
      const companyId = party?.companyId || (raw.companyId ? raw.companyId : raw.companyName ? companyByName.get(String(raw.companyName).trim().toLowerCase()) || null : null);
      const data = normalizeWorker({ ...raw, companyId });
      const existing = data.employeeNumber ? await prisma.worker.findFirst({ where: { orgId, employeeNumber: data.employeeNumber } }) : await prisma.worker.findFirst({ where: { orgId, name: { equals: data.name, mode: "insensitive" }, companyId: data.companyId } });
      if (existing) {
        if (party && existing.companyId !== party.companyId) {
          results.skipped += 1;
          continue;
        }
        await assertWorkerRefs({ orgId, data, existing });
        await prisma.worker.update({ where: { id: existing.id }, data: { ...data, companyId: existing.companyId || data.companyId } });
        results.updated += 1;
      } else {
        await assertWorkerRefs({ orgId, data });
        await prisma.worker.create({ data: { ...data, orgId, createdBy: actor?.id || null } });
        results.created += 1;
      }
    } catch (error) {
      // A row's refusal is told in the product's words; anything else (the
      // database's own text names the constraint, the file and the line) is
      // not passed on (CERT-2: it told an id that exists nowhere from one of
      // another company).
      results.errors.push({ row: index + 1, message: error instanceof HttpError ? error.message : "The row could not be imported" });
    }
  }
  return results;
};

// ─── Crews ────────────────────────────────────────────────────────────────

const crewInclude = { company: { select: { id: true, name: true } }, members: { include: { worker: { include: { company: { select: { id: true, name: true } } } } }, orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] }, _count: { select: { members: true } } };

const listCrews = async ({ orgId, projectId, query = {}, viewer = null }) => {
  const where = { orgId, projectId };
  if (query.status) where.status = query.status;
  const scope = visibilityWhere(viewer);
  if (scope) Object.assign(where, scope);
  const rows = await prisma.crew.findMany({ where, include: crewInclude, orderBy: [{ status: "asc" }, { name: "asc" }] });
  return { items: rows.map(crewOut) };
};

const assertCrewRefs = async ({ orgId, projectId, data, existing = null }) => {
  if (data.companyId) {
    const company = await prisma.company.findFirst({ where: { id: data.companyId, orgId }, select: { id: true } });
    if (!company) throw new HttpError(400, "CREW_COMPANY_INVALID", "Unknown company");
  }
  if (data.defaultActivityId) {
    const activity = await prisma.activity.findFirst({ where: { id: data.defaultActivityId, projectId }, select: { id: true } });
    if (!activity) throw new HttpError(400, "CREW_ACTIVITY_INVALID", "The default activity is not on this project");
  }
  if (data.defaultCostCodeId) {
    const code = await prisma.projectCostCode.findFirst({ where: { projectId, costCodeId: data.defaultCostCodeId }, select: { id: true } });
    if (!code) throw new HttpError(400, "CREW_COST_CODE_INVALID", "The default cost code is not on this project");
  }
  // The foreman is a person of this organisation, by membership: another
  // company's person used to be stored as given, and one who exists nowhere
  // too (CERT-2). Checked when it is set or changed, so a crew whose foreman
  // has since left can still be edited for anything else.
  if (data.foremanUserId && data.foremanUserId !== existing?.foremanUserId) {
    await assertMembers({ orgId, userIds: [data.foremanUserId], message: "The foreman is not a member of this organisation" });
  }
  // The crew's party is a party of this project. Crew.partyId has no foreign
  // key: another company's party, and an id that exists nowhere, used to be
  // stored as given and copied onto every timesheet of the crew (CERT-2). Both
  // are answered as a party that is not on this project. Checked when it is
  // set or changed, like the foreman.
  if (data.partyId && data.partyId !== existing?.partyId) {
    const party = await prisma.projectParty.findFirst({ where: { id: data.partyId, projectId }, select: { id: true } });
    if (!party) throw new HttpError(400, "CREW_PARTY_INVALID", "The party is not on this project");
  }
};

const normalizeCrew = (payload, existing = null) => {
  const pick = (key, fallback = null) => (payload[key] !== undefined ? payload[key] : existing ? existing[key] : fallback);
  const name = trimOrNull(pick("name"));
  if (!name) throw new HttpError(400, "CREW_NAME_REQUIRED", "The crew needs a name");
  return { name: name.slice(0, 120), companyId: trimOrNull(pick("companyId")), partyId: trimOrNull(pick("partyId")), foremanUserId: trimOrNull(pick("foremanUserId")), defaultCostCodeId: trimOrNull(pick("defaultCostCodeId")), defaultActivityId: trimOrNull(pick("defaultActivityId")), status: pick("status", "active") === "inactive" ? "inactive" : "active" };
};

const setMembers = async (tx, crewId, workerIds) => {
  const ids = uniqueIds(workerIds);
  await tx.crewMember.deleteMany({ where: { crewId, workerId: { notIn: ids.length ? ids : ["__none__"] } } });
  for (const [index, workerId] of ids.entries()) {
    await tx.crewMember.upsert({ where: { crewId_workerId: { crewId, workerId } }, create: { crewId, workerId, sortOrder: index }, update: { sortOrder: index } });
  }
};

const assertWorkersUsable = async ({ orgId, workerIds, viewer }) => {
  const ids = uniqueIds(workerIds);
  if (!ids.length) return [];
  const workers = await prisma.worker.findMany({ where: { id: { in: ids }, orgId } });
  if (workers.length !== ids.length) throw new HttpError(400, "WORKER_INVALID", "One of the workers does not exist");
  if (scoped(viewer)) {
    const companyIds = companyIdsFor(viewer);
    if (workers.some((worker) => !companyIds.includes(worker.companyId))) throw new HttpError(403, "FORBIDDEN", "You can only use your company's workers");
  }
  return workers;
};

const createCrew = async ({ orgId, projectId, payload = {}, actor = null, viewer = null }) => {
  const data = normalizeCrew(payload);
  if (scoped(viewer)) {
    const party = partyFor(viewer);
    data.companyId = party?.companyId || null;
    data.partyId = party?.partyId || null;
  }
  await assertCrewRefs({ orgId, projectId, data });
  await assertWorkersUsable({ orgId, workerIds: payload.workerIds || [], viewer });
  const clash = await prisma.crew.findFirst({ where: { projectId, name: { equals: data.name, mode: "insensitive" } }, select: { id: true } });
  if (clash) throw new HttpError(409, "CREW_NAME_EXISTS", `A crew called ${data.name} already exists`);
  const row = await prisma.$transaction(async (tx) => {
    const created = await tx.crew.create({ data: { ...data, orgId, projectId, createdBy: actor?.id || null } });
    if (Array.isArray(payload.workerIds)) await setMembers(tx, created.id, payload.workerIds);
    return tx.crew.findFirst({ where: { id: created.id }, include: crewInclude });
  });
  await auditService.recordEvent({ orgId, projectId, entityType: "crew", entityId: row.id, action: auditService.ACTIONS.CREATED, actorId: actor?.id || null, summary: { name: row.name, members: row._count.members } }).catch(() => null);
  return crewOut(row);
};

const loadCrew = async ({ orgId, projectId, crewId, viewer }) => {
  // A crew is named by one id; any other value names no crew (CERT-2 shapes:
  // ["<id>"] reached Prisma as a 500), whoever's id it wraps.
  if (typeof crewId !== "string") throw new HttpError(404, "CREW_NOT_FOUND", "Crew not found");
  const row = await prisma.crew.findFirst({ where: { id: crewId, orgId, projectId }, include: crewInclude });
  if (!row) throw new HttpError(404, "CREW_NOT_FOUND", "Crew not found");
  assertVisible(row, viewer);
  return row;
};

const updateCrew = async ({ orgId, projectId, crewId, payload = {}, actor = null, viewer = null }) => {
  const existing = await loadCrew({ orgId, projectId, crewId, viewer });
  const data = normalizeCrew(payload, existing);
  if (scoped(viewer)) {
    data.companyId = existing.companyId;
    data.partyId = existing.partyId;
  }
  await assertCrewRefs({ orgId, projectId, data, existing });
  if (Array.isArray(payload.workerIds)) await assertWorkersUsable({ orgId, workerIds: payload.workerIds, viewer });
  if (data.name.toLowerCase() !== existing.name.toLowerCase()) {
    const clash = await prisma.crew.findFirst({ where: { projectId, name: { equals: data.name, mode: "insensitive" }, id: { not: crewId } }, select: { id: true } });
    if (clash) throw new HttpError(409, "CREW_NAME_EXISTS", `A crew called ${data.name} already exists`);
  }
  const row = await prisma.$transaction(async (tx) => {
    await tx.crew.update({ where: { id: crewId }, data });
    if (Array.isArray(payload.workerIds)) await setMembers(tx, crewId, payload.workerIds);
    return tx.crew.findFirst({ where: { id: crewId }, include: crewInclude });
  });
  await auditService.recordEvent({ orgId, projectId, entityType: "crew", entityId: crewId, action: auditService.ACTIONS.UPDATED, actorId: actor?.id || null, summary: { name: row.name, members: row._count.members } }).catch(() => null);
  return crewOut(row);
};

const deleteCrew = async ({ orgId, projectId, crewId, actor = null, viewer = null }) => {
  const existing = await loadCrew({ orgId, projectId, crewId, viewer });
  const used = await prisma.timesheet.count({ where: { crewId } });
  if (used) throw new HttpError(409, "CREW_IN_USE", "This crew has timesheets — mark it inactive instead");
  await prisma.crew.delete({ where: { id: crewId } });
  await auditService.recordEvent({ orgId, projectId, entityType: "crew", entityId: crewId, action: auditService.ACTIONS.DELETED, actorId: actor?.id || null, summary: { name: existing.name } }).catch(() => null);
  return { deleted: true };
};

// ─── Timesheets ───────────────────────────────────────────────────────────

const ensureProject = async ({ orgId, projectId }) => {
  const project = await prisma.project.findFirst({ where: { id: projectId, orgId }, select: { id: true, name: true } });
  if (!project) throw new HttpError(404, "PROJECT_NOT_FOUND", "Project not found");
  return project;
};

/** Validates and normalises entry rows against the project's references. */
const normalizeEntries = async ({ orgId, projectId, rows, viewer }) => {
  const list = Array.isArray(rows) ? rows : [];
  if (list.length > 500) throw new HttpError(400, "TIMESHEET_TOO_MANY_ENTRIES", "A timesheet takes up to 500 entries");
  const workers = await assertWorkersUsable({ orgId, workerIds: list.map((row) => row.workerId), viewer });
  const workerById = new Map(workers.map((worker) => [worker.id, worker]));
  const activityIds = uniqueIds(list.map((row) => row.activityId));
  const costCodeIds = uniqueIds(list.map((row) => row.costCodeId));
  const locationIds = uniqueIds(list.map((row) => row.locationId));
  const [activities, costCodes, locations] = await Promise.all([
    activityIds.length ? prisma.activity.findMany({ where: { id: { in: activityIds }, projectId }, select: { id: true } }) : [],
    costCodeIds.length ? prisma.projectCostCode.findMany({ where: { projectId, costCodeId: { in: costCodeIds } }, select: { costCodeId: true } }) : [],
    locationIds.length ? prisma.location.findMany({ where: { id: { in: locationIds }, projectId }, select: { id: true } }) : [],
  ]);
  const activitySet = new Set(activities.map((row) => row.id));
  const costCodeSet = new Set(costCodes.map((row) => row.costCodeId));
  const locationSet = new Set(locations.map((row) => row.id));
  const hoursByWorker = new Map();
  const entries = list.map((row, index) => {
    const workerId = trimOrNull(row.workerId);
    if (!workerId || !workerById.has(workerId)) throw new HttpError(400, "TIMESHEET_ENTRY_WORKER", `Entry ${index + 1}: pick a worker`);
    const activityId = trimOrNull(row.activityId);
    if (activityId && !activitySet.has(activityId)) throw new HttpError(400, "TIMESHEET_ENTRY_ACTIVITY", `Entry ${index + 1}: the activity is not on this project`);
    const costCodeId = trimOrNull(row.costCodeId);
    if (costCodeId && !costCodeSet.has(costCodeId)) throw new HttpError(400, "TIMESHEET_ENTRY_COST_CODE", `Entry ${index + 1}: the cost code is not on this project`);
    const locationId = trimOrNull(row.locationId);
    if (locationId && !locationSet.has(locationId)) throw new HttpError(400, "TIMESHEET_ENTRY_LOCATION", `Entry ${index + 1}: unknown location`);
    const timeType = TIME_TYPES.includes(row.timeType) ? row.timeType : "regular";
    const hours = round2(row.hours);
    if (!(hours >= 0) || hours > MAX_HOURS_PER_DAY) throw new HttpError(400, "TIMESHEET_ENTRY_HOURS", `Entry ${index + 1}: hours must be between 0 and 24`);
    const total = (hoursByWorker.get(workerId) || 0) + hours;
    if (total > MAX_HOURS_PER_DAY) throw new HttpError(400, "TIMESHEET_HOURS_EXCEEDED", `${workerById.get(workerId).name} has more than 24 hours on this day`);
    hoursByWorker.set(workerId, total);
    return { workerId, activityId, costCodeId, locationId, timeType, hours, startTime: trimOrNull(row.startTime)?.slice(0, 5) || null, endTime: trimOrNull(row.endTime)?.slice(0, 5) || null, notes: trimOrNull(row.notes)?.slice(0, 1000) || null, sortOrder: index };
  });
  return { entries, workerById };
};

/**
 * What a timesheet's entries come to. The cost is added up as an exact
 * decimal, and that decimal is what is checked and what is stored (CERT-2,
 * round 6): added up in floating point, entries of 5,000,000,000,000,000 and
 * 4,999,999,999,999,999 came to 10^16 — the check, in decimals, let the
 * timesheet through and the write of the float overflowed its column.
 */
const totalsOf = (entries) => {
  let regular = 0;
  let overtime = 0;
  let cost = toMoneyDecimal(0);
  for (const entry of entries) {
    if (entry.timeType === "regular") regular += toNumber(entry.hours);
    else overtime += toNumber(entry.hours);
    cost = cost.plus(toMoneyDecimal(entry.amount || 0));
  }
  return { regularHours: round2(regular), overtimeHours: round2(overtime), totalCost: cost };
};

const listTimesheets = async ({ orgId, projectId, query = {}, viewer = null }) => {
  const where = { orgId, projectId };
  if (query.from || query.to) where.date = { ...(query.from ? { gte: toDateOnly(query.from) } : {}), ...(query.to ? { lte: toDateOnly(query.to) } : {}) };
  if (query.status) where.status = query.status;
  if (query.crewId) where.crewId = query.crewId;
  if (query.companyId) where.companyId = query.companyId;
  const scope = visibilityWhere(viewer);
  if (scope) Object.assign(where, scope);
  const rows = await prisma.timesheet.findMany({ where, include: { crew: { select: { id: true, name: true } }, entries: { select: { workerId: true } }, _count: { select: { entries: true } } }, orderBy: [{ date: "desc" }, { createdAt: "desc" }], take: 1000 });
  const items = rows.map((row) => timesheetOut(row));
  const summary = { count: items.length, regularHours: round2(items.reduce((sum, row) => sum + row.regularHours, 0)), overtimeHours: round2(items.reduce((sum, row) => sum + row.overtimeHours, 0)), totalCost: round2(items.reduce((sum, row) => sum + row.totalCost, 0)), byStatus: Object.fromEntries(Object.values(STATUS).map((status) => [status, items.filter((row) => row.status === status).length])) };
  return { items, summary };
};

const loadTimesheet = async ({ orgId, projectId, timesheetId, viewer, tx = prisma }) => {
  const row = await tx.timesheet.findFirst({ where: { id: timesheetId, orgId, projectId }, include: timesheetInclude });
  if (!row) throw new HttpError(404, "TIMESHEET_NOT_FOUND", "Timesheet not found");
  assertVisible(row, viewer);
  return row;
};

const getTimesheet = async ({ orgId, projectId, timesheetId, viewer = null }) => timesheetOut(await loadTimesheet({ orgId, projectId, timesheetId, viewer }), { withEntries: true });

/** Creates a day's timesheet; with a crew and no entries the members are pre-filled with 8 regular hours on the crew's defaults. */
const createTimesheet = async ({ orgId, projectId, payload = {}, actor = null, viewer = null }) => {
  await ensureProject({ orgId, projectId });
  const date = toDateOnly(payload.date);
  const clientRequestId = trimOrNull(payload.clientRequestId);
  if (clientRequestId) {
    const replay = await prisma.timesheet.findFirst({ where: { projectId, clientRequestId }, include: timesheetInclude });
    if (replay) return { ...timesheetOut(replay, { withEntries: true }), replayed: true };
  }
  const crew = payload.crewId ? await loadCrew({ orgId, projectId, crewId: payload.crewId, viewer }) : null;
  if (crew) {
    const existing = await prisma.timesheet.findFirst({ where: { projectId, crewId: crew.id, date }, select: { id: true, status: true } });
    if (existing) throw new HttpError(409, "TIMESHEET_EXISTS", `${crew.name} already has a timesheet for ${dateKey(date)}`, { timesheetId: existing.id, status: existing.status });
  }
  let rows = Array.isArray(payload.entries) ? payload.entries : null;
  if (!rows && crew) rows = crew.members.map((member) => ({ workerId: member.workerId, activityId: crew.defaultActivityId, costCodeId: crew.defaultCostCodeId, timeType: "regular", hours: toNumber(payload.defaultHours, 8) }));
  const { entries } = await normalizeEntries({ orgId, projectId, rows: rows || [], viewer });
  // The company a timesheet is booked to is one of the organisation's
  // directory: Timesheet.companyId has no foreign key, and another company's
  // id (or one that exists nowhere) used to be stored as given (CERT-2).
  const requestedCompanyId = trimOrNull(payload.companyId);
  if (requestedCompanyId) {
    const company = await prisma.company.findFirst({ where: { id: requestedCompanyId, orgId }, select: { id: true } });
    if (!company) throw new HttpError(400, "TIMESHEET_COMPANY_INVALID", "Unknown company");
  }
  const party = scoped(viewer) ? partyFor(viewer) : null;
  const companyId = party?.companyId || crew?.companyId || requestedCompanyId || null;
  const created = await prisma.$transaction(async (tx) => {
    const row = await tx.timesheet.create({ data: { orgId, projectId, date, crewId: crew?.id || null, partyId: party?.partyId || crew?.partyId || null, companyId, status: STATUS.DRAFT, notes: trimOrNull(payload.notes)?.slice(0, 2000) || null, ...totalsOf(entries), clientRequestId, createdBy: actor?.id || null } });
    if (entries.length) await tx.timeEntry.createMany({ data: entries.map((entry) => ({ ...entry, orgId, projectId, timesheetId: row.id })) });
    return loadTimesheet({ orgId, projectId, timesheetId: row.id, viewer, tx });
  });
  await auditService.recordEvent({ orgId, projectId, entityType: "timesheet", entityId: created.id, action: auditService.ACTIONS.CREATED, actorId: actor?.id || null, summary: { date: dateKey(date), crew: crew?.name || null, entries: entries.length } }).catch(() => null);
  return timesheetOut(created, { withEntries: true });
};

const assertEditable = (row) => {
  if (![STATUS.DRAFT, STATUS.REJECTED].includes(row.status)) throw new HttpError(409, "TIMESHEET_LOCKED", `A ${row.status} timesheet cannot be edited`);
};

/** Replaces the entries (and notes) of a draft or rejected timesheet. */
/**
 * Holds the timesheet for the transaction and refuses if its status is no
 * longer one the caller decided on: a return that started while the sheet
 * was submitted must not land on it once approved and posted — the cost
 * would stay posted and the sheet become editable (Phase 21D, CX21-414);
 * an edit or a delete that started on a draft, likewise (CX21-423).
 */
const lockTimesheetExpecting = async (tx, timesheetId, statuses, code, message) => {
  const [fresh] = await tx.$queryRaw`SELECT status FROM "Timesheet" WHERE id = ${timesheetId} FOR UPDATE`;
  if (fresh && !statuses.includes(fresh.status)) throw new HttpError(409, code, message(fresh.status));
};

const updateTimesheet = async ({ orgId, projectId, timesheetId, payload = {}, actor = null, viewer = null }) => {
  const existing = await loadTimesheet({ orgId, projectId, timesheetId, viewer });
  assertEditable(existing);
  const rows = Array.isArray(payload.entries) ? payload.entries : null;
  const { entries } = rows ? await normalizeEntries({ orgId, projectId, rows, viewer }) : { entries: existing.entries.map((entry) => ({ ...entry })) };
  const updated = await prisma.$transaction(async (tx) => {
    await lockTimesheetExpecting(tx, timesheetId, [STATUS.DRAFT, STATUS.REJECTED], "TIMESHEET_LOCKED", (status) => `A ${status} timesheet cannot be edited`);
    if (rows) {
      await tx.timeEntry.deleteMany({ where: { timesheetId } });
      if (entries.length) await tx.timeEntry.createMany({ data: entries.map(({ id, worker, activity, costCode, location, rate, amount, postedAmount, budgetLineId, createdAt, updatedAt, timesheetId: _ts, orgId: _o, projectId: _p, ...entry }) => ({ ...entry, orgId, projectId, timesheetId })) });
    }
    await tx.timesheet.update({ where: { id: timesheetId }, data: { ...(payload.notes !== undefined ? { notes: trimOrNull(payload.notes)?.slice(0, 2000) || null } : {}), ...(payload.date ? { date: toDateOnly(payload.date) } : {}), ...totalsOf(entries.map((entry) => ({ ...entry, amount: 0 }))) } });
    return loadTimesheet({ orgId, projectId, timesheetId, viewer, tx });
  });
  await auditService.recordEvent({ orgId, projectId, entityType: "timesheet", entityId: timesheetId, action: auditService.ACTIONS.UPDATED, actorId: actor?.id || null, summary: { entries: updated.entries.length, regularHours: updated.regularHours, overtimeHours: updated.overtimeHours } }).catch(() => null);
  return timesheetOut(updated, { withEntries: true });
};

const deleteTimesheet = async ({ orgId, projectId, timesheetId, actor = null, viewer = null }) => {
  const existing = await loadTimesheet({ orgId, projectId, timesheetId, viewer });
  if (existing.status !== STATUS.DRAFT) throw new HttpError(409, "TIMESHEET_LOCKED", "Only draft timesheets can be deleted");
  await prisma.$transaction(async (tx) => {
    await lockTimesheetExpecting(tx, timesheetId, [STATUS.DRAFT], "TIMESHEET_LOCKED", () => "Only draft timesheets can be deleted");
    await tx.timesheet.delete({ where: { id: timesheetId } });
  });
  await auditService.recordEvent({ orgId, projectId, entityType: "timesheet", entityId: timesheetId, action: auditService.ACTIONS.DELETED, actorId: actor?.id || null, summary: { date: dateKey(existing.date) } }).catch(() => null);
  return { deleted: true };
};

const notify = async ({ orgId, projectId, row, actor, event, title, message, recipientUserIds = [], recipientRoles = [] }) =>
  notificationService
    .createNotifications({ orgId, projectId, actorId: actor?.id || null, recipientUserIds: uniqueIds(recipientUserIds), recipientRoles, type: "timesheet", category: notificationService.NOTIFICATION_CATEGORIES.APPROVAL, event, title, message, actionUrl: recordWorkspacePath({ projectId, recordType: "timesheet", recordId: row.id }), entityType: "timesheet", entityId: row.id, dedupeKeyBase: `timesheet:${row.id}:${event}:${Date.now()}`, metadata: { date: dateKey(row.date), status: row.status, crew: row.crew?.name || null } })
    .catch(() => null);

const labelOf = (row) => `${row.crew?.name ? `${row.crew.name} · ` : ""}${dateKey(row.date)}`;

const submitTimesheet = async ({ orgId, projectId, timesheetId, actor = null, viewer = null }) => {
  const existing = await loadTimesheet({ orgId, projectId, timesheetId, viewer });
  assertEditable(existing);
  if (!existing.entries.length) throw new HttpError(400, "TIMESHEET_EMPTY", "Add at least one entry before submitting");
  const missing = existing.entries.filter((entry) => !entry.activityId);
  if (missing.length) throw new HttpError(400, "TIMESHEET_ENTRY_ACTIVITY_REQUIRED", `${missing.length} entr${missing.length === 1 ? "y has" : "ies have"} no activity — every entry must be linked to a schedule activity`, { workerIds: uniqueIds(missing.map((entry) => entry.workerId)) });
  const now = new Date();
  const row = await prisma.$transaction(async (tx) => {
    await lockTimesheetExpecting(tx, timesheetId, [STATUS.DRAFT, STATUS.REJECTED], "TIMESHEET_LOCKED", (status) => `A ${status} timesheet cannot be submitted`);
    await tx.timesheet.update({ where: { id: timesheetId }, data: { status: STATUS.SUBMITTED, submittedBy: actor?.id || null, submittedAt: now, rejectedBy: null, rejectedAt: null, rejectionReason: null } });
    return loadTimesheet({ orgId, projectId, timesheetId, viewer, tx });
  });
  await auditService.recordEvent({ orgId, projectId, entityType: "timesheet", entityId: timesheetId, action: auditService.ACTIONS.STATUS_CHANGED, actorId: actor?.id || null, summary: { from: existing.status, to: STATUS.SUBMITTED, hours: row.regularHours + row.overtimeHours } }).catch(() => null);
  await notify({ orgId, projectId, row, actor, event: "timesheet.submitted", title: `Timesheet submitted: ${labelOf(row)}`, message: `${row.entries.length} entr${row.entries.length === 1 ? "y" : "ies"}, ${round2(row.regularHours + row.overtimeHours)} h — waiting for approval.`, recipientRoles: ["pm", "cost_controller"], recipientUserIds: [row.crew?.foremanUserId].filter(Boolean) });
  return timesheetOut(row, { withEntries: true });
};

/** Approves and posts labour cost: cost record per activity, labour budget line per cost code. */
const approveTimesheet = async ({ orgId, projectId, timesheetId, actor = null, viewer = null }) => {
  const existing = await loadTimesheet({ orgId, projectId, timesheetId, viewer });
  if (existing.status !== STATUS.SUBMITTED) throw new HttpError(409, "TIMESHEET_NOT_SUBMITTED", "Only submitted timesheets can be approved");
  // What each entry costs, and what they come to. The timesheet's total is a
  // Decimal(18,2) like each entry's amount, and entries that each fit can
  // together pass it: two workers on one day at the highest rate with
  // overtime were a 500 at the write (CERT-2). Refused before anything is
  // posted; what the activities and budget lines can take is the ledger's
  // check (cost-ledger assertPostingFits).
  const priced = existing.entries.map((entry) => {
    const rate = entry.rate !== null && entry.rate !== undefined ? toNumber(entry.rate) : toNumber(entry.worker?.hourlyRate, 0);
    return { entry, rate, amount: round2(toNumber(entry.hours) * rate * multiplierFor(entry.timeType, entry.worker)) };
  });
  // The totals checked here are the totals written below (round 6).
  const totals = totalsOf(priced.map(({ entry, rate, amount }) => ({ ...entry, rate, amount })));
  if (totals.totalCost.greaterThan(MONEY_MAX)) {
    throw new HttpError(400, "TIMESHEET_TOTAL_TOO_LARGE", "This timesheet's labour cost comes to more than a timesheet can record");
  }
  const now = new Date();
  const row = await prisma.$transaction(async (tx) => {
    await lockTimesheetExpecting(tx, timesheetId, [STATUS.SUBMITTED], "TIMESHEET_NOT_SUBMITTED", () => "Only submitted timesheets can be approved");
    const posted = [];
    for (const { entry, rate, amount } of priced) {
      // Through the cost ledger (OCTA-FIN-LEDGER-059), so labour is traceable
      // back to the timesheet entry that produced it and reconciles like every
      // other source.
      const result = await costLedger.post({
        tx,
        orgId,
        projectId,
        sourceType: "timesheet",
        sourceId: timesheetId,
        sourceLineId: entry.id,
        amount,
        costType: "labour",
        activityId: entry.activityId || null,
        costCodeId: entry.costCodeId || null,
        budgetLineId: entry.budgetLineId || null,
        quantity: toNumber(entry.hours),
        unitCost: rate,
        incurredOn: existing.date,
        postedBy: actor?.id || null,
        note: entry.worker?.name || null,
      });
      const budgetLineId = result.entry?.budgetLineId ?? entry.budgetLineId ?? null;
      await tx.timeEntry.update({ where: { id: entry.id }, data: { rate, amount, postedAmount: result.posted ? amount : toNumber(entry.postedAmount), budgetLineId } });
      posted.push({ ...entry, rate, amount });
    }
    await tx.timesheet.update({ where: { id: timesheetId }, data: { status: STATUS.APPROVED, approvedBy: actor?.id || null, approvedAt: now, postedAt: now, ...totals } });
    return loadTimesheet({ orgId, projectId, timesheetId, viewer, tx });
  });
  await auditService.recordEvent({ orgId, projectId, entityType: "timesheet", entityId: timesheetId, action: auditService.ACTIONS.APPROVED, actorId: actor?.id || null, summary: { hours: row.regularHours + row.overtimeHours, totalCost: money(row.totalCost), activities: uniqueIds(row.entries.map((entry) => entry.activityId)).length } }).catch(() => null);
  await notify({ orgId, projectId, row, actor, event: "timesheet.approved", title: `Timesheet approved: ${labelOf(row)}`, message: `${round2(row.regularHours + row.overtimeHours)} h approved; labour cost ${money(row.totalCost)} posted to the activities.`, recipientUserIds: [row.submittedBy, row.createdBy] });
  return timesheetOut(row, { withEntries: true });
};

const rejectTimesheet = async ({ orgId, projectId, timesheetId, payload = {}, actor = null, viewer = null }) => {
  const existing = await loadTimesheet({ orgId, projectId, timesheetId, viewer });
  if (existing.status !== STATUS.SUBMITTED) throw new HttpError(409, "TIMESHEET_NOT_SUBMITTED", "Only submitted timesheets can be returned");
  const reason = trimOrNull(payload.reason);
  if (!reason) throw new HttpError(400, "TIMESHEET_REASON_REQUIRED", "Say why the timesheet is returned");
  const now = new Date();
  const row = await prisma.$transaction(async (tx) => {
    await lockTimesheetExpecting(tx, timesheetId, [STATUS.SUBMITTED], "TIMESHEET_NOT_SUBMITTED", () => "Only submitted timesheets can be returned");
    await tx.timesheet.update({ where: { id: timesheetId }, data: { status: STATUS.REJECTED, rejectedBy: actor?.id || null, rejectedAt: now, rejectionReason: reason.slice(0, 1000) } });
    return loadTimesheet({ orgId, projectId, timesheetId, viewer, tx });
  });
  await auditService.recordEvent({ orgId, projectId, entityType: "timesheet", entityId: timesheetId, action: auditService.ACTIONS.REJECTED, actorId: actor?.id || null, summary: { reason: reason.slice(0, 200) } }).catch(() => null);
  await notify({ orgId, projectId, row, actor, event: "timesheet.rejected", title: `Timesheet returned: ${labelOf(row)}`, message: reason.slice(0, 500), recipientUserIds: [row.submittedBy, row.createdBy] });
  return timesheetOut(row, { withEntries: true });
};

/** Reverses the posted cost and returns an approved timesheet to draft. */
const reopenTimesheet = async ({ orgId, projectId, timesheetId, payload = {}, actor = null, viewer = null }) => {
  const existing = await loadTimesheet({ orgId, projectId, timesheetId, viewer });
  if (![STATUS.APPROVED, STATUS.SUBMITTED].includes(existing.status)) throw new HttpError(409, "TIMESHEET_NOT_REOPENABLE", "Only submitted or approved timesheets can be reopened");
  const row = await prisma.$transaction(async (tx) => {
    await lockTimesheetExpecting(tx, timesheetId, [STATUS.APPROVED, STATUS.SUBMITTED], "TIMESHEET_NOT_REOPENABLE", () => "Only submitted or approved timesheets can be reopened");
    // Negative mirrors rather than decrements, so the reversal is on the record.
    await costLedger.reverse({ tx, orgId, projectId, sourceType: "timesheet", sourceId: timesheetId, postedBy: actor?.id || null, note: payload.reason ? String(payload.reason).slice(0, 500) : null });
    for (const entry of existing.entries) {
      await tx.timeEntry.update({ where: { id: entry.id }, data: { postedAmount: 0, amount: 0, budgetLineId: null } });
    }
    await tx.timesheet.update({ where: { id: timesheetId }, data: { status: STATUS.DRAFT, approvedBy: null, approvedAt: null, postedAt: null, submittedBy: null, submittedAt: null, totalCost: 0, notes: payload.reason ? `${existing.notes ? `${existing.notes}\n` : ""}Reopened: ${String(payload.reason).slice(0, 500)}` : existing.notes } });
    return loadTimesheet({ orgId, projectId, timesheetId, viewer, tx });
  });
  await auditService.recordEvent({ orgId, projectId, entityType: "timesheet", entityId: timesheetId, action: auditService.ACTIONS.STATUS_CHANGED, actorId: actor?.id || null, summary: { from: existing.status, to: STATUS.DRAFT, reversed: money(existing.totalCost), reason: trimOrNull(payload.reason) } }).catch(() => null);
  return timesheetOut(row, { withEntries: true });
};

// ─── Views ────────────────────────────────────────────────────────────────

/** Worker × day grid for the week starting `weekStart`, plus totals by crew, activity and cost code. */
const weekSummary = async ({ orgId, projectId, weekStart, viewer = null }) => {
  const start = toDateOnly(weekStart);
  const end = addDays(start, 6);
  const days = Array.from({ length: 7 }, (_, index) => dateKey(addDays(start, index)));
  const where = { orgId, projectId, date: { gte: start, lte: end } };
  const scope = visibilityWhere(viewer);
  if (scope) Object.assign(where, scope);
  const sheets = await prisma.timesheet.findMany({ where, include: timesheetInclude, orderBy: { date: "asc" } });
  const workers = new Map();
  const crews = new Map();
  const activities = new Map();
  const costCodes = new Map();
  const bump = (map, key, seed, hours, cost) => {
    const row = map.get(key) || { ...seed, hours: 0, cost: 0 };
    row.hours = round2(row.hours + hours);
    row.cost = round2(row.cost + cost);
    map.set(key, row);
  };
  for (const sheet of sheets) {
    const day = dateKey(sheet.date);
    const index = days.indexOf(day);
    for (const entry of sheet.entries) {
      const hours = toNumber(entry.hours);
      const cost = toNumber(entry.amount);
      const worker = workers.get(entry.workerId) || { workerId: entry.workerId, name: entry.worker?.name || "Worker", trade: entry.worker?.trade || null, companyName: entry.worker?.company?.name || null, days: days.map(() => ({ hours: 0, overtime: 0, timesheetIds: [] })), hours: 0, overtime: 0, cost: 0 };
      if (index >= 0) {
        worker.days[index].hours = round2(worker.days[index].hours + hours);
        if (entry.timeType !== "regular") worker.days[index].overtime = round2(worker.days[index].overtime + hours);
        if (!worker.days[index].timesheetIds.includes(sheet.id)) worker.days[index].timesheetIds.push(sheet.id);
      }
      worker.hours = round2(worker.hours + hours);
      if (entry.timeType !== "regular") worker.overtime = round2(worker.overtime + hours);
      worker.cost = round2(worker.cost + cost);
      workers.set(entry.workerId, worker);
      bump(crews, sheet.crewId || "none", { crewId: sheet.crewId || null, name: sheet.crew?.name || "No crew" }, hours, cost);
      bump(activities, entry.activityId || "none", { activityId: entry.activityId || null, name: entry.activity?.name || "No activity", code: entry.activity?.activityCode || entry.activity?.wbsCode || null }, hours, cost);
      bump(costCodes, entry.costCodeId || "none", { costCodeId: entry.costCodeId || null, code: entry.costCode?.code || null, name: entry.costCode?.name || "No cost code" }, hours, cost);
    }
  }
  const byStatus = Object.fromEntries(Object.values(STATUS).map((status) => [status, sheets.filter((sheet) => sheet.status === status).length]));
  const totalHours = round2([...workers.values()].reduce((sum, row) => sum + row.hours, 0));
  const dayTotals = days.map((_, index) => round2([...workers.values()].reduce((sum, row) => sum + row.days[index].hours, 0)));
  return {
    weekStart: days[0],
    weekEnd: days[6],
    days,
    workers: [...workers.values()].sort((a, b) => a.name.localeCompare(b.name)),
    crews: [...crews.values()].sort((a, b) => b.hours - a.hours),
    activities: [...activities.values()].sort((a, b) => b.hours - a.hours),
    costCodes: [...costCodes.values()].sort((a, b) => b.hours - a.hours),
    timesheets: sheets.map((sheet) => timesheetOut(sheet)),
    totals: { hours: totalHours, overtime: round2([...workers.values()].reduce((sum, row) => sum + row.overtime, 0)), cost: round2([...workers.values()].reduce((sum, row) => sum + row.cost, 0)), workers: workers.size, timesheets: sheets.length, dayTotals, byStatus },
  };
};

/** Approved hours and cost per activity against its progress and labour budget. */
const productivity = async ({ orgId, projectId, query = {}, viewer = null }) => {
  const where = { orgId, projectId, status: STATUS.APPROVED };
  if (query.from || query.to) where.date = { ...(query.from ? { gte: toDateOnly(query.from) } : {}), ...(query.to ? { lte: toDateOnly(query.to) } : {}) };
  const scope = visibilityWhere(viewer);
  if (scope) Object.assign(where, scope);
  const sheets = await prisma.timesheet.findMany({ where, include: { entries: { include: { activity: { select: { id: true, name: true, activityCode: true, wbsCode: true, physComplete: true, startDate: true, endDate: true } } } } } });
  const byActivity = new Map();
  for (const sheet of sheets) {
    for (const entry of sheet.entries) {
      if (!entry.activityId) continue;
      const row = byActivity.get(entry.activityId) || { activityId: entry.activityId, name: entry.activity?.name || "Activity", code: entry.activity?.activityCode || entry.activity?.wbsCode || null, hours: 0, overtimeHours: 0, cost: 0, workers: new Set(), days: new Set() };
      row.hours = round2(row.hours + toNumber(entry.hours));
      if (entry.timeType !== "regular") row.overtimeHours = round2(row.overtimeHours + toNumber(entry.hours));
      row.cost = round2(row.cost + toNumber(entry.amount));
      row.workers.add(entry.workerId);
      row.days.add(dateKey(sheet.date));
      byActivity.set(entry.activityId, row);
    }
  }
  const ids = [...byActivity.keys()];
  const [progress, costRecords] = ids.length
    ? await Promise.all([
        prisma.activityProgress.findMany({ where: { activityId: { in: ids }, status: "approved" }, orderBy: { updatedAt: "desc" }, select: { activityId: true, pctComplete: true, updatedAt: true } }),
        prisma.costRecord.findMany({ where: { projectId, activityId: { in: ids } }, select: { activityId: true, labour: true, budget: true, actual: true } }),
      ])
    : [[], []];
  const pctByActivity = new Map();
  for (const row of progress) if (!pctByActivity.has(row.activityId)) pctByActivity.set(row.activityId, toNumber(row.pctComplete));
  const costByActivity = new Map(costRecords.map((row) => [row.activityId, row]));
  const items = [...byActivity.values()].map((row) => {
    const pct = pctByActivity.get(row.activityId) ?? null;
    const record = costByActivity.get(row.activityId);
    const labourBudget = record ? money(record.labour) : null;
    const earnedLabour = labourBudget !== null && pct !== null ? round2((labourBudget * pct) / 100) : null;
    return { activityId: row.activityId, name: row.name, code: row.code, hours: row.hours, overtimeHours: row.overtimeHours, cost: row.cost, workers: row.workers.size, days: row.days.size, hoursPerDay: row.days.size ? round2(row.hours / row.days.size) : 0, pctComplete: pct, labourBudget, earnedLabour, labourBurnPct: labourBudget ? round2((row.cost / labourBudget) * 100) : null, costPerPct: pct ? round2(row.cost / pct) : null, hoursPerPct: pct ? round2(row.hours / pct) : null, warning: labourBudget !== null && earnedLabour !== null && row.cost > earnedLabour ? "labour cost ahead of progress" : null };
  });
  items.sort((a, b) => b.hours - a.hours);
  return { items, totals: { hours: round2(items.reduce((sum, row) => sum + row.hours, 0)), cost: round2(items.reduce((sum, row) => sum + row.cost, 0)), activities: items.length, warnings: items.filter((row) => row.warning).length } };
};

const exportTimesheets = async ({ orgId, projectId, query = {}, viewer = null }) => {
  const where = { orgId, projectId };
  if (query.from || query.to) where.date = { ...(query.from ? { gte: toDateOnly(query.from) } : {}), ...(query.to ? { lte: toDateOnly(query.to) } : {}) };
  if (query.status) where.status = query.status;
  const scope = visibilityWhere(viewer);
  if (scope) Object.assign(where, scope);
  const sheets = await prisma.timesheet.findMany({ where, include: timesheetInclude, orderBy: { date: "asc" } });
  const workbook = new ExcelJS.Workbook();
  const entries = workbook.addWorksheet("Entries");
  entries.columns = [
    { header: "Date", key: "date", width: 12 },
    { header: "Crew", key: "crew", width: 18 },
    { header: "Worker", key: "worker", width: 24 },
    { header: "Company", key: "company", width: 20 },
    { header: "Trade", key: "trade", width: 16 },
    { header: "Activity", key: "activity", width: 32 },
    { header: "Cost code", key: "costCode", width: 16 },
    { header: "Location", key: "location", width: 18 },
    { header: "Type", key: "type", width: 10 },
    { header: "Hours", key: "hours", width: 8 },
    { header: "Rate", key: "rate", width: 10 },
    { header: "Amount", key: "amount", width: 12 },
    { header: "Status", key: "status", width: 11 },
    { header: "Notes", key: "notes", width: 30 },
  ];
  const byWorker = new Map();
  for (const sheet of sheets) {
    for (const entry of sheet.entries) {
      entries.addRow({ date: dateKey(sheet.date), crew: sheet.crew?.name || "", worker: entry.worker?.name || "", company: entry.worker?.company?.name || "", trade: entry.worker?.trade || "", activity: entry.activity ? `${entry.activity.activityCode || entry.activity.wbsCode || ""} ${entry.activity.name}`.trim() : "", costCode: entry.costCode ? `${entry.costCode.code} ${entry.costCode.name}` : "", location: entry.location?.name || "", type: entry.timeType, hours: toNumber(entry.hours), rate: money(entry.rate) ?? "", amount: money(entry.amount) || 0, status: sheet.status, notes: entry.notes || "" });
      const key = entry.workerId;
      const row = byWorker.get(key) || { worker: entry.worker?.name || "", company: entry.worker?.company?.name || "", trade: entry.worker?.trade || "", regular: 0, overtime: 0, amount: 0 };
      if (entry.timeType === "regular") row.regular = round2(row.regular + toNumber(entry.hours));
      else row.overtime = round2(row.overtime + toNumber(entry.hours));
      row.amount = round2(row.amount + toNumber(entry.amount));
      byWorker.set(key, row);
    }
  }
  const summary = workbook.addWorksheet("By worker");
  summary.columns = [
    { header: "Worker", key: "worker", width: 24 },
    { header: "Company", key: "company", width: 20 },
    { header: "Trade", key: "trade", width: 16 },
    { header: "Regular h", key: "regular", width: 10 },
    { header: "Overtime h", key: "overtime", width: 10 },
    { header: "Amount", key: "amount", width: 12 },
  ];
  for (const row of [...byWorker.values()].sort((a, b) => a.worker.localeCompare(b.worker))) summary.addRow(row);
  const about = workbook.addWorksheet("About");
  about.addRow(["From", query.from || ""]);
  about.addRow(["To", query.to || ""]);
  about.addRow(["Timesheets", sheets.length]);
  about.addRow(["Generated", new Date().toISOString()]);
  brandWorkbook(workbook, { title: "Timesheets" });
  const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
  return { buffer, fileName: `timesheets-${query.from || "all"}-${query.to || "all"}.xlsx`, mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", rows: entries.rowCount - 1 };
};

module.exports = { STATUS, TIME_TYPES, RATE_MAX, toDateOnly, multiplierFor, normalizeWorker, listWorkers, createWorker, updateWorker, importWorkers, listCrews, createCrew, updateCrew, deleteCrew, listTimesheets, getTimesheet, createTimesheet, updateTimesheet, deleteTimesheet, submitTimesheet, approveTimesheet, rejectTimesheet, reopenTimesheet, weekSummary, productivity, exportTimesheets };
