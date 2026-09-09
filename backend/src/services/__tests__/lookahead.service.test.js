const { referenceCounterMock } = require("./helpers/reference-counter-mock");
const store = { lookaheads: [], items: [], notifications: [], audits: [] };
let seq = 0;
const nextId = (prefix) => `${prefix}-${(seq += 1)}`;
const DATE_KEYS = new Set(["startDate", "plannedStart", "plannedFinish", "scheduleStart", "scheduleFinish", "constraintDueDate", "constraintClearedAt", "createdAt", "updatedAt", "publishedAt", "archivedAt", "refreshedAt"]);
const clone = (row) => (row ? JSON.parse(JSON.stringify(row), (key, value) => (DATE_KEYS.has(key) && value ? new Date(value) : value)) : row);

const matches = (row, where = {}) =>
  Object.entries(where).every(([key, condition]) => {
    if (key === "OR") return condition.some((clause) => matches(row, clause));
    if (key === "AND") return condition.every((clause) => matches(row, clause));
    if (key === "lookahead") return matches(store.lookaheads.find((lookahead) => lookahead.id === row.lookaheadId) || {}, condition);
    const value = row[key];
    if (condition instanceof Date) return value instanceof Date && value.getTime() === condition.getTime();
    if (condition === null || typeof condition !== "object") return value === condition;
    if ("in" in condition) return condition.in.includes(value);
    if ("notIn" in condition) return !condition.notIn.includes(value);
    if ("not" in condition) return value !== condition.not;
    if ("equals" in condition) return value === condition.equals;
    if ("gte" in condition || "lte" in condition) return (!condition.gte || value >= condition.gte) && (!condition.lte || value <= condition.lte);
    return true;
  });
const applyData = (row, data) => ({ ...row, ...data, updatedAt: new Date() });
const sortRows = (rows, orderBy) => {
  if (!orderBy) return rows;
  const orders = Array.isArray(orderBy) ? orderBy : [orderBy];
  return rows.sort((a, b) => {
    for (const order of orders) {
      const [key, dir] = Object.entries(order)[0];
      const av = a[key] instanceof Date ? a[key].getTime() : a[key];
      const bv = b[key] instanceof Date ? b[key].getTime() : b[key];
      if (av === bv || av === null || av === undefined || bv === null || bv === undefined) continue;
      return (av > bv ? 1 : -1) * (dir === "desc" ? -1 : 1);
    }
    return 0;
  });
};
const table = (name, { hydrate = (row) => row } = {}) => ({
  findMany: jest.fn(async ({ where = {}, orderBy } = {}) => sortRows(store[name].filter((row) => matches(row, where)).map((row) => hydrate(clone(row))), orderBy)),
  findFirst: jest.fn(async ({ where = {} } = {}) => {
    const row = store[name].find((item) => matches(item, where));
    return row ? hydrate(clone(row)) : null;
  }),
  aggregate: jest.fn(async ({ where = {}, _max }) => {
    const key = Object.keys(_max)[0];
    const values = store[name].filter((row) => matches(row, where)).map((row) => row[key]).filter((value) => value !== null && value !== undefined);
    return { _max: { [key]: values.length ? Math.max(...values) : null } };
  }),
  create: jest.fn(async ({ data }) => {
    const row = { id: nextId(name), createdAt: new Date(), updatedAt: new Date(), ...data };
    store[name].push(row);
    return hydrate(clone(row));
  }),
  createMany: jest.fn(async ({ data }) => {
    for (const item of data) store[name].push({ id: nextId(name), createdAt: new Date(), updatedAt: new Date(), ...item });
    return { count: data.length };
  }),
  update: jest.fn(async ({ where, data }) => {
    const index = store[name].findIndex((row) => row.id === where.id);
    if (index < 0) throw new Error(`${name} ${where.id} not found`);
    store[name][index] = applyData(store[name][index], data);
    return hydrate(clone(store[name][index]));
  }),
  delete: jest.fn(async ({ where }) => {
    store[name] = store[name].filter((row) => row.id !== where.id);
    if (name === "lookaheads") store.items = store.items.filter((row) => row.lookaheadId !== where.id);
    return {};
  }),
});

const day = (value) => new Date(`${value}T00:00:00.000Z`);
const PROJECT = { id: "p1", orgId: "org-1", name: "Riverside Tower", startDate: day("2026-09-07"), projectCalendar: "five_day", currency: "AED", timezone: "Asia/Dubai" };
const activity = (id, name, code, wbsCode, earlyStart, earlyFinish, extra = {}) => ({ id, projectId: "p1", name, activityCode: code, wbsCode, category: "substructure", calendarId: null, duration: earlyFinish - earlyStart + 1, earlyStart, earlyFinish, isCritical: true, isMilestone: false, totalFloat: 0, progress: [], ...extra });
let ACTIVITIES = [];
const resetActivities = () => {
  ACTIVITIES = [
    activity("act-1", "Mobilise", "A1000", "1", 0, 4, { progress: [{ pctComplete: 100, actualStart: day("2026-09-07"), actualFinish: day("2026-09-11") }] }),
    activity("act-2", "Excavate footings", "A1010", "1.1", 5, 14, { progress: [{ pctComplete: 40, actualStart: day("2026-09-14"), actualFinish: null }] }),
    activity("act-3", "Site fence", "A1020", "2", 0, 2, { isCritical: false, category: "siteworks" }),
    activity("act-4", "Blinding", "A1030", "1.1", 15, 17, { isCritical: false }),
    activity("act-5", "Tower crane base", "A1040", "3", 40, 45),
    activity("act-6", "Fence removal", "A1050", "2", 20, 21, { isCritical: false, category: "siteworks" }),
  ];
};
const CREWS = [{ id: "crew-1", projectId: "p1", name: "Steel fixers", companyId: "co-sub", foremanUserId: "u-foreman" }, { id: "crew-2", projectId: "p1", name: "Concrete gang", companyId: "co-main", foremanUserId: null }];
const LOCATIONS = [{ id: "loc-1", projectId: "p1", name: "Level 1", code: "L1" }];

const hydrateItem = (row) => ({ ...row, activity: ACTIVITIES.find((item) => item.id === row.activityId) || null, crew: CREWS.find((crew) => crew.id === row.crewId) || null, location: LOCATIONS.find((location) => location.id === row.locationId) || null, lookahead: (() => { const lookahead = store.lookaheads.find((item) => item.id === row.lookaheadId); return lookahead ? { id: lookahead.id, ref: lookahead.ref, title: lookahead.title, status: lookahead.status } : null; })() });
const hydrateLookahead = (row) => ({ ...row, items: sortRows(store.items.filter((item) => item.lookaheadId === row.id).map((item) => hydrateItem(clone(item))), [{ sortOrder: "asc" }, { plannedStart: "asc" }]) });

const mockPrisma = {
  ...referenceCounterMock(),
  project: { findFirst: jest.fn(async ({ where }) => (where.id === "p1" ? PROJECT : null)) },
  activity: {
    findMany: jest.fn(async () => ACTIVITIES.map((item) => ({ ...item, progress: item.progress.map((progress) => ({ ...progress })) }))),
    findFirst: jest.fn(async ({ where }) => ACTIVITIES.find((item) => item.id === where.id && item.projectId === where.projectId) || null),
  },
  crew: { findFirst: jest.fn(async ({ where }) => CREWS.find((crew) => crew.id === where.id && crew.projectId === where.projectId) || null) },
  location: { findFirst: jest.fn(async ({ where }) => LOCATIONS.find((location) => location.id === where.id && location.projectId === where.projectId) || null) },
  lookahead: table("lookaheads", { hydrate: hydrateLookahead }),
  lookaheadItem: table("items", { hydrate: hydrateItem }),
  $transaction: jest.fn(async (fn) => fn(mockPrisma)),
};
const mockAudit = { ACTIONS: { CREATED: "created", UPDATED: "updated", STATUS_CHANGED: "status_changed", DELETED: "deleted", ARCHIVED: "archived" }, recordEvent: jest.fn(async (event) => store.audits.push(event)) };
const mockNotifications = { NOTIFICATION_CATEGORIES: { ASSIGNMENT: "assignment" }, createNotifications: jest.fn(async (payload) => store.notifications.push(payload)) };

jest.mock("../../config/db", () => ({ prisma: mockPrisma }));
jest.mock("../audit.service", () => mockAudit);
jest.mock("../notification.service", () => mockNotifications);
jest.mock("../company-party.service", () => ({ isPartyScopedAccess: (access) => Boolean(access?.partyScoped) }));

const service = require("../lookahead.service");

const scope = { orgId: "org-1", projectId: "p1" };
const actor = { id: "u-planner", name: "Plan", role: "planning_eng" };
const sub = { id: "u-sub", name: "Sub", role: "site_engineer", projectAccess: { partyScoped: true, partyAccess: [{ companyId: "co-sub" }] } };
const setToday = (value) => jest.useFakeTimers({ now: new Date(`${value}T10:00:00Z`), doNotFake: ["nextTick", "setImmediate", "setTimeout", "setInterval", "clearTimeout", "clearInterval", "clearImmediate", "queueMicrotask", "performance", "hrtime"] });
const reset = () => {
  for (const key of Object.keys(store)) store[key] = [];
  resetActivities();
  jest.clearAllMocks();
  setToday("2026-09-16");
};
const create = (overrides = {}) => service.createLookahead({ ...scope, actor, payload: { startDate: "2026-09-16", weeks: 3, ...overrides } });

describe("lookaheads", () => {
  beforeEach(reset);
  afterAll(() => jest.useRealTimers());

  it("creates a numbered lookahead on the week boundary, seeded with the unfinished activities that touch the window, with a calendar grid", async () => {
    const lookahead = await create();
    expect(lookahead).toMatchObject({ ref: "LA-001", status: "draft", startDate: "2026-09-14", endDate: "2026-10-04", weeks: 3, weekStartDay: 1, title: "3-week lookahead from 14 Sep", current: true });
    expect(lookahead.items.map((item) => [item.activity?.code, item.name, item.plannedStart, item.plannedFinish, item.status, item.pctComplete, item.source])).toEqual([
      ["A1010", "Excavate footings", "2026-09-14", "2026-09-25", "in_progress", 40, "schedule"],
      ["A1030", "Blinding", "2026-09-28", "2026-09-30", "planned", 0, "schedule"],
    ]);
    expect(lookahead.grid).toHaveLength(3);
    expect(lookahead.grid[0]).toMatchObject({ index: 1, start: "2026-09-14", end: "2026-09-20", current: true, closed: false });
    expect(lookahead.grid[0].days.map((d) => `${d.label}${d.working ? "" : "·"}${d.isToday ? "!" : ""}`)).toEqual(["Mon", "Tue", "Wed!", "Thu", "Fri", "Sat·", "Sun·"]);
    expect(lookahead.summary).toMatchObject({ items: 2, byStatus: { planned: 1, in_progress: 1, done: 0, not_done: 0 }, openConstraints: 0, behind: 0 });
    expect(lookahead.summary.ppc).toMatchObject({ closedWeeks: 0, committed: 0, ppc: null });

    const critical = await create({ filter: { onlyCritical: true }, title: "Critical only" });
    expect(critical.ref).toBe("LA-002");
    expect(critical.items.map((item) => item.activity.code)).toEqual(["A1010"]);
    const siteworks = await create({ filter: { categories: ["siteworks"] }, weeks: 4 });
    expect(siteworks.items.map((item) => item.activity.code)).toEqual(["A1050"]);
    await expect(create({ weeks: 9 })).rejects.toMatchObject({ code: "LOOKAHEAD_WEEKS_INVALID" });
    await expect(service.createLookahead({ ...scope, actor, payload: { weeks: 3 } })).rejects.toMatchObject({ code: "LOOKAHEAD_DATE_REQUIRED" });
    const list = await service.listLookaheads({ ...scope, viewer: actor });
    expect(list.summary).toMatchObject({ count: 3, currentId: expect.any(String) });
    expect(list.items[0].items).toBeUndefined();
  });

  it("adds tasks, tracks status with variance reasons, constraints with due dates, and computes PPC per closed week", async () => {
    const lookahead = await create();
    const added = await service.addItem({ ...scope, actor, lookaheadId: lookahead.id, payload: { name: "Set out grid lines", plannedStart: "2026-09-15", plannedFinish: "2026-09-16", crewId: "crew-1", locationId: "loc-1", quantity: 12, unit: "pts" } });
    expect(added).toMatchObject({ source: "added", status: "planned", companyId: "co-sub", crew: { name: "Steel fixers" }, location: { name: "Level 1" }, datesEdited: true, driftDays: null });
    await expect(service.addItem({ ...scope, actor, lookaheadId: lookahead.id, payload: { plannedStart: "2026-09-15" } })).rejects.toMatchObject({ code: "LOOKAHEAD_ITEM_NAME_REQUIRED" });
    await expect(service.addItem({ ...scope, actor, lookaheadId: lookahead.id, payload: { name: "x", plannedStart: "2026-09-16", plannedFinish: "2026-09-15" } })).rejects.toMatchObject({ code: "LOOKAHEAD_DATES_INVALID" });
    await expect(service.addItem({ ...scope, actor, lookaheadId: lookahead.id, payload: { name: "x", crewId: "crew-9" } })).rejects.toMatchObject({ code: "LOOKAHEAD_CREW_INVALID" });
    const fromActivity = await service.addItem({ ...scope, actor, lookaheadId: lookahead.id, payload: { activityId: "act-3", plannedStart: "2026-09-17" } });
    expect(fromActivity).toMatchObject({ name: "Site fence", wbsCode: "2", plannedFinish: "2026-09-17", activity: { code: "A1020" } });

    await expect(service.updateItem({ ...scope, actor, lookaheadId: lookahead.id, itemId: added.id, payload: { status: "not_done" } })).rejects.toMatchObject({ code: "LOOKAHEAD_VARIANCE_REASON_REQUIRED" });
    await expect(service.updateItem({ ...scope, actor, lookaheadId: lookahead.id, itemId: added.id, payload: { constraintStatus: "open" } })).rejects.toMatchObject({ code: "LOOKAHEAD_CONSTRAINT_REQUIRED" });
    const constrained = await service.updateItem({ ...scope, actor, lookaheadId: lookahead.id, itemId: added.id, payload: { constraint: "Survey control points from the consultant", constraintOwnerUserId: "u-consultant", constraintDueDate: "2026-09-18" } });
    expect(constrained).toMatchObject({ constraintStatus: "open", constraintOverdue: false, constraintDueDate: "2026-09-18" });
    const log = await service.listConstraints({ ...scope, viewer: actor });
    expect(log.summary).toEqual({ open: 1, overdue: 0, dueThisWeek: 1 });
    expect(log.items[0]).toMatchObject({ name: "Set out grid lines", lookahead: { ref: "LA-001" } });
    const cleared = await service.updateItem({ ...scope, actor, lookaheadId: lookahead.id, itemId: added.id, payload: { constraintStatus: "cleared" } });
    expect(cleared.constraintStatus).toBe("cleared");
    expect(cleared.constraintClearedAt).toBeTruthy();
    expect((await service.listConstraints({ ...scope, viewer: actor })).summary.open).toBe(0);

    const notDone = await service.updateItem({ ...scope, actor, lookaheadId: lookahead.id, itemId: added.id, payload: { status: "not_done", varianceReason: "material" } });
    expect(notDone).toMatchObject({ status: "not_done", varianceReason: "material" });
    const progressed = await service.updateItem({ ...scope, actor, lookaheadId: lookahead.id, itemId: fromActivity.id, payload: { pctComplete: 50 } });
    expect(progressed).toMatchObject({ status: "in_progress", pctComplete: 50 });
    const done = await service.updateItem({ ...scope, actor, lookaheadId: lookahead.id, itemId: fromActivity.id, payload: { pctComplete: 100 } });
    expect(done).toMatchObject({ status: "done", pctComplete: 100 });

    setToday("2026-09-23");
    const detail = await service.getLookahead({ ...scope, lookaheadId: lookahead.id });
    expect(detail.summary.ppc.weeks[0]).toMatchObject({ week: 1, closed: true, committed: 2, completed: 1, notDone: 1, ppc: 50 });
    expect(detail.summary.ppc).toMatchObject({ closedWeeks: 1, committed: 2, completed: 1, ppc: 50, varianceReasons: { material: 1 } });
    expect(detail.summary.behind).toBe(0);
    expect(detail.grid[0].closed).toBe(true);
    expect(store.audits.filter((event) => event.action === "status_changed")).toHaveLength(3);
  });

  it("refreshes from the schedule: new activities appear, unedited dates follow the schedule, edited ones stay, finished activities complete, removed ones stay away", async () => {
    const lookahead = await create();
    const [excavate, blinding] = lookahead.items;
    const edited = await service.updateItem({ ...scope, actor, lookaheadId: lookahead.id, itemId: excavate.id, payload: { plannedFinish: "2026-09-23" } });
    expect(edited).toMatchObject({ datesEdited: true, driftDays: -2 });
    await service.removeItem({ ...scope, actor, lookaheadId: lookahead.id, itemId: blinding.id });
    expect((await service.getLookahead({ ...scope, lookaheadId: lookahead.id })).items).toHaveLength(1);

    ACTIVITIES.find((item) => item.id === "act-2").earlyFinish = 16;
    ACTIVITIES.find((item) => item.id === "act-6").earlyStart = 18;
    ACTIVITIES.find((item) => item.id === "act-6").earlyFinish = 19;
    const first = await service.refreshFromSchedule({ ...scope, actor, lookaheadId: lookahead.id });
    expect(first).toMatchObject({ added: 1, updated: 1, completed: 0 });
    const afterFirst = first.lookahead.items;
    expect(afterFirst.find((item) => item.id === excavate.id)).toMatchObject({ plannedFinish: "2026-09-23", scheduleFinish: "2026-09-29", driftDays: -6 });
    expect(afterFirst.map((item) => item.activity?.code)).toEqual(["A1010", "A1050"]);
    const fence = afterFirst.find((item) => item.activity?.code === "A1050");
    expect(fence).toMatchObject({ plannedStart: "2026-10-01", plannedFinish: "2026-10-02", datesEdited: false });

    ACTIVITIES.find((item) => item.id === "act-6").earlyStart = 17;
    ACTIVITIES.find((item) => item.id === "act-2").progress = [{ pctComplete: 100, actualStart: day("2026-09-14"), actualFinish: day("2026-09-22") }];
    const second = await service.refreshFromSchedule({ ...scope, actor, lookaheadId: lookahead.id });
    expect(second).toMatchObject({ added: 0, updated: 1, completed: 1 });
    expect(second.lookahead.items.find((item) => item.id === excavate.id)).toMatchObject({ status: "done", pctComplete: 100 });
    expect(second.lookahead.items.find((item) => item.activity?.code === "A1050").plannedStart).toBe("2026-09-30");
    expect(second.lookahead.items.some((item) => item.activity?.code === "A1030")).toBe(false);
  });

  it("publishes (notifying assignees, foremen and the site roles), locks archived lookaheads and refuses to delete anything but a draft", async () => {
    const empty = await create({ seed: false });
    await expect(service.publishLookahead({ ...scope, actor, lookaheadId: empty.id })).rejects.toMatchObject({ code: "LOOKAHEAD_EMPTY" });
    await service.addItem({ ...scope, actor, lookaheadId: empty.id, payload: { name: "Handover walk", plannedStart: "2026-09-18", crewId: "crew-1", assigneeUserId: "u-site" } });
    const published = await service.publishLookahead({ ...scope, actor, lookaheadId: empty.id });
    expect(published).toMatchObject({ status: "published", publishedBy: "u-planner" });
    expect(store.notifications[0]).toMatchObject({ event: "lookahead.published", recipientRoles: ["pm", "planning_eng", "site_engineer"], recipientUserIds: ["u-site", "u-foreman"] });
    await expect(service.publishLookahead({ ...scope, actor, lookaheadId: empty.id })).rejects.toMatchObject({ code: "LOOKAHEAD_NOT_DRAFT" });
    await expect(service.deleteLookahead({ ...scope, actor, lookaheadId: empty.id })).rejects.toMatchObject({ code: "LOOKAHEAD_NOT_DRAFT" });
    await expect(service.updateLookahead({ ...scope, actor, lookaheadId: empty.id, payload: { title: "Week 38" } })).resolves.toMatchObject({ title: "Week 38", status: "published" });
    const archived = await service.archiveLookahead({ ...scope, actor, lookaheadId: empty.id });
    expect(archived.status).toBe("archived");
    await expect(service.updateLookahead({ ...scope, actor, lookaheadId: empty.id, payload: { title: "x" } })).rejects.toMatchObject({ code: "LOOKAHEAD_LOCKED" });
    await expect(service.addItem({ ...scope, actor, lookaheadId: empty.id, payload: { name: "x" } })).rejects.toMatchObject({ code: "LOOKAHEAD_LOCKED" });
    const draft = await create({ seed: false });
    await expect(service.deleteLookahead({ ...scope, actor, lookaheadId: draft.id })).resolves.toEqual({ deleted: true });
    await expect(service.getLookahead({ ...scope, lookaheadId: draft.id })).rejects.toMatchObject({ code: "LOOKAHEAD_NOT_FOUND" });
  });

  it("rolls forward one week carrying unfinished and not-done tasks (re-planned, reason noted, open constraints kept) and seeds the newly due activities", async () => {
    const lookahead = await create();
    const [excavate, blinding] = lookahead.items;
    await service.updateItem({ ...scope, actor, lookaheadId: lookahead.id, itemId: excavate.id, payload: { status: "done" } });
    const late = await service.addItem({ ...scope, actor, lookaheadId: lookahead.id, payload: { name: "Pump test", plannedStart: "2026-09-15", plannedFinish: "2026-09-16", constraint: "Pump hire", constraintDueDate: "2026-09-15" } });
    await service.updateItem({ ...scope, actor, lookaheadId: lookahead.id, itemId: late.id, payload: { status: "not_done", varianceReason: "weather" } });
    await service.addItem({ ...scope, actor, lookaheadId: lookahead.id, payload: { name: "Old task", plannedStart: "2026-09-14", plannedFinish: "2026-09-18" } });
    await service.publishLookahead({ ...scope, actor, lookaheadId: lookahead.id });

    const next = await service.rollForward({ ...scope, actor, lookaheadId: lookahead.id, payload: { archiveSource: true } });
    expect(next).toMatchObject({ ref: "LA-002", status: "draft", startDate: "2026-09-21", endDate: "2026-10-11", rolledFromId: lookahead.id, weeks: 3 });
    expect(next.items.map((item) => [item.name, item.source, item.status, item.plannedStart, item.plannedFinish])).toEqual([
      ["Blinding", "carried", "planned", "2026-09-28", "2026-09-30"],
      ["Pump test", "carried", "planned", "2026-09-21", "2026-09-21"],
      ["Fence removal", "schedule", "planned", "2026-10-05", "2026-10-06"],
    ]);
    const pump = next.items.find((item) => item.name === "Pump test");
    expect(pump).toMatchObject({ constraint: "Pump hire", constraintStatus: "open", constraintOverdue: true, varianceReason: null, carriedFromItemId: late.id });
    expect(pump.notes).toContain("Carried from LA-001 — not done (Weather)");
    expect(next.items.find((item) => item.name === "Blinding")).toMatchObject({ activity: { code: "A1030" }, carriedFromItemId: blinding.id });
    expect((await service.getLookahead({ ...scope, lookaheadId: lookahead.id })).status).toBe("archived");
  });

  it("scopes party users to published lookaheads and their own company's tasks", async () => {
    const draft = await create();
    const [excavate] = draft.items;
    await service.updateItem({ ...scope, actor, lookaheadId: draft.id, itemId: excavate.id, payload: { crewId: "crew-2" } });
    const subTask = await service.addItem({ ...scope, actor, lookaheadId: draft.id, payload: { name: "Fix rebar L1", plannedStart: "2026-09-17", crewId: "crew-1" } });
    expect((await service.listLookaheads({ ...scope, viewer: sub })).items).toHaveLength(0);
    await expect(service.getLookahead({ ...scope, lookaheadId: draft.id, viewer: sub })).rejects.toMatchObject({ code: "LOOKAHEAD_NOT_FOUND" });
    await service.publishLookahead({ ...scope, actor, lookaheadId: draft.id });
    expect((await service.listLookaheads({ ...scope, viewer: sub })).items).toHaveLength(1);
    await expect(service.updateItem({ ...scope, actor: sub, viewer: sub, lookaheadId: draft.id, itemId: excavate.id, payload: { status: "done" } })).rejects.toMatchObject({ code: "LOOKAHEAD_ITEM_FORBIDDEN" });
    await expect(service.updateItem({ ...scope, actor: sub, viewer: sub, lookaheadId: draft.id, itemId: subTask.id, payload: { status: "in_progress", pctComplete: 30 } })).resolves.toMatchObject({ status: "in_progress", pctComplete: 30 });
    const own = await service.addItem({ ...scope, actor: sub, viewer: sub, lookaheadId: draft.id, payload: { name: "Cage delivery", plannedStart: "2026-09-18", companyId: "co-main" } });
    expect(own.companyId).toBe("co-sub");
    expect((await service.listConstraints({ ...scope, viewer: sub })).summary.open).toBe(0);
  });

  it("exports the plan as a workbook with the day grid, constraints, PPC and about sheets", async () => {
    const lookahead = await create();
    await service.updateItem({ ...scope, actor, lookaheadId: lookahead.id, itemId: lookahead.items[0].id, payload: { constraint: "Rebar delivery", constraintDueDate: "2026-09-17" } });
    const { workbook, filename } = await service.exportLookahead({ ...scope, lookaheadId: lookahead.id, viewer: actor });
    expect(filename).toBe("la-001-lookahead.xlsx");
    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual(["Plan", "Constraints", "PPC", "About"]);
    const plan = workbook.getWorksheet("Plan");
    expect(plan.getRow(2).cellCount).toBe(10 + 21);
    expect(plan.getRow(1).getCell(11).value).toBe("Week 1 · 14 Sep – 20 Sep");
    expect(plan.getRow(3).getCell(1).value).toBe("Excavate footings");
    expect(plan.getRow(3).getCell(11).value).toBe("■");
    expect(plan.getRow(3).getCell(16).value).toBe("");
    expect(workbook.getWorksheet("Constraints").getRow(2).getCell(2).value).toBe("Rebar delivery");
    expect(workbook.getWorksheet("PPC").getRow(2).getCell(1).value).toBe(1);
  });
});
