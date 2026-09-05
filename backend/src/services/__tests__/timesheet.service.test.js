const store = { workers: [], crews: [], crewMembers: [], timesheets: [], entries: [], costRecords: [], budgetLines: [], notifications: [] };
let seq = 0;
const nextId = (prefix) => `${prefix}-${(seq += 1)}`;
const clone = (row) => (row ? JSON.parse(JSON.stringify(row), (key, value) => (["date", "createdAt", "updatedAt", "submittedAt", "approvedAt", "rejectedAt", "postedAt", "actualThroughDate"].includes(key) && value ? new Date(value) : value)) : row);

const matches = (row, where = {}) =>
  Object.entries(where).every(([key, condition]) => {
    if (key === "OR") return condition.some((clause) => matches(row, clause));
    if (key === "AND") return condition.every((clause) => matches(row, clause));
    const value = row[key];
    if (condition instanceof Date) return value instanceof Date && value.getTime() === condition.getTime();
    if (condition === null || typeof condition !== "object") return value === condition;
    if ("in" in condition) return condition.in.includes(value);
    if ("notIn" in condition) return !condition.notIn.includes(value);
    if ("not" in condition) return value !== condition.not;
    if ("equals" in condition) return String(value || "").toLowerCase() === String(condition.equals).toLowerCase();
    if ("contains" in condition) return String(value || "").toLowerCase().includes(String(condition.contains).toLowerCase());
    if ("gte" in condition || "lte" in condition) return (!condition.gte || value >= condition.gte) && (!condition.lte || value <= condition.lte);
    if (key === "crew" && condition.projectId) return store.crews.find((crew) => crew.id === row.crewId)?.projectId === condition.projectId;
    return true;
  });

const applyData = (row, data) => {
  const next = { ...row };
  for (const [key, value] of Object.entries(data)) {
    if (value && typeof value === "object" && !(value instanceof Date) && ("increment" in value || "decrement" in value)) next[key] = Number(next[key] || 0) + Number(value.increment || 0) - Number(value.decrement || 0);
    else next[key] = value;
  }
  next.updatedAt = new Date();
  return next;
};

const table = (name, { hydrate = (row) => row } = {}) => ({
  findMany: jest.fn(async ({ where = {}, orderBy } = {}) => {
    let rows = store[name].filter((row) => matches(row, where)).map((row) => hydrate(clone(row)));
    if (orderBy) {
      const orders = Array.isArray(orderBy) ? orderBy : [orderBy];
      rows = rows.sort((a, b) => {
        for (const order of orders) {
          const [key, dir] = Object.entries(order)[0];
          const av = a[key];
          const bv = b[key];
          if (av === bv) continue;
          return (av > bv ? 1 : -1) * (dir === "desc" ? -1 : 1);
        }
        return 0;
      });
    }
    return rows;
  }),
  findFirst: jest.fn(async ({ where = {} } = {}) => {
    const row = store[name].find((item) => matches(item, where));
    return row ? hydrate(clone(row)) : null;
  }),
  count: jest.fn(async ({ where = {} } = {}) => store[name].filter((row) => matches(row, where)).length),
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
  upsert: jest.fn(async ({ where, create, update }) => {
    const key = Object.values(where)[0];
    const index = store[name].findIndex((row) => Object.entries(key).every(([field, value]) => row[field] === value));
    if (index >= 0) {
      store[name][index] = applyData(store[name][index], update);
      return clone(store[name][index]);
    }
    const row = { id: nextId(name), createdAt: new Date(), ...create };
    store[name].push(row);
    return clone(row);
  }),
  delete: jest.fn(async ({ where }) => {
    store[name] = store[name].filter((row) => row.id !== where.id);
    return {};
  }),
  deleteMany: jest.fn(async ({ where = {} } = {}) => {
    const before = store[name].length;
    store[name] = store[name].filter((row) => !matches(row, where));
    return { count: before - store[name].length };
  }),
});

const ACTIVITIES = [
  { id: "act-1", projectId: "p1", name: "Pour slab L1", activityCode: "A100", wbsCode: "1.2", physComplete: 40 },
  { id: "act-2", projectId: "p1", name: "Formwork L2", activityCode: "A200", wbsCode: "1.3", physComplete: 10 },
];
const COMPANIES = [
  { id: "co-1", orgId: "org-1", name: "Main Contractor" },
  { id: "co-2", orgId: "org-1", name: "Steel Fixers Ltd" },
];

const hydrateWorker = (row) => ({ ...row, company: COMPANIES.find((company) => company.id === row.companyId) || null });
const hydrateEntry = (row) => ({ ...row, worker: hydrateWorker(clone(store.workers.find((worker) => worker.id === row.workerId))), activity: ACTIVITIES.find((activity) => activity.id === row.activityId) || null, costCode: row.costCodeId ? { id: row.costCodeId, code: "03-100", name: "Concrete labour" } : null, location: null });
const hydrateTimesheet = (row) => ({ ...row, crew: store.crews.find((crew) => crew.id === row.crewId) ? { id: row.crewId, name: store.crews.find((crew) => crew.id === row.crewId).name, foremanUserId: store.crews.find((crew) => crew.id === row.crewId).foremanUserId } : null, entries: store.entries.filter((entry) => entry.timesheetId === row.id).sort((a, b) => a.sortOrder - b.sortOrder).map((entry) => hydrateEntry(clone(entry))), _count: { entries: store.entries.filter((entry) => entry.timesheetId === row.id).length } });
const hydrateCrew = (row) => ({ ...row, company: COMPANIES.find((company) => company.id === row.companyId) || null, members: store.crewMembers.filter((member) => member.crewId === row.id).sort((a, b) => a.sortOrder - b.sortOrder).map((member) => ({ ...member, worker: hydrateWorker(clone(store.workers.find((worker) => worker.id === member.workerId))) })), _count: { members: store.crewMembers.filter((member) => member.crewId === row.id).length } });

const mockPrisma = {
  project: { findFirst: jest.fn(async ({ where }) => (where.id === "p1" ? { id: "p1", name: "Tower" } : null)) },
  company: { findFirst: jest.fn(async ({ where }) => COMPANIES.find((company) => company.id === where.id) || null), findMany: jest.fn(async () => COMPANIES) },
  activity: { findMany: jest.fn(async ({ where }) => ACTIVITIES.filter((activity) => activity.projectId === where.projectId && (!where.id?.in || where.id.in.includes(activity.id))).map((activity) => ({ id: activity.id }))), findFirst: jest.fn(async ({ where }) => ACTIVITIES.find((activity) => activity.id === where.id && activity.projectId === where.projectId) || null) },
  projectCostCode: { findMany: jest.fn(async ({ where }) => (where.costCodeId?.in || []).filter((id) => id === "cc-1").map((id) => ({ costCodeId: id }))), findFirst: jest.fn(async ({ where }) => (where.costCodeId === "cc-1" ? { id: "pcc-1" } : null)) },
  location: { findMany: jest.fn(async () => []) },
  activityProgress: { findMany: jest.fn(async ({ where }) => ACTIVITIES.filter((activity) => where.activityId.in.includes(activity.id)).map((activity) => ({ activityId: activity.id, pctComplete: activity.physComplete, updatedAt: new Date() }))) },
  worker: table("workers", { hydrate: hydrateWorker }),
  crew: table("crews", { hydrate: hydrateCrew }),
  crewMember: table("crewMembers"),
  timesheet: table("timesheets", { hydrate: hydrateTimesheet }),
  timeEntry: table("entries", { hydrate: hydrateEntry }),
  costRecord: table("costRecords"),
  budgetLine: table("budgetLines"),
  $transaction: jest.fn(async (fn) => fn(mockPrisma)),
};
const mockAudit = { ACTIONS: { CREATED: "created", UPDATED: "updated", STATUS_CHANGED: "status_changed", APPROVED: "approved", REJECTED: "rejected", DELETED: "deleted" }, recordEvent: jest.fn(async () => null) };
const mockNotifications = { NOTIFICATION_CATEGORIES: { APPROVAL: "approval" }, createNotifications: jest.fn(async (payload) => store.notifications.push(payload)) };
const mockParty = { isPartyScopedAccess: (access) => Boolean(access?.partyAccess?.length) };

jest.mock("../../config/db", () => ({ prisma: mockPrisma }));
jest.mock("../audit.service", () => mockAudit);
jest.mock("../notification.service", () => mockNotifications);
jest.mock("../company-party.service", () => mockParty);

const service = require("../timesheet.service");

const scope = { orgId: "org-1", projectId: "p1" };
const pm = { id: "u-pm", role: "pm", projectAccess: null };
const sub = { id: "u-sub", role: "site_engineer", projectAccess: { partyAccess: [{ projectPartyId: "party-2", companyId: "co-2" }] } };

const seed = () => {
  store.workers = [
    { id: "w-1", orgId: "org-1", companyId: "co-1", name: "Ali Hassan", employeeNumber: "E-001", trade: "Carpenter", hourlyRate: 20, overtimeMultiplier: 1.5, status: "active", createdAt: new Date(), updatedAt: new Date() },
    { id: "w-2", orgId: "org-1", companyId: "co-1", name: "Ben Okoro", employeeNumber: "E-002", trade: "Labourer", hourlyRate: 12, overtimeMultiplier: 1.5, status: "active", createdAt: new Date(), updatedAt: new Date() },
    { id: "w-3", orgId: "org-1", companyId: "co-2", name: "Carla Reyes", employeeNumber: "S-010", trade: "Steel fixer", hourlyRate: 25, overtimeMultiplier: 2, status: "active", createdAt: new Date(), updatedAt: new Date() },
  ];
  store.crews = [{ id: "crew-1", orgId: "org-1", projectId: "p1", name: "Formwork A", companyId: "co-1", partyId: null, foremanUserId: "u-foreman", defaultCostCodeId: "cc-1", defaultActivityId: "act-1", status: "active", createdBy: "u-pm", createdAt: new Date(), updatedAt: new Date() }];
  store.crewMembers = [
    { id: "cm-1", crewId: "crew-1", workerId: "w-1", role: "member", sortOrder: 0 },
    { id: "cm-2", crewId: "crew-1", workerId: "w-2", role: "member", sortOrder: 1 },
  ];
  store.timesheets = [];
  store.entries = [];
  store.costRecords = [{ id: "cr-1", projectId: "p1", activityId: "act-1", labour: 10000, budget: 50000, actual: 1000, actualThroughDate: new Date("2026-09-01T00:00:00Z") }];
  store.budgetLines = [{ id: "bl-1", projectId: "p1", costCodeId: "cc-1", costType: "labour", status: "active", actual: 500 }];
  store.notifications = [];
};

describe("timesheets and crews", () => {
  beforeEach(() => {
    seed();
    jest.clearAllMocks();
  });

  it("creates a crew timesheet pre-filled from the members and the crew defaults", async () => {
    const sheet = await service.createTimesheet({ ...scope, payload: { date: "2026-09-07", crewId: "crew-1" }, actor: pm, viewer: pm });
    expect(sheet).toMatchObject({ date: "2026-09-07", status: "draft", crewId: "crew-1", companyId: "co-1", regularHours: 16, overtimeHours: 0, totalCost: 0 });
    expect(sheet.entries.map((entry) => [entry.worker.name, entry.activityId, entry.costCodeId, entry.hours])).toEqual([
      ["Ali Hassan", "act-1", "cc-1", 8],
      ["Ben Okoro", "act-1", "cc-1", 8],
    ]);
    await expect(service.createTimesheet({ ...scope, payload: { date: "2026-09-07", crewId: "crew-1" }, actor: pm, viewer: pm })).rejects.toMatchObject({ code: "TIMESHEET_EXISTS", status: 409 });
    const replay = await service.createTimesheet({ ...scope, payload: { date: "2026-09-08", crewId: "crew-1", clientRequestId: "req-1" }, actor: pm, viewer: pm });
    expect((await service.createTimesheet({ ...scope, payload: { date: "2026-09-08", crewId: "crew-1", clientRequestId: "req-1" }, actor: pm, viewer: pm })).id).toBe(replay.id);
  });

  it("validates entries: project references, hours per entry and per worker per day", async () => {
    const sheet = await service.createTimesheet({ ...scope, payload: { date: "2026-09-07", crewId: "crew-1" }, actor: pm, viewer: pm });
    await expect(service.updateTimesheet({ ...scope, timesheetId: sheet.id, payload: { entries: [{ workerId: "w-1", activityId: "act-9", hours: 8 }] }, actor: pm, viewer: pm })).rejects.toMatchObject({ code: "TIMESHEET_ENTRY_ACTIVITY" });
    await expect(service.updateTimesheet({ ...scope, timesheetId: sheet.id, payload: { entries: [{ workerId: "w-1", activityId: "act-1", costCodeId: "cc-9", hours: 8 }] }, actor: pm, viewer: pm })).rejects.toMatchObject({ code: "TIMESHEET_ENTRY_COST_CODE" });
    await expect(service.updateTimesheet({ ...scope, timesheetId: sheet.id, payload: { entries: [{ workerId: "w-1", activityId: "act-1", hours: 30 }] }, actor: pm, viewer: pm })).rejects.toMatchObject({ code: "TIMESHEET_ENTRY_HOURS" });
    await expect(service.updateTimesheet({ ...scope, timesheetId: sheet.id, payload: { entries: [{ workerId: "w-1", activityId: "act-1", hours: 14 }, { workerId: "w-1", activityId: "act-2", hours: 12, timeType: "overtime" }] }, actor: pm, viewer: pm })).rejects.toMatchObject({ code: "TIMESHEET_HOURS_EXCEEDED" });
    const updated = await service.updateTimesheet({ ...scope, timesheetId: sheet.id, payload: { notes: "Slab pour", entries: [{ workerId: "w-1", activityId: "act-1", costCodeId: "cc-1", hours: 8 }, { workerId: "w-1", activityId: "act-1", costCodeId: "cc-1", hours: 2, timeType: "overtime" }, { workerId: "w-2", activityId: "act-2", hours: 8 }] }, actor: pm, viewer: pm });
    expect(updated).toMatchObject({ notes: "Slab pour", regularHours: 16, overtimeHours: 2, entryCount: 3, workerCount: 2 });
  });

  it("submits only with an activity on every entry and notifies the approvers", async () => {
    const sheet = await service.createTimesheet({ ...scope, payload: { date: "2026-09-07", entries: [{ workerId: "w-1", hours: 8 }] }, actor: pm, viewer: pm });
    await expect(service.submitTimesheet({ ...scope, timesheetId: sheet.id, actor: pm, viewer: pm })).rejects.toMatchObject({ code: "TIMESHEET_ENTRY_ACTIVITY_REQUIRED" });
    const fixed = await service.updateTimesheet({ ...scope, timesheetId: sheet.id, payload: { entries: [{ workerId: "w-1", activityId: "act-1", hours: 8 }] }, actor: pm, viewer: pm });
    const submitted = await service.submitTimesheet({ ...scope, timesheetId: fixed.id, actor: pm, viewer: pm });
    expect(submitted.status).toBe("submitted");
    expect(submitted.submittedBy).toBe("u-pm");
    expect(store.notifications[0]).toMatchObject({ event: "timesheet.submitted", recipientRoles: ["pm", "cost_controller"], entityType: "timesheet" });
    await expect(service.updateTimesheet({ ...scope, timesheetId: fixed.id, payload: { notes: "x" }, actor: pm, viewer: pm })).rejects.toMatchObject({ code: "TIMESHEET_LOCKED" });
  });

  it("approves: snapshots rates, posts labour cost to the activity and the labour budget line, and reopening reverses it", async () => {
    const sheet = await service.createTimesheet({ ...scope, payload: { date: "2026-09-07", crewId: "crew-1", entries: [{ workerId: "w-1", activityId: "act-1", costCodeId: "cc-1", hours: 8 }, { workerId: "w-1", activityId: "act-1", costCodeId: "cc-1", hours: 2, timeType: "overtime" }, { workerId: "w-2", activityId: "act-2", hours: 8 }] }, actor: pm, viewer: pm });
    await service.submitTimesheet({ ...scope, timesheetId: sheet.id, actor: pm, viewer: pm });
    const approved = await service.approveTimesheet({ ...scope, timesheetId: sheet.id, actor: pm, viewer: pm });
    // 8 × 20 + 2 × 20 × 1.5 + 8 × 12 = 160 + 60 + 96
    expect(approved).toMatchObject({ status: "approved", totalCost: 316, regularHours: 16, overtimeHours: 2 });
    expect(approved.entries.map((entry) => [entry.rate, entry.amount, entry.budgetLineId])).toEqual([
      [20, 160, "bl-1"],
      [20, 60, "bl-1"],
      [12, 96, null],
    ]);
    expect(store.costRecords.find((row) => row.activityId === "act-1")).toMatchObject({ actual: 1220, actualThroughDate: new Date("2026-09-07T00:00:00Z") });
    expect(store.costRecords.find((row) => row.activityId === "act-2")).toMatchObject({ actual: 96 });
    expect(store.budgetLines[0].actual).toBe(720);
    expect(store.notifications.at(-1)).toMatchObject({ event: "timesheet.approved", recipientUserIds: ["u-pm"] });

    const reopened = await service.reopenTimesheet({ ...scope, timesheetId: sheet.id, payload: { reason: "wrong crew" }, actor: pm, viewer: pm });
    expect(reopened.status).toBe("draft");
    expect(reopened.totalCost).toBe(0);
    expect(store.costRecords.find((row) => row.activityId === "act-1").actual).toBe(1000);
    expect(store.costRecords.find((row) => row.activityId === "act-2").actual).toBe(0);
    expect(store.budgetLines[0].actual).toBe(500);
    expect(reopened.notes).toContain("Reopened: wrong crew");
  });

  it("returns a submitted timesheet with a reason and refuses approval otherwise", async () => {
    const sheet = await service.createTimesheet({ ...scope, payload: { date: "2026-09-07", crewId: "crew-1" }, actor: pm, viewer: pm });
    await expect(service.approveTimesheet({ ...scope, timesheetId: sheet.id, actor: pm, viewer: pm })).rejects.toMatchObject({ code: "TIMESHEET_NOT_SUBMITTED" });
    await service.submitTimesheet({ ...scope, timesheetId: sheet.id, actor: pm, viewer: pm });
    await expect(service.rejectTimesheet({ ...scope, timesheetId: sheet.id, payload: {}, actor: pm, viewer: pm })).rejects.toMatchObject({ code: "TIMESHEET_REASON_REQUIRED" });
    const rejected = await service.rejectTimesheet({ ...scope, timesheetId: sheet.id, payload: { reason: "Ben was on leave" }, actor: pm, viewer: pm });
    expect(rejected).toMatchObject({ status: "rejected", rejectionReason: "Ben was on leave" });
    const edited = await service.updateTimesheet({ ...scope, timesheetId: sheet.id, payload: { entries: [{ workerId: "w-1", activityId: "act-1", hours: 8 }] }, actor: pm, viewer: pm });
    expect(edited.entryCount).toBe(1);
    expect((await service.submitTimesheet({ ...scope, timesheetId: sheet.id, actor: pm, viewer: pm })).rejectionReason).toBeNull();
  });

  it("scopes party users to their company's workers, crews and timesheets", async () => {
    const workers = await service.listWorkers({ orgId: "org-1", query: { projectId: "p1" }, viewer: sub });
    expect(workers.items.map((row) => row.name)).toEqual(["Carla Reyes"]);
    const created = await service.createWorker({ orgId: "org-1", payload: { name: "Dev Patel", companyId: "co-1", hourlyRate: 18 }, actor: sub, viewer: sub });
    expect(created.companyId).toBe("co-2");
    await expect(service.updateWorker({ orgId: "org-1", workerId: "w-1", payload: { hourlyRate: 99 }, viewer: sub })).rejects.toMatchObject({ status: 403 });
    await expect(service.createCrew({ ...scope, payload: { name: "Steel B", workerIds: ["w-1"] }, actor: sub, viewer: sub })).rejects.toMatchObject({ status: 403 });
    const crew = await service.createCrew({ ...scope, payload: { name: "Steel B", workerIds: ["w-3", created.id], defaultActivityId: "act-1" }, actor: sub, viewer: sub });
    expect(crew).toMatchObject({ companyId: "co-2", partyId: "party-2", memberCount: 2 });
    expect((await service.listCrews({ ...scope, viewer: sub })).items.map((row) => row.name)).toEqual(["Steel B"]);
    await service.createTimesheet({ ...scope, payload: { date: "2026-09-07", crewId: "crew-1" }, actor: pm, viewer: pm });
    const mine = await service.createTimesheet({ ...scope, payload: { date: "2026-09-07", crewId: crew.id }, actor: sub, viewer: sub });
    expect(mine.companyId).toBe("co-2");
    expect((await service.listTimesheets({ ...scope, query: {}, viewer: sub })).items.map((row) => row.id)).toEqual([mine.id]);
    expect((await service.listTimesheets({ ...scope, query: {}, viewer: pm })).items).toHaveLength(2);
    await expect(service.getTimesheet({ ...scope, timesheetId: store.timesheets[0].id, viewer: sub })).rejects.toMatchObject({ status: 403 });
  });

  it("builds the week grid, productivity by activity and the XLSX export", async () => {
    const monday = await service.createTimesheet({ ...scope, payload: { date: "2026-09-07", crewId: "crew-1" }, actor: pm, viewer: pm });
    await service.submitTimesheet({ ...scope, timesheetId: monday.id, actor: pm, viewer: pm });
    await service.approveTimesheet({ ...scope, timesheetId: monday.id, actor: pm, viewer: pm });
    const tuesday = await service.createTimesheet({ ...scope, payload: { date: "2026-09-08", entries: [{ workerId: "w-1", activityId: "act-2", hours: 6 }, { workerId: "w-1", activityId: "act-2", hours: 3, timeType: "double" }] }, actor: pm, viewer: pm });
    const week = await service.weekSummary({ ...scope, weekStart: "2026-09-07", viewer: pm });
    expect(week.days[0]).toBe("2026-09-07");
    expect(week.days[6]).toBe("2026-09-13");
    const ali = week.workers.find((row) => row.name === "Ali Hassan");
    expect(ali.days.map((day) => day.hours)).toEqual([8, 9, 0, 0, 0, 0, 0]);
    expect(ali).toMatchObject({ hours: 17, overtime: 3, cost: 160 });
    expect(week.totals).toMatchObject({ hours: 25, workers: 2, timesheets: 2, dayTotals: [16, 9, 0, 0, 0, 0, 0], byStatus: { draft: 1, approved: 1 } });
    expect(week.activities.map((row) => [row.name, row.hours])).toEqual([
      ["Pour slab L1", 16],
      ["Formwork L2", 9],
    ]);
    expect(week.crews.map((row) => row.name)).toEqual(["Formwork A", "No crew"]);

    const productivity = await service.productivity({ ...scope, query: { from: "2026-09-01", to: "2026-09-30" }, viewer: pm });
    expect(productivity.items).toHaveLength(1);
    expect(productivity.items[0]).toMatchObject({ activityId: "act-1", hours: 16, cost: 256, workers: 2, days: 1, pctComplete: 40, labourBudget: 10000, earnedLabour: 4000, labourBurnPct: 2.56, hoursPerPct: 0.4, warning: null });
    expect(tuesday.status).toBe("draft");

    const exported = await service.exportTimesheets({ ...scope, query: { from: "2026-09-07", to: "2026-09-13" }, viewer: pm });
    expect(exported.fileName).toBe("timesheets-2026-09-07-2026-09-13.xlsx");
    expect(exported.rows).toBe(4);
    expect(exported.buffer.length).toBeGreaterThan(1000);
  });

  it("imports workers by employee number or name and manages crews", async () => {
    const result = await service.importWorkers({ orgId: "org-1", rows: [{ name: "Ali H.", employeeNumber: "E-001", hourlyRate: 22 }, { name: "New Person", trade: "Mason", companyName: "Main Contractor" }, { name: "" }], actor: pm, viewer: pm });
    expect(result).toMatchObject({ created: 1, updated: 1, skipped: 0 });
    expect(result.errors).toHaveLength(1);
    expect(store.workers.find((row) => row.employeeNumber === "E-001")).toMatchObject({ name: "Ali H.", hourlyRate: 22 });
    expect(store.workers.find((row) => row.name === "New Person")).toMatchObject({ companyId: "co-1", trade: "Mason" });
    const crew = await service.updateCrew({ ...scope, crewId: "crew-1", payload: { workerIds: ["w-2"], defaultActivityId: "act-2" }, actor: pm, viewer: pm });
    expect(crew.members.map((member) => member.workerId)).toEqual(["w-2"]);
    expect(crew.defaultActivityId).toBe("act-2");
    await expect(service.createCrew({ ...scope, payload: { name: "formwork a" }, actor: pm, viewer: pm })).rejects.toMatchObject({ code: "CREW_NAME_EXISTS" });
    await service.createTimesheet({ ...scope, payload: { date: "2026-09-07", crewId: "crew-1" }, actor: pm, viewer: pm });
    await expect(service.deleteCrew({ ...scope, crewId: "crew-1", actor: pm, viewer: pm })).rejects.toMatchObject({ code: "CREW_IN_USE" });
  });
});
