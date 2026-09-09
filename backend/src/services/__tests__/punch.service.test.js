const { referenceCounterMock } = require("./helpers/reference-counter-mock");
const mockPrisma = {
  ...referenceCounterMock(),
  $transaction: jest.fn((fn) => fn(mockPrisma)),
  project: { findFirst: jest.fn() },
  location: { findFirst: jest.fn() },
  sheet: { findFirst: jest.fn() },
  activity: { findFirst: jest.fn() },
  company: { findFirst: jest.fn() },
  user: { findMany: jest.fn() },
  punchItem: { aggregate: jest.fn(), create: jest.fn(), update: jest.fn(), updateMany: jest.fn(), findFirst: jest.fn(), findMany: jest.fn(), delete: jest.fn() },
  punchItemEvent: { create: jest.fn(async () => ({})), findMany: jest.fn(async () => []) },
  projectPartyMember: { findMany: jest.fn(async () => []) },
  attachment: { findMany: jest.fn(async () => []) },
};
const mockAudit = {
  ENTITY_TYPES: { PUNCH_ITEM: "punch_item" },
  ACTIONS: { CREATED: "created", UPDATED: "updated", STATUS_CHANGED: "status_changed", DELETED: "deleted" },
  recordEvent: jest.fn(async () => ({})),
};
const mockNotifications = {
  NOTIFICATION_CATEGORIES: { ASSIGNMENT: "assignment", APPROVAL: "approval", QUALITY: "quality", WORKFLOW: "workflow" },
  createNotifications: jest.fn(async () => ({ created: 0 })),
};
const mockSendEmail = jest.fn(async () => ({ delivered: true }));
const mockIsPartyScoped = jest.fn(() => false);

jest.mock("../../config/db", () => ({ prisma: mockPrisma }));
jest.mock("../audit.service", () => mockAudit);
jest.mock("../notification.service", () => mockNotifications);
jest.mock("../file-storage.service", () => ({ getProjectDocumentFile: jest.fn() }));
jest.mock("../email.service", () => ({ sendEmail: (...args) => mockSendEmail(...args) }));
jest.mock("../company-party.service", () => ({ isPartyScopedAccess: (...args) => mockIsPartyScoped(...args) }));
jest.mock("../workflow-support.service", () => ({
  RECORD_TYPES: { PUNCH_ITEM: "punch_item" },
  attachWorkflowDetailsToRecords: async ({ records }) => records.map((row) => ({ ...row, attachments: [], activityLinks: [], history: [] })),
  syncWorkflowReferences: jest.fn(async () => ({})),
}));

const service = require("../punch.service");

const ORG = "org-1";
const PROJECT = "project-1";
const PM = { id: "user-pm", name: "Priya", role: "pm", projectAccess: { role: "pm", partyAccess: [] } };
const SITE = { id: "user-site", name: "Sami", role: "site_engineer", projectAccess: { role: "site_engineer", partyAccess: [] } };
const SUB = { id: "user-sub", name: "Bilal", role: "external_party", projectAccess: { scope: "party", partyAccess: [{ projectPartyId: "party-1", companyId: "company-sub" }] } };
const APPROVER = { id: "user-arch", name: "Aisha", role: "external_party", projectAccess: { role: "consultant", partyAccess: [{ projectPartyId: "party-2", companyId: "company-arch" }] } };

const item = (overrides = {}) => ({
  id: "item-1",
  orgId: ORG,
  projectId: PROJECT,
  number: 7,
  ref: "PL-007",
  title: "Crack in render",
  status: "open",
  priority: "normal",
  assigneeCompanyId: "company-sub",
  assigneeUserId: "user-sub",
  managerUserId: "user-site",
  finalApproverUserId: "user-arch",
  ballInCourtUserId: "user-sub",
  createdBy: "user-site",
  reopenCount: 0,
  dueDate: new Date("2026-09-01T00:00:00Z"),
  createdAt: new Date(),
  updatedAt: new Date(),
  assigneeCompany: { id: "company-sub", name: "Sub Co" },
  assigneeUser: { id: "user-sub", name: "Bilal" },
  managerUser: { id: "user-site", name: "Sami" },
  finalApproverUser: { id: "user-arch", name: "Aisha" },
  location: null,
  sheet: null,
  activity: null,
  ...overrides,
});

// The service re-reads / updates the row several times per call; keep one mutable "row" so each
// update sees the previous one, the way the database would.
let state = {};
const seed = (overrides = {}) => {
  state = { ...overrides };
};

describe("punch service", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    seed({});
    mockIsPartyScoped.mockReturnValue(false);
    mockPrisma.project.findFirst.mockResolvedValue({ id: PROJECT, name: "Tower" });
    mockPrisma.punchItem.aggregate.mockResolvedValue({ _max: { number: 6 } });
    mockPrisma.punchItem.findFirst.mockImplementation(async () => item(state));
    mockPrisma.punchItem.create.mockImplementation(({ data }) => {
      state = { id: `item-${data.number}`, ...data, assigneeCompany: null, assigneeUser: null, managerUser: null, finalApproverUser: null };
      return Promise.resolve(item(state));
    });
    mockPrisma.punchItem.update.mockImplementation(({ data }) => {
      state = { ...state, ...data };
      return Promise.resolve(item(state));
    });
    mockPrisma.company.findFirst.mockResolvedValue({ id: "company-sub" });
    mockPrisma.user.findMany.mockImplementation(({ where }) => Promise.resolve((where.id?.in || []).map((id) => ({ id, name: id, email: `${id}@example.com` }))));
  });

  describe("create", () => {
    it("numbers items sequentially, starts as draft with the creator holding the ball, and audits", async () => {
      const created = await service.createPunchItem({ orgId: ORG, projectId: PROJECT, payload: { title: "  Crack in render ", assigneeCompanyId: "company-sub", priority: "high" }, actor: SITE });
      expect(mockPrisma.punchItem.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ number: 7, ref: "PL-007", title: "Crack in render", status: "draft", priority: "high", createdBy: SITE.id }) }),
      );
      expect(mockPrisma.punchItem.update).toHaveBeenCalledWith(expect.objectContaining({ data: { ballInCourtUserId: SITE.id } }));
      expect(mockPrisma.punchItemEvent.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: "created", toStatus: "draft" }) }));
      expect(mockAudit.recordEvent).toHaveBeenCalledWith(expect.objectContaining({ entityType: "punch_item", action: "created" }));
      expect(mockNotifications.createNotifications).not.toHaveBeenCalled();
      expect(created.ref).toBe("PL-007");
    });

    it("opens immediately when asked and notifies the assignee, manager and company members", async () => {
      mockPrisma.projectPartyMember.findMany.mockResolvedValue([{ userId: "user-sub-2" }]);
      await service.createPunchItem({
        orgId: ORG,
        projectId: PROJECT,
        payload: { title: "Missing skirting", status: "open", assigneeCompanyId: "company-sub", assigneeUserId: "user-sub", managerUserId: "user-site" },
        actor: SITE,
      });
      expect(mockPrisma.projectPartyMember.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ projectParty: expect.objectContaining({ companyId: { in: ["company-sub"] } }) }) }));
      expect(mockNotifications.createNotifications).toHaveBeenCalledWith(
        expect.objectContaining({ category: "assignment", event: "punch.opened", recipientUserIds: expect.arrayContaining(["user-sub", "user-site", "user-sub-2"]) }),
      );
    });

    it("numbers observations separately, validates their type and points back at the source", async () => {
      const created = await service.createPunchItem({
        orgId: ORG,
        projectId: PROJECT,
        actor: SITE,
        payload: { title: "Unguarded slab edge", kind: "observation", observationType: "safety", hazard: "Fall from height", sourceRecordType: "form_instance", sourceRecordId: "inst-9", status: "open" },
      });
      expect(mockPrisma.punchItem.aggregate).toHaveBeenCalledWith({ where: { projectId: PROJECT, kind: "observation" }, _max: { number: true } });
      expect(mockPrisma.punchItem.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ kind: "observation", number: 7, ref: "OBS-007", observationType: "safety", hazard: "Fall from height", sourceRecordType: "form_instance", sourceRecordId: "inst-9" }) }),
      );
      expect(created.kind).toBe("observation");
      expect(created.path).toContain("/quality/observations?recordId=");
      expect(created.sourcePath).toContain("/quality/itp?recordId=inst-9");
      await expect(service.createPunchItem({ orgId: ORG, projectId: PROJECT, actor: SITE, payload: { title: "x", kind: "observation", observationType: "weather" } })).rejects.toMatchObject({ code: "OBSERVATION_TYPE_INVALID" });
      // Plain punch items default to kind punch with PL numbering.
      await service.createPunchItem({ orgId: ORG, projectId: PROJECT, actor: SITE, payload: { title: "Scuffed paint" } });
      expect(mockPrisma.punchItem.create).toHaveBeenLastCalledWith(expect.objectContaining({ data: expect.objectContaining({ kind: "punch", ref: "PL-007" }) }));
    });

    it("rejects bad priorities, missing titles and unknown companies", async () => {
      await expect(service.createPunchItem({ orgId: ORG, projectId: PROJECT, payload: { title: "x", priority: "asap" }, actor: SITE })).rejects.toMatchObject({ code: "PUNCH_PRIORITY_INVALID" });
      await expect(service.createPunchItem({ orgId: ORG, projectId: PROJECT, payload: { title: "  " }, actor: SITE })).rejects.toMatchObject({ code: "PUNCH_TITLE_REQUIRED" });
      mockPrisma.company.findFirst.mockResolvedValue(null);
      await expect(service.createPunchItem({ orgId: ORG, projectId: PROJECT, payload: { title: "x", assigneeCompanyId: "nope" }, actor: SITE })).rejects.toMatchObject({ code: "COMPANY_NOT_FOUND" });
    });

    it("bulk-creates with defaults and consecutive numbers", async () => {
      let next = 6;
      mockPrisma.punchItem.aggregate.mockImplementation(async () => ({ _max: { number: next } }));
      mockPrisma.punchItem.create.mockImplementation(({ data }) => {
        next = data.number;
        return Promise.resolve(item({ id: `item-${data.number}`, ...data }));
      });
      const result = await service.bulkCreatePunchItems({
        orgId: ORG,
        projectId: PROJECT,
        items: [{ title: "Door closer" }, { title: "Paint touch-up", priority: "low" }, { title: "Seal joint" }],
        defaults: { assigneeCompanyId: "company-sub", trade: "Joinery" },
        actor: PM,
      });
      expect(result.created).toBe(3);
      expect(mockPrisma.punchItem.create.mock.calls.map(([args]) => args.data.number)).toEqual([7, 8, 9]);
      expect(mockPrisma.punchItem.create.mock.calls[1][0].data).toEqual(expect.objectContaining({ trade: "Joinery", priority: "low", assigneeCompanyId: "company-sub" }));
      await expect(service.bulkCreatePunchItems({ orgId: ORG, projectId: PROJECT, items: [], actor: PM })).rejects.toMatchObject({ code: "PUNCH_ITEMS_REQUIRED" });
    });
  });

  describe("state machine", () => {
    it("walks open → ready for review → closed by the final approver only, with the ball moving", async () => {
      seed({ status: "open" });
      const ready = await service.transitionPunchItem({ orgId: ORG, projectId: PROJECT, itemId: "item-1", action: "ready_for_review", actor: SUB });
      expect(ready.status).toBe("ready_for_review");
      expect(mockPrisma.punchItem.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "ready_for_review", readyAt: expect.any(Date) }) }));
      expect(mockPrisma.punchItem.update).toHaveBeenLastCalledWith(expect.objectContaining({ data: { ballInCourtUserId: "user-arch" } }));
      expect(mockNotifications.createNotifications).toHaveBeenLastCalledWith(expect.objectContaining({ category: "approval", event: "punch.ready_for_review", recipientUserIds: expect.arrayContaining(["user-arch"]) }));

      seed({ status: "ready_for_review" });
      await expect(service.transitionPunchItem({ orgId: ORG, projectId: PROJECT, itemId: "item-1", action: "close", actor: PM })).rejects.toMatchObject({ code: "PUNCH_FINAL_APPROVER_ONLY" });
      const closed = await service.transitionPunchItem({ orgId: ORG, projectId: PROJECT, itemId: "item-1", action: "close", actor: APPROVER });
      expect(closed.status).toBe("closed");
      expect(mockPrisma.punchItem.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "closed", closedBy: APPROVER.id }) }));
      expect(mockPrisma.punchItemEvent.create).toHaveBeenLastCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: "closed", fromStatus: "ready_for_review", toStatus: "closed" }) }));
    });

    it("requires a reason to reopen or dispute, counts reopens, and refuses impossible moves", async () => {
      seed({ status: "closed", reopenCount: 1 });
      await expect(service.transitionPunchItem({ orgId: ORG, projectId: PROJECT, itemId: "item-1", action: "reopen", actor: PM })).rejects.toMatchObject({ code: "PUNCH_REASON_REQUIRED" });
      const reopened = await service.transitionPunchItem({ orgId: ORG, projectId: PROJECT, itemId: "item-1", action: "reopen", reason: "Paint peeling again", actor: PM });
      expect(reopened.status).toBe("open");
      expect(mockPrisma.punchItem.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "open", reopenCount: 2, closedAt: null }) }));

      seed({ status: "draft" });
      await expect(service.transitionPunchItem({ orgId: ORG, projectId: PROJECT, itemId: "item-1", action: "ready_for_review", actor: SITE })).rejects.toMatchObject({ code: "PUNCH_TRANSITION_INVALID" });

      seed({ status: "open" });
      const disputed = await service.transitionPunchItem({ orgId: ORG, projectId: PROJECT, itemId: "item-1", action: "dispute", reason: "Not our scope", actor: SUB });
      expect(disputed.status).toBe("in_dispute");
      expect(mockPrisma.punchItem.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "in_dispute", disputeReason: "Not our scope" }) }));
    });
  });

  describe("visibility", () => {
    it("scopes party users to their company's items and their own", async () => {
      mockIsPartyScoped.mockImplementation((access) => access?.scope === "party");
      mockPrisma.punchItem.findMany.mockResolvedValue([item()]);
      await service.listPunchItems({ orgId: ORG, projectId: PROJECT, filters: { status: "open", overdue: true }, viewer: SUB });
      const where = mockPrisma.punchItem.findMany.mock.calls[0][0].where;
      expect(where.AND).toEqual([
        { OR: [{ assigneeCompanyId: { in: ["company-sub"] } }, { createdBy: SUB.id }, { assigneeUserId: SUB.id }] },
      ]);
      expect(where.dueDate).toEqual({ lt: expect.any(Date) });

      seed({ assigneeCompanyId: "company-other", assigneeUserId: "someone", createdBy: "someone" });
      await expect(service.getPunchItem({ orgId: ORG, projectId: PROJECT, itemId: "item-1", viewer: SUB })).rejects.toMatchObject({ code: "PUNCH_ITEM_NOT_FOUND" });

      mockPrisma.punchItem.findMany.mockResolvedValue([]);
      await service.listPunchItems({ orgId: ORG, projectId: PROJECT, filters: {}, viewer: PM });
      const pmWhere = mockPrisma.punchItem.findMany.mock.calls[1][0].where;
      expect(pmWhere.AND).toBeUndefined();
      expect(pmWhere.status).toEqual({ not: "void" });
      expect(pmWhere.kind).toBe("punch");

      await service.listPunchItems({ orgId: ORG, projectId: PROJECT, filters: { kind: "observation", observationType: "safety" }, viewer: PM });
      expect(mockPrisma.punchItem.findMany.mock.calls[2][0].where).toEqual(expect.objectContaining({ kind: "observation", observationType: "safety" }));
    });

    it("summarises by status, company and overdue", async () => {
      mockPrisma.punchItem.findMany.mockResolvedValue([
        item({ id: "a", status: "open" }),
        item({ id: "b", status: "closed", dueDate: new Date("2020-01-01") }),
        item({ id: "c", status: "ready_for_review", assigneeCompany: { id: "x", name: "Other Co" }, dueDate: new Date("2099-01-01") }),
      ]);
      const result = await service.listPunchItems({ orgId: ORG, projectId: PROJECT, filters: { status: "all" }, viewer: PM });
      expect(result.summary).toEqual(
        expect.objectContaining({ total: 3, open: 2, overdue: 1, byStatus: expect.objectContaining({ open: 1, closed: 1, ready_for_review: 1 }) }),
      );
      expect(result.summary.byCompany[0]).toEqual({ company: "Sub Co", total: 2, open: 1, overdue: 1 });
      expect(result.items[0].isOverdue).toBe(true);
    });
  });

  describe("distribution and export", () => {
    it("emails company members and assignees, records the event and notifies in-app", async () => {
      mockPrisma.punchItem.findMany.mockResolvedValue([item({ id: "a" }), item({ id: "b", ref: "PL-008", title: "Loose tile" })]);
      mockPrisma.projectPartyMember.findMany.mockResolvedValue([{ userId: "user-sub" }, { userId: "user-sub-2" }]);
      mockPrisma.punchItem.updateMany.mockResolvedValue({ count: 2 });
      const result = await service.distributePunchItems({ orgId: ORG, projectId: PROJECT, companyIds: ["company-sub"], message: "Please close by Friday", actor: PM });
      expect(mockSendEmail).toHaveBeenCalledTimes(2);
      expect(mockSendEmail).toHaveBeenCalledWith(expect.objectContaining({ to: "user-sub@example.com", subject: "Punch list: 2 items on Tower", body: expect.stringContaining("PL-007  Crack in render") }));
      expect(mockSendEmail.mock.calls[0][0].body).toContain("Please close by Friday");
      expect(mockPrisma.punchItemEvent.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: "distributed" }) }));
      expect(mockNotifications.createNotifications).toHaveBeenCalledWith(expect.objectContaining({ event: "punch.distributed", recipientUserIds: ["user-sub", "user-sub-2"] }));
      expect(result).toEqual(expect.objectContaining({ items: 2, recipients: expect.arrayContaining([expect.objectContaining({ delivered: true })]) }));
    });

    it("exports a grouped PDF and a CSV", async () => {
      mockPrisma.punchItem.findMany.mockResolvedValue([item({ id: "a" }), item({ id: "b", assigneeCompany: { id: "x", name: "Other Co" }, location: { id: "l", name: "Level 3", path: "l" } })]);
      const pdf = await service.exportPunchListPdf({ orgId: ORG, projectId: PROJECT, filters: {}, groupBy: "company", viewer: PM });
      expect(pdf.fileName).toBe("punch-list-tower.pdf");
      expect(pdf.count).toBe(2);
      const text = pdf.buffer.toString("latin1");
      expect(text.startsWith("%PDF")).toBe(true);
      expect(text).toContain("Assigned to Sub Co");
      expect(text).toContain("Assigned to Other Co");

      const csv = await service.exportPunchListCsv({ orgId: ORG, projectId: PROJECT, filters: {}, viewer: PM });
      expect(csv.csv).toContain("Ref,Kind,Title,Description,Status");
      expect(csv.csv).toContain("PL-007,punch,Crack in render");
      expect(csv.csv).toContain("Level 3");
    });
  });
});
