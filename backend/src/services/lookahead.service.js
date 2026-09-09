const ExcelJS = require("exceljs");
const { brandWorkbook } = require("../utils/export-branding");
const { prisma } = require("../config/db");
const { HttpError } = require("../utils/http-error");
const { recordWorkspacePath } = require("../utils/record-links");
const auditService = require("./audit.service");
const notificationService = require("./notification.service");
const { isPartyScopedAccess } = require("./company-party.service");
const { isWorkingDate, workingDayToDate } = require("./cpm.service");
const { nextNumber } = require("../utils/reference-number");

/**
 * Lookaheads (OCTA-SCH-LOOKAHEAD-041): short-interval plans.
 *
 *  - A lookahead is a 2–6 week window starting on a week boundary. Creating
 *    one SEEDS it with every active, unfinished activity of the master
 *    schedule whose planned window (actual start / early dates / planned
 *    dates) touches the window, optionally narrowed by WBS prefix, phase,
 *    critical-only or an explicit activity list.
 *  - Items keep the schedule's dates next to the planned dates the site
 *    commits to; edited dates survive a refresh, unedited ones follow the
 *    schedule. Tasks can be added by hand (no activity) and carried from the
 *    previous lookahead when rolling forward.
 *  - Each item can carry a constraint to clear (open → cleared) with an
 *    owner and a due date; the project's open constraints form the
 *    make-ready log.
 *  - Status: planned → in_progress → done, or not_done with a variance
 *    reason. Weekly PPC = done ÷ committed for items due in that week.
 *  - Party users (owner / consultant / subcontractor) see published and
 *    archived lookaheads plus their own; subcontractors may only update
 *    their company's items.
 */

const STATUS = Object.freeze({ DRAFT: "draft", PUBLISHED: "published", ARCHIVED: "archived" });
const ITEM_STATUS = Object.freeze({ PLANNED: "planned", IN_PROGRESS: "in_progress", DONE: "done", NOT_DONE: "not_done", REMOVED: "removed" });
const LIVE_ITEM_STATUSES = Object.freeze([ITEM_STATUS.PLANNED, ITEM_STATUS.IN_PROGRESS, ITEM_STATUS.DONE, ITEM_STATUS.NOT_DONE]);
const CONSTRAINT_STATUSES = Object.freeze(["none", "open", "cleared"]);
const VARIANCE_REASONS = Object.freeze(["design", "material", "labour", "equipment", "weather", "prerequisite", "permit", "space", "other"]);
const VARIANCE_LABEL = Object.freeze({ design: "Design / information", material: "Material", labour: "Labour", equipment: "Equipment", weather: "Weather", prerequisite: "Prerequisite work", permit: "Permit / approval", space: "Space / access", other: "Other" });
const SOURCES = Object.freeze(["schedule", "added", "carried"]);
const WEEK_OPTIONS = Object.freeze([2, 3, 4, 5, 6]);
const DAY_MS = 86_400_000;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// ─── Helpers ──────────────────────────────────────────────────────────────

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
const round1 = (value) => Math.round(toNumber(value) * 10) / 10;
const uniqueIds = (values) => [...new Set((values || []).filter(Boolean))];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const startOfUtcDay = (value) => {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
};
const toDateOnly = (value, field, { required = false } = {}) => {
  if (value === null || value === undefined || value === "") {
    if (required) throw new HttpError(400, "LOOKAHEAD_DATE_REQUIRED", `${field} is required`);
    return null;
  }
  const text = String(value).slice(0, 10);
  const date = DATE_RE.test(text) ? new Date(`${text}T00:00:00.000Z`) : new Date(value);
  if (Number.isNaN(date.getTime())) throw new HttpError(400, "LOOKAHEAD_DATE_INVALID", `${field} is not a valid date`);
  return startOfUtcDay(date);
};
const dateKey = (value) => (value ? new Date(value).toISOString().slice(0, 10) : null);
const addDays = (date, days) => new Date(date.getTime() + days * DAY_MS);
const todayUtc = () => startOfUtcDay(new Date());
const startOfWeek = (date, weekStartDay) => addDays(date, -((date.getUTCDay() - weekStartDay + 7) % 7));
const daysBetween = (from, to) => (from && to ? Math.round((startOfUtcDay(to).getTime() - startOfUtcDay(from).getTime()) / DAY_MS) : null);
const fmtDay = (date) => `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]}`;
const later = (a, b) => (a.getTime() >= b.getTime() ? a : b);

// ─── Visibility ───────────────────────────────────────────────────────────

const companyIdsFor = (viewer) => uniqueIds((viewer?.projectAccess?.partyAccess || []).map((party) => party.companyId));
const scoped = (viewer) => Boolean(viewer && isPartyScopedAccess(viewer.projectAccess || {}));
/** Party users see published and archived lookaheads, plus the ones they created. */
const visibilityWhere = (viewer) => (scoped(viewer) ? { OR: [{ status: { in: [STATUS.PUBLISHED, STATUS.ARCHIVED] } }, ...(viewer.id ? [{ createdBy: viewer.id }] : [])] } : null);
const assertVisible = (row, viewer) => {
  if (!scoped(viewer)) return;
  if ([STATUS.PUBLISHED, STATUS.ARCHIVED].includes(row.status) || (viewer.id && row.createdBy === viewer.id)) return;
  throw new HttpError(404, "LOOKAHEAD_NOT_FOUND", "Lookahead not found");
};
const assertItemEditable = (item, viewer) => {
  if (!scoped(viewer)) return;
  const companies = companyIdsFor(viewer);
  if (item.companyId && companies.includes(item.companyId)) return;
  if (item.crew?.companyId && companies.includes(item.crew.companyId)) return;
  if (viewer.id && item.createdBy === viewer.id) return;
  throw new HttpError(403, "LOOKAHEAD_ITEM_FORBIDDEN", "You can only update your own company's tasks");
};

// ─── Windows, grid and PPC ────────────────────────────────────────────────

const windowOf = (row) => {
  const start = startOfUtcDay(row.startDate);
  return { start, end: addDays(start, toNumber(row.weeks, 3) * 7 - 1) };
};
const weeksOf = (row) => {
  const { start } = windowOf(row);
  return Array.from({ length: toNumber(row.weeks, 3) }, (_, index) => {
    const weekStart = addDays(start, index * 7);
    return { index: index + 1, start: weekStart, end: addDays(weekStart, 6) };
  });
};

const gridFor = (row, project, today = todayUtc()) => {
  const calendar = { calendarId: project?.projectCalendar, projectCalendar: project?.projectCalendar };
  return weeksOf(row).map((week) => ({
    index: week.index,
    start: dateKey(week.start),
    end: dateKey(week.end),
    label: `Week ${week.index} · ${fmtDay(week.start)} – ${fmtDay(week.end)}`,
    closed: week.end.getTime() < today.getTime(),
    current: week.start.getTime() <= today.getTime() && today.getTime() <= week.end.getTime(),
    days: Array.from({ length: 7 }, (_, offset) => {
      const date = addDays(week.start, offset);
      return { date: dateKey(date), dow: date.getUTCDay(), label: DAYS[date.getUTCDay()], working: isWorkingDate(date, calendar), isToday: date.getTime() === today.getTime() };
    }),
  }));
};

/** Percent plan complete per week: items due in the week that are done ÷ items due in the week. */
const computePpc = (items, row, today = todayUtc()) => {
  const live = items.filter((item) => item.status !== ITEM_STATUS.REMOVED);
  const weeks = weeksOf(row).map((week) => {
    const committed = live.filter((item) => {
      const finish = startOfUtcDay(item.plannedFinish);
      return finish && finish.getTime() >= week.start.getTime() && finish.getTime() <= week.end.getTime();
    });
    const completed = committed.filter((item) => item.status === ITEM_STATUS.DONE).length;
    const notDone = committed.filter((item) => item.status === ITEM_STATUS.NOT_DONE).length;
    return { week: week.index, start: dateKey(week.start), end: dateKey(week.end), closed: week.end.getTime() < today.getTime(), committed: committed.length, completed, notDone, ppc: committed.length ? round1((completed / committed.length) * 100) : null };
  });
  const closed = weeks.filter((week) => week.closed);
  const committed = closed.reduce((sum, week) => sum + week.committed, 0);
  const completed = closed.reduce((sum, week) => sum + week.completed, 0);
  const varianceReasons = {};
  live.filter((item) => item.status === ITEM_STATUS.NOT_DONE).forEach((item) => {
    const key = item.varianceReason || "other";
    varianceReasons[key] = (varianceReasons[key] || 0) + 1;
  });
  return { weeks, closedWeeks: closed.length, committed, completed, ppc: committed ? round1((completed / committed) * 100) : null, varianceReasons };
};

const summarize = (items = [], row, today = todayUtc()) => {
  const live = items.filter((item) => item.status !== ITEM_STATUS.REMOVED);
  const byStatus = Object.fromEntries(LIVE_ITEM_STATUSES.map((status) => [status, live.filter((item) => item.status === status).length]));
  const open = live.filter((item) => item.constraintStatus === "open");
  const overdue = open.filter((item) => item.constraintDueDate && startOfUtcDay(item.constraintDueDate).getTime() < today.getTime());
  const behind = live.filter((item) => [ITEM_STATUS.PLANNED, ITEM_STATUS.IN_PROGRESS].includes(item.status) && startOfUtcDay(item.plannedFinish).getTime() < today.getTime()).length;
  return { items: live.length, byStatus, openConstraints: open.length, overdueConstraints: overdue.length, behind, ppc: computePpc(items, row, today) };
};

// ─── Serialisers ──────────────────────────────────────────────────────────

const activityOut = (activity) => (activity ? { id: activity.id, name: activity.name, code: activity.activityCode || activity.p6ActivityId || null, wbsCode: activity.wbsCode || null, isCritical: Boolean(activity.isCritical), isMilestone: Boolean(activity.isMilestone), totalFloat: activity.totalFloat ?? null } : null);

const itemOut = (row, { today = todayUtc() } = {}) => ({
  id: row.id,
  lookaheadId: row.lookaheadId,
  activityId: row.activityId || null,
  activity: activityOut(row.activity),
  source: row.source,
  name: row.name,
  wbsCode: row.wbsCode || null,
  plannedStart: dateKey(row.plannedStart),
  plannedFinish: dateKey(row.plannedFinish),
  scheduleStart: dateKey(row.scheduleStart),
  scheduleFinish: dateKey(row.scheduleFinish),
  datesEdited: Boolean(row.datesEdited),
  driftDays: daysBetween(row.scheduleFinish, row.plannedFinish),
  crewId: row.crewId || null,
  crew: row.crew ? { id: row.crew.id, name: row.crew.name, companyId: row.crew.companyId || null } : null,
  companyId: row.companyId || null,
  assigneeUserId: row.assigneeUserId || null,
  locationId: row.locationId || null,
  location: row.location ? { id: row.location.id, name: row.location.name, code: row.location.code || null } : null,
  quantity: row.quantity ?? null,
  unit: row.unit || null,
  status: row.status,
  pctComplete: toNumber(row.pctComplete),
  varianceReason: row.varianceReason || null,
  constraint: row.constraint || null,
  constraintStatus: row.constraintStatus || "none",
  constraintOwnerUserId: row.constraintOwnerUserId || null,
  constraintDueDate: dateKey(row.constraintDueDate),
  constraintClearedAt: toIso(row.constraintClearedAt),
  constraintOverdue: row.constraintStatus === "open" && Boolean(row.constraintDueDate) && startOfUtcDay(row.constraintDueDate).getTime() < today.getTime(),
  behind: [ITEM_STATUS.PLANNED, ITEM_STATUS.IN_PROGRESS].includes(row.status) && startOfUtcDay(row.plannedFinish).getTime() < today.getTime(),
  notes: row.notes || null,
  sortOrder: row.sortOrder,
  carriedFromItemId: row.carriedFromItemId || null,
  createdBy: row.createdBy || null,
  createdAt: toIso(row.createdAt),
  updatedAt: toIso(row.updatedAt),
});

const lookaheadOut = (row, { detail = false, project = null, today = todayUtc() } = {}) => {
  const window = windowOf(row);
  const items = row.items || [];
  return {
    id: row.id,
    projectId: row.projectId,
    number: row.number,
    ref: row.ref,
    title: row.title,
    startDate: dateKey(window.start),
    endDate: dateKey(window.end),
    weeks: row.weeks,
    weekStartDay: row.weekStartDay,
    status: row.status,
    filter: normalizeFilter(row.filterJson),
    notes: row.notes || null,
    publishedBy: row.publishedBy || null,
    publishedAt: toIso(row.publishedAt),
    archivedBy: row.archivedBy || null,
    archivedAt: toIso(row.archivedAt),
    refreshedAt: toIso(row.refreshedAt),
    rolledFromId: row.rolledFromId || null,
    current: window.start.getTime() <= today.getTime() && today.getTime() <= window.end.getTime(),
    summary: summarize(items, row, today),
    grid: detail ? gridFor(row, project, today) : undefined,
    items: detail ? items.filter((item) => item.status !== ITEM_STATUS.REMOVED).map((item) => itemOut(item, { today })) : undefined,
    path: recordWorkspacePath({ projectId: row.projectId, recordType: "lookahead", recordId: row.id }),
    createdBy: row.createdBy || null,
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
  };
};

// ─── Loading ──────────────────────────────────────────────────────────────

const itemInclude = {
  activity: { select: { id: true, name: true, activityCode: true, p6ActivityId: true, wbsCode: true, isCritical: true, isMilestone: true, totalFloat: true } },
  crew: { select: { id: true, name: true, companyId: true, foremanUserId: true } },
  location: { select: { id: true, name: true, code: true } },
};
const detailInclude = { items: { include: itemInclude, orderBy: [{ sortOrder: "asc" }, { plannedStart: "asc" }, { createdAt: "asc" }] } };
const listItemSelect = { select: { id: true, status: true, plannedFinish: true, constraintStatus: true, constraintDueDate: true, varianceReason: true } };

const ensureProject = async ({ orgId, projectId }) => {
  const project = await prisma.project.findFirst({ where: { id: projectId, orgId }, select: { id: true, name: true, startDate: true, endDate: true, dataDate: true, projectCalendar: true, currency: true, timezone: true } });
  if (!project) throw new HttpError(404, "PROJECT_NOT_FOUND", "Project not found");
  return project;
};

const load = async ({ orgId, projectId, lookaheadId, tx = prisma, include = detailInclude }) => {
  const row = await tx.lookahead.findFirst({ where: { id: lookaheadId, orgId, projectId }, include });
  if (!row) throw new HttpError(404, "LOOKAHEAD_NOT_FOUND", "Lookahead not found");
  return row;
};

const loadActivities = (projectId, tx = prisma) => tx.activity.findMany({ where: { projectId, isActive: true }, include: { progress: { where: { status: "approved" }, orderBy: { updatedAt: "desc" }, take: 1 } }, orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] });

/** The dates the schedule holds for an activity: actuals first, then the CPM early dates, then the planned dates. */
const activityWindow = (activity, project) => {
  const options = { calendarId: activity.calendarId || project.projectCalendar, projectCalendar: project.projectCalendar };
  const fromDay = (day) => (project.startDate && day !== null && day !== undefined ? workingDayToDate(project.startDate, day, options) : null);
  const progress = Array.isArray(activity.progress) ? activity.progress[0] || null : null;
  const pct = Math.min(100, Math.max(0, toNumber(progress?.pctComplete ?? activity.physComplete ?? 0)));
  let start = fromDay(activity.earlyStart) || startOfUtcDay(activity.startDate);
  let finish = fromDay(activity.earlyFinish) || startOfUtcDay(activity.endDate);
  if (progress?.actualStart) start = startOfUtcDay(progress.actualStart);
  if (progress?.actualFinish) finish = startOfUtcDay(progress.actualFinish);
  if (!start && finish) start = finish;
  if (start && !finish) finish = start;
  if (start && finish && finish.getTime() < start.getTime()) finish = start;
  return { start, finish, pct, complete: pct >= 100 || Boolean(progress?.actualFinish) };
};
const activityWindows = (activities, project) => new Map(activities.map((activity) => [activity.id, { activity, ...activityWindow(activity, project) }]));

const normalizeFilter = (raw) => {
  const source = raw && typeof raw === "object" ? raw : {};
  const list = (value) => (Array.isArray(value) ? uniqueIds(value.map((item) => trimOrNull(item))) : []);
  return { wbsPrefixes: list(source.wbsPrefixes), categories: list(source.categories), activityIds: list(source.activityIds), onlyCritical: Boolean(source.onlyCritical) };
};

/** Master-schedule activities that belong in the window, as item rows. */
const candidateRows = ({ lookahead, windows, exclude = new Set() }) => {
  const window = windowOf(lookahead);
  const filter = normalizeFilter(lookahead.filterJson);
  const rows = [];
  let index = 0;
  for (const { activity, start, finish, pct, complete } of windows.values()) {
    index += 1;
    if (exclude.has(activity.id) || !start || !finish || complete) continue;
    if (finish.getTime() < window.start.getTime() || start.getTime() > window.end.getTime()) continue;
    if (filter.onlyCritical && !activity.isCritical) continue;
    if (filter.wbsPrefixes.length && !filter.wbsPrefixes.some((prefix) => String(activity.wbsCode || "").startsWith(prefix))) continue;
    if (filter.categories.length && !filter.categories.includes(activity.category)) continue;
    if (filter.activityIds.length && !filter.activityIds.includes(activity.id)) continue;
    rows.push({ activityId: activity.id, name: activity.name, wbsCode: activity.wbsCode || null, plannedStart: start, plannedFinish: finish, scheduleStart: start, scheduleFinish: finish, pctComplete: pct, status: pct > 0 ? ITEM_STATUS.IN_PROGRESS : ITEM_STATUS.PLANNED, sortOrder: index });
  }
  return rows;
};

const seedRow = ({ orgId, projectId, lookaheadId, row, sortOrder, actor }) => ({ orgId, projectId, lookaheadId, activityId: row.activityId, source: "schedule", name: row.name, wbsCode: row.wbsCode, plannedStart: row.plannedStart, plannedFinish: row.plannedFinish, scheduleStart: row.scheduleStart, scheduleFinish: row.scheduleFinish, pctComplete: row.pctComplete, status: row.status, sortOrder, createdBy: actor?.id || null });

// ─── Header normalisation ─────────────────────────────────────────────────

const normalizeHeader = ({ payload = {}, existing = null }) => {
  const pick = (key, fallback = null) => (payload[key] !== undefined ? payload[key] : existing ? existing[key] : fallback);
  const weeks = Math.round(toNumber(pick("weeks", 3), 3));
  if (!WEEK_OPTIONS.includes(weeks)) throw new HttpError(400, "LOOKAHEAD_WEEKS_INVALID", `Weeks must be one of ${WEEK_OPTIONS.join(", ")}`);
  const weekStartDay = Math.round(toNumber(pick("weekStartDay", 1), 1));
  if (weekStartDay < 0 || weekStartDay > 6) throw new HttpError(400, "LOOKAHEAD_WEEK_START_INVALID", "Week start day must be 0 (Sunday) to 6 (Saturday)");
  const rawStart = toDateOnly(pick("startDate"), "startDate", { required: true });
  const startDate = startOfWeek(rawStart, weekStartDay);
  const title = trimOrNull(pick("title")) || `${weeks}-week lookahead from ${fmtDay(startDate)}`;
  const filterJson = normalizeFilter(payload.filter !== undefined ? payload.filter : existing?.filterJson);
  return { weeks, weekStartDay, startDate, title, notes: trimOrNull(pick("notes")), filterJson };
};

// ─── Lookaheads ───────────────────────────────────────────────────────────

const listLookaheads = async ({ orgId, projectId, query = {}, viewer = null }) => {
  await ensureProject({ orgId, projectId });
  const where = { projectId, orgId };
  if (query.status) where.status = query.status;
  const scope = visibilityWhere(viewer);
  if (scope) Object.assign(where, scope);
  const rows = await prisma.lookahead.findMany({ where, include: { items: listItemSelect }, orderBy: [{ startDate: "desc" }, { number: "desc" }] });
  const today = todayUtc();
  const items = rows.map((row) => lookaheadOut(row, { today }));
  const current = items.find((item) => item.status === STATUS.PUBLISHED && item.current) || items.find((item) => item.current) || null;
  return { items, summary: { count: items.length, byStatus: Object.fromEntries(Object.values(STATUS).map((status) => [status, items.filter((item) => item.status === status).length])), currentId: current?.id || null, openConstraints: items.reduce((sum, item) => sum + item.summary.openConstraints, 0) } };
};

const getLookahead = async ({ orgId, projectId, lookaheadId, viewer = null }) => {
  const project = await ensureProject({ orgId, projectId });
  const row = await load({ orgId, projectId, lookaheadId });
  assertVisible(row, viewer);
  return lookaheadOut(row, { detail: true, project });
};

const createLookahead = async ({ orgId, projectId, payload = {}, actor = null }) => {
  const project = await ensureProject({ orgId, projectId });
  const header = normalizeHeader({ payload });
  const created = await prisma.$transaction(async (tx) => {
    const number = await nextNumber(tx, { table: "Lookahead", scope: { projectId } });
    const row = await tx.lookahead.create({ data: { orgId, projectId, number, ref: `LA-${String(number).padStart(3, "0")}`, ...header, status: STATUS.DRAFT, createdBy: actor?.id || null, updatedBy: actor?.id || null } });
    let seeded = 0;
    if (payload.seed !== false) {
      const windows = activityWindows(await loadActivities(projectId, tx), project);
      const rows = candidateRows({ lookahead: row, windows });
      if (rows.length) await tx.lookaheadItem.createMany({ data: rows.map((item, index) => seedRow({ orgId, projectId, lookaheadId: row.id, row: item, sortOrder: index, actor })) });
      seeded = rows.length;
      await tx.lookahead.update({ where: { id: row.id }, data: { refreshedAt: new Date() } });
    }
    return { ...row, seeded };
  });
  await auditService.recordEvent({ orgId, projectId, entityType: "lookahead", entityId: created.id, action: auditService.ACTIONS.CREATED, actorId: actor?.id || null, summary: { ref: created.ref, title: created.title, weeks: created.weeks, startDate: dateKey(created.startDate), seeded: created.seeded } }).catch(() => null);
  return getLookahead({ orgId, projectId, lookaheadId: created.id });
};

const updateLookahead = async ({ orgId, projectId, lookaheadId, payload = {}, actor = null }) => {
  await ensureProject({ orgId, projectId });
  const existing = await load({ orgId, projectId, lookaheadId, include: undefined });
  if (existing.status === STATUS.ARCHIVED) throw new HttpError(409, "LOOKAHEAD_LOCKED", "An archived lookahead cannot be edited");
  const header = normalizeHeader({ payload, existing });
  await prisma.lookahead.update({ where: { id: lookaheadId }, data: { ...header, updatedBy: actor?.id || null } });
  await auditService.recordEvent({ orgId, projectId, entityType: "lookahead", entityId: lookaheadId, action: auditService.ACTIONS.UPDATED, actorId: actor?.id || null, summary: { ref: existing.ref, title: header.title, weeks: header.weeks, startDate: dateKey(header.startDate) } }).catch(() => null);
  return getLookahead({ orgId, projectId, lookaheadId });
};

const deleteLookahead = async ({ orgId, projectId, lookaheadId, actor = null }) => {
  const existing = await load({ orgId, projectId, lookaheadId, include: undefined });
  if (existing.status !== STATUS.DRAFT) throw new HttpError(409, "LOOKAHEAD_NOT_DRAFT", "Only draft lookaheads can be deleted — archive it instead");
  await prisma.lookahead.delete({ where: { id: lookaheadId } });
  await auditService.recordEvent({ orgId, projectId, entityType: "lookahead", entityId: lookaheadId, action: auditService.ACTIONS.DELETED, actorId: actor?.id || null, summary: { ref: existing.ref } }).catch(() => null);
  return { deleted: true };
};

/** Adds newly due activities, follows the schedule's dates on unedited items and completes items whose activity is finished. */
const refreshFromSchedule = async ({ orgId, projectId, lookaheadId, actor = null }) => {
  const project = await ensureProject({ orgId, projectId });
  const existing = await load({ orgId, projectId, lookaheadId });
  if (existing.status === STATUS.ARCHIVED) throw new HttpError(409, "LOOKAHEAD_LOCKED", "An archived lookahead cannot be refreshed");
  const windows = activityWindows(await loadActivities(projectId), project);
  const byActivity = new Map(existing.items.filter((item) => item.activityId).map((item) => [item.activityId, item]));
  const creates = [];
  const updates = [];
  let completed = 0;
  let nextSort = existing.items.reduce((max, item) => Math.max(max, toNumber(item.sortOrder)), -1) + 1;
  for (const row of candidateRows({ lookahead: existing, windows })) {
    const item = byActivity.get(row.activityId);
    if (!item) {
      creates.push(seedRow({ orgId, projectId, lookaheadId, row, sortOrder: nextSort, actor }));
      nextSort += 1;
      continue;
    }
    if (item.status === ITEM_STATUS.REMOVED) continue;
    const data = {};
    if (dateKey(item.scheduleStart) !== dateKey(row.scheduleStart)) data.scheduleStart = row.scheduleStart;
    if (dateKey(item.scheduleFinish) !== dateKey(row.scheduleFinish)) data.scheduleFinish = row.scheduleFinish;
    if (!item.datesEdited) {
      if (dateKey(item.plannedStart) !== dateKey(row.plannedStart)) data.plannedStart = row.plannedStart;
      if (dateKey(item.plannedFinish) !== dateKey(row.plannedFinish)) data.plannedFinish = row.plannedFinish;
    }
    if ([ITEM_STATUS.PLANNED, ITEM_STATUS.IN_PROGRESS].includes(item.status) && row.pctComplete > toNumber(item.pctComplete)) {
      data.pctComplete = row.pctComplete;
      if (item.status === ITEM_STATUS.PLANNED) data.status = ITEM_STATUS.IN_PROGRESS;
    }
    if (Object.keys(data).length) updates.push({ id: item.id, data });
  }
  for (const item of existing.items) {
    if (!item.activityId || [ITEM_STATUS.DONE, ITEM_STATUS.REMOVED].includes(item.status)) continue;
    if (windows.get(item.activityId)?.complete) {
      updates.push({ id: item.id, data: { status: ITEM_STATUS.DONE, pctComplete: 100, varianceReason: null } });
      completed += 1;
    }
  }
  await prisma.$transaction(async (tx) => {
    if (creates.length) await tx.lookaheadItem.createMany({ data: creates });
    for (const update of updates) await tx.lookaheadItem.update({ where: { id: update.id }, data: { ...update.data, updatedBy: actor?.id || null } });
    await tx.lookahead.update({ where: { id: lookaheadId }, data: { refreshedAt: new Date(), updatedBy: actor?.id || null } });
  });
  const result = { added: creates.length, updated: updates.length - completed, completed };
  await auditService.recordEvent({ orgId, projectId, entityType: "lookahead", entityId: lookaheadId, action: auditService.ACTIONS.UPDATED, actorId: actor?.id || null, summary: { ref: existing.ref, refresh: result } }).catch(() => null);
  return { ...result, lookahead: await getLookahead({ orgId, projectId, lookaheadId }) };
};

// ─── Workflow ─────────────────────────────────────────────────────────────

const notify = ({ orgId, projectId, row, actor, event, title, message, recipientUserIds = [], recipientRoles = [] }) =>
  notificationService
    .createNotifications({ orgId, projectId, actorId: actor?.id || null, recipientUserIds: uniqueIds(recipientUserIds), recipientRoles, type: "lookahead", category: notificationService.NOTIFICATION_CATEGORIES.ASSIGNMENT, event, title, message, actionUrl: recordWorkspacePath({ projectId, recordType: "lookahead", recordId: row.id }), entityType: "lookahead", entityId: row.id, dedupeKeyBase: `lookahead:${row.id}:${event}:${Date.now()}`, metadata: { ref: row.ref, status: row.status, startDate: dateKey(row.startDate), weeks: row.weeks } })
    .catch(() => null);

const publishLookahead = async ({ orgId, projectId, lookaheadId, actor = null }) => {
  await ensureProject({ orgId, projectId });
  const existing = await load({ orgId, projectId, lookaheadId });
  if (existing.status !== STATUS.DRAFT) throw new HttpError(409, "LOOKAHEAD_NOT_DRAFT", `A ${existing.status} lookahead cannot be published`);
  const live = existing.items.filter((item) => item.status !== ITEM_STATUS.REMOVED);
  if (!live.length) throw new HttpError(400, "LOOKAHEAD_EMPTY", "Add at least one task before publishing");
  const row = await prisma.lookahead.update({ where: { id: lookaheadId }, data: { status: STATUS.PUBLISHED, publishedBy: actor?.id || null, publishedAt: new Date(), updatedBy: actor?.id || null } });
  await auditService.recordEvent({ orgId, projectId, entityType: "lookahead", entityId: lookaheadId, action: auditService.ACTIONS.STATUS_CHANGED, actorId: actor?.id || null, summary: { ref: row.ref, from: STATUS.DRAFT, to: STATUS.PUBLISHED, items: live.length } }).catch(() => null);
  const window = windowOf(row);
  await notify({ orgId, projectId, row, actor, event: "lookahead.published", title: `${row.ref} published — ${row.title}`, message: `${live.length} task${live.length === 1 ? "" : "s"} planned ${fmtDay(window.start)} – ${fmtDay(window.end)}.`, recipientRoles: ["pm", "planning_eng", "site_engineer"], recipientUserIds: [...live.map((item) => item.assigneeUserId), ...live.map((item) => item.crew?.foremanUserId), ...live.map((item) => item.constraintOwnerUserId)] });
  return getLookahead({ orgId, projectId, lookaheadId });
};

const archiveLookahead = async ({ orgId, projectId, lookaheadId, actor = null }) => {
  await ensureProject({ orgId, projectId });
  const existing = await load({ orgId, projectId, lookaheadId, include: undefined });
  if (existing.status === STATUS.ARCHIVED) throw new HttpError(409, "LOOKAHEAD_LOCKED", "Already archived");
  const row = await prisma.lookahead.update({ where: { id: lookaheadId }, data: { status: STATUS.ARCHIVED, archivedBy: actor?.id || null, archivedAt: new Date(), updatedBy: actor?.id || null } });
  await auditService.recordEvent({ orgId, projectId, entityType: "lookahead", entityId: lookaheadId, action: auditService.ACTIONS.ARCHIVED, actorId: actor?.id || null, summary: { ref: row.ref, from: existing.status, to: STATUS.ARCHIVED } }).catch(() => null);
  return getLookahead({ orgId, projectId, lookaheadId });
};

/** A new lookahead one week later (by default) carrying the unfinished tasks, then seeded from the schedule. */
const rollForward = async ({ orgId, projectId, lookaheadId, payload = {}, actor = null }) => {
  const project = await ensureProject({ orgId, projectId });
  const source = await load({ orgId, projectId, lookaheadId });
  if (source.status === STATUS.ARCHIVED) throw new HttpError(409, "LOOKAHEAD_LOCKED", "An archived lookahead cannot be rolled forward");
  const startDate = payload.startDate ? toDateOnly(payload.startDate, "startDate") : addDays(startOfUtcDay(source.startDate), 7);
  const header = normalizeHeader({ payload: { startDate, weeks: payload.weeks ?? source.weeks, weekStartDay: source.weekStartDay, title: payload.title, notes: payload.notes ?? source.notes, filter: source.filterJson } });
  const window = { start: header.startDate, end: addDays(header.startDate, header.weeks * 7 - 1) };
  const carried = source.items.filter((item) => [ITEM_STATUS.PLANNED, ITEM_STATUS.IN_PROGRESS, ITEM_STATUS.NOT_DONE].includes(item.status)).filter((item) => item.status === ITEM_STATUS.NOT_DONE || startOfUtcDay(item.plannedFinish).getTime() >= window.start.getTime());
  const created = await prisma.$transaction(async (tx) => {
    const number = await nextNumber(tx, { table: "Lookahead", scope: { projectId } });
    const row = await tx.lookahead.create({ data: { orgId, projectId, number, ref: `LA-${String(number).padStart(3, "0")}`, ...header, status: STATUS.DRAFT, rolledFromId: source.id, createdBy: actor?.id || null, updatedBy: actor?.id || null } });
    const carriedRows = carried.map((item, index) => {
      const notDone = item.status === ITEM_STATUS.NOT_DONE;
      const plannedStart = notDone ? window.start : later(startOfUtcDay(item.plannedStart), window.start);
      const plannedFinish = later(startOfUtcDay(item.plannedFinish), plannedStart);
      const carryNote = notDone ? `Carried from ${source.ref} — not done (${VARIANCE_LABEL[item.varianceReason] || "no reason"})` : `Carried from ${source.ref}`;
      return { orgId, projectId, lookaheadId: row.id, activityId: item.activityId || null, source: "carried", name: item.name, wbsCode: item.wbsCode, plannedStart, plannedFinish, scheduleStart: item.scheduleStart, scheduleFinish: item.scheduleFinish, datesEdited: Boolean(item.datesEdited) || notDone, crewId: item.crewId, companyId: item.companyId, assigneeUserId: item.assigneeUserId, locationId: item.locationId, quantity: item.quantity, unit: item.unit, status: notDone ? ITEM_STATUS.PLANNED : item.status, pctComplete: item.pctComplete, varianceReason: null, constraint: item.constraintStatus === "open" ? item.constraint : null, constraintStatus: item.constraintStatus === "open" ? "open" : "none", constraintOwnerUserId: item.constraintStatus === "open" ? item.constraintOwnerUserId : null, constraintDueDate: item.constraintStatus === "open" ? item.constraintDueDate : null, notes: [carryNote, item.notes].filter(Boolean).join(" · "), sortOrder: index, carriedFromItemId: item.id, createdBy: actor?.id || null };
    });
    if (carriedRows.length) await tx.lookaheadItem.createMany({ data: carriedRows });
    // Activities the previous lookahead already settled (done, removed) or carried are not seeded again.
    const windows = activityWindows(await loadActivities(projectId, tx), project);
    const seeded = candidateRows({ lookahead: row, windows, exclude: new Set(source.items.map((item) => item.activityId).filter(Boolean)) });
    if (seeded.length) await tx.lookaheadItem.createMany({ data: seeded.map((item, index) => seedRow({ orgId, projectId, lookaheadId: row.id, row: item, sortOrder: carriedRows.length + index, actor })) });
    await tx.lookahead.update({ where: { id: row.id }, data: { refreshedAt: new Date() } });
    if (payload.archiveSource) await tx.lookahead.update({ where: { id: source.id }, data: { status: STATUS.ARCHIVED, archivedBy: actor?.id || null, archivedAt: new Date(), updatedBy: actor?.id || null } });
    return { ...row, carried: carriedRows.length, seeded: seeded.length };
  });
  await auditService.recordEvent({ orgId, projectId, entityType: "lookahead", entityId: created.id, action: auditService.ACTIONS.CREATED, actorId: actor?.id || null, summary: { ref: created.ref, rolledFrom: source.ref, carried: created.carried, seeded: created.seeded, archivedSource: Boolean(payload.archiveSource) } }).catch(() => null);
  return getLookahead({ orgId, projectId, lookaheadId: created.id });
};

// ─── Items ────────────────────────────────────────────────────────────────

const assertRefs = async ({ projectId, data }) => {
  if (data.activityId) {
    const activity = await prisma.activity.findFirst({ where: { id: data.activityId, projectId, isActive: true }, select: { id: true, name: true, wbsCode: true } });
    if (!activity) throw new HttpError(400, "LOOKAHEAD_ACTIVITY_INVALID", "Unknown activity");
    return activity;
  }
  return null;
};
const assertCrew = async ({ projectId, crewId }) => {
  if (!crewId) return null;
  const crew = await prisma.crew.findFirst({ where: { id: crewId, projectId }, select: { id: true, companyId: true, foremanUserId: true } });
  if (!crew) throw new HttpError(400, "LOOKAHEAD_CREW_INVALID", "Unknown crew");
  return crew;
};
const assertLocation = async ({ projectId, locationId }) => {
  if (!locationId) return;
  const location = await prisma.location.findFirst({ where: { id: locationId, projectId }, select: { id: true } });
  if (!location) throw new HttpError(400, "LOOKAHEAD_LOCATION_INVALID", "Unknown location");
};

const normalizeStatus = ({ status, varianceReason, existing }) => {
  const next = status !== undefined ? status : existing?.status || ITEM_STATUS.PLANNED;
  if (!LIVE_ITEM_STATUSES.includes(next)) throw new HttpError(400, "LOOKAHEAD_ITEM_STATUS_INVALID", `Status must be one of ${LIVE_ITEM_STATUSES.join(", ")}`);
  const reason = varianceReason !== undefined ? trimOrNull(varianceReason) : existing?.varianceReason || null;
  if (next === ITEM_STATUS.NOT_DONE) {
    if (!reason || !VARIANCE_REASONS.includes(reason)) throw new HttpError(400, "LOOKAHEAD_VARIANCE_REASON_REQUIRED", `Say why it was not done: ${VARIANCE_REASONS.join(", ")}`);
    return { status: next, varianceReason: reason };
  }
  if (reason && !VARIANCE_REASONS.includes(reason)) throw new HttpError(400, "LOOKAHEAD_VARIANCE_REASON_INVALID", `Variance reason must be one of ${VARIANCE_REASONS.join(", ")}`);
  return { status: next, varianceReason: null };
};

const normalizeConstraint = ({ payload, existing }) => {
  const pick = (key) => (payload[key] !== undefined ? payload[key] : existing ? existing[key] : undefined);
  const constraint = trimOrNull(pick("constraint"));
  let constraintStatus = pick("constraintStatus") || (constraint ? "open" : "none");
  if (payload.constraint !== undefined && payload.constraintStatus === undefined) constraintStatus = constraint ? (existing?.constraintStatus === "cleared" ? "cleared" : "open") : "none";
  if (!CONSTRAINT_STATUSES.includes(constraintStatus)) throw new HttpError(400, "LOOKAHEAD_CONSTRAINT_STATUS_INVALID", `Constraint status must be one of ${CONSTRAINT_STATUSES.join(", ")}`);
  if (constraintStatus !== "none" && !constraint) throw new HttpError(400, "LOOKAHEAD_CONSTRAINT_REQUIRED", "Describe the constraint");
  const clearedNow = constraintStatus === "cleared" && existing?.constraintStatus !== "cleared";
  return {
    constraint: constraintStatus === "none" ? null : constraint,
    constraintStatus,
    constraintOwnerUserId: constraintStatus === "none" ? null : trimOrNull(pick("constraintOwnerUserId")),
    constraintDueDate: constraintStatus === "none" ? null : toDateOnly(pick("constraintDueDate"), "constraintDueDate"),
    constraintClearedAt: constraintStatus === "cleared" ? (clearedNow ? new Date() : existing?.constraintClearedAt || new Date()) : null,
  };
};

const addItem = async ({ orgId, projectId, lookaheadId, payload = {}, actor = null, viewer = null }) => {
  await ensureProject({ orgId, projectId });
  const lookahead = await load({ orgId, projectId, lookaheadId, include: undefined });
  if (lookahead.status === STATUS.ARCHIVED) throw new HttpError(409, "LOOKAHEAD_LOCKED", "An archived lookahead cannot be edited");
  assertVisible(lookahead, viewer);
  const activity = await assertRefs({ projectId, data: { activityId: trimOrNull(payload.activityId) } });
  const crew = await assertCrew({ projectId, crewId: trimOrNull(payload.crewId) });
  await assertLocation({ projectId, locationId: trimOrNull(payload.locationId) });
  const name = trimOrNull(payload.name) || activity?.name;
  if (!name) throw new HttpError(400, "LOOKAHEAD_ITEM_NAME_REQUIRED", "Name the task");
  const window = windowOf(lookahead);
  const plannedStart = toDateOnly(payload.plannedStart, "plannedStart") || window.start;
  const plannedFinish = toDateOnly(payload.plannedFinish, "plannedFinish") || plannedStart;
  if (plannedFinish.getTime() < plannedStart.getTime()) throw new HttpError(400, "LOOKAHEAD_DATES_INVALID", "The finish cannot be before the start");
  const { status, varianceReason } = normalizeStatus({ status: payload.status, varianceReason: payload.varianceReason });
  const constraint = normalizeConstraint({ payload, existing: null });
  const companies = companyIdsFor(viewer);
  const companyId = scoped(viewer) ? companies[0] || crew?.companyId || null : trimOrNull(payload.companyId) || crew?.companyId || null;
  const max = await prisma.lookaheadItem.aggregate({ where: { lookaheadId }, _max: { sortOrder: true } });
  const pct = Math.min(100, Math.max(0, toNumber(payload.pctComplete, status === ITEM_STATUS.DONE ? 100 : 0)));
  const row = await prisma.lookaheadItem.create({
    data: { orgId, projectId, lookaheadId, activityId: activity?.id || null, source: "added", name, wbsCode: trimOrNull(payload.wbsCode) || activity?.wbsCode || null, plannedStart, plannedFinish, datesEdited: true, crewId: crew?.id || null, companyId, assigneeUserId: trimOrNull(payload.assigneeUserId), locationId: trimOrNull(payload.locationId), quantity: payload.quantity === null || payload.quantity === undefined || payload.quantity === "" ? null : toNumber(payload.quantity), unit: trimOrNull(payload.unit), status, pctComplete: status === ITEM_STATUS.DONE ? 100 : pct, varianceReason, ...constraint, notes: trimOrNull(payload.notes), sortOrder: (max._max.sortOrder ?? -1) + 1, createdBy: actor?.id || null, updatedBy: actor?.id || null },
    include: itemInclude,
  });
  await auditService.recordEvent({ orgId, projectId, entityType: "lookahead", entityId: lookaheadId, action: auditService.ACTIONS.UPDATED, actorId: actor?.id || null, summary: { ref: lookahead.ref, itemAdded: row.name, activityId: row.activityId } }).catch(() => null);
  return itemOut(row);
};

const updateItem = async ({ orgId, projectId, lookaheadId, itemId, payload = {}, actor = null, viewer = null }) => {
  await ensureProject({ orgId, projectId });
  const lookahead = await load({ orgId, projectId, lookaheadId, include: undefined });
  if (lookahead.status === STATUS.ARCHIVED) throw new HttpError(409, "LOOKAHEAD_LOCKED", "An archived lookahead cannot be edited");
  assertVisible(lookahead, viewer);
  const existing = await prisma.lookaheadItem.findFirst({ where: { id: itemId, lookaheadId, projectId }, include: itemInclude });
  if (!existing || existing.status === ITEM_STATUS.REMOVED) throw new HttpError(404, "LOOKAHEAD_ITEM_NOT_FOUND", "Task not found");
  assertItemEditable(existing, viewer);
  const data = { updatedBy: actor?.id || null };
  if (payload.name !== undefined) {
    const name = trimOrNull(payload.name);
    if (!name) throw new HttpError(400, "LOOKAHEAD_ITEM_NAME_REQUIRED", "Name the task");
    data.name = name;
  }
  if (payload.wbsCode !== undefined) data.wbsCode = trimOrNull(payload.wbsCode);
  if (payload.plannedStart !== undefined || payload.plannedFinish !== undefined) {
    const plannedStart = payload.plannedStart !== undefined ? toDateOnly(payload.plannedStart, "plannedStart", { required: true }) : startOfUtcDay(existing.plannedStart);
    const plannedFinish = payload.plannedFinish !== undefined ? toDateOnly(payload.plannedFinish, "plannedFinish", { required: true }) : startOfUtcDay(existing.plannedFinish);
    if (plannedFinish.getTime() < plannedStart.getTime()) throw new HttpError(400, "LOOKAHEAD_DATES_INVALID", "The finish cannot be before the start");
    data.plannedStart = plannedStart;
    data.plannedFinish = plannedFinish;
    data.datesEdited = existing.source !== "schedule" || dateKey(plannedStart) !== dateKey(existing.scheduleStart) || dateKey(plannedFinish) !== dateKey(existing.scheduleFinish);
  }
  if (payload.crewId !== undefined) {
    const crew = await assertCrew({ projectId, crewId: trimOrNull(payload.crewId) });
    data.crewId = crew?.id || null;
    if (crew?.companyId && !existing.companyId && payload.companyId === undefined) data.companyId = crew.companyId;
  }
  if (payload.companyId !== undefined && !scoped(viewer)) data.companyId = trimOrNull(payload.companyId);
  if (payload.assigneeUserId !== undefined) data.assigneeUserId = trimOrNull(payload.assigneeUserId);
  if (payload.locationId !== undefined) {
    await assertLocation({ projectId, locationId: trimOrNull(payload.locationId) });
    data.locationId = trimOrNull(payload.locationId);
  }
  if (payload.quantity !== undefined) data.quantity = payload.quantity === null || payload.quantity === "" ? null : toNumber(payload.quantity);
  if (payload.unit !== undefined) data.unit = trimOrNull(payload.unit);
  if (payload.status !== undefined || payload.varianceReason !== undefined) {
    const next = normalizeStatus({ status: payload.status, varianceReason: payload.varianceReason, existing });
    data.status = next.status;
    data.varianceReason = next.varianceReason;
    if (next.status === ITEM_STATUS.DONE) data.pctComplete = 100;
  }
  if (payload.pctComplete !== undefined) {
    const pct = Math.min(100, Math.max(0, toNumber(payload.pctComplete)));
    data.pctComplete = pct;
    if (payload.status === undefined && pct >= 100) data.status = ITEM_STATUS.DONE;
    else if (payload.status === undefined && pct > 0 && existing.status === ITEM_STATUS.PLANNED) data.status = ITEM_STATUS.IN_PROGRESS;
  }
  if (payload.constraint !== undefined || payload.constraintStatus !== undefined || payload.constraintOwnerUserId !== undefined || payload.constraintDueDate !== undefined) Object.assign(data, normalizeConstraint({ payload, existing }));
  if (payload.notes !== undefined) data.notes = trimOrNull(payload.notes);
  if (payload.sortOrder !== undefined) data.sortOrder = Math.round(toNumber(payload.sortOrder, existing.sortOrder));
  const row = await prisma.lookaheadItem.update({ where: { id: itemId }, data, include: itemInclude });
  const changed = Object.keys(data).filter((key) => key !== "updatedBy");
  await auditService.recordEvent({ orgId, projectId, entityType: "lookahead", entityId: lookaheadId, action: data.status && data.status !== existing.status ? auditService.ACTIONS.STATUS_CHANGED : auditService.ACTIONS.UPDATED, actorId: actor?.id || null, summary: { ref: lookahead.ref, item: row.name, changed, ...(data.status ? { from: existing.status, to: data.status } : {}), ...(data.varianceReason ? { varianceReason: data.varianceReason } : {}), ...(data.constraintStatus ? { constraintStatus: data.constraintStatus } : {}) } }).catch(() => null);
  return itemOut(row);
};

/** Schedule-sourced items are kept as removed (so a refresh does not bring them back); added tasks are deleted. */
const removeItem = async ({ orgId, projectId, lookaheadId, itemId, actor = null, viewer = null }) => {
  await ensureProject({ orgId, projectId });
  const lookahead = await load({ orgId, projectId, lookaheadId, include: undefined });
  if (lookahead.status === STATUS.ARCHIVED) throw new HttpError(409, "LOOKAHEAD_LOCKED", "An archived lookahead cannot be edited");
  assertVisible(lookahead, viewer);
  const existing = await prisma.lookaheadItem.findFirst({ where: { id: itemId, lookaheadId, projectId }, include: itemInclude });
  if (!existing || existing.status === ITEM_STATUS.REMOVED) throw new HttpError(404, "LOOKAHEAD_ITEM_NOT_FOUND", "Task not found");
  assertItemEditable(existing, viewer);
  if (existing.source === "schedule" && existing.activityId) await prisma.lookaheadItem.update({ where: { id: itemId }, data: { status: ITEM_STATUS.REMOVED, updatedBy: actor?.id || null } });
  else await prisma.lookaheadItem.delete({ where: { id: itemId } });
  await auditService.recordEvent({ orgId, projectId, entityType: "lookahead", entityId: lookaheadId, action: auditService.ACTIONS.UPDATED, actorId: actor?.id || null, summary: { ref: lookahead.ref, itemRemoved: existing.name } }).catch(() => null);
  return { removed: true };
};

// ─── Make-ready log ───────────────────────────────────────────────────────

const listConstraints = async ({ orgId, projectId, viewer = null }) => {
  await ensureProject({ orgId, projectId });
  const lookaheadWhere = { status: { not: STATUS.ARCHIVED } };
  const scope = visibilityWhere(viewer);
  if (scope) Object.assign(lookaheadWhere, scope);
  const rows = await prisma.lookaheadItem.findMany({ where: { projectId, orgId, constraintStatus: "open", status: { not: ITEM_STATUS.REMOVED }, lookahead: lookaheadWhere }, include: { ...itemInclude, lookahead: { select: { id: true, ref: true, title: true, status: true } } }, orderBy: [{ constraintDueDate: "asc" }, { plannedStart: "asc" }] });
  const today = todayUtc();
  const weekEnd = addDays(today, 7);
  const items = rows.map((row) => ({ ...itemOut(row, { today }), lookahead: row.lookahead ? { id: row.lookahead.id, ref: row.lookahead.ref, title: row.lookahead.title, status: row.lookahead.status } : null }));
  return { items, summary: { open: items.length, overdue: items.filter((item) => item.constraintOverdue).length, dueThisWeek: items.filter((item) => item.constraintDueDate && !item.constraintOverdue && new Date(`${item.constraintDueDate}T00:00:00.000Z`).getTime() <= weekEnd.getTime()).length } };
};

// ─── Export ───────────────────────────────────────────────────────────────

const FILL = (argb) => ({ type: "pattern", pattern: "solid", fgColor: { argb } });
const STATUS_FILL = { planned: "FFBFDBFE", in_progress: "FFFDE68A", done: "FFBBF7D0", not_done: "FFFECACA" };
const styleHeader = (row) => {
  row.eachCell((cell) => {
    cell.fill = FILL("FF1E3A5F");
    cell.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 10 };
    cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
  });
  row.height = 26;
};

const exportLookahead = async ({ orgId, projectId, lookaheadId, viewer = null }) => {
  const project = await ensureProject({ orgId, projectId });
  const row = await load({ orgId, projectId, lookaheadId });
  assertVisible(row, viewer);
  const detail = lookaheadOut(row, { detail: true, project });
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "OctaPM";
  workbook.created = new Date();

  const plan = workbook.addWorksheet("Plan", { views: [{ state: "frozen", xSplit: 6, ySplit: 2 }] });
  const fixed = ["Task", "Activity", "WBS", "Crew", "Location", "Start", "Finish", "Status", "%", "Constraint"];
  const days = detail.grid.flatMap((week) => week.days);
  const weekRow = plan.addRow([...fixed.map(() => ""), ...detail.grid.flatMap((week) => [week.label, "", "", "", "", "", ""])]);
  detail.grid.forEach((week, index) => {
    const from = fixed.length + index * 7 + 1;
    plan.mergeCells(1, from, 1, from + 6);
    const cell = plan.getCell(1, from);
    cell.value = week.label;
    cell.alignment = { horizontal: "center" };
    cell.font = { bold: true };
    cell.fill = FILL(week.current ? "FFE0F2FE" : "FFF1F5F9");
  });
  weekRow.height = 20;
  const header = plan.addRow([...fixed, ...days.map((day) => `${day.label} ${Number(day.date.slice(8, 10))}`)]);
  styleHeader(header);
  fixed.forEach((_, index) => {
    plan.getColumn(index + 1).width = [34, 12, 10, 16, 16, 11, 11, 12, 6, 28][index];
  });
  days.forEach((day, index) => {
    const column = plan.getColumn(fixed.length + index + 1);
    column.width = 4.5;
    if (!day.working) column.eachCell({ includeEmpty: false }, () => {});
  });
  detail.items.forEach((item) => {
    const cells = [item.name, item.activity?.code || "", item.wbsCode || "", item.crew?.name || "", item.location?.name || "", item.plannedStart, item.plannedFinish, item.status.replace("_", " "), Math.round(item.pctComplete), item.constraint ? `${item.constraint}${item.constraintStatus === "cleared" ? " (cleared)" : ""}` : ""];
    const excelRow = plan.addRow([...cells, ...days.map(() => "")]);
    days.forEach((day, index) => {
      const cell = excelRow.getCell(fixed.length + index + 1);
      const inside = day.date >= item.plannedStart && day.date <= item.plannedFinish;
      if (inside && day.working) {
        cell.fill = FILL(STATUS_FILL[item.status] || STATUS_FILL.planned);
        cell.value = item.status === ITEM_STATUS.DONE ? "✓" : item.status === ITEM_STATUS.NOT_DONE ? "✗" : "■";
        cell.alignment = { horizontal: "center" };
      } else if (!day.working) cell.fill = FILL("FFF3F4F6");
      if (day.isToday) cell.border = { left: { style: "medium", color: { argb: "FF2563EB" } }, right: { style: "medium", color: { argb: "FF2563EB" } } };
    });
  });

  const constraints = workbook.addWorksheet("Constraints");
  styleHeader(constraints.addRow(["Task", "Constraint", "Status", "Owner", "Due", "Cleared", "Overdue"]));
  [34, 48, 10, 20, 12, 14, 9].forEach((width, index) => {
    constraints.getColumn(index + 1).width = width;
  });
  detail.items.filter((item) => item.constraintStatus !== "none").forEach((item) => constraints.addRow([item.name, item.constraint, item.constraintStatus, item.constraintOwnerUserId || "", item.constraintDueDate || "", item.constraintClearedAt ? item.constraintClearedAt.slice(0, 10) : "", item.constraintOverdue ? "yes" : ""]));

  const ppc = workbook.addWorksheet("PPC");
  styleHeader(ppc.addRow(["Week", "From", "To", "Committed", "Completed", "Not done", "PPC %", "Closed"]));
  [8, 12, 12, 11, 11, 10, 8, 8].forEach((width, index) => {
    ppc.getColumn(index + 1).width = width;
  });
  detail.summary.ppc.weeks.forEach((week) => ppc.addRow([week.week, week.start, week.end, week.committed, week.completed, week.notDone, week.ppc ?? "", week.closed ? "yes" : ""]));
  ppc.addRow([]);
  ppc.addRow(["Overall (closed weeks)", "", "", detail.summary.ppc.committed, detail.summary.ppc.completed, "", detail.summary.ppc.ppc ?? "", ""]).font = { bold: true };
  ppc.addRow([]);
  styleHeader(ppc.addRow(["Variance reason", "Count"]));
  Object.entries(detail.summary.ppc.varianceReasons).forEach(([reason, count]) => ppc.addRow([VARIANCE_LABEL[reason] || reason, count]));

  const about = workbook.addWorksheet("About");
  about.getColumn(1).width = 22;
  about.getColumn(2).width = 60;
  [["Project", project.name], ["Lookahead", `${detail.ref} — ${detail.title}`], ["Window", `${detail.startDate} → ${detail.endDate} (${detail.weeks} weeks)`], ["Status", detail.status], ["Tasks", String(detail.summary.items)], ["Open constraints", String(detail.summary.openConstraints)], ["PPC", detail.summary.ppc.ppc === null ? "—" : `${detail.summary.ppc.ppc}%`], ["Exported", new Date().toISOString()]].forEach((pair) => about.addRow(pair));

  brandWorkbook(workbook, { title: `Lookahead — ${detail.ref}`, project: project.name });
  return { workbook, filename: `${String(detail.ref).toLowerCase()}-lookahead.xlsx` };
};

module.exports = {
  STATUS,
  ITEM_STATUS,
  LIVE_ITEM_STATUSES,
  CONSTRAINT_STATUSES,
  VARIANCE_REASONS,
  VARIANCE_LABEL,
  SOURCES,
  WEEK_OPTIONS,
  activityWindow,
  computePpc,
  listLookaheads,
  getLookahead,
  createLookahead,
  updateLookahead,
  deleteLookahead,
  refreshFromSchedule,
  publishLookahead,
  archiveLookahead,
  rollForward,
  addItem,
  updateItem,
  removeItem,
  listConstraints,
  exportLookahead,
};
