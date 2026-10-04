const table = () => ({
  findFirst: jest.fn(async () => null),
  findMany: jest.fn(async () => []),
  count: jest.fn(async () => 0),
  create: jest.fn(async ({ data }) => ({ id: `new-${Math.random().toString(36).slice(2, 8)}`, ...data })),
  createMany: jest.fn(async ({ data }) => ({ count: data.length })),
  update: jest.fn(async ({ data, where }) => ({ id: where.id, ...data })),
  updateMany: jest.fn(async () => ({ count: 0 })),
  delete: jest.fn(async () => ({})),
});

const mockPrisma = {
  $transaction: jest.fn((fn) => fn(mockPrisma)),
  project: { findFirst: jest.fn(), findMany: jest.fn(async () => []), update: jest.fn(async ({ data }) => ({ id: "project-1", ...data })) },
  projectParty: { findFirst: jest.fn(async () => null), findMany: jest.fn(async () => []) },
  company: { findFirst: jest.fn(async () => ({ name: "ACME Concrete" })) },
  activity: { findFirst: jest.fn(async () => ({ id: "act-1" })), findMany: jest.fn(async () => [{ id: "act-1", name: "Slab pour", p6ActivityId: "A100", wbsCode: null }]) },
  location: { findFirst: jest.fn(async () => ({ id: "loc-1" })), findMany: jest.fn(async () => []) },
  equipment: { findFirst: jest.fn(async () => ({ name: "Tower crane" })), findMany: jest.fn(async () => []) },
  dailyLog: { findUnique: jest.fn(), findMany: jest.fn(async () => []), create: jest.fn(async ({ data }) => ({ id: "log-1", ...data })), update: jest.fn(async ({ data }) => ({ id: "log-1", date: new Date("2026-09-05T00:00:00Z"), ...data })), updateMany: jest.fn(async () => ({ count: 1 })) },
  dailyLogManpower: table(),
  dailyLogEquipment: table(),
  dailyLogDelivery: table(),
  dailyLogVisitor: table(),
  dailyLogDelay: table(),
  dailyLogNote: table(),
  // PC-6 §4: the seventh section and what it names.
  dailyLogQuantity: table(),
  quantityProgressEntry: table(),
  boqItem: { findMany: jest.fn(async () => [{ id: "item-1", code: "1.1", ref: null, description: "Concrete in footings", unit: "m3", unitCode: "m3" }]) },
  // CERT-2: who belongs to the organisation (by membership).
  organizationMembership: { findMany: jest.fn(async () => []) },
};
// The quantity-progress service as the daily log calls it: the Decimal
// helpers are real arithmetic; the row/entry helpers record their calls.
const mockQuantityProgress = (() => {
  const { Decimal } = require("@prisma/client/runtime/library");
  const quantityDecimal = (value) => (value === null || value === undefined || value === "" ? null : new Decimal(value).toDecimalPlaces(3));
  return {
    quantityDecimal,
    quantityNumber: (value) => (quantityDecimal(value) === null ? null : Number(quantityDecimal(value).toFixed(3))),
    // The entries service's own rule, as the section applies it.
    assertPositiveQuantity: (quantity) => {
      if (quantity && quantity.isZero()) throw Object.assign(new Error("A quantity must be greater than zero; record nothing for no work"), { status: 400, code: "QUANTITY_INVALID", details: { field: "quantity" } });
    },
    entriesForDailyLogRows: jest.fn(async () => []),
    mintDailyLogEntries: jest.fn(async () => ({ minted: [], synced: [], kept: [], retired: [] })),
    resolveDailyLogQuantity: jest.fn(async ({ boqItemId, allocationId }) => ({ item: { id: boqItemId }, allocationId: allocationId || "alloc-1", unitCode: "m3" })),
    dailyLogRowEntryGate: jest.fn(async () => null),
    syncDailyLogRowEntry: jest.fn(async () => null),
    deleteDailyLogRowEntry: jest.fn(async () => null),
    rejectDailyLogRowEntry: jest.fn(async () => null),
  };
})();
const mockAssertProgressSubmitAllowed = jest.fn(async () => undefined);
const mockAudit = { ENTITY_TYPES: { DAILY_LOG: "daily_log", PROJECT: "project" }, ACTIONS: { CREATED: "created", UPDATED: "updated", DELETED: "deleted", STATUS_CHANGED: "status_changed", APPROVED: "approved", REJECTED: "rejected" }, recordEvent: jest.fn(async () => ({})) };
const mockNotifications = { NOTIFICATION_CATEGORIES: { APPROVAL: "approval", WORKFLOW: "workflow" }, createNotifications: jest.fn(async () => ({ created: 2 })) };
const mockUpload = jest.fn(async ({ file }) => ({ id: "doc-1", fileName: file.originalname }));
const mockSendEmail = jest.fn(async ({ to }) => ({ delivered: true, to }));
const mockCreateWeatherDelay = jest.fn(async ({ payload }) => ({ id: "wd-1", contractual: payload.contractual }));

jest.mock("../../config/db", () => ({ prisma: mockPrisma }));
jest.mock("../audit.service", () => mockAudit);
jest.mock("../notification.service", () => mockNotifications);
jest.mock("../company-party.service", () => ({ isPartyScopedAccess: (access) => Boolean(access?.partyScoped) }));
jest.mock("../file-storage.service", () => ({ uploadProjectDocument: mockUpload }));
jest.mock("../email.service", () => ({ sendEmail: mockSendEmail }));
jest.mock("../weather.service", () => ({ createWeatherDelay: mockCreateWeatherDelay }));
jest.mock("../weather-feed.service", () => ({ ...jest.requireActual("../weather-feed.service"), fetchDailyWeather: jest.fn() }));
jest.mock("../quantity-progress.service", () => mockQuantityProgress);
jest.mock("../progress.service", () => ({ assertProgressSubmitAllowed: mockAssertProgressSubmitAllowed }));

const weatherFeed = require("../weather-feed.service");
const service = require("../daily-log.service");

const DAY = new Date("2026-09-05T00:00:00.000Z");
const project = (overrides = {}) => ({ id: "project-1", orgId: "org-1", name: "Tower", status: "active", latitude: 24.7, longitude: 46.7, timezone: "Asia/Riyadh", dailyLogSettingsJson: { distributionRoles: ["pm"], distributionEmails: ["client@example.com"], thresholds: { rainMm: 10 } }, ...overrides });
const manpower = (overrides = {}) => ({ id: "mp-1", dailyLogId: "log-1", partyId: null, companyId: "co-1", companyName: "ACME Concrete", trade: "Steel fixer", workers: 12, hours: 9, activityId: "act-1", locationId: null, notes: null, status: "approved", createdBy: "staff-1", submittedAt: null, reviewedBy: null, reviewedAt: null, rejectionReason: null, clientRequestId: null, sortOrder: 0, createdAt: DAY, updatedAt: DAY, ...overrides });
const logRow = (overrides = {}) => ({ id: "log-1", orgId: "org-1", projectId: "project-1", date: DAY, status: "open", weatherJson: null, weatherSource: null, weatherFetchedAt: null, summary: null, submittedAt: null, submittedBy: null, approvedAt: null, approvedBy: null, distributedAt: null, distributionJson: null, pdfDocumentId: null, createdAt: DAY, updatedAt: DAY, manpower: [], equipment: [], deliveries: [], visitors: [], delays: [], notes: [], ...overrides });
const quantityRow = (overrides = {}) => ({ id: "qty-1", dailyLogId: "log-1", partyId: null, activityId: "act-1", boqItemId: "item-1", allocationId: "alloc-1", locationId: null, quantity: "12.500", unitCode: "m3", notes: null, status: "approved", createdBy: "staff-1", submittedAt: null, reviewedBy: null, reviewedAt: null, rejectionReason: null, clientRequestId: null, sortOrder: 0, createdAt: DAY, updatedAt: DAY, ...overrides });
const staff = { id: "staff-1", projectAccess: { assignmentRole: "site_engineer" } };
const partyUser = { id: "sub-user", projectAccess: { partyScoped: true, partyAccess: [{ projectPartyId: "party-1", companyId: "co-2", role: "subcontractor" }] } };

// The weather feed is off unless WEATHER_FEED_ENABLED is exactly "true" (C0-2); these tests are about a process that has it on.
const savedWeatherSwitch = process.env.WEATHER_FEED_ENABLED;
beforeAll(() => {
  process.env.WEATHER_FEED_ENABLED = "true";
});
afterAll(() => {
  if (savedWeatherSwitch === undefined) delete process.env.WEATHER_FEED_ENABLED;
  else process.env.WEATHER_FEED_ENABLED = savedWeatherSwitch;
});

describe("daily log", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPrisma.project.findFirst.mockResolvedValue(project());
    mockPrisma.dailyLog.findUnique.mockResolvedValue(logRow());
    mockPrisma.projectParty.findFirst.mockResolvedValue({ id: "party-1", projectId: "project-1", companyId: "co-2", role: "subcontractor", company: { id: "co-2", name: "Steel Bros" } });
  });

  it("staff entries are approved at once and carry the company name", async () => {
    mockPrisma.dailyLogManpower.create.mockImplementationOnce(async ({ data }) => manpower({ ...data, id: "mp-new" }));
    mockPrisma.dailyLog.findUnique.mockResolvedValueOnce(logRow()).mockResolvedValueOnce(logRow({ manpower: [manpower({ id: "mp-new" })] }));
    const log = await service.addEntry({ orgId: "org-1", projectId: "project-1", date: "2026-09-05", section: "manpower", payload: { companyId: "co-1", trade: "Steel fixer", workers: 12, hours: 9, activityId: "act-1" }, actor: { id: "staff-1" }, viewer: staff });
    expect(mockPrisma.dailyLogManpower.create).toHaveBeenCalledWith({ data: expect.objectContaining({ dailyLogId: "log-1", companyId: "co-1", companyName: "ACME Concrete", trade: "Steel fixer", workers: 12, hours: 9, status: "approved", partyId: null }) });
    expect(log.entryId).toBe("mp-new");
    expect(log.sections.manpower[0]).toMatchObject({ trade: "Steel fixer", manHours: 108, activity: { id: "act-1", name: "Slab pour", code: "A100" } });
    expect(log.totals).toMatchObject({ workers: 12, manHours: 108, entries: 1, awaitingReview: 0 });
    expect(mockNotifications.createNotifications).not.toHaveBeenCalled();
  });

  it("party entries are submitted for review under the viewer's party and replay by clientRequestId", async () => {
    mockPrisma.dailyLogManpower.create.mockImplementationOnce(async ({ data }) => manpower({ ...data, id: "mp-sub" }));
    await service.addEntry({ orgId: "org-1", projectId: "project-1", date: "2026-09-05", section: "manpower", payload: { trade: "Welder", workers: 4, partyId: "party-9", companyId: "co-9", clientRequestId: "req-1" }, actor: { id: "sub-user" }, viewer: partyUser });
    expect(mockPrisma.dailyLogManpower.create).toHaveBeenCalledWith({ data: expect.objectContaining({ partyId: "party-1", companyId: "co-2", companyName: "Steel Bros", status: "submitted", clientRequestId: "req-1", submittedAt: expect.any(Date) }) });
    expect(mockNotifications.createNotifications).toHaveBeenCalledWith(expect.objectContaining({ event: "daily_log.entry_submitted", recipientRoles: ["pm", "site_engineer"] }));

    mockPrisma.dailyLogManpower.findFirst.mockResolvedValueOnce(manpower({ id: "mp-sub", clientRequestId: "req-1" }));
    const replay = await service.addEntry({ orgId: "org-1", projectId: "project-1", date: "2026-09-05", section: "manpower", payload: { trade: "Welder", clientRequestId: "req-1" }, actor: { id: "sub-user" }, viewer: partyUser });
    expect(replay).toMatchObject({ entryId: "mp-sub", replayed: true });
    expect(mockPrisma.dailyLogManpower.create).toHaveBeenCalledTimes(1);
  });

  // ── CERT-2: what a row may name ───────────────────────────────────────────

  it("CERT-2: a row names a company of the organisation's own directory only; another organisation's is refused exactly as one that exists nowhere", async () => {
    // The directory of org-1 holds co-1; the lookup is scoped to the caller's organisation.
    mockPrisma.company.findFirst.mockImplementation(async ({ where }) => (where.id === "co-1" && where.orgId === "org-1" ? { id: "co-1", name: "ACME Concrete" } : null));
    try {
      const base = { manpower: { trade: "Steel fixer", workers: 4 }, equipment: { name: "Excavator" }, deliveries: { description: "Rebar" } };
      for (const [section, payload] of Object.entries(base)) {
        const answers = [];
        for (const companyId of ["co-of-another-org", "co-that-exists-nowhere"]) {
          const error = await service.addEntry({ orgId: "org-1", projectId: "project-1", date: "2026-09-05", section, payload: { ...payload, companyId }, actor: { id: "staff-1" }, viewer: staff }).catch((caught) => caught);
          expect(error).toMatchObject({ status: 400, code: "DAILY_LOG_COMPANY_NOT_FOUND", message: "Company not found" });
          answers.push(JSON.stringify({ status: error.status, code: error.code, message: error.message, details: error.details ?? null }));
        }
        expect(answers[0]).toBe(answers[1]);
        expect(mockPrisma.company.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "co-of-another-org", orgId: "org-1" } }));
      }
      expect(mockPrisma.dailyLogManpower.create).not.toHaveBeenCalled();
      expect(mockPrisma.dailyLogEquipment.create).not.toHaveBeenCalled();
      expect(mockPrisma.dailyLogDelivery.create).not.toHaveBeenCalled();

      // The organisation's own company is accepted and stored.
      await service.addEntry({ orgId: "org-1", projectId: "project-1", date: "2026-09-05", section: "equipment", payload: { name: "Excavator", companyId: "co-1" }, actor: { id: "staff-1" }, viewer: staff });
      expect(mockPrisma.dailyLogEquipment.create).toHaveBeenCalledWith({ data: expect.objectContaining({ companyId: "co-1", name: "Excavator" }) });

      // The edit route: pointing a row at another organisation's company is refused and the row is not written…
      mockPrisma.dailyLogManpower.findFirst.mockResolvedValueOnce(manpower());
      await expect(service.updateEntry({ orgId: "org-1", projectId: "project-1", date: "2026-09-05", section: "manpower", entryId: "mp-1", payload: { companyId: "co-of-another-org" }, actor: { id: "staff-1" }, viewer: staff })).rejects.toMatchObject({ status: 400, code: "DAILY_LOG_COMPANY_NOT_FOUND" });
      expect(mockPrisma.dailyLogManpower.update).not.toHaveBeenCalled();
      // …and an edit that leaves the row's company as it was is not looked up again.
      mockPrisma.company.findFirst.mockClear();
      mockPrisma.dailyLogManpower.findFirst.mockResolvedValueOnce(manpower());
      await service.updateEntry({ orgId: "org-1", projectId: "project-1", date: "2026-09-05", section: "manpower", entryId: "mp-1", payload: { workers: 5 }, actor: { id: "staff-1" }, viewer: staff });
      expect(mockPrisma.dailyLogManpower.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ companyId: "co-1", workers: 5 }) }));
      expect(mockPrisma.company.findFirst).not.toHaveBeenCalled();
    } finally {
      mockPrisma.company.findFirst.mockImplementation(async () => ({ name: "ACME Concrete" }));
    }
  });

  it("CERT-2: an activity, location or party of another project is refused as not found on this project", async () => {
    mockPrisma.activity.findFirst.mockResolvedValueOnce(null);
    await expect(service.addEntry({ orgId: "org-1", projectId: "project-1", date: "2026-09-05", section: "notes", payload: { text: "pour", activityId: "act-elsewhere" }, actor: { id: "staff-1" }, viewer: staff })).rejects.toMatchObject({ status: 400, code: "DAILY_LOG_ACTIVITY_NOT_FOUND" });
    expect(mockPrisma.activity.findFirst).toHaveBeenLastCalledWith(expect.objectContaining({ where: { id: "act-elsewhere", projectId: "project-1" } }));
    mockPrisma.location.findFirst.mockResolvedValueOnce(null);
    await expect(service.addEntry({ orgId: "org-1", projectId: "project-1", date: "2026-09-05", section: "notes", payload: { text: "pour", locationId: "loc-elsewhere" }, actor: { id: "staff-1" }, viewer: staff })).rejects.toMatchObject({ status: 400, code: "DAILY_LOG_LOCATION_NOT_FOUND" });
    expect(mockPrisma.location.findFirst).toHaveBeenLastCalledWith(expect.objectContaining({ where: { id: "loc-elsewhere", projectId: "project-1" } }));
    mockPrisma.projectParty.findFirst.mockResolvedValueOnce(null);
    await expect(service.addEntry({ orgId: "org-1", projectId: "project-1", date: "2026-09-05", section: "manpower", payload: { trade: "Welder", partyId: "party-elsewhere" }, actor: { id: "staff-1" }, viewer: staff })).rejects.toMatchObject({ status: 400, code: "DAILY_LOG_PARTY_NOT_FOUND" });
    expect(mockPrisma.projectParty.findFirst).toHaveBeenLastCalledWith(expect.objectContaining({ where: { id: "party-elsewhere", projectId: "project-1" } }));
    expect(mockPrisma.dailyLogNote.create).not.toHaveBeenCalled();
    expect(mockPrisma.dailyLogManpower.create).not.toHaveBeenCalled();
  });

  it("party users cannot touch other companies' entries and cannot write once the day is submitted", async () => {
    mockPrisma.dailyLogManpower.findFirst.mockResolvedValueOnce(manpower({ partyId: "party-other", createdBy: "someone" }));
    await expect(service.updateEntry({ orgId: "org-1", projectId: "project-1", date: "2026-09-05", section: "manpower", entryId: "mp-1", payload: { workers: 1 }, actor: { id: "sub-user" }, viewer: partyUser })).rejects.toMatchObject({ code: "DAILY_LOG_ENTRY_FORBIDDEN" });
    mockPrisma.dailyLog.findUnique.mockResolvedValue(logRow({ status: "submitted" }));
    await expect(service.addEntry({ orgId: "org-1", projectId: "project-1", date: "2026-09-05", section: "notes", payload: { text: "late" }, actor: { id: "sub-user" }, viewer: partyUser })).rejects.toMatchObject({ code: "DAILY_LOG_SUBMITTED" });
    mockPrisma.dailyLog.findUnique.mockResolvedValue(logRow({ status: "approved" }));
    await expect(service.addEntry({ orgId: "org-1", projectId: "project-1", date: "2026-09-05", section: "notes", payload: { text: "late" }, actor: { id: "staff-1" }, viewer: staff })).rejects.toMatchObject({ code: "DAILY_LOG_APPROVED" });
  });

  it("copies yesterday's crews and plant into an empty day and skips sections that already have rows", async () => {
    const yesterday = logRow({ id: "log-0", date: new Date("2026-09-04T00:00:00Z"), manpower: [manpower({ id: "mp-y" }), manpower({ id: "mp-y2", trade: "Carpenter", workers: 6 })], equipment: [{ id: "eq-y", partyId: null, companyId: null, equipmentId: "eq-1", name: "Tower crane", count: 1, hoursOperated: 8, hoursIdle: 1, activityId: null, locationId: null, notes: null, status: "approved" }] });
    mockPrisma.dailyLog.findMany.mockResolvedValueOnce([yesterday]);
    mockPrisma.dailyLogEquipment.count.mockResolvedValueOnce(1);
    const result = await service.copyPrevious({ orgId: "org-1", projectId: "project-1", date: "2026-09-05", actor: { id: "staff-1" }, viewer: staff });
    expect(mockPrisma.dailyLogManpower.createMany).toHaveBeenCalledWith({ data: [expect.objectContaining({ dailyLogId: "log-1", trade: "Steel fixer", workers: 12, hours: 9, companyName: "ACME Concrete", status: "approved", createdBy: "staff-1" }), expect.objectContaining({ trade: "Carpenter", workers: 6 })] });
    expect(mockPrisma.dailyLogEquipment.createMany).not.toHaveBeenCalled();
    expect(result.copy).toEqual({ fromDate: "2026-09-04", copied: { manpower: 2 }, skipped: { equipment: "already has entries" } });
    mockPrisma.dailyLog.findMany.mockResolvedValueOnce([]);
    await expect(service.copyPrevious({ orgId: "org-1", projectId: "project-1", date: "2026-09-05", actor: { id: "staff-1" }, viewer: staff })).rejects.toMatchObject({ code: "DAILY_LOG_NOTHING_TO_COPY" });
  });

  it("fills weather from the feed and suggests a weather delay when a threshold is hit", async () => {
    weatherFeed.fetchDailyWeather.mockResolvedValue({ source: "open-meteo", date: "2026-09-05", code: 65, condition: "Heavy rain", tempMinC: 20, tempMaxC: 28, precipitationMm: 22, windMaxKph: 30, windGustKph: 40, summary: "Heavy rain · 20–28 °C · 22 mm rain · wind 30 km/h" });
    const log = await service.refreshWeather({ orgId: "org-1", projectId: "project-1", date: "2026-09-05", actor: { id: "staff-1" }, viewer: staff });
    expect(weatherFeed.fetchDailyWeather).toHaveBeenCalledWith(expect.objectContaining({ latitude: 24.7, longitude: 46.7, date: "2026-09-05", timezone: "Asia/Riyadh" }));
    expect(mockPrisma.dailyLog.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ weatherSource: "feed", weatherJson: expect.objectContaining({ condition: "Heavy rain", alerts: [expect.objectContaining({ metric: "rain", value: 22, threshold: 10 })] }) }) }));
    expect(mockPrisma.dailyLogDelay.create).toHaveBeenCalledWith({ data: expect.objectContaining({ type: "weather", source: "weather_feed", status: "draft", description: "Rainfall 22 mm reached the 10 mm threshold" }) });
    expect(mockNotifications.createNotifications).toHaveBeenCalledWith(expect.objectContaining({ event: "daily_log.weather_delay_suggested", priority: "high" }));
    expect(log.alerts).toHaveLength(1);

    mockPrisma.dailyLog.findUnique.mockResolvedValue(logRow({ weatherSource: "manual", weatherJson: { condition: "Clear" } }));
    const kept = await service.refreshWeather({ orgId: "org-1", projectId: "project-1", date: "2026-09-05", actor: null });
    expect(kept.weatherSkipped).toBe(true);
    mockPrisma.project.findFirst.mockResolvedValue(project({ latitude: null }));
    await expect(service.refreshWeather({ orgId: "org-1", projectId: "project-1", date: "2026-09-05", actor: { id: "staff-1" } })).rejects.toMatchObject({ code: "WEATHER_COORDINATES_REQUIRED" });
  });

  it("submit needs content, approval accepts pending entries, reopen returns to open", async () => {
    await expect(service.submitLog({ orgId: "org-1", projectId: "project-1", date: "2026-09-05", actor: { id: "staff-1" } })).rejects.toMatchObject({ code: "DAILY_LOG_EMPTY" });
    mockPrisma.dailyLog.findUnique.mockResolvedValue(logRow({ manpower: [manpower()] }));
    const submitted = await service.submitLog({ orgId: "org-1", projectId: "project-1", date: "2026-09-05", actor: { id: "staff-1" } });
    expect(mockPrisma.dailyLog.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "submitted", submittedBy: "staff-1" }) }));
    expect(mockNotifications.createNotifications).toHaveBeenCalledWith(expect.objectContaining({ event: "daily_log.submitted", recipientRoles: ["pm"] }));
    expect(submitted.date).toBe("2026-09-05");

    mockPrisma.dailyLog.findUnique.mockResolvedValue(logRow({ status: "submitted", submittedBy: "staff-1", manpower: [manpower({ status: "submitted", partyId: "party-1" })] }));
    await service.approveLog({ orgId: "org-1", projectId: "project-1", date: "2026-09-05", actor: { id: "pm-1" } });
    expect(mockPrisma.dailyLogManpower.updateMany).toHaveBeenCalledWith({ where: { dailyLogId: "log-1", status: "submitted" }, data: expect.objectContaining({ status: "approved", reviewedBy: "pm-1" }) });
    expect(mockPrisma.dailyLog.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "approved", approvedBy: "pm-1" }) }));
    expect(mockNotifications.createNotifications).toHaveBeenCalledWith(expect.objectContaining({ event: "daily_log.approved", recipientUserIds: ["staff-1"] }));

    mockPrisma.dailyLog.findUnique.mockResolvedValue(logRow({ status: "approved" }));
    await service.reopenLog({ orgId: "org-1", projectId: "project-1", date: "2026-09-05", actor: { id: "pm-1" }, reason: "missed crane" });
    expect(mockPrisma.dailyLog.update).toHaveBeenLastCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "open", approvedAt: null }) }));
    await expect(service.reviewEntry({ orgId: "org-1", projectId: "project-1", date: "2026-09-05", section: "manpower", entryId: "mp-1", decision: "reject", actor: { id: "pm-1" } })).rejects.toMatchObject({ code: "DAILY_LOG_REASON_REQUIRED" });
  });

  it("reports manpower by company across days", async () => {
    mockPrisma.dailyLogManpower.findMany.mockResolvedValueOnce([
      manpower({ dailyLog: { date: new Date("2026-09-01T00:00:00Z") } }),
      manpower({ id: "mp-2", dailyLog: { date: new Date("2026-09-02T00:00:00Z") }, workers: 10, hours: 8 }),
      manpower({ id: "mp-3", companyId: "co-2", companyName: "Steel Bros", trade: "Welder", workers: 4, hours: 10, dailyLog: { date: new Date("2026-09-02T00:00:00Z") } }),
    ]);
    const report = await service.manpowerReport({ orgId: "org-1", projectId: "project-1", from: "2026-09-01", to: "2026-09-05", groupBy: "company", viewer: staff });
    expect(report.items).toEqual([
      expect.objectContaining({ label: "ACME Concrete", companyId: "co-1", workers: 22, manHours: 188, days: 2, avgWorkersPerDay: 11, entries: 2 }),
      expect.objectContaining({ label: "Steel Bros", workers: 4, manHours: 40, days: 1 }),
    ]);
    expect(report.byDate).toEqual([{ date: "2026-09-01", workers: 12, manHours: 108 }, { date: "2026-09-02", workers: 14, manHours: 120 }]);
    expect(report.totals).toEqual({ workers: 26, manHours: 228, entries: 3, days: 2 });
    await expect(service.manpowerReport({ orgId: "org-1", projectId: "project-1", groupBy: "week" })).rejects.toMatchObject({ code: "DAILY_LOG_GROUP_BY" });
  });

  it("distributes the day as a filed PDF, in-app/email to roles and a digest to external addresses", async () => {
    mockPrisma.dailyLog.findUnique.mockResolvedValue(logRow({ manpower: [manpower()], weatherJson: { summary: "Clear · 30 °C", alerts: [] }, weatherSource: "feed" }));
    const result = await service.distribute({ orgId: "org-1", projectId: "project-1", date: "2026-09-05", actor: { id: "pm-1" }, note: "See you at 7am" });
    expect(mockUpload).toHaveBeenCalledWith(expect.objectContaining({ documentType: "workflow_attachment", linkedEntityType: "daily_log", linkedEntityId: "log-1", file: expect.objectContaining({ mimetype: "application/pdf", originalname: "daily-log-tower-2026-09-05.pdf" }) }));
    expect(mockUpload.mock.calls[0][0].file.buffer.subarray(0, 4).toString()).toBe("%PDF");
    expect(mockNotifications.createNotifications).toHaveBeenCalledWith(expect.objectContaining({ event: "daily_log.distributed", recipientRoles: ["pm"], metadata: { documentId: "doc-1", scheduled: false } }));
    expect(mockSendEmail).toHaveBeenCalledWith(expect.objectContaining({ to: "client@example.com", subject: "Daily log 2026-09-05 — Tower", body: expect.stringContaining("Steel fixer · 12 × 9 h") }));
    expect(mockPrisma.dailyLog.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ pdfDocumentId: "doc-1", distributionJson: expect.objectContaining({ notified: 2, emails: ["client@example.com"], failedEmails: [] }) }) }));
    expect(result.document).toEqual({ id: "doc-1", fileName: "daily-log-tower-2026-09-05.pdf" });
    mockPrisma.dailyLog.findUnique.mockResolvedValue(logRow());
    await expect(service.distribute({ orgId: "org-1", projectId: "project-1", date: "2026-09-05", actor: { id: "pm-1" } })).rejects.toMatchObject({ code: "DAILY_LOG_EMPTY" });
  });

  it("CERT-2: the people a day is distributed to by name are members of the organisation; another organisation's person is refused exactly as one who exists nowhere, before anything is filed, sent or stored", async () => {
    mockPrisma.dailyLog.findUnique.mockResolvedValue(logRow({ manpower: [manpower()] }));
    mockPrisma.organizationMembership.findMany.mockImplementation(async ({ where }) => (where.orgId === "org-1" ? ["pm-1", "site-1"].filter((id) => where.userId.in.includes(id)).map((userId) => ({ userId })) : []));
    try {
      const day = { orgId: "org-1", projectId: "project-1", date: "2026-09-05", actor: { id: "pm-1" } };
      const answers = [];
      for (const userId of ["user-of-another-org", "user-that-exists-nowhere"]) {
        const error = await service.distribute({ ...day, to: { roles: [], userIds: ["site-1", userId], emails: [] } }).catch((caught) => caught);
        expect(error).toMatchObject({ status: 404, code: "USER_NOT_FOUND" });
        answers.push(JSON.stringify({ status: error.status, code: error.code, message: error.message, details: error.details ?? null }));
      }
      expect(answers[0]).toBe(answers[1]);
      expect(mockPrisma.organizationMembership.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ orgId: "org-1", userId: { in: ["site-1", "user-of-another-org"] } }) }));
      // A value that is not an identifier names no one, and is refused the same way.
      await expect(service.distribute({ ...day, to: { roles: [], userIds: [["site-1"]], emails: [] } })).rejects.toMatchObject({ status: 404, code: "USER_NOT_FOUND" });
      expect(mockUpload).not.toHaveBeenCalled();
      expect(mockNotifications.createNotifications).not.toHaveBeenCalled();
      expect(mockSendEmail).not.toHaveBeenCalled();
      expect(mockPrisma.dailyLog.update).not.toHaveBeenCalled();

      // Members are accepted, stored once each and told.
      const result = await service.distribute({ ...day, to: { roles: [], userIds: ["site-1", "site-1"], emails: [] } });
      expect(mockNotifications.createNotifications).toHaveBeenCalledWith(expect.objectContaining({ recipientUserIds: ["site-1"] }));
      expect(mockPrisma.dailyLog.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ distributionJson: expect.objectContaining({ userIds: ["site-1"] }) }) }));
      expect(result.distribution.userIds).toEqual(["site-1"]);
      // The scheduled send names no one: nothing to look up.
      mockPrisma.organizationMembership.findMany.mockClear();
      await service.distribute({ ...day, actor: null, scheduled: true });
      expect(mockPrisma.organizationMembership.findMany).not.toHaveBeenCalled();
    } finally {
      mockPrisma.organizationMembership.findMany.mockImplementation(async () => []);
    }
  });

  it("queues the evening send once the project's local clock passes the send time", async () => {
    mockPrisma.project.findMany.mockResolvedValueOnce([{ id: "project-1", orgId: "org-1", timezone: "Asia/Riyadh", dailyLogSettingsJson: { autoDistributeAt: "18:00" } }, { id: "project-2", orgId: "org-1", timezone: "Asia/Riyadh", dailyLogSettingsJson: {} }]);
    // 15:30 UTC = 18:30 in Riyadh
    const now = new Date("2026-09-05T15:30:00Z");
    mockPrisma.dailyLog.findUnique.mockResolvedValue(logRow({ manpower: [manpower()] }));
    const enqueue = jest.fn(async () => ({}));
    const result = await service.queueScheduledDistributions({ now, enqueue });
    expect(enqueue).toHaveBeenCalledWith({ orgId: "org-1", projectId: "project-1", payload: { projectId: "project-1", date: "2026-09-05", scheduled: true } });
    expect(mockPrisma.dailyLog.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ autoDistributeQueuedFor: null }), data: { autoDistributeQueuedFor: now } }));
    expect(result.queued).toEqual([{ projectId: "project-1", date: "2026-09-05" }]);

    mockPrisma.project.findMany.mockResolvedValueOnce([{ id: "project-1", orgId: "org-1", timezone: "Asia/Riyadh", dailyLogSettingsJson: { autoDistributeAt: "18:00" } }]);
    const again = await service.queueScheduledDistributions({ now: new Date("2026-09-05T13:00:00Z"), enqueue });
    expect(again.queued).toEqual([]);

    // Another process claimed the same log first: nothing is queued twice.
    enqueue.mockClear();
    mockPrisma.project.findMany.mockResolvedValueOnce([{ id: "project-1", orgId: "org-1", timezone: "Asia/Riyadh", dailyLogSettingsJson: { autoDistributeAt: "18:00" } }]);
    mockPrisma.dailyLog.updateMany.mockResolvedValueOnce({ count: 0 });
    const raced = await service.queueScheduledDistributions({ now, enqueue });
    expect(raced.queued).toEqual([]);
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("logs a confirmed weather delay on the contractual register", async () => {
    mockPrisma.dailyLogDelay.findFirst.mockResolvedValueOnce({ id: "dl-1", dailyLogId: "log-1", type: "weather", description: "Rainfall 22 mm reached the 10 mm threshold", hoursLost: 4, activityId: "act-1", source: "weather_feed", status: "draft", weatherDelayId: null });
    const result = await service.logWeatherDelay({ orgId: "org-1", projectId: "project-1", date: "2026-09-05", entryId: "dl-1", actor: { id: "pm-1" }, viewer: staff });
    expect(mockCreateWeatherDelay).toHaveBeenCalledWith(expect.objectContaining({ payload: expect.objectContaining({ date: "2026-09-05", delayDays: 0.5, contractual: true, affectedActivityIds: ["act-1"] }) }));
    expect(mockPrisma.dailyLogDelay.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ weatherDelayId: "wd-1", status: "approved" }) }));
    expect(result.weatherDelay).toEqual({ id: "wd-1", delayDays: 0.5, contractual: true });
  });

  it("validates settings and keeps the merged defaults", async () => {
    const settings = await service.updateSettings({ orgId: "org-1", projectId: "project-1", actorId: "pm-1", payload: { latitude: 24.7136, longitude: 46.6753, timezone: "Asia/Riyadh", thresholds: { rainMm: 5, windKph: null }, distributionRoles: ["pm", "qs"], distributionEmails: "client@example.com, owner@example.com", autoDistributeAt: "18:30" } });
    expect(mockPrisma.project.update).toHaveBeenCalledWith({ where: { id: "project-1" }, data: expect.objectContaining({ latitude: 24.7136, longitude: 46.6753, timezone: "Asia/Riyadh", dailyLogSettingsJson: expect.objectContaining({ thresholds: { rainMm: 5, tempMinC: 0, tempMaxC: 40, windKph: null }, distributionRoles: ["pm", "qs"], distributionEmails: ["client@example.com", "owner@example.com"], autoDistributeAt: "18:30" }) }) });
    expect(settings.copySections).toEqual(["manpower", "equipment"]);
    await expect(service.updateSettings({ orgId: "org-1", projectId: "project-1", payload: { timezone: "Mars/Olympus" } })).rejects.toMatchObject({ code: "DAILY_LOG_TIMEZONE" });
    await expect(service.updateSettings({ orgId: "org-1", projectId: "project-1", payload: { distributionEmails: ["not-an-email"] } })).rejects.toMatchObject({ code: "DAILY_LOG_DISTRIBUTION_EMAIL" });
    await expect(service.updateSettings({ orgId: "org-1", projectId: "project-1", payload: { autoDistributeAt: "25:00" } })).rejects.toMatchObject({ code: "DAILY_LOG_AUTO_TIME" });
  });

  // ── PC-6 §4: the quantities section ───────────────────────────────────────

  it("quantities: a row is recorded under the progress assignment rule, against the bill, in the item's unit, and is approved as a site record only", async () => {
    mockPrisma.dailyLogQuantity.create.mockImplementationOnce(async ({ data }) => quantityRow({ ...data, id: "qty-new" }));
    mockPrisma.dailyLog.findUnique.mockResolvedValueOnce(logRow()).mockResolvedValueOnce(logRow({ quantities: [quantityRow({ id: "qty-new" })] }));
    const log = await service.addEntry({ orgId: "org-1", projectId: "project-1", date: "2026-09-05", section: "quantities", payload: { activityId: "act-1", boqItemId: "item-1", quantity: 12.5, unit: "cum" }, actor: { id: "staff-1", role: "site_engineer" }, viewer: staff });
    expect(mockAssertProgressSubmitAllowed).toHaveBeenCalledWith(expect.objectContaining({ projectId: "project-1", activityIds: ["act-1"], userId: "staff-1", userRole: "site_engineer" }));
    expect(mockQuantityProgress.resolveDailyLogQuantity).toHaveBeenCalledWith(expect.objectContaining({ orgId: "org-1", projectId: "project-1", activityId: "act-1", boqItemId: "item-1", unit: "cum" }));
    const created = mockPrisma.dailyLogQuantity.create.mock.calls[0][0].data;
    expect(created).toMatchObject({ dailyLogId: "log-1", activityId: "act-1", boqItemId: "item-1", allocationId: "alloc-1", unitCode: "m3", status: "approved" });
    expect(created.quantity.toFixed(3)).toBe("12.500");
    // Recording a row mints nothing: no entry exists before the log is submitted.
    expect(mockPrisma.quantityProgressEntry.create).not.toHaveBeenCalled();
    expect(mockQuantityProgress.mintDailyLogEntries).not.toHaveBeenCalled();
    expect(log.sections.quantities[0]).toMatchObject({ quantity: 12.5, unitCode: "m3", boqItem: { id: "item-1", code: "1.1", description: "Concrete in footings" }, activity: { id: "act-1", name: "Slab pour" }, progressEntry: null });
    expect(log.totals).toMatchObject({ quantityRows: 1, quantities: [{ unitCode: "m3", quantity: 12.5, rows: 1 }], entries: 1 });
    await expect(service.addEntry({ orgId: "org-1", projectId: "project-1", date: "2026-09-05", section: "quantities", payload: { activityId: "act-1", boqItemId: "item-1", quantity: -1 }, actor: { id: "staff-1" }, viewer: staff })).rejects.toMatchObject({ code: "QUANTITY_NEGATIVE" });
    // Zero is no work, and no work is no row (integration item 7).
    await expect(service.addEntry({ orgId: "org-1", projectId: "project-1", date: "2026-09-05", section: "quantities", payload: { activityId: "act-1", boqItemId: "item-1", quantity: 0 }, actor: { id: "staff-1" }, viewer: staff })).rejects.toMatchObject({ status: 400, code: "QUANTITY_INVALID" });
    await expect(service.addEntry({ orgId: "org-1", projectId: "project-1", date: "2026-09-05", section: "quantities", payload: { activityId: "act-1", quantity: 1 }, actor: { id: "staff-1" }, viewer: staff })).rejects.toMatchObject({ code: "DAILY_LOG_FIELD_REQUIRED", details: { field: "boqItemId" } });
  });

  it("quantities: totals are per unit, never one figure across units", () => {
    const totals = service.totalsFor(logRow({ quantities: [quantityRow({ quantity: "10" }), quantityRow({ id: "qty-2", quantity: "2.5" }), quantityRow({ id: "qty-3", quantity: "7", unitCode: "t", boqItemId: "item-2" }), quantityRow({ id: "qty-4", quantity: "99", status: "rejected" }), quantityRow({ id: "qty-5", quantity: "99", status: "draft" })] }));
    expect(totals.quantityRows).toBe(3);
    expect(totals.quantities).toEqual([{ unitCode: "m3", quantity: 12.5, rows: 2 }, { unitCode: "t", quantity: 7, rows: 1 }]);
    expect(totals.entries).toBe(5);
  });

  it("quantities: submitting the log mints entries for the rows that count and retires the rest; approving the log mints what the submitted day took since and approves no entry", async () => {
    const rows = [quantityRow(), quantityRow({ id: "qty-2", status: "submitted", partyId: "party-1" }), quantityRow({ id: "qty-3", status: "draft" }), quantityRow({ id: "qty-4", status: "rejected" })];
    mockPrisma.dailyLog.findUnique.mockResolvedValue(logRow({ quantities: rows }));
    await service.submitLog({ orgId: "org-1", projectId: "project-1", date: "2026-09-05", actor: { id: "staff-1", role: "site_engineer" } });
    expect(mockQuantityProgress.mintDailyLogEntries).toHaveBeenCalledTimes(1);
    const call = mockQuantityProgress.mintDailyLogEntries.mock.calls[0][0];
    expect(call).toMatchObject({ orgId: "org-1", projectId: "project-1", log: expect.objectContaining({ id: "log-1", status: "submitted" }), actor: { id: "staff-1", role: "site_engineer" } });
    expect(call.rows.map((row) => row.id)).toEqual(["qty-1", "qty-2"]);
    expect(call.retiredRows.map((row) => row.id)).toEqual(["qty-3", "qty-4"]);
    expect(mockAudit.recordEvent).toHaveBeenCalledWith(expect.objectContaining({ summary: expect.objectContaining({ transition: "daily_log.submit", quantityEntries: { minted: 0, synced: 0, kept: 0, retired: 0 } }) }));

    mockPrisma.dailyLog.findUnique.mockResolvedValue(logRow({ status: "submitted", submittedBy: "staff-1", quantities: rows }));
    await service.approveLog({ orgId: "org-1", projectId: "project-1", date: "2026-09-05", actor: { id: "pm-1", role: "pm" } });
    // The row's own review state moves like its six siblings' …
    expect(mockPrisma.dailyLogQuantity.updateMany).toHaveBeenCalledWith({ where: { dailyLogId: "log-1", status: "submitted" }, data: expect.objectContaining({ status: "approved", reviewedBy: "pm-1" }) });
    // … the day's closing mints for every counted row (a row taken after the submit is not left behind) …
    expect(mockQuantityProgress.mintDailyLogEntries).toHaveBeenCalledTimes(2);
    const closing = mockQuantityProgress.mintDailyLogEntries.mock.calls[1][0];
    expect(closing.rows.map((row) => row.id)).toEqual(["qty-1", "qty-2"]);
    expect(closing.retiredRows.map((row) => row.id)).toEqual(["qty-3", "qty-4"]);
    expect(closing.log).toMatchObject({ id: "log-1" });
    expect(mockAudit.recordEvent).toHaveBeenLastCalledWith(expect.objectContaining({ summary: expect.objectContaining({ transition: "daily_log.approve", quantityEntries: { minted: 0, synced: 0, kept: 0, retired: 0 } }) }));
    // … and no quantity progress entry is approved or touched by the log's approval.
    expect(mockPrisma.quantityProgressEntry.updateMany).not.toHaveBeenCalled();
    expect(mockPrisma.quantityProgressEntry.update).not.toHaveBeenCalled();
    expect(mockPrisma.quantityProgressEntry.create).not.toHaveBeenCalled();
  });

  it("quantities: on a day already submitted a row added, edited back into counting or approved by the site team is pending at once; on an open day nothing is minted", async () => {
    // Added to a submitted day.
    mockPrisma.dailyLogQuantity.create.mockImplementationOnce(async ({ data }) => quantityRow({ ...data, id: "qty-late" }));
    mockPrisma.dailyLog.findUnique.mockResolvedValueOnce(logRow({ status: "submitted" })).mockResolvedValueOnce(logRow({ status: "submitted", quantities: [quantityRow({ id: "qty-late" })] }));
    await service.addEntry({ orgId: "org-1", projectId: "project-1", date: "2026-09-05", section: "quantities", payload: { activityId: "act-1", boqItemId: "item-1", quantity: 7 }, actor: { id: "pm-1", role: "pm" }, viewer: { id: "pm-1", projectAccess: { assignmentRole: "pm" } } });
    expect(mockQuantityProgress.mintDailyLogEntries).toHaveBeenCalledTimes(1);
    expect(mockQuantityProgress.mintDailyLogEntries.mock.calls[0][0].rows.map((row) => row.id)).toEqual(["qty-late"]);
    expect(mockQuantityProgress.mintDailyLogEntries.mock.calls[0][0].log).toMatchObject({ id: "log-1", status: "submitted" });
    // A draft row on a submitted day does not count: nothing minted.
    mockPrisma.dailyLogQuantity.create.mockImplementationOnce(async ({ data }) => quantityRow({ ...data, id: "qty-draft" }));
    mockPrisma.dailyLog.findUnique.mockResolvedValueOnce(logRow({ status: "submitted" })).mockResolvedValueOnce(logRow({ status: "submitted" }));
    await service.addEntry({ orgId: "org-1", projectId: "project-1", date: "2026-09-05", section: "quantities", payload: { activityId: "act-1", boqItemId: "item-1", quantity: 7, status: "draft" }, actor: { id: "pm-1", role: "pm" }, viewer: { id: "pm-1", projectAccess: { assignmentRole: "pm" } } });
    expect(mockQuantityProgress.mintDailyLogEntries).toHaveBeenCalledTimes(1);
    // Added to an open day: a site record only.
    mockPrisma.dailyLogQuantity.create.mockImplementationOnce(async ({ data }) => quantityRow({ ...data, id: "qty-open" }));
    mockPrisma.dailyLog.findUnique.mockResolvedValueOnce(logRow()).mockResolvedValueOnce(logRow());
    await service.addEntry({ orgId: "org-1", projectId: "project-1", date: "2026-09-05", section: "quantities", payload: { activityId: "act-1", boqItemId: "item-1", quantity: 7 }, actor: { id: "staff-1", role: "site_engineer" }, viewer: staff });
    expect(mockQuantityProgress.mintDailyLogEntries).toHaveBeenCalledTimes(1);

    // A rejected row edited on a submitted day is resubmitted and, having no entry, minted.
    mockPrisma.dailyLog.findUnique.mockResolvedValueOnce(logRow({ status: "submitted" })).mockResolvedValueOnce(logRow({ status: "submitted" }));
    mockPrisma.dailyLogQuantity.findFirst.mockResolvedValueOnce(quantityRow({ status: "rejected" }));
    mockPrisma.dailyLogQuantity.update.mockImplementationOnce(async ({ data }) => quantityRow({ ...data }));
    await service.updateEntry({ orgId: "org-1", projectId: "project-1", date: "2026-09-05", section: "quantities", entryId: "qty-1", payload: { quantity: 9 }, actor: { id: "staff-1", role: "site_engineer" }, viewer: staff });
    expect(mockQuantityProgress.mintDailyLogEntries).toHaveBeenCalledTimes(2);
    expect(mockQuantityProgress.mintDailyLogEntries.mock.calls[1][0].rows[0]).toMatchObject({ id: "qty-1", status: "approved" });

    // Approved by the site team on a submitted day: minted; the entry is never approved by the review.
    mockPrisma.dailyLog.findUnique.mockResolvedValueOnce(logRow({ status: "submitted" })).mockResolvedValueOnce(logRow({ status: "submitted" }));
    mockPrisma.dailyLogQuantity.findFirst.mockResolvedValueOnce(quantityRow({ status: "submitted", partyId: "party-1" }));
    mockPrisma.dailyLogQuantity.update.mockImplementationOnce(async ({ data }) => quantityRow({ ...data }));
    await service.reviewEntry({ orgId: "org-1", projectId: "project-1", date: "2026-09-05", section: "quantities", entryId: "qty-1", decision: "approve", actor: { id: "staff-1", role: "site_engineer" }, viewer: staff });
    expect(mockQuantityProgress.mintDailyLogEntries).toHaveBeenCalledTimes(3);
    expect(mockQuantityProgress.rejectDailyLogRowEntry).not.toHaveBeenCalled();
    expect(mockPrisma.quantityProgressEntry.updateMany).not.toHaveBeenCalled();
  });

  it("quantities: the site team's reject takes the row's free pending entry with it, and an official or bundled entry refuses the review", async () => {
    const pending = { id: "entry-1", status: "submitted", submissionId: null, submission: null };
    mockQuantityProgress.rejectDailyLogRowEntry.mockResolvedValueOnce(pending);
    mockPrisma.dailyLog.findUnique.mockResolvedValueOnce(logRow({ status: "submitted" })).mockResolvedValueOnce(logRow({ status: "submitted" }));
    mockPrisma.dailyLogQuantity.findFirst.mockResolvedValueOnce(quantityRow());
    mockPrisma.dailyLogQuantity.update.mockImplementationOnce(async ({ data }) => quantityRow({ ...data }));
    await service.reviewEntry({ orgId: "org-1", projectId: "project-1", date: "2026-09-05", section: "quantities", entryId: "qty-1", decision: "reject", reason: "measured twice", actor: { id: "staff-1", role: "site_engineer" }, viewer: staff });
    expect(mockQuantityProgress.rejectDailyLogRowEntry).toHaveBeenCalledWith(expect.objectContaining({ orgId: "org-1", projectId: "project-1", row: expect.objectContaining({ id: "qty-1" }), actorId: "staff-1", reason: "measured twice" }));
    expect(mockQuantityProgress.rejectDailyLogRowEntry.mock.invocationCallOrder[0]).toBeLessThan(mockPrisma.dailyLogQuantity.update.mock.invocationCallOrder[0]);
    expect(mockPrisma.dailyLogQuantity.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "rejected", rejectionReason: "measured twice" }) }));
    expect(mockAudit.recordEvent).toHaveBeenLastCalledWith(expect.objectContaining({ summary: expect.objectContaining({ transition: "daily_log.entry_reject", section: "quantities", quantityEntryId: "entry-1" }) }));
    expect(mockQuantityProgress.mintDailyLogEntries).not.toHaveBeenCalled();

    // The refusals pass through and the row is not moved.
    for (const code of ["DAILY_LOG_QUANTITY_LOCKED", "QUANTITY_ENTRY_BUNDLED"]) {
      mockQuantityProgress.rejectDailyLogRowEntry.mockRejectedValueOnce(Object.assign(new Error(code), { status: 409, code }));
      mockPrisma.dailyLog.findUnique.mockResolvedValueOnce(logRow({ status: "submitted" }));
      mockPrisma.dailyLogQuantity.findFirst.mockResolvedValueOnce(quantityRow());
      await expect(service.reviewEntry({ orgId: "org-1", projectId: "project-1", date: "2026-09-05", section: "quantities", entryId: "qty-1", decision: "reject", reason: "no", actor: { id: "staff-1" }, viewer: staff })).rejects.toMatchObject({ status: 409, code });
    }
    expect(mockPrisma.dailyLogQuantity.update).toHaveBeenCalledTimes(1);
    // The six siblings' review is untouched by the quantities rule.
    mockPrisma.dailyLog.findUnique.mockResolvedValueOnce(logRow({ status: "submitted" })).mockResolvedValueOnce(logRow({ status: "submitted" }));
    mockPrisma.dailyLogManpower.findFirst.mockResolvedValueOnce(manpower({ status: "submitted", partyId: "party-1" }));
    await service.reviewEntry({ orgId: "org-1", projectId: "project-1", date: "2026-09-05", section: "manpower", entryId: "mp-1", decision: "reject", reason: "no", actor: { id: "staff-1" }, viewer: staff });
    expect(mockQuantityProgress.rejectDailyLogRowEntry).toHaveBeenCalledTimes(3);
  });

  it("quantities: a row edit before approval follows the entry gate and syncs the pending entry; a row delete removes its pending entry", async () => {
    const pending = { id: "entry-1", status: "submitted", submissionId: null, submission: null, createdBy: "staff-1", createdAt: DAY, source: "daily_log" };
    mockQuantityProgress.dailyLogRowEntryGate.mockResolvedValueOnce(pending);
    mockPrisma.dailyLogQuantity.findFirst.mockResolvedValueOnce(quantityRow());
    mockPrisma.dailyLogQuantity.update.mockImplementationOnce(async ({ data }) => quantityRow({ ...data }));
    await service.updateEntry({ orgId: "org-1", projectId: "project-1", date: "2026-09-05", section: "quantities", entryId: "qty-1", payload: { quantity: 14 }, actor: { id: "staff-1", role: "site_engineer" }, viewer: staff });
    expect(mockQuantityProgress.dailyLogRowEntryGate).toHaveBeenCalledWith(expect.objectContaining({ rowId: "qty-1" }));
    expect(mockQuantityProgress.syncDailyLogRowEntry).toHaveBeenCalledWith(expect.objectContaining({ entry: pending, row: expect.objectContaining({ activityId: "act-1", boqItemId: "item-1" }), actorId: "staff-1" }));
    expect(mockQuantityProgress.syncDailyLogRowEntry.mock.calls[0][0].row.quantity.toFixed(3)).toBe("14.000");

    // Moving a submitted quantity to another item is a new row, not an edit.
    mockQuantityProgress.dailyLogRowEntryGate.mockResolvedValueOnce(pending);
    mockPrisma.dailyLogQuantity.findFirst.mockResolvedValueOnce(quantityRow());
    await expect(service.updateEntry({ orgId: "org-1", projectId: "project-1", date: "2026-09-05", section: "quantities", entryId: "qty-1", payload: { boqItemId: "item-2" }, actor: { id: "staff-1" }, viewer: staff })).rejects.toMatchObject({ code: "QUANTITY_ENTRY_IMMUTABLE_FIELD" });

    // The gate's refusals pass through untouched.
    mockQuantityProgress.dailyLogRowEntryGate.mockRejectedValueOnce(Object.assign(new Error("locked"), { status: 409, code: "DAILY_LOG_QUANTITY_LOCKED" }));
    mockPrisma.dailyLogQuantity.findFirst.mockResolvedValueOnce(quantityRow());
    await expect(service.updateEntry({ orgId: "org-1", projectId: "project-1", date: "2026-09-05", section: "quantities", entryId: "qty-1", payload: { quantity: 1 }, actor: { id: "staff-1" }, viewer: staff })).rejects.toMatchObject({ code: "DAILY_LOG_QUANTITY_LOCKED" });
    expect(mockPrisma.dailyLogQuantity.update).toHaveBeenCalledTimes(1);

    mockQuantityProgress.deleteDailyLogRowEntry.mockResolvedValueOnce(pending);
    mockPrisma.dailyLogQuantity.findFirst.mockResolvedValueOnce(quantityRow());
    await service.deleteEntry({ orgId: "org-1", projectId: "project-1", date: "2026-09-05", section: "quantities", entryId: "qty-1", actor: { id: "staff-1" }, viewer: staff });
    expect(mockQuantityProgress.deleteDailyLogRowEntry).toHaveBeenCalledWith(expect.objectContaining({ row: expect.objectContaining({ id: "qty-1" }), actorId: "staff-1" }));
    expect(mockPrisma.dailyLogQuantity.delete).toHaveBeenCalledWith({ where: { id: "qty-1" } });
    expect(mockAudit.recordEvent).toHaveBeenLastCalledWith(expect.objectContaining({ summary: expect.objectContaining({ transition: "daily_log.entry_delete", section: "quantities", quantityEntryId: "entry-1" }) }));
  });

  it("quantities: the section is never copied forward; the digest — and the PDF for a reader who may not read the BOQ — carry no per-item quantity, no code and no per-unit total (integration item 4)", async () => {
    expect(service.SECTIONS.quantities.copyFields).toBeUndefined();
    expect(service.mergeSettings({ copySections: ["quantities", "manpower"] }).copySections).toEqual(["manpower"]);
    mockQuantityProgress.entriesForDailyLogRows.mockResolvedValueOnce([{ id: "entry-1", dailyLogQuantityId: "qty-1", status: "approved", source: "daily_log", submissionId: "sub-1", submission: { status: "approved" }, createdBy: "staff-1", createdAt: DAY, approvedBy: "pm-1", approvedAt: DAY, rejectedBy: null, rejectedAt: null, rejectionReason: null }]);
    mockPrisma.dailyLog.findUnique.mockResolvedValue(logRow({ status: "approved", quantities: [quantityRow(), quantityRow({ id: "qty-2", quantity: "3", unitCode: "t", boqItemId: "item-1" })] }));
    const rendered = await service.renderPdf({ orgId: "org-1", projectId: "project-1", date: "2026-09-05", viewer: staff, boqAccess: { boq: false, budget: false } });
    expect(rendered.log.sections.quantities[0].progressEntry).toMatchObject({ id: "entry-1", status: "approved", official: true, submissionId: "sub-1", approvedBy: "pm-1", recordedBy: "staff-1" });
    expect(rendered.log.totals.quantities).toEqual([{ unitCode: "m3", quantity: 12.5, rows: 1 }, { unitCode: "t", quantity: 3, rows: 1 }]);
    const text = service.renderText({ project: project(), log: rendered.log });
    expect(text).not.toContain("installed 12.5 m3");
    expect(text).toContain("Concrete in footings · — — Slab pour · official");
    expect(text).toContain("Quantities per BOQ item are shown to members who may read the BOQ.");
    expect(text).not.toContain("1.1 Concrete");
    expect(text).not.toMatch(/12\.5|\b3 t\b/);
    // The PDF rendered for that reader carries the same: no figure of the section.
    const pdfText = rendered.buffer.toString("latin1");
    expect(pdfText).not.toContain("12.5");
    expect(pdfText).not.toContain("1.1 Concrete");
    // A BOQ reader's PDF keeps the figures and the code.
    mockQuantityProgress.entriesForDailyLogRows.mockResolvedValueOnce([]);
    const full = await service.renderPdf({ orgId: "org-1", projectId: "project-1", date: "2026-09-05", viewer: staff, boqAccess: { boq: true, budget: true } });
    expect(full.buffer.toString("latin1")).toContain("12.5");
  });
});
