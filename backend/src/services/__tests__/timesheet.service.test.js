const { createCostLedgerMock } = require("./helpers/cost-ledger-mock");

const store = { workers: [], crews: [], crewMembers: [], timesheets: [], entries: [], costRecords: [], budgetLines: [], notifications: [] };
const mockLedger = createCostLedgerMock();
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
  // Another organisation's company (CERT-2): never a reference of org-1.
  { id: "co-x", orgId: "org-2", name: "Other Org Builders" },
];
// The parties of each project (CERT-2): party-elsewhere is a party of another project.
const PARTIES = [
  { id: "party-1", projectId: "p1" },
  { id: "party-2", projectId: "p1" },
  { id: "party-elsewhere", projectId: "p-other" },
];

// Who belongs to which organisation, by membership (CERT-2): u-guest's home workspace is another
// organisation's, u-other is org-2's only, u-left has left org-1.
const MEMBERSHIPS = [
  { orgId: "org-1", userId: "u-foreman", status: "active" },
  { orgId: "org-1", userId: "u-pm", status: "active" },
  { orgId: "org-1", userId: "u-guest", status: "active" },
  { orgId: "org-1", userId: "u-left", status: "left" },
  { orgId: "org-2", userId: "u-other", status: "active" },
  { orgId: "org-2", userId: "u-guest", status: "active" },
];
const hydrateWorker = (row) => ({ ...row, company: COMPANIES.find((company) => company.id === row.companyId) || null });
const hydrateEntry = (row) => ({ ...row, worker: hydrateWorker(clone(store.workers.find((worker) => worker.id === row.workerId))), activity: ACTIVITIES.find((activity) => activity.id === row.activityId) || null, costCode: row.costCodeId ? { id: row.costCodeId, code: "03-100", name: "Concrete labour" } : null, location: null });
const hydrateTimesheet = (row) => ({ ...row, crew: store.crews.find((crew) => crew.id === row.crewId) ? { id: row.crewId, name: store.crews.find((crew) => crew.id === row.crewId).name, foremanUserId: store.crews.find((crew) => crew.id === row.crewId).foremanUserId } : null, entries: store.entries.filter((entry) => entry.timesheetId === row.id).sort((a, b) => a.sortOrder - b.sortOrder).map((entry) => hydrateEntry(clone(entry))), _count: { entries: store.entries.filter((entry) => entry.timesheetId === row.id).length } });
const hydrateCrew = (row) => ({ ...row, company: COMPANIES.find((company) => company.id === row.companyId) || null, members: store.crewMembers.filter((member) => member.crewId === row.id).sort((a, b) => a.sortOrder - b.sortOrder).map((member) => ({ ...member, worker: hydrateWorker(clone(store.workers.find((worker) => worker.id === member.workerId))) })), _count: { members: store.crewMembers.filter((member) => member.crewId === row.id).length } });

const mockPrisma = {
  project: { findFirst: jest.fn(async ({ where }) => (where.id === "p1" ? { id: "p1", name: "Tower" } : null)) },
  company: { findFirst: jest.fn(async ({ where }) => COMPANIES.find((company) => company.id === where.id && (!where.orgId || company.orgId === where.orgId)) || null), findMany: jest.fn(async ({ where } = {}) => COMPANIES.filter((company) => !where?.orgId || company.orgId === where.orgId)) },
  projectParty: { findFirst: jest.fn(async ({ where }) => PARTIES.find((party) => party.id === where.id && party.projectId === where.projectId) || null) },
  activity: { findMany: jest.fn(async ({ where }) => ACTIVITIES.filter((activity) => activity.projectId === where.projectId && (!where.id?.in || where.id.in.includes(activity.id))).map((activity) => ({ id: activity.id }))), findFirst: jest.fn(async ({ where }) => ACTIVITIES.find((activity) => activity.id === where.id && activity.projectId === where.projectId) || null) },
  projectCostCode: { findMany: jest.fn(async ({ where }) => (where.costCodeId?.in || []).filter((id) => id === "cc-1").map((id) => ({ costCodeId: id }))), findFirst: jest.fn(async ({ where }) => (where.costCodeId === "cc-1" ? { id: "pcc-1" } : null)) },
  location: { findMany: jest.fn(async () => []) },
  organizationMembership: { findMany: jest.fn(async ({ where }) => MEMBERSHIPS.filter((row) => row.orgId === where.orgId && where.userId.in.includes(row.userId) && row.status !== where.status?.not).map((row) => ({ userId: row.userId }))) },
  activityProgress: { findMany: jest.fn(async ({ where }) => ACTIVITIES.filter((activity) => where.activityId.in.includes(activity.id)).map((activity) => ({ activityId: activity.id, pctComplete: activity.physComplete, updatedAt: new Date() }))) },
  worker: table("workers", { hydrate: hydrateWorker }),
  crew: table("crews", { hydrate: hydrateCrew }),
  crewMember: table("crewMembers"),
  timesheet: table("timesheets", { hydrate: hydrateTimesheet }),
  timeEntry: table("entries", { hydrate: hydrateEntry }),
  costRecord: table("costRecords"),
  // The approved allocations a first posting's default forecast is worked from (R5-2): none here.
  activityBoqAllocation: { findMany: jest.fn(async () => []) },
  budgetLine: table("budgetLines"),
  // Approving now posts labour through the cost ledger (OCTA-FIN-LEDGER-059).
  costLedgerEntry: mockLedger.tables.costLedgerEntry,
  $transaction: jest.fn(async (fn) => fn(mockPrisma)),
  $queryRaw: jest.fn(async () => []), // row locks (Phase 21D): nothing to lock in a fake
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
    mockLedger.reset();
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

describe("CERT-2 — a crew's foreman is a member of the organisation", () => {
  beforeEach(() => {
    seed();
    jest.clearAllMocks();
  });

  it("refuses another organisation's person exactly as one who exists nowhere, and stores nothing", async () => {
    const answers = [];
    for (const [name, foremanUserId] of [["Steel C", "u-other"], ["Steel D", "u-that-exists-nowhere"], ["Steel E", "u-left"]]) {
      const error = await service.createCrew({ ...scope, payload: { name, foremanUserId }, actor: pm, viewer: pm }).catch((caught) => caught);
      expect(error).toMatchObject({ status: 404, code: "USER_NOT_FOUND", message: "The foreman is not a member of this organisation" });
      answers.push(JSON.stringify({ status: error.status, code: error.code, message: error.message, details: error.details ?? null }));
    }
    expect(new Set(answers).size).toBe(1);
    expect(mockPrisma.organizationMembership.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ orgId: "org-1", userId: { in: ["u-other"] } }) }));
    expect(store.crews.map((crew) => crew.name)).toEqual(["Formwork A"]);
  });

  it("accepts a member — including one whose home workspace is another organisation — and stores them", async () => {
    const own = await service.createCrew({ ...scope, payload: { name: "Steel F", foremanUserId: "u-foreman" }, actor: pm, viewer: pm });
    expect(own.foremanUserId).toBe("u-foreman");
    const guest = await service.createCrew({ ...scope, payload: { name: "Steel G", foremanUserId: "u-guest" }, actor: pm, viewer: pm });
    expect(guest.foremanUserId).toBe("u-guest");
    expect(store.crews.find((crew) => crew.name === "Steel G").foremanUserId).toBe("u-guest");
  });

  it("the edit route: another organisation's person is refused and the crew keeps its foreman; other edits are not held up by a foreman who has since left", async () => {
    await expect(service.updateCrew({ ...scope, crewId: "crew-1", payload: { foremanUserId: "u-other" }, actor: pm, viewer: pm })).rejects.toMatchObject({ status: 404, code: "USER_NOT_FOUND" });
    expect(store.crews.find((crew) => crew.id === "crew-1").foremanUserId).toBe("u-foreman");
    const moved = await service.updateCrew({ ...scope, crewId: "crew-1", payload: { foremanUserId: "u-guest" }, actor: pm, viewer: pm });
    expect(moved.foremanUserId).toBe("u-guest");
    store.crews[0].foremanUserId = "u-left";
    mockPrisma.organizationMembership.findMany.mockClear();
    const renamed = await service.updateCrew({ ...scope, crewId: "crew-1", payload: { name: "Formwork A1" }, actor: pm, viewer: pm });
    expect(renamed).toMatchObject({ name: "Formwork A1", foremanUserId: "u-left" });
    expect(mockPrisma.organizationMembership.findMany).not.toHaveBeenCalled();
  });
});

describe("CERT-2 — a crew's party is a party of this project", () => {
  beforeEach(() => {
    seed();
    jest.clearAllMocks();
  });

  it("refuses another project's party exactly as one that exists nowhere, and stores nothing", async () => {
    const answers = [];
    for (const [name, partyId] of [["Steel P1", "party-elsewhere"], ["Steel P2", "party-that-exists-nowhere"]]) {
      const error = await service.createCrew({ ...scope, payload: { name, partyId }, actor: pm, viewer: pm }).catch((caught) => caught);
      expect(error).toMatchObject({ status: 400, code: "CREW_PARTY_INVALID", message: "The party is not on this project" });
      answers.push(JSON.stringify({ status: error.status, code: error.code, message: error.message, details: error.details ?? null }));
    }
    expect(answers[0]).toBe(answers[1]);
    expect(mockPrisma.projectParty.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "party-elsewhere", projectId: "p1" } }));
    expect(store.crews.map((crew) => crew.name)).toEqual(["Formwork A"]);
  });

  it("accepts a party of the project, stores it, and the crew's timesheets are booked to it", async () => {
    const crew = await service.createCrew({ ...scope, payload: { name: "Steel P3", partyId: "party-1", workerIds: ["w-1"] }, actor: pm, viewer: pm });
    expect(crew.partyId).toBe("party-1");
    expect(store.crews.find((row) => row.name === "Steel P3").partyId).toBe("party-1");
    const sheet = await service.createTimesheet({ ...scope, payload: { date: "2026-09-09", crewId: crew.id }, actor: pm, viewer: pm });
    expect(sheet.partyId).toBe("party-1");
  });

  it("the edit route: another project's party is refused and the crew keeps its own; an edit that leaves the party as it was is not looked up again", async () => {
    store.crews[0].partyId = "party-1";
    for (const partyId of ["party-elsewhere", "party-that-exists-nowhere"]) {
      await expect(service.updateCrew({ ...scope, crewId: "crew-1", payload: { partyId }, actor: pm, viewer: pm })).rejects.toMatchObject({ status: 400, code: "CREW_PARTY_INVALID", message: "The party is not on this project" });
    }
    expect(mockPrisma.crew.update).not.toHaveBeenCalled();
    expect(store.crews[0].partyId).toBe("party-1");
    const moved = await service.updateCrew({ ...scope, crewId: "crew-1", payload: { partyId: "party-2" }, actor: pm, viewer: pm });
    expect(moved.partyId).toBe("party-2");
    store.crews[0].partyId = "party-since-removed";
    mockPrisma.projectParty.findFirst.mockClear();
    const renamed = await service.updateCrew({ ...scope, crewId: "crew-1", payload: { name: "Formwork A2" }, actor: pm, viewer: pm });
    expect(renamed).toMatchObject({ name: "Formwork A2", partyId: "party-since-removed" });
    expect(mockPrisma.projectParty.findFirst).not.toHaveBeenCalled();
  });
});

/**
 * CERT-2 (bodies-4): a worker's hourly rate is no larger than its columns hold
 * — the worker's Decimal(18,2), and on approval the labour's unit cost
 * (Decimal(18,4)) beside a day's amount (Decimal(18,2)). 1e20 failed at the
 * write with a 500.
 */
describe("CERT-2 — a worker's hourly rate fits its columns", () => {
  beforeEach(() => {
    seed();
    jest.clearAllMocks();
  });

  it("the bound: a day's hours at the highest overtime multiplier stay under 10^16, and the rate under 10^14", () => {
    expect(service.RATE_MAX * 24 * 5).toBeLessThan(1e16);
    expect(service.RATE_MAX).toBeLessThan(1e14);
    expect(service.RATE_MAX * 100).toBeLessThan(Number.MAX_SAFE_INTEGER);
  });

  it.each([[1e20], [service.RATE_MAX + 1], [-1], ["abc"]])("hourlyRate %j is a 400 WORKER_RATE_INVALID on create and edit, and nothing is written", async (hourlyRate) => {
    await expect(service.createWorker({ orgId: "org-1", payload: { name: "Rate probe", hourlyRate }, actor: pm, viewer: pm })).rejects.toMatchObject({ status: 400, code: "WORKER_RATE_INVALID" });
    const existing = store.workers[0];
    await expect(service.updateWorker({ orgId: "org-1", workerId: existing.id, payload: { hourlyRate }, viewer: pm })).rejects.toMatchObject({ status: 400, code: "WORKER_RATE_INVALID" });
    expect(mockPrisma.worker.create).not.toHaveBeenCalled();
    expect(mockPrisma.worker.update).not.toHaveBeenCalled();
  });

  it("the largest rate, a rate in text, none and an edit of something else are accepted", async () => {
    const top = await service.createWorker({ orgId: "org-1", payload: { name: "Top rate", hourlyRate: service.RATE_MAX }, actor: pm, viewer: pm });
    expect(top.hourlyRate).toBe(service.RATE_MAX);
    const text = await service.createWorker({ orgId: "org-1", payload: { name: "Text rate", hourlyRate: "45.50" }, actor: pm, viewer: pm });
    expect(text.hourlyRate).toBe(45.5);
    const none = await service.createWorker({ orgId: "org-1", payload: { name: "No rate", hourlyRate: null }, actor: pm, viewer: pm });
    expect(none.hourlyRate).toBeNull();
    await expect(service.updateWorker({ orgId: "org-1", workerId: store.workers[0].id, payload: { trade: "Fixer" }, viewer: pm })).resolves.toMatchObject({ trade: "Fixer" });
  });

  it("an import row with a rate of 1e20 is reported as that row's error and stored nowhere; the other rows are", async () => {
    const result = await service.importWorkers({ orgId: "org-1", rows: [{ name: "Overflow", employeeNumber: "E-RATE-1", hourlyRate: 1e20 }, { name: "Fine", employeeNumber: "E-RATE-2", hourlyRate: 30 }], actor: pm, viewer: pm });
    expect(result.errors).toEqual([expect.objectContaining({ row: 1, message: expect.stringMatching(/hourly rate/) })]);
    expect(result.created).toBe(1);
    expect(store.workers.some((worker) => worker.name === "Overflow")).toBe(false);
  });
});

/**
 * CERT-2 (alerts-money-5): what a timesheet posts fits what holds it. A day's
 * entry at the highest rate fits its own column, but two of them do not fit
 * the timesheet's total, and one does not fit on top of what an activity has
 * already spent: each was a 500 at the write (numeric field overflow),
 * rolled back. Now a 400 before anything is posted.
 */
describe("CERT-2 — a timesheet's labour cost fits the timesheet and the activity", () => {
  beforeEach(() => {
    seed();
    mockLedger.reset();
    jest.clearAllMocks();
    store.workers.push(
      { id: "w-top-1", orgId: "org-1", companyId: "co-1", name: "Top One", hourlyRate: service.RATE_MAX, overtimeMultiplier: 5, status: "active", createdAt: new Date(), updatedAt: new Date() },
      { id: "w-top-2", orgId: "org-1", companyId: "co-1", name: "Top Two", hourlyRate: service.RATE_MAX, overtimeMultiplier: 5, status: "active", createdAt: new Date(), updatedAt: new Date() },
    );
  });
  const submitted = async (date, entries) => {
    const sheet = await service.createTimesheet({ ...scope, payload: { date, entries }, actor: pm, viewer: pm });
    await service.submitTimesheet({ ...scope, timesheetId: sheet.id, actor: pm, viewer: pm });
    return sheet;
  };
  const state = () => JSON.stringify({ records: store.costRecords, lines: store.budgetLines, ledger: mockLedger.store.entries.length });

  it("two workers at the highest rate on overtime for a day: each entry fits, the timesheet's total does not — a 400 TIMESHEET_TOTAL_TOO_LARGE and nothing posted", async () => {
    const sheet = await submitted("2026-09-07", [{ workerId: "w-top-1", activityId: "act-2", hours: 24, timeType: "overtime" }, { workerId: "w-top-2", activityId: "act-2", hours: 24, timeType: "overtime" }]);
    const before = state();
    await expect(service.approveTimesheet({ ...scope, timesheetId: sheet.id, actor: pm, viewer: pm })).rejects.toMatchObject({ status: 400, code: "TIMESHEET_TOTAL_TOO_LARGE" });
    expect(state()).toBe(before);
    const stored = store.timesheets.find((row) => row.id === sheet.id);
    expect([stored.status, Number(stored.totalCost)]).toEqual(["submitted", 0]);
  });

  it("round 6: entries of 5,000,000,000,000,000 and 4,999,999,999,999,999 fit, and the total stored is exactly their sum (the float sum, 10^16, overflowed the column)", async () => {
    store.workers.push(
      { id: "w-five", orgId: "org-1", companyId: "co-1", name: "Five", hourlyRate: 50000000000000, overtimeMultiplier: 5, status: "active", createdAt: new Date(), updatedAt: new Date() },
      { id: "w-nine", orgId: "org-1", companyId: "co-1", name: "Nine", hourlyRate: 49999999999999.99, overtimeMultiplier: 5, status: "active", createdAt: new Date(), updatedAt: new Date() },
    );
    const sheet = await submitted("2026-09-09", [{ workerId: "w-five", activityId: "act-1", hours: 20, timeType: "overtime" }, { workerId: "w-nine", activityId: "act-2", hours: 20, timeType: "overtime" }]);
    const approved = await service.approveTimesheet({ ...scope, timesheetId: sheet.id, actor: pm, viewer: pm });
    expect(approved.status).toBe("approved");
    const stored = store.timesheets.find((row) => row.id === sheet.id);
    expect(stored.totalCost.toFixed(2)).toBe("9999999999999999.00");
    expect(5e15 + 4999999999999999).toBe(1e16);
  });

  it("one that fits the timesheet but not on top of what the activity has spent is the ledger's 400 COST_LEDGER_TOTAL_TOO_LARGE; one that fits is posted, and reopening it frees the room", async () => {
    const first = await submitted("2026-09-07", [{ workerId: "w-top-1", activityId: "act-1", hours: 12, timeType: "overtime" }]);
    await expect(service.approveTimesheet({ ...scope, timesheetId: first.id, actor: pm, viewer: pm })).resolves.toMatchObject({ status: "approved" });
    const second = await submitted("2026-09-08", [{ workerId: "w-top-2", activityId: "act-1", hours: 12, timeType: "overtime" }]);
    const before = state();
    await expect(service.approveTimesheet({ ...scope, timesheetId: second.id, actor: pm, viewer: pm })).rejects.toMatchObject({ status: 400, code: "COST_LEDGER_TOTAL_TOO_LARGE" });
    expect(state()).toBe(before);
    await service.reopenTimesheet({ ...scope, timesheetId: first.id, payload: { reason: "wrong day" }, actor: pm, viewer: pm });
    await expect(service.approveTimesheet({ ...scope, timesheetId: second.id, actor: pm, viewer: pm })).resolves.toMatchObject({ status: "approved" });
  });
});

describe("CERT-2 — a worker's person and company belong to the organisation", () => {
  beforeEach(() => {
    seed();
    jest.clearAllMocks();
  });

  it("refuses another organisation's person exactly as one who exists nowhere (or has left), and stores nothing; a member is accepted", async () => {
    const answers = [];
    for (const userId of ["u-other", "u-that-exists-nowhere", "u-left"]) {
      const error = await service.createWorker({ orgId: "org-1", payload: { name: `Linked ${userId}`, userId }, actor: pm, viewer: pm }).catch((caught) => caught);
      expect(error).toMatchObject({ status: 404, code: "USER_NOT_FOUND", message: "The person is not a member of this organisation" });
      answers.push(JSON.stringify({ status: error.status, code: error.code, message: error.message, details: error.details ?? null }));
    }
    expect(new Set(answers).size).toBe(1);
    expect(mockPrisma.organizationMembership.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ orgId: "org-1", userId: { in: ["u-other"] } }) }));
    expect(mockPrisma.worker.create).not.toHaveBeenCalled();
    expect(store.workers).toHaveLength(3);
    // A member whose home workspace is another organisation is a colleague here too.
    const guest = await service.createWorker({ orgId: "org-1", payload: { name: "Guest worker", userId: "u-guest" }, actor: pm, viewer: pm });
    expect(guest.userId).toBe("u-guest");
    await expect(service.createWorker({ orgId: "org-1", payload: { name: "Foreign co", companyId: "co-x" }, actor: pm, viewer: pm })).rejects.toMatchObject({ status: 400, code: "WORKER_COMPANY_INVALID", message: "Unknown company" });
  });

  it("the edit route: another organisation's person or company is refused as one that exists nowhere and the worker is unchanged; a person who has since left does not hold up other edits", async () => {
    for (const userId of ["u-other", "u-that-exists-nowhere"]) {
      await expect(service.updateWorker({ orgId: "org-1", workerId: "w-1", payload: { userId }, viewer: pm })).rejects.toMatchObject({ status: 404, code: "USER_NOT_FOUND", message: "The person is not a member of this organisation" });
    }
    for (const companyId of ["co-x", "co-that-exists-nowhere"]) {
      await expect(service.updateWorker({ orgId: "org-1", workerId: "w-1", payload: { companyId }, viewer: pm })).rejects.toMatchObject({ status: 400, code: "WORKER_COMPANY_INVALID", message: "Unknown company" });
    }
    expect(mockPrisma.worker.update).not.toHaveBeenCalled();
    expect(store.workers[0].companyId).toBe("co-1");
    expect(store.workers[0].userId).toBeUndefined();
    const linked = await service.updateWorker({ orgId: "org-1", workerId: "w-1", payload: { userId: "u-foreman", companyId: "co-2" }, viewer: pm });
    expect(linked).toMatchObject({ userId: "u-foreman", companyId: "co-2" });
    store.workers[0].userId = "u-left";
    mockPrisma.organizationMembership.findMany.mockClear();
    mockPrisma.company.findFirst.mockClear();
    const edited = await service.updateWorker({ orgId: "org-1", workerId: "w-1", payload: { hourlyRate: 30 }, viewer: pm });
    expect(edited).toMatchObject({ hourlyRate: 30, userId: "u-left", companyId: "co-2" });
    expect(mockPrisma.organizationMembership.findMany).not.toHaveBeenCalled();
    expect(mockPrisma.company.findFirst).not.toHaveBeenCalled();
  });

  it("import: a row naming another organisation's person or company is refused exactly as one naming nothing — that row only; the matched worker is not changed", async () => {
    const result = await service.importWorkers({
      orgId: "org-1",
      rows: [
        { name: "Row foreign person", userId: "u-other" },
        { name: "Row nowhere person", userId: "u-that-exists-nowhere" },
        { name: "Row foreign company", companyId: "co-x" },
        { name: "Row nowhere company", companyId: "co-that-exists-nowhere" },
        { name: "Row own", userId: "u-guest", companyId: "co-2" },
        { name: "Ali H.", employeeNumber: "E-001", userId: "u-other" },
      ],
      actor: pm,
      viewer: pm,
    });
    expect(result).toMatchObject({ created: 1, updated: 0, skipped: 0 });
    expect(result.errors).toEqual([
      { row: 1, message: "The person is not a member of this organisation" },
      { row: 2, message: "The person is not a member of this organisation" },
      { row: 3, message: "Unknown company" },
      { row: 4, message: "Unknown company" },
      { row: 6, message: "The person is not a member of this organisation" },
    ]);
    expect(store.workers.map((row) => row.name)).toEqual(["Ali Hassan", "Ben Okoro", "Carla Reyes", "Row own"]);
    expect(store.workers.find((row) => row.name === "Row own")).toMatchObject({ userId: "u-guest", companyId: "co-2" });
    expect(mockPrisma.worker.update).not.toHaveBeenCalled();
  });

  it("import: the database's own text never reaches the answer", async () => {
    mockPrisma.worker.create.mockImplementationOnce(async () => {
      throw Object.assign(new Error("\nInvalid `prisma.worker.create()` invocation in\nC:\\app\\src\\services\\timesheet.service.js:265:29\nForeign key constraint violated on the constraint: `Worker_userId_fkey`"), { code: "P2003" });
    });
    const result = await service.importWorkers({ orgId: "org-1", rows: [{ name: "Row one" }, { name: "Row two" }], actor: pm, viewer: pm });
    expect(result).toMatchObject({ created: 1, errors: [{ row: 1, message: "The row could not be imported" }] });
    expect(JSON.stringify(result)).not.toMatch(/prisma|constraint|timesheet\.service/i);
  });

  it("a timesheet is booked to a company of the organisation's directory only", async () => {
    for (const companyId of ["co-x", "co-that-exists-nowhere"]) {
      await expect(service.createTimesheet({ ...scope, payload: { date: "2026-09-10", companyId }, actor: pm, viewer: pm })).rejects.toMatchObject({ status: 400, code: "TIMESHEET_COMPANY_INVALID", message: "Unknown company" });
    }
    expect(store.timesheets).toHaveLength(0);
    const sheet = await service.createTimesheet({ ...scope, payload: { date: "2026-09-10", companyId: "co-2" }, actor: pm, viewer: pm });
    expect(sheet.companyId).toBe("co-2");
  });
});

describe("Phase 21D — integrity (release challenge)", () => {
  afterEach(() => mockPrisma.$queryRaw.mockImplementation(async () => []));

  it("CX21-414: a return that started on a submitted timesheet refuses once it was approved under the lock", async () => {
    const sheet = { id: "ts-9", orgId: "org-1", projectId: "p1", status: "submitted", date: new Date("2027-02-02"), entries: [{ id: "e1", hours: 8, rate: 50, activityId: "act-1", worker: { name: "A" } }], crew: null };
    mockPrisma.timesheet.findFirst.mockResolvedValue(sheet);
    mockPrisma.timesheet.update.mockClear();
    mockPrisma.$queryRaw.mockImplementation(async (strings) => (Array.isArray(strings) && strings.join("?").includes('FROM "Timesheet"') ? [{ status: "approved" }] : []));
    await expect(service.rejectTimesheet({ orgId: "org-1", projectId: "p1", timesheetId: "ts-9", payload: { reason: "wrong hours" }, actor: { id: "pm" } })).rejects.toMatchObject({ code: "TIMESHEET_NOT_SUBMITTED" });
    expect(mockPrisma.timesheet.update).not.toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "rejected" }) }));
  });
});

describe("Phase 21D — integrity (release challenge, second pass)", () => {
  afterEach(() => mockPrisma.$queryRaw.mockImplementation(async () => []));

  it("CX21-423: an edit that started on a draft refuses once the sheet was approved under the lock", async () => {
    const sheet = { id: "ts-8", orgId: "org-1", projectId: "p1", status: "draft", date: new Date("2027-02-02"), entries: [], crew: null };
    mockPrisma.timesheet.findFirst.mockResolvedValue(sheet);
    mockPrisma.timeEntry.deleteMany.mockClear();
    mockPrisma.$queryRaw.mockImplementation(async (strings) => (Array.isArray(strings) && strings.join("?").includes('FROM "Timesheet"') ? [{ status: "approved" }] : []));
    await expect(service.updateTimesheet({ orgId: "org-1", projectId: "p1", timesheetId: "ts-8", payload: { notes: "late" }, actor: { id: "site" } })).rejects.toMatchObject({ code: "TIMESHEET_LOCKED" });
    expect(mockPrisma.timeEntry.deleteMany).not.toHaveBeenCalled();
    mockPrisma.timesheet.delete.mockClear();
    await expect(service.deleteTimesheet({ orgId: "org-1", projectId: "p1", timesheetId: "ts-8", actor: { id: "site" } })).rejects.toMatchObject({ code: "TIMESHEET_LOCKED" });
    expect(mockPrisma.timesheet.delete).not.toHaveBeenCalled();
  });
});
