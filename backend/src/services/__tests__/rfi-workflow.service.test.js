const mockPrisma = {
  $transaction: jest.fn((fn) => fn(mockPrisma)),
  project: { findFirst: jest.fn(async () => ({ id: "project-1", name: "Tower" })) },
  user: { findMany: jest.fn() },
  location: { findFirst: jest.fn() },
  rfi: { findFirst: jest.fn(), update: jest.fn(async ({ data }) => ({ ...rfiRow(), ...data })) },
  rfiAssignee: { findMany: jest.fn(async () => []), deleteMany: jest.fn(), upsert: jest.fn() },
  rfiResponse: { findMany: jest.fn(async () => []), findFirst: jest.fn(), create: jest.fn(), update: jest.fn(), updateMany: jest.fn(), delete: jest.fn() },
  workflowActivityLink: { upsert: jest.fn(async (args) => args.create) },
};
const mockAudit = { ENTITY_TYPES: { RFI: "rfi" }, ACTIONS: { UPDATED: "updated" }, recordEvent: jest.fn(async () => ({})) };
const mockNotifications = { NOTIFICATION_CATEGORIES: { ASSIGNMENT: "assignment", WORKFLOW: "workflow", APPROVAL: "approval" }, createNotifications: jest.fn(async () => ({ created: 1 })) };
const mockRfiService = { answerRfi: jest.fn(async () => ({})), updateRfi: jest.fn(async () => ({})) };
const mockChangeOrders = { createChangeOrder: jest.fn(async () => ({ id: "co-1", ref: "VO-03" })) };

jest.mock("../../config/db", () => ({ prisma: mockPrisma }));
jest.mock("../audit.service", () => mockAudit);
jest.mock("../notification.service", () => mockNotifications);
jest.mock("../rfi.service", () => mockRfiService);
jest.mock("../change-order.service", () => mockChangeOrders);
jest.mock("../workflow-support.service", () => ({
  RECORD_TYPES: { RFI: "rfi" },
  attachWorkflowDetailsToRecords: async ({ records }) => records.map((row) => ({ ...row, attachments: [], activityLinks: [], history: [] })),
}));

const rfiRow = (overrides = {}) => ({
  id: "rfi-1",
  projectId: "project-1",
  ref: "RFI-004",
  subject: "Rebar spacing at gridline C",
  question: "Drawing S-201 shows 150 c/c, spec says 200 c/c. Which governs?",
  response: null,
  status: "open",
  priority: "high",
  scheduleImpact: 0,
  scheduleImpactFlag: false,
  costImpact: false,
  costImpactAmount: null,
  managerUserId: "user-pm",
  createdBy: "user-site",
  assigneeUserId: null,
  approverUserId: null,
  ballInCourtUserId: null,
  officialResponseId: null,
  revision: 0,
  changeOrderId: null,
  activityId: "act-1",
  managerUser: { id: "user-pm", name: "Priya", email: "p@x" },
  location: null,
  activity: { id: "act-1", name: "Slab L3" },
  createdAt: new Date(),
  ...overrides,
});

const service = require("../rfi-workflow.service");

describe("rfi workflow", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPrisma.rfi.findFirst.mockResolvedValue(rfiRow());
    mockPrisma.user.findMany.mockImplementation(async ({ where }) => (where.id?.in || []).map((id) => ({ id })));
    mockPrisma.rfiAssignee.findMany.mockResolvedValue([]);
    mockPrisma.rfiResponse.findMany.mockResolvedValue([]);
  });

  it("derives the ball in court from status and the assignee list", () => {
    const assignees = [{ userId: "user-arch" }, { userId: "user-eng" }];
    expect(service.ballInCourtFor(rfiRow({ status: "draft" }), assignees)).toBe("user-site");
    expect(service.ballInCourtFor(rfiRow({ status: "open" }), assignees)).toBe("user-arch");
    expect(service.ballInCourtFor(rfiRow({ status: "open" }), [])).toBe("user-pm");
    expect(service.ballInCourtFor(rfiRow({ status: "answered" }), assignees)).toBe("user-pm");
    expect(service.ballInCourtFor(rfiRow({ status: "closed" }), assignees)).toBeNull();
  });

  it("replaces assignee and distribution lists, validating users, and reports who was added", async () => {
    mockPrisma.rfiAssignee.findMany.mockImplementation(async ({ where }) => (where.role === "assignee" ? [{ userId: "user-old" }] : []));
    const changes = await service.syncPeople({ orgId: "org-1", rfiId: "rfi-1", assigneeUserIds: ["user-arch", "user-eng"], distributionUserIds: ["user-qs"], actorId: "user-site" });
    expect(mockPrisma.rfiAssignee.deleteMany).toHaveBeenCalledWith({ where: { rfiId: "rfi-1", role: "assignee", userId: { in: ["user-old"] } } });
    expect(mockPrisma.rfiAssignee.upsert).toHaveBeenCalledTimes(3);
    expect(changes).toEqual({ assigneesAdded: ["user-arch", "user-eng"], distributionAdded: ["user-qs"] });
    mockPrisma.user.findMany.mockResolvedValueOnce([]);
    await expect(service.syncPeople({ orgId: "org-1", rfiId: "rfi-1", assigneeUserIds: ["ghost"] })).rejects.toMatchObject({ code: "USER_NOT_FOUND" });
  });

  it("keeps drafts private to their creator and manager", async () => {
    expect(service.withDraftVisibility({ projectId: "p" }, "user-x")).toEqual({
      AND: [{ projectId: "p" }, { OR: [{ status: { not: "draft" } }, { createdBy: "user-x" }, { managerUserId: "user-x" }] }],
    });
    expect(service.withDraftVisibility({ projectId: "p" }, null)).toEqual({ projectId: "p" });
    expect(() => service.assertDraftVisible(rfiRow({ status: "draft" }), "user-site")).not.toThrow();
    expect(() => service.assertDraftVisible(rfiRow({ status: "draft" }), "user-other")).toThrow(expect.objectContaining({ code: "RFI_NOT_FOUND" }));
  });

  it("adds a thread response, notifies the people on the RFI, and delegates official answers to the workflow", async () => {
    mockPrisma.rfiAssignee.findMany.mockResolvedValue([{ userId: "user-arch", role: "assignee", sortOrder: 0, user: { id: "user-arch", name: "Aisha" } }]);
    mockPrisma.rfiResponse.create.mockResolvedValue({ id: "resp-1", rfiId: "rfi-1", body: "Please confirm the bar size too", isOfficial: false, revision: 0, authorId: "user-eng", author: { id: "user-eng", name: "Eli" }, createdAt: new Date(), updatedAt: new Date() });
    await service.addResponse({ orgId: "org-1", projectId: "project-1", rfiId: "rfi-1", payload: { body: "Please confirm the bar size too" }, userId: "user-eng", userRole: "external_party" });
    expect(mockPrisma.rfiResponse.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ isOfficial: false, authorId: "user-eng", revision: 0 }) }));
    expect(mockNotifications.createNotifications).toHaveBeenCalledWith(expect.objectContaining({ event: "rfi.response", recipientUserIds: expect.arrayContaining(["user-pm", "user-site", "user-arch"]) }));
    expect(mockRfiService.answerRfi).not.toHaveBeenCalled();

    await service.addResponse({ orgId: "org-1", projectId: "project-1", rfiId: "rfi-1", payload: { body: "150 c/c governs", isOfficial: true }, userId: "user-arch", userRole: "external_party" });
    expect(mockRfiService.answerRfi).toHaveBeenCalledWith(expect.objectContaining({ rfiId: "rfi-1", payload: { response: "150 c/c governs" }, userId: "user-arch" }));

    mockPrisma.rfi.findFirst.mockResolvedValue(rfiRow({ status: "closed" }));
    await expect(service.addResponse({ orgId: "org-1", projectId: "project-1", rfiId: "rfi-1", payload: { body: "late" }, userId: "user-eng" })).rejects.toMatchObject({ code: "RFI_ALREADY_CLOSED" });
  });

  it("promotes a thread response to the official answer", async () => {
    mockPrisma.rfiResponse.findFirst.mockResolvedValue({ id: "resp-2", rfiId: "rfi-1", body: "Use 150 c/c per S-201 rev C", authorId: "user-arch", isOfficial: false });
    await service.setOfficialResponse({ orgId: "org-1", projectId: "project-1", rfiId: "rfi-1", responseId: "resp-2", userId: "user-pm", userRole: "pm" });
    expect(mockPrisma.rfiResponse.updateMany).toHaveBeenCalledWith({ where: { rfiId: "rfi-1", isOfficial: true }, data: { isOfficial: false } });
    expect(mockPrisma.rfiResponse.update).toHaveBeenCalledWith({ where: { id: "resp-2" }, data: { isOfficial: true, revision: 0 } });
    expect(mockRfiService.answerRfi).toHaveBeenCalledWith(expect.objectContaining({ payload: expect.objectContaining({ response: "Use 150 c/c per S-201 rev C", officialResponseId: "resp-2", answeredBy: "user-arch" }) }));
  });

  it("records the official response row for answers that came through the base workflow", async () => {
    mockPrisma.rfiResponse.create.mockResolvedValue({ id: "resp-9", rfiId: "rfi-1", body: "Answer", isOfficial: true, revision: 1, authorId: "user-arch", author: null, createdAt: new Date(), updatedAt: new Date() });
    const result = await service.recordOfficialResponse({ orgId: "org-1", projectId: "project-1", rfi: rfiRow({ revision: 1 }), body: "Answer", authorId: "user-arch" });
    expect(mockPrisma.rfiResponse.updateMany).toHaveBeenCalledWith({ where: { rfiId: "rfi-1", isOfficial: true }, data: { isOfficial: false } });
    expect(mockPrisma.rfi.update).toHaveBeenCalledWith({ where: { id: "rfi-1" }, data: { officialResponseId: "resp-9" } });
    expect(result.isOfficial).toBe(true);
  });

  it("writes the schedule impact onto the activity link only when flagged with days", async () => {
    expect(await service.applyScheduleImpact({ projectId: "project-1", rfi: rfiRow({ scheduleImpactFlag: false, scheduleImpact: 3 }) })).toBeNull();
    expect(await service.applyScheduleImpact({ projectId: "project-1", rfi: rfiRow({ scheduleImpactFlag: true, scheduleImpact: 0 }) })).toBeNull();
    const link = await service.applyScheduleImpact({ projectId: "project-1", rfi: rfiRow({ scheduleImpactFlag: true, scheduleImpact: 4 }) });
    expect(mockPrisma.workflowActivityLink.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { recordType_recordId_activityId_relationType: { recordType: "rfi", recordId: "rfi-1", activityId: "act-1", relationType: "schedule_impact" } },
        create: expect.objectContaining({ scheduleImpactDays: 4 }),
        update: { scheduleImpactDays: 4 },
      }),
    );
    expect(link.scheduleImpactDays).toBe(4);
  });

  it("converts an RFI into a change event once", async () => {
    mockPrisma.rfi.findFirst.mockResolvedValue(rfiRow({ status: "answered", response: "150 c/c governs", scheduleImpactFlag: true, scheduleImpact: 2, costImpact: true, costImpactAmount: 12500 }));
    const result = await service.convertToChangeEvent({ orgId: "org-1", projectId: "project-1", rfiId: "rfi-1", userId: "user-pm", userRole: "pm" });
    expect(mockChangeOrders.createChangeOrder).toHaveBeenCalledWith(
      expect.objectContaining({ payload: expect.objectContaining({ description: expect.stringContaining("RFI-004: Rebar spacing"), value: 12500, scheduleImpact: 2, activityId: "act-1", category: "rfi" }) }),
    );
    expect(mockPrisma.rfi.update).toHaveBeenCalledWith({ where: { id: "rfi-1" }, data: { changeOrderId: "co-1" } });
    expect(result.changeOrder.ref).toBe("VO-03");
    mockPrisma.rfi.findFirst.mockResolvedValue(rfiRow({ changeOrderId: "co-1" }));
    await expect(service.convertToChangeEvent({ orgId: "org-1", projectId: "project-1", rfiId: "rfi-1" })).rejects.toMatchObject({ code: "RFI_ALREADY_CONVERTED" });
  });

  it("builds a detail with people, thread and the official response, and exports it as PDF", async () => {
    mockPrisma.rfi.findFirst.mockResolvedValue(rfiRow({ status: "answered", officialResponseId: "resp-1", responseRequiredBy: new Date("2020-01-01") }));
    mockPrisma.rfiAssignee.findMany.mockResolvedValue([
      { userId: "user-arch", role: "assignee", sortOrder: 0, user: { id: "user-arch", name: "Aisha", email: null } },
      { userId: "user-qs", role: "distribution", sortOrder: 0, user: { id: "user-qs", name: "Quinn", email: null } },
    ]);
    mockPrisma.rfiResponse.findMany.mockResolvedValue([
      { id: "resp-1", rfiId: "rfi-1", body: "150 c/c governs", isOfficial: true, revision: 0, authorId: "user-arch", author: { id: "user-arch", name: "Aisha" }, createdAt: new Date(), updatedAt: new Date() },
      { id: "resp-2", rfiId: "rfi-1", body: "Noted, thanks", isOfficial: false, revision: 0, authorId: "user-site", author: { id: "user-site", name: "Sami" }, createdAt: new Date(), updatedAt: new Date() },
    ]);
    const detail = await service.getRfi({ orgId: "org-1", projectId: "project-1", rfiId: "rfi-1", viewerId: "user-site" });
    expect(detail.assignees.map((row) => row.name)).toEqual(["Aisha"]);
    expect(detail.distribution.map((row) => row.name)).toEqual(["Quinn"]);
    expect(detail.officialResponse.id).toBe("resp-1");
    expect(detail.responses).toHaveLength(2);
    expect(detail.isOverdue).toBe(true);
    expect(detail.path).toContain("/doc-control/rfi?recordId=rfi-1");

    const pdf = await service.exportRfiPdf({ orgId: "org-1", projectId: "project-1", rfiId: "rfi-1", viewerId: "user-site" });
    expect(pdf.fileName).toBe("rfi-004-rebar-spacing-at-gridline-c.pdf");
    const text = pdf.buffer.toString("latin1");
    expect(text.startsWith("%PDF")).toBe(true);
    expect(text).toContain("Official response");
    expect(text).toContain("150 c/c governs");
  });
});
