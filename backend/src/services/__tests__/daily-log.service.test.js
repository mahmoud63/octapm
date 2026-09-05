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
  dailyLog: { findUnique: jest.fn(), findMany: jest.fn(async () => []), create: jest.fn(async ({ data }) => ({ id: "log-1", ...data })), update: jest.fn(async ({ data }) => ({ id: "log-1", date: new Date("2026-09-05T00:00:00Z"), ...data })) },
  dailyLogManpower: table(),
  dailyLogEquipment: table(),
  dailyLogDelivery: table(),
  dailyLogVisitor: table(),
  dailyLogDelay: table(),
  dailyLogNote: table(),
};
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

const weatherFeed = require("../weather-feed.service");
const service = require("../daily-log.service");

const DAY = new Date("2026-09-05T00:00:00.000Z");
const project = (overrides = {}) => ({ id: "project-1", orgId: "org-1", name: "Tower", status: "active", latitude: 24.7, longitude: 46.7, timezone: "Asia/Riyadh", dailyLogSettingsJson: { distributionRoles: ["pm"], distributionEmails: ["client@example.com"], thresholds: { rainMm: 10 } }, ...overrides });
const manpower = (overrides = {}) => ({ id: "mp-1", dailyLogId: "log-1", partyId: null, companyId: "co-1", companyName: "ACME Concrete", trade: "Steel fixer", workers: 12, hours: 9, activityId: "act-1", locationId: null, notes: null, status: "approved", createdBy: "staff-1", submittedAt: null, reviewedBy: null, reviewedAt: null, rejectionReason: null, clientRequestId: null, sortOrder: 0, createdAt: DAY, updatedAt: DAY, ...overrides });
const logRow = (overrides = {}) => ({ id: "log-1", orgId: "org-1", projectId: "project-1", date: DAY, status: "open", weatherJson: null, weatherSource: null, weatherFetchedAt: null, summary: null, submittedAt: null, submittedBy: null, approvedAt: null, approvedBy: null, distributedAt: null, distributionJson: null, pdfDocumentId: null, createdAt: DAY, updatedAt: DAY, manpower: [], equipment: [], deliveries: [], visitors: [], delays: [], notes: [], ...overrides });
const staff = { id: "staff-1", projectAccess: { assignmentRole: "site_engineer" } };
const partyUser = { id: "sub-user", projectAccess: { partyScoped: true, partyAccess: [{ projectPartyId: "party-1", companyId: "co-2", role: "subcontractor" }] } };

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

  it("queues the evening send once the project's local clock passes the send time", async () => {
    mockPrisma.project.findMany.mockResolvedValueOnce([{ id: "project-1", orgId: "org-1", timezone: "Asia/Riyadh", dailyLogSettingsJson: { autoDistributeAt: "18:00" } }, { id: "project-2", orgId: "org-1", timezone: "Asia/Riyadh", dailyLogSettingsJson: {} }]);
    // 15:30 UTC = 18:30 in Riyadh
    const now = new Date("2026-09-05T15:30:00Z");
    mockPrisma.dailyLog.findUnique.mockResolvedValue(logRow({ manpower: [manpower()] }));
    const enqueue = jest.fn(async () => ({}));
    const result = await service.queueScheduledDistributions({ now, enqueue });
    expect(enqueue).toHaveBeenCalledWith({ orgId: "org-1", projectId: "project-1", payload: { projectId: "project-1", date: "2026-09-05", scheduled: true } });
    expect(mockPrisma.dailyLog.update).toHaveBeenCalledWith(expect.objectContaining({ data: { autoDistributeQueuedFor: now } }));
    expect(result.queued).toEqual([{ projectId: "project-1", date: "2026-09-05" }]);

    mockPrisma.project.findMany.mockResolvedValueOnce([{ id: "project-1", orgId: "org-1", timezone: "Asia/Riyadh", dailyLogSettingsJson: { autoDistributeAt: "18:00" } }]);
    const again = await service.queueScheduledDistributions({ now: new Date("2026-09-05T13:00:00Z"), enqueue });
    expect(again.queued).toEqual([]);
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
});
