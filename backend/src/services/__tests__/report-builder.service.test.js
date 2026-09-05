const table = () => ({ findMany: jest.fn(async () => []), findFirst: jest.fn(async () => null), findUnique: jest.fn(async () => null), create: jest.fn(async ({ data }) => ({ id: "new-1", ...data })), update: jest.fn(async ({ data, where }) => ({ id: where.id, ...data })), delete: jest.fn(async () => ({})), deleteMany: jest.fn(async () => ({ count: 0 })) });

const mockPrisma = {
  project: { findMany: jest.fn(async () => []), findFirst: jest.fn(async () => null) },
  rfi: table(),
  punchItem: table(),
  costRecord: table(),
  ipcCertificate: table(),
  reportDefinition: table(),
  reportSchedule: table(),
  reportRun: table(),
  user: { findFirst: jest.fn(async () => ({ id: "pm-1", name: "Pat PM", email: "pat@example.com", role: "pm", isCompanyAdmin: false })) },
};
const mockAccess = { assertProjectAccess: jest.fn(), getProjectAccessWhere: jest.fn(() => ({})) };
const mockTemplates = { resolveTemplateContext: jest.fn(async () => null), templateAllows: jest.fn(() => null) };
const mockNotifications = { NOTIFICATION_CATEGORIES: { WORKFLOW: "workflow" }, createNotifications: jest.fn(async () => ({ created: 2 })) };
const mockEmail = { sendEmail: jest.fn(async ({ to }) => ({ delivered: true, to })) };
const mockAudit = { ENTITY_TYPES: { REPORT: "report" }, ACTIONS: { CREATED: "created", UPDATED: "updated", DELETED: "deleted" }, recordEvent: jest.fn(async () => ({})) };

jest.mock("../../config/db", () => ({ prisma: mockPrisma }));
jest.mock("../project-authorization.service", () => mockAccess);
jest.mock("../permission-template.service", () => mockTemplates);
jest.mock("../notification.service", () => mockNotifications);
jest.mock("../email.service", () => mockEmail);
jest.mock("../audit.service", () => mockAudit);
jest.mock("../company-party.service", () => ({
  isPartyScopedAccess: (access) => access?.scope === "party",
  applyPartyWorkflowVisibility: (where, access) => {
    if (access?.scope !== "party") return where;
    const ids = (access.partyAccess || []).map((party) => party.projectPartyId);
    return { ...where, AND: [...(where.AND || []), { OR: [{ ownerPartyId: { in: ids } }, { reviewerPartyId: { in: ids } }, { approverPartyId: { in: ids } }] }] };
  },
}));
jest.mock("../rfi-workflow.service", () => ({ withDraftVisibility: (where, viewerId) => ({ AND: [where, { OR: [{ status: { not: "draft" } }, { createdBy: viewerId }] }] }) }));
jest.mock("../punch.service", () => ({
  visibilityWhere: (viewer) => {
    if (viewer?.projectAccess?.scope !== "party") return null;
    return { OR: [{ assigneeCompanyId: { in: viewer.projectAccess.partyAccess.map((party) => party.companyId) } }, { createdBy: viewer.id }] };
  },
}));

const service = require("../report-builder.service");

const pm = { id: "pm-1", name: "Pat PM", email: "pat@example.com", role: "pm", isCompanyAdmin: false };
const warehouse = { id: "wh-1", name: "Wes", email: "wes@example.com", role: "warehouse", isCompanyAdmin: false };
const partyUser = { id: "sub-1", name: "Sam Sub", email: "sam@example.com", role: "site_engineer", isCompanyAdmin: false };
const projects = [{ id: "p1", name: "Tower", currency: "USD", status: "active" }, { id: "p2", name: "Bridge", currency: "USD", status: "active" }];
const staffAccess = (projectId, role) => ({ id: projectId, orgId: "org-1", role, assignmentRole: role, partyAccess: [], scope: "assignment" });
const partyAccess = (projectId) => ({ id: projectId, orgId: "org-1", role: "external_party", assignmentRole: null, partyAccess: [{ projectPartyId: "party-9", companyId: "co-9", role: "subcontractor" }], scope: "party" });
const rfi = (overrides = {}) => ({ id: "rfi-1", projectId: "p1", ref: "RFI-001", subject: "Rebar spacing", discipline: "Structural", priority: "high", status: "open", raisedDate: new Date("2026-08-20T00:00:00Z"), dueDate: null, responseRequiredBy: new Date("2026-08-30T00:00:00Z"), answeredDate: null, scheduleImpact: 3, costImpact: false, costImpactAmount: null, revision: 0, createdAt: new Date("2026-08-20T00:00:00Z"), project: { id: "p1", name: "Tower", currency: "USD" }, activity: { id: "a1", name: "Slab", activityCode: "A100", wbsCode: null }, location: null, ...overrides });

describe("report builder", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPrisma.project.findMany.mockResolvedValue(projects);
    mockAccess.assertProjectAccess.mockImplementation(async ({ projectId, role }) => staffAccess(projectId, role));
    mockPrisma.reportRun.findMany.mockResolvedValue([]);
  });

  it("queries the source with translated filters, flattens relation and computed columns, sorts and groups", async () => {
    mockPrisma.rfi.findMany.mockResolvedValueOnce([rfi(), rfi({ id: "rfi-2", projectId: "p2", ref: "RFI-002", subject: "Door schedule", status: "answered", priority: "normal", responseRequiredBy: new Date("2026-12-01T00:00:00Z"), answeredDate: new Date("2026-09-01T00:00:00Z"), project: { id: "p2", name: "Bridge", currency: "USD" }, activity: null })]);
    const result = await service.runQuery({
      orgId: "org-1",
      user: pm,
      definition: { source: "rfi", columns: ["ref", "subject", "status", "activity.name", "overdue", "daysOpen"], filters: [{ field: "priority", op: "in", value: ["high", "normal"] }, { field: "responseRequiredBy", op: "not_empty" }, { field: "overdue", op: "is_true" }], sort: { field: "ref", dir: "desc" }, groupBy: "status", aggregates: [{ fn: "count" }, { fn: "sum", field: "scheduleImpact" }] },
    });
    // Staff share one draft-visibility clause, so both projects go in one query.
    expect(mockPrisma.rfi.findMany).toHaveBeenCalledTimes(1);
    const where = mockPrisma.rfi.findMany.mock.calls[0][0].where;
    expect(where).toMatchObject({ projectId: { in: ["p1", "p2"] }, archivedAt: null });
    expect(where.AND).toHaveLength(3);
    expect(where.AND.slice(0, 2)).toEqual([{ priority: { in: ["high", "normal"] } }, { responseRequiredBy: { not: null } }]);
    expect(JSON.stringify(where.AND[2])).toContain('"createdBy":"pm-1"');
    expect(mockPrisma.rfi.findMany.mock.calls[0][0].take).toBe(5000);
    expect(result.projects).toEqual({ inScope: 2, queried: 2, denied: 0 });
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({ id: "rfi-1", projectName: "Tower", ref: "RFI-001", "activity.name": "Slab", overdue: true });
    expect(result.rows[0].daysOpen).toBeGreaterThan(0);
    expect(result.groups).toEqual([{ key: "open", label: "open", count: 1, sum_scheduleImpact: 3 }]);
    expect(result.totals).toEqual({ count: 1, sum_scheduleImpact: 3 });
    expect(result.columns.map((column) => column.key)).toEqual(["ref", "subject", "status", "activity.name", "overdue", "daysOpen"]);
  });

  it("skips projects where the caller cannot read the source's module", async () => {
    // Warehouse cannot read IPC anywhere.
    const result = await service.runQuery({ orgId: "org-1", user: warehouse, definition: { source: "ipc_certificate", columns: ["period"] } });
    expect(mockPrisma.ipcCertificate.findMany).not.toHaveBeenCalled();
    expect(result.projects).toEqual({ inScope: 2, queried: 0, denied: 2 });
    expect(result.rows).toEqual([]);

    mockTemplates.templateAllows.mockReturnValueOnce(false).mockReturnValueOnce(true);
    mockTemplates.resolveTemplateContext.mockResolvedValue({ compiled: { any: true } });
    const gated = await service.runQuery({ orgId: "org-1", user: pm, definition: { source: "rfi", columns: ["ref"] } });
    expect(gated.projects).toEqual({ inScope: 2, queried: 1, denied: 1 });
    expect(mockPrisma.rfi.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ projectId: { in: ["p2"] } }) }));
    mockTemplates.resolveTemplateContext.mockResolvedValue(null);
  });

  it("applies the register's party visibility per project for collaborator users", async () => {
    mockAccess.assertProjectAccess.mockImplementation(async ({ projectId }) => (projectId === "p1" ? partyAccess("p1") : staffAccess("p2", "site_engineer")));
    mockPrisma.punchItem.findMany.mockResolvedValue([]);
    await service.runQuery({ orgId: "org-1", user: partyUser, definition: { source: "punch_item", columns: ["ref", "title"] } });
    const calls = mockPrisma.punchItem.findMany.mock.calls.map((call) => call[0].where);
    expect(calls).toHaveLength(2);
    const partyCall = calls.find((where) => where.projectId.in.includes("p1"));
    expect(partyCall.AND).toEqual([{ OR: [{ assigneeCompanyId: { in: ["co-9"] } }, { createdBy: "sub-1" }] }]);
    const staffCall = calls.find((where) => where.projectId.in.includes("p2"));
    expect(staffCall.AND).toEqual([]);
  });

  it("validates definitions", () => {
    expect(() => service.normalizeDefinition({ source: "nope" })).toThrow(expect.objectContaining({ code: "REPORT_SOURCE_UNKNOWN" }));
    expect(() => service.normalizeDefinition({ source: "rfi", columns: ["ref", "colour"] })).toThrow(expect.objectContaining({ code: "REPORT_COLUMN_UNKNOWN" }));
    expect(() => service.normalizeDefinition({ source: "rfi", filters: [{ field: "ref", op: "like", value: "x" }] })).toThrow(expect.objectContaining({ code: "REPORT_FILTER_OP" }));
    expect(() => service.normalizeDefinition({ source: "rfi", filters: [{ field: "scheduleImpact", op: "gt", value: "many" }] })).toThrow(expect.objectContaining({ code: "REPORT_FILTER_VALUE" }));
    expect(() => service.normalizeDefinition({ source: "rfi", aggregates: [{ fn: "sum", field: "subject" }] })).toThrow(expect.objectContaining({ code: "REPORT_AGGREGATE_FIELD" }));
    const normalized = service.normalizeDefinition({ source: "rfi", filters: [{ field: "raisedDate", op: "last_days", value: "7" }], sort: { field: "dueDate", dir: "DESC" }, visibility: "org" });
    expect(normalized).toMatchObject({ columns: expect.arrayContaining(["ref", "subject"]), filters: [{ field: "raisedDate", op: "last_days", value: 7 }], sort: { field: "dueDate", dir: "desc" }, visibility: "org" });
  });

  it("computes the next run in the schedule's time zone", () => {
    const from = new Date("2026-09-08T10:00:00Z"); // Tuesday
    expect(service.computeNextRun({ frequency: "weekly", dayOfWeek: 1, hour: 7, minute: 0, timezone: "Asia/Riyadh", from }).toISOString()).toBe("2026-09-14T04:00:00.000Z");
    expect(service.computeNextRun({ frequency: "daily", hour: 6, minute: 30, timezone: "UTC", from }).toISOString()).toBe("2026-09-09T06:30:00.000Z");
    expect(service.computeNextRun({ frequency: "daily", hour: 18, minute: 0, timezone: "UTC", from }).toISOString()).toBe("2026-09-08T18:00:00.000Z");
    expect(service.computeNextRun({ frequency: "monthly", dayOfMonth: 31, hour: 8, minute: 0, timezone: "UTC", from }).toISOString()).toBe("2026-09-30T08:00:00.000Z");
  });

  it("renders XLSX and PDF from a result", async () => {
    const result = await service.runQuery({ orgId: "org-1", user: pm, definition: { source: "rfi", columns: ["ref", "subject", "status"], groupBy: "status", aggregates: [{ fn: "count" }] } });
    const report = { id: "r1", name: "Open RFIs", description: null, source: "rfi", columns: ["ref", "subject", "status"], filters: [], projectId: null };
    const xlsx = await service.renderXlsx({ report, result, user: pm });
    expect(xlsx.subarray(0, 2).toString()).toBe("PK");
    const pdf = service.renderPdf({ report, result, user: pm });
    expect(pdf.subarray(0, 4).toString()).toBe("%PDF");
  });

  it("executes a scheduled run as the schedule owner, stores files and delivers", async () => {
    mockPrisma.rfi.findMany.mockResolvedValue([rfi()]);
    mockPrisma.reportRun.findUnique.mockResolvedValue({
      id: "run-1",
      orgId: "org-1",
      reportId: "r1",
      scheduleId: "s1",
      format: "both",
      requestedBy: null,
      recipientsJson: { userIds: [], roles: ["pm"], emails: ["director@example.com"] },
      report: { id: "r1", name: "Overdue RFIs", description: null, source: "rfi", columnsJson: ["ref", "subject", "overdue"], filtersJson: [{ field: "overdue", op: "is_true" }], sortJson: null, groupBy: null, aggregatesJson: [], projectId: null, createdBy: "pm-1" },
      schedule: { id: "s1", createdBy: "pm-1", recipientsJson: {} },
    });
    const run = await service.executeRun({ runId: "run-1" });
    expect(mockPrisma.user.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ id: "pm-1", orgId: "org-1" }) }));
    const finalUpdate = mockPrisma.reportRun.update.mock.calls.find((call) => call[0].data.status === "succeeded")[0];
    expect(finalUpdate.data).toMatchObject({ rowCount: 1, truncated: false, recipientsJson: { userIds: [], roles: ["pm"], emails: ["director@example.com"] } });
    expect(finalUpdate.data.pdfBytes.subarray(0, 4).toString()).toBe("%PDF");
    expect(finalUpdate.data.xlsxBytes.subarray(0, 2).toString()).toBe("PK");
    expect(mockNotifications.createNotifications).toHaveBeenCalledWith(expect.objectContaining({ event: "report.delivered", recipientRoles: ["pm"], actionUrl: "/reports?reportId=r1&runId=run-1" }));
    expect(mockEmail.sendEmail).toHaveBeenCalledWith(expect.objectContaining({ to: "director@example.com", subject: "Report: Overdue RFIs" }));
    expect(mockPrisma.reportSchedule.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "s1" }, data: expect.objectContaining({ lastStatus: "succeeded" }) }));
    expect(run.status).toBe("succeeded");
  });

  it("queues due schedules and moves nextRunAt forward", async () => {
    const now = new Date("2026-09-14T04:05:00Z");
    mockPrisma.reportSchedule.findMany.mockResolvedValueOnce([{ id: "s1", orgId: "org-1", reportId: "r1", frequency: "weekly", dayOfWeek: 1, dayOfMonth: 1, hour: 7, minute: 0, timezone: "Asia/Riyadh", format: "pdf", recipientsJson: { roles: ["pm"] }, createdBy: "pm-1", nextRunAt: new Date("2026-09-14T04:00:00Z"), report: { id: "r1", orgId: "org-1", projectId: null } }]);
    const enqueue = jest.fn(async () => ({}));
    const result = await service.queueDueSchedules({ now, enqueue });
    expect(mockPrisma.reportSchedule.update).toHaveBeenCalledWith({ where: { id: "s1" }, data: { nextRunAt: new Date("2026-09-21T04:00:00.000Z") } });
    expect(mockPrisma.reportRun.create).toHaveBeenCalledWith({ data: expect.objectContaining({ reportId: "r1", scheduleId: "s1", trigger: "schedule", format: "pdf", requestedBy: "pm-1" }) });
    expect(enqueue).toHaveBeenCalledWith({ orgId: "org-1", projectId: null, payload: { runId: "new-1", reportId: "r1", scheduleId: "s1" } });
    expect(result.queued).toHaveLength(1);
  });

  it("only owners and PMs change or delete a saved report", async () => {
    mockPrisma.reportDefinition.findFirst.mockResolvedValue({ id: "r1", orgId: "org-1", name: "Mine", source: "rfi", columnsJson: ["ref"], filtersJson: [], aggregatesJson: [], visibility: "org", createdBy: "someone-else", projectId: null });
    await expect(service.updateDefinition({ orgId: "org-1", user: warehouse, reportId: "r1", payload: { name: "Taken" } })).rejects.toMatchObject({ code: "REPORT_FORBIDDEN" });
    mockPrisma.reportDefinition.update.mockResolvedValueOnce({ id: "r1", name: "Taken", source: "rfi", columnsJson: ["ref"], filtersJson: [], aggregatesJson: [], visibility: "org", createdBy: "someone-else", projectId: null });
    const updated = await service.updateDefinition({ orgId: "org-1", user: pm, reportId: "r1", payload: { name: "Taken" } });
    expect(updated.name).toBe("Taken");
    expect(mockPrisma.reportDefinition.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ name: "Taken", updatedBy: "pm-1" }) }));
  });
});
