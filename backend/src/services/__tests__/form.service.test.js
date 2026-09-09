const { referenceCounterMock } = require("./helpers/reference-counter-mock");
const mockPrisma = {
  ...referenceCounterMock(),
  $transaction: jest.fn((fn) => fn(mockPrisma)),
  project: { findFirst: jest.fn() },
  location: { findFirst: jest.fn() },
  sheet: { findFirst: jest.fn() },
  activity: { findFirst: jest.fn() },
  company: { findFirst: jest.fn() },
  formTemplate: { findFirst: jest.fn(), findMany: jest.fn(), create: jest.fn(), update: jest.fn() },
  formSection: { findMany: jest.fn(), create: jest.fn(), update: jest.fn(), deleteMany: jest.fn() },
  formItem: { findMany: jest.fn(), findFirst: jest.fn(), create: jest.fn(), update: jest.fn(), deleteMany: jest.fn() },
  formInstance: { aggregate: jest.fn(), create: jest.fn(), update: jest.fn(), findFirst: jest.fn(), findMany: jest.fn(), delete: jest.fn() },
  formItemResponse: { findMany: jest.fn(), findUnique: jest.fn(), upsert: jest.fn(), deleteMany: jest.fn(), count: jest.fn() },
  signature: { findMany: jest.fn(), create: jest.fn(), deleteMany: jest.fn() },
  attachment: { groupBy: jest.fn(async () => []), findMany: jest.fn(async () => []) },
};
const mockAudit = {
  ENTITY_TYPES: { FORM_TEMPLATE: "form_template", FORM_INSTANCE: "form_instance" },
  ACTIONS: { CREATED: "created", UPDATED: "updated", STATUS_CHANGED: "status_changed", DELETED: "deleted" },
  recordEvent: jest.fn(async () => ({})),
};
const mockNotifications = {
  NOTIFICATION_CATEGORIES: { ASSIGNMENT: "assignment", APPROVAL: "approval", QUALITY: "quality" },
  createNotifications: jest.fn(async () => ({ created: 0 })),
};
const mockIsPartyScoped = jest.fn(() => false);
const mockCreatePunch = jest.fn(async () => ({ id: "punch-1", ref: "PL-009" }));

jest.mock("../../config/db", () => ({ prisma: mockPrisma }));
jest.mock("../audit.service", () => mockAudit);
jest.mock("../notification.service", () => mockNotifications);
jest.mock("../attachment.service", () => ({ createAttachments: jest.fn(async () => ({ items: [] })) }));
jest.mock("../file-storage.service", () => ({
  DOCUMENT_TYPES: { WORKFLOW_ATTACHMENT: "workflow_attachment" },
  uploadProjectDocument: jest.fn(async () => ({ id: "doc-sig" })),
  getProjectDocumentFile: jest.fn(),
}));
jest.mock("../company-party.service", () => ({ isPartyScopedAccess: (...args) => mockIsPartyScoped(...args) }));
jest.mock("../punch.service", () => ({ createPunchItem: (...args) => mockCreatePunch(...args) }));

const service = require("../form.service");

const ORG = "org-1";
const TPL = "10000000-0000-4000-8000-000000000001";
const SEC = "10000000-0000-4000-8000-000000000002";
const I_HOLD = "10000000-0000-4000-8000-000000000003";
const I_SLUMP = "10000000-0000-4000-8000-000000000004";
const I_NOTE = "10000000-0000-4000-8000-000000000005";
const PROJECT = "project-1";
const PM = { id: "user-pm", name: "Priya", role: "pm", projectAccess: { role: "pm", partyAccess: [] } };
const SITE = { id: "user-site", name: "Sami", role: "site_engineer", projectAccess: { role: "site_engineer", partyAccess: [] } };
const SUB = { id: "user-sub", name: "Bilal", role: "external_party", projectAccess: { scope: "party", partyAccess: [{ projectPartyId: "party-1", companyId: "company-sub" }] } };

const ITEM_HOLD = { id: I_HOLD, templateId: TPL, sectionId: SEC, sortOrder: 0, label: "Rebar cover verified", responseType: "pass_fail", required: true, photoRequired: true, isHoldPoint: true, inspectionPointType: "hold", optionsJson: null };
const ITEM_SLUMP = { id: I_SLUMP, templateId: TPL, sectionId: SEC, sortOrder: 1, label: "Slump", responseType: "number", required: true, photoRequired: false, isHoldPoint: false, optionsJson: { min: 50, max: 150, unit: "mm" } };
const ITEM_NOTE = { id: I_NOTE, templateId: TPL, sectionId: SEC, sortOrder: 2, label: "Comments", responseType: "text", required: false, photoRequired: false, isHoldPoint: false, optionsJson: null };
const SECTION = { id: SEC, templateId: TPL, title: "Before the pour", description: null, sortOrder: 0, items: [ITEM_HOLD, ITEM_SLUMP, ITEM_NOTE] };
const TEMPLATE = { id: TPL, orgId: ORG, projectId: PROJECT, type: "itp", name: "Concrete pour ITP", version: 2, status: "active", isSystem: false, settingsJson: { requireSignatures: ["inspector"] }, sections: [SECTION], _count: { instances: 3 }, createdAt: new Date(), updatedAt: new Date() };

let state = {};
const seed = (overrides = {}) => {
  state = { ...overrides };
};
const instance = (overrides = {}) => ({
  id: "inst-1",
  orgId: ORG,
  projectId: PROJECT,
  templateId: TPL,
  templateVersion: 2,
  number: 4,
  ref: "ITP-004",
  type: "itp",
  title: "Pour slab L3",
  status: "scheduled",
  outcome: null,
  activityId: "act-1",
  locationId: null,
  sheetId: null,
  assigneeUserId: "user-sub",
  assigneeCompanyId: "company-sub",
  inspectorUserId: "user-site",
  approverUserId: "user-pm",
  ballInCourtUserId: "user-sub",
  scheduledFor: new Date("2026-09-10T00:00:00Z"),
  dueDate: null,
  recurrenceJson: null,
  startedAt: null,
  completedAt: null,
  closedAt: null,
  createdBy: "user-site",
  createdAt: new Date(),
  updatedAt: new Date(),
  template: { id: TPL, name: "Concrete pour ITP", type: "itp", version: 2, settingsJson: { requireSignatures: ["inspector"] }, projectId: PROJECT, isSystem: false },
  activity: { id: "act-1", name: "Slab L3" },
  location: null,
  sheet: null,
  assigneeUser: { id: "user-sub", name: "Bilal" },
  inspectorUser: { id: "user-site", name: "Sami" },
  approverUser: { id: "user-pm", name: "Priya" },
  ballInCourtUser: { id: "user-sub", name: "Bilal" },
  assigneeCompany: { id: "company-sub", name: "Sub Co" },
  ...overrides,
});

describe("form service", () => {
  let responses;
  let signatures;
  beforeEach(() => {
    jest.clearAllMocks();
    seed({});
    responses = [];
    signatures = [];
    mockIsPartyScoped.mockReturnValue(false);
    mockPrisma.project.findFirst.mockResolvedValue({ id: PROJECT, name: "Tower" });
    mockPrisma.activity.findFirst.mockResolvedValue({ id: "act-1" });
    mockPrisma.company.findFirst.mockResolvedValue({ id: "company-sub" });
    mockPrisma.formTemplate.findFirst.mockResolvedValue(TEMPLATE);
    mockPrisma.formSection.findMany.mockResolvedValue([SECTION]);
    mockPrisma.formItem.findMany.mockImplementation(async ({ where }) => SECTION.items.filter((item) => !where?.isHoldPoint || item.isHoldPoint));
    mockPrisma.formInstance.aggregate.mockResolvedValue({ _max: { number: 3 } });
    mockPrisma.formInstance.findFirst.mockImplementation(async ({ where }) => (where.clientRequestId ? null : instance(state)));
    mockPrisma.formInstance.create.mockImplementation(async ({ data }) => {
      state = { id: "inst-new", ...data };
      return instance(state);
    });
    mockPrisma.formInstance.update.mockImplementation(async ({ data }) => {
      state = { ...state, ...data };
      return instance(state);
    });
    mockPrisma.formItemResponse.findMany.mockImplementation(async () => responses);
    mockPrisma.formItemResponse.findUnique.mockImplementation(async ({ where }) => responses.find((row) => row.itemId === where.instanceId_itemId.itemId) || null);
    mockPrisma.formItemResponse.upsert.mockImplementation(async ({ where, create, update }) => {
      const existing = responses.find((row) => row.itemId === where.instanceId_itemId.itemId);
      if (existing) Object.assign(existing, update);
      else responses.push({ id: `resp-${where.instanceId_itemId.itemId}`, ...create });
      return existing || responses[responses.length - 1];
    });
    mockPrisma.formItemResponse.deleteMany.mockImplementation(async ({ where }) => {
      responses = responses.filter((row) => row.itemId !== where.itemId);
      return { count: 1 };
    });
    mockPrisma.signature.findMany.mockImplementation(async () => signatures);
    mockPrisma.attachment.groupBy.mockResolvedValue([]);
  });

  describe("templates", () => {
    it("validates structure: labels, choice options, hold point types", () => {
      expect(() => service.normalizeSections([{ title: "A", items: [{ label: " " }] }])).toThrow(expect.objectContaining({ code: "FORM_ITEM_LABEL_REQUIRED" }));
      expect(() => service.normalizeSections([{ title: "A", items: [{ label: "Pick", responseType: "choice", options: [] }] }])).toThrow(expect.objectContaining({ code: "FORM_CHOICE_OPTIONS_REQUIRED" }));
      expect(() => service.normalizeSections([{ title: "A", items: [{ label: "Slump", responseType: "number", isHoldPoint: true }] }])).toThrow(expect.objectContaining({ code: "FORM_HOLD_POINT_TYPE" }));
      const sections = service.normalizeSections([{ title: "A", items: [{ label: "Cover ok", isHoldPoint: true }, { label: "Slump", responseType: "number", options: { min: "50", max: 150, unit: "mm" } }] }]);
      expect(sections[0].items[0]).toEqual(expect.objectContaining({ responseType: "pass_fail", isHoldPoint: true, inspectionPointType: "hold", required: true }));
      expect(sections[0].items[1].optionsJson).toEqual({ min: 50, max: 150, unit: "mm" });
    });

    it("creates a project template with nested sections and audits it", async () => {
      mockPrisma.formTemplate.create.mockResolvedValue({ id: "tpl-new" });
      mockPrisma.formSection.create.mockResolvedValue({ id: "sec-new" });
      mockPrisma.formItem.create.mockResolvedValue({ id: "item-new" });
      await service.createTemplate({ orgId: ORG, projectId: PROJECT, actor: PM, payload: { name: " Safety walk ", type: "inspection", settings: { requireSignatures: ["inspector", "bogus"] }, sections: [{ title: "Site", items: [{ label: "PPE worn" }, { label: "Photo of edge protection", responseType: "photo" }] }] } });
      expect(mockPrisma.formTemplate.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ projectId: PROJECT, name: "Safety walk", type: "inspection", settingsJson: expect.objectContaining({ requireSignatures: ["inspector"] }) }) }));
      expect(mockPrisma.formItem.create).toHaveBeenCalledTimes(2);
      expect(mockAudit.recordEvent).toHaveBeenCalledWith(expect.objectContaining({ entityType: "form_template", action: "created" }));
      await expect(service.createTemplate({ orgId: ORG, projectId: PROJECT, actor: PM, payload: { name: "x", type: "audit" } })).rejects.toMatchObject({ code: "FORM_TYPE_INVALID" });
    });

    it("refuses to drop an item that has answers and bumps the version when restructured", async () => {
      mockPrisma.formItemResponse.count.mockResolvedValue(2);
      await expect(service.updateTemplate({ orgId: ORG, projectId: PROJECT, templateId: TPL, actor: PM, payload: { sections: [{ id: SEC, title: "Before the pour", items: [{ id: I_HOLD, label: "Rebar cover verified" }] }] } })).rejects.toMatchObject({ code: "FORM_ITEM_IN_USE" });
      mockPrisma.formItemResponse.count.mockResolvedValue(0);
      mockPrisma.formSection.update.mockResolvedValue({ id: SEC });
      mockPrisma.formItem.update.mockResolvedValue({});
      mockPrisma.formTemplate.update.mockResolvedValue({});
      await service.updateTemplate({ orgId: ORG, projectId: PROJECT, templateId: TPL, actor: PM, payload: { sections: [{ id: SEC, title: "Before the pour", items: [{ id: I_HOLD, label: "Rebar cover verified", isHoldPoint: true }] }] } });
      expect(mockPrisma.formItem.deleteMany).toHaveBeenCalledWith({ where: { templateId: TPL, id: { notIn: [I_HOLD] } } });
      expect(mockPrisma.formTemplate.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ version: { increment: 1 } }) }));
    });

    it("blocks editing a company template from a project", async () => {
      mockPrisma.formTemplate.findFirst.mockResolvedValue({ ...TEMPLATE, projectId: null });
      await expect(service.updateTemplate({ orgId: ORG, projectId: PROJECT, templateId: TPL, actor: PM, payload: { name: "New" } })).rejects.toMatchObject({ code: "FORM_TEMPLATE_COMPANY_SCOPED" });
    });
  });

  describe("instances", () => {
    it("numbers per type, snapshots the template version, starts with the assignee holding the ball, and notifies", async () => {
      const created = await service.createInstance({ orgId: ORG, projectId: PROJECT, actor: SITE, payload: { templateId: TPL, title: "Pour slab L3", activityId: "act-1", assigneeUserId: "user-sub", assigneeCompanyId: "company-sub", scheduledFor: "2026-09-10" } });
      expect(mockPrisma.formInstance.aggregate).toHaveBeenCalledWith({ where: { projectId: PROJECT, type: "itp" }, _max: { number: true } });
      expect(mockPrisma.formInstance.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ number: 4, ref: "ITP-004", type: "itp", templateVersion: 2, status: "scheduled" }) }));
      expect(mockPrisma.formInstance.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ ballInCourtUserId: "user-sub", summaryJson: expect.objectContaining({ total: 3, holdPoints: 1, holdPointsOpen: 1 }) }) }));
      expect(mockNotifications.createNotifications).toHaveBeenCalledWith(expect.objectContaining({ event: "inspection.scheduled", recipientUserIds: expect.arrayContaining(["user-sub"]) }));
      expect(created.sections[0].items).toHaveLength(3);
      expect(created.holdPoints).toEqual([expect.objectContaining({ itemId: I_HOLD, state: "pending" })]);
    });

    it("is idempotent on clientRequestId and refuses inactive or empty templates", async () => {
      mockPrisma.formInstance.findFirst.mockImplementation(async ({ where }) => (where.clientRequestId ? instance({ clientRequestId: "req-1" }) : null));
      const again = await service.createInstance({ orgId: ORG, projectId: PROJECT, actor: SITE, payload: { templateId: TPL, clientRequestId: "req-1" } });
      expect(again.ref).toBe("ITP-004");
      expect(mockPrisma.formInstance.create).not.toHaveBeenCalled();
      mockPrisma.formTemplate.findFirst.mockResolvedValue({ ...TEMPLATE, status: "archived" });
      await expect(service.createInstance({ orgId: ORG, projectId: PROJECT, actor: SITE, payload: { templateId: TPL } })).rejects.toMatchObject({ code: "FORM_TEMPLATE_INACTIVE" });
      mockPrisma.formTemplate.findFirst.mockResolvedValue({ ...TEMPLATE, sections: [] });
      await expect(service.createInstance({ orgId: ORG, projectId: PROJECT, actor: SITE, payload: { templateId: TPL } })).rejects.toMatchObject({ code: "FORM_TEMPLATE_EMPTY" });
    });

    it("validates answers by type, marks deficiencies and moves a scheduled inspection into progress", async () => {
      seed({ status: "scheduled" });
      await expect(service.respond({ orgId: ORG, projectId: PROJECT, instanceId: "inst-1", actor: SUB, responses: [{ itemId: I_HOLD, value: "maybe" }] })).rejects.toMatchObject({ code: "FORM_RESPONSE_INVALID" });
      await expect(service.respond({ orgId: ORG, projectId: PROJECT, instanceId: "inst-1", actor: SUB, responses: [{ itemId: I_SLUMP, value: "abc" }] })).rejects.toMatchObject({ code: "FORM_RESPONSE_INVALID" });
      await expect(service.respond({ orgId: ORG, projectId: PROJECT, instanceId: "inst-1", actor: SUB, responses: [{ itemId: "nope", value: "pass" }] })).rejects.toMatchObject({ code: "FORM_ITEM_NOT_FOUND" });
      const result = await service.respond({
        orgId: ORG,
        projectId: PROJECT,
        instanceId: "inst-1",
        actor: SUB,
        responses: [
          { itemId: I_HOLD, value: "fail", note: "Cover 15mm at grid C" },
          { itemId: I_SLUMP, value: "180" },
          { itemId: I_NOTE, value: "" },
        ],
      });
      expect(responses).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ itemId: I_HOLD, value: "fail", isDeficient: true, note: "Cover 15mm at grid C" }),
          expect.objectContaining({ itemId: I_SLUMP, value: "180", numberValue: 180, isDeficient: true }),
        ]),
      );
      expect(result.status).toBe("in_progress");
      expect(result.summary).toEqual(expect.objectContaining({ answered: 2, failed: 1, deficient: 2, holdPointsOpen: 1 }));
      expect(result.holdPoints[0].state).toBe("failed");
      expect(mockPrisma.formInstance.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "in_progress", startedAt: expect.any(Date) }) }));
    });

    it("cannot answer once complete", async () => {
      seed({ status: "complete" });
      await expect(service.respond({ orgId: ORG, projectId: PROJECT, instanceId: "inst-1", actor: SUB, responses: [{ itemId: I_HOLD, value: "pass" }] })).rejects.toMatchObject({ code: "FORM_INSTANCE_LOCKED" });
    });

    it("refuses completion until required answers, photos and signatures are there, then records the outcome", async () => {
      seed({ status: "in_progress" });
      responses = [{ id: `resp-${I_HOLD}`, instanceId: "inst-1", itemId: I_HOLD, value: "pass", isDeficient: false }];
      let error;
      await service.completeInstance({ orgId: ORG, projectId: PROJECT, instanceId: "inst-1", actor: SITE }).catch((caught) => {
        error = caught;
      });
      expect(error).toMatchObject({ code: "FORM_INCOMPLETE" });
      expect(error.details.problems).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ itemId: I_HOLD, reason: "photo" }),
          expect.objectContaining({ itemId: I_SLUMP, reason: "answer" }),
          expect.objectContaining({ role: "inspector", reason: "signature_role" }),
        ]),
      );
      expect(error.details.problems.some((problem) => problem.itemId === I_NOTE)).toBe(false);

      responses.push({ id: `resp-${I_SLUMP}`, instanceId: "inst-1", itemId: I_SLUMP, value: "90", numberValue: 90, isDeficient: false });
      mockPrisma.attachment.groupBy.mockResolvedValue([{ recordId: `resp-${I_HOLD}`, _count: { _all: 2 } }]);
      signatures = [{ id: "sig-1", role: "inspector", itemId: null, userId: "user-site" }];
      const done = await service.completeInstance({ orgId: ORG, projectId: PROJECT, instanceId: "inst-1", actor: SITE });
      expect(done.status).toBe("complete");
      expect(done.outcome).toBe("pass");
      expect(mockPrisma.formInstance.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "complete", outcome: "pass", completedBy: SITE.id }) }));
      expect(mockPrisma.formInstance.update).toHaveBeenCalledWith(expect.objectContaining({ data: { ballInCourtUserId: "user-pm" } }));
      expect(mockNotifications.createNotifications).toHaveBeenCalledWith(expect.objectContaining({ event: "inspection.complete", category: "approval", recipientUserIds: expect.arrayContaining(["user-pm"]) }));
      expect(done.nextInstance).toBeNull();
    });

    it("fails the outcome when anything is deficient and schedules the next recurring copy", async () => {
      seed({ status: "in_progress", recurrenceJson: { every: "week", interval: 1, until: null }, scheduledFor: new Date("2026-09-10T00:00:00Z") });
      responses = [
        { id: `resp-${I_HOLD}`, instanceId: "inst-1", itemId: I_HOLD, value: "fail", isDeficient: true },
        { id: `resp-${I_SLUMP}`, instanceId: "inst-1", itemId: I_SLUMP, value: "90", numberValue: 90, isDeficient: false },
      ];
      mockPrisma.attachment.groupBy.mockResolvedValue([{ recordId: `resp-${I_HOLD}`, _count: { _all: 1 } }]);
      signatures = [{ id: "sig-1", role: "inspector", itemId: null }];
      mockPrisma.formInstance.aggregate.mockResolvedValue({ _max: { number: 4 } });
      const done = await service.completeInstance({ orgId: ORG, projectId: PROJECT, instanceId: "inst-1", actor: SITE });
      expect(done.outcome).toBe("fail");
      expect(mockPrisma.formInstance.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ ref: "ITP-005", status: "scheduled", scheduledFor: new Date("2026-09-17T00:00:00Z"), recurrenceJson: { every: "week", interval: 1, until: null } }) }));
      expect(done.nextInstance).toEqual(expect.objectContaining({ ref: "ITP-005" }));
    });

    it("closes, reopens with a reason, and voids", async () => {
      seed({ status: "complete", outcome: "pass" });
      const closed = await service.transition({ orgId: ORG, projectId: PROJECT, instanceId: "inst-1", action: "close", actor: PM });
      expect(closed.status).toBe("closed");
      expect(mockPrisma.formInstance.update).toHaveBeenCalledWith(expect.objectContaining({ data: { ballInCourtUserId: null } }));
      await expect(service.transition({ orgId: ORG, projectId: PROJECT, instanceId: "inst-1", action: "reopen", actor: PM })).rejects.toMatchObject({ code: "FORM_REASON_REQUIRED" });
      const reopened = await service.transition({ orgId: ORG, projectId: PROJECT, instanceId: "inst-1", action: "reopen", reason: "Re-check cover", actor: PM });
      expect(reopened.status).toBe("in_progress");
      expect(mockPrisma.formInstance.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "in_progress", outcome: null, reopenReason: "Re-check cover" }) }));
      seed({ status: "closed" });
      await expect(service.transition({ orgId: ORG, projectId: PROJECT, instanceId: "inst-1", action: "void", reason: "dup", actor: PM })).rejects.toMatchObject({ code: "FORM_TRANSITION_INVALID" });
    });

    it("scopes party users to their company's inspections", async () => {
      mockIsPartyScoped.mockImplementation((access) => access?.scope === "party");
      mockPrisma.formInstance.findMany.mockResolvedValue([instance()]);
      await service.listInstances({ orgId: ORG, projectId: PROJECT, filters: { overdue: true }, viewer: SUB });
      const where = mockPrisma.formInstance.findMany.mock.calls[0][0].where;
      expect(where.AND[0].OR[0]).toEqual({ assigneeCompanyId: { in: ["company-sub"] } });
      expect(where.status).toEqual({ in: ["scheduled", "in_progress"] });
      seed({ assigneeCompanyId: "company-other", assigneeUserId: "x", inspectorUserId: "y", approverUserId: "z", createdBy: "w" });
      await expect(service.getInstance({ orgId: ORG, projectId: PROJECT, instanceId: "inst-1", viewer: SUB })).rejects.toMatchObject({ code: "FORM_INSTANCE_NOT_FOUND" });
    });
  });

  describe("signatures and deficiencies", () => {
    const png = `data:image/png;base64,${Buffer.concat([Buffer.from("89504e470d0a1a0a", "hex"), Buffer.alloc(64)]).toString("base64")}`;

    it("stores a PNG signature as a document and a Signature row", async () => {
      seed({ status: "in_progress" });
      mockPrisma.signature.create.mockResolvedValue({ id: "sig-1", role: "inspector", itemId: null, userId: SITE.id, signerName: "Sami", signedAt: new Date(), user: { id: SITE.id, name: "Sami" }, documentId: "doc-sig" });
      const result = await service.sign({ orgId: ORG, projectId: PROJECT, instanceId: "inst-1", actor: SITE, payload: { role: "inspector", image: png }, meta: { ip: "10.0.0.1" } });
      expect(mockPrisma.signature.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ role: "inspector", signerName: "Sami", documentId: "doc-sig", ipAddress: "10.0.0.1" }) }));
      expect(result.signature.imageUrl).toContain("/attachments/documents/doc-sig");
      await expect(service.sign({ orgId: ORG, projectId: PROJECT, instanceId: "inst-1", actor: SITE, payload: { role: "inspector", image: "data:image/jpeg;base64,AAAA" } })).rejects.toMatchObject({ code: "FORM_SIGNATURE_IMAGE_INVALID" });
      await expect(service.sign({ orgId: ORG, projectId: PROJECT, instanceId: "inst-1", actor: SITE, payload: { role: "boss", image: png } })).rejects.toMatchObject({ code: "FORM_SIGNATURE_ROLE_INVALID" });
    });

    it("raises a punch item from a deficient answer and links it back", async () => {
      seed({ status: "in_progress" });
      responses = [{ id: `resp-${I_HOLD}`, instanceId: "inst-1", itemId: I_HOLD, value: "fail", isDeficient: true, note: "Cover 15mm" }];
      mockPrisma.formItem.findFirst.mockResolvedValue(ITEM_HOLD);
      const result = await service.raiseDeficiency({ orgId: ORG, projectId: PROJECT, instanceId: "inst-1", itemId: I_HOLD, actor: SITE, payload: { priority: "high" } });
      expect(mockCreatePunch).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: expect.objectContaining({ title: "Rebar cover verified — ITP-004", priority: "high", activityId: "act-1", assigneeCompanyId: "company-sub", finalApproverUserId: "user-pm", status: "open", description: expect.stringContaining("Cover 15mm") }),
        }),
      );
      expect(mockPrisma.formItemResponse.upsert).toHaveBeenCalledWith(expect.objectContaining({ update: expect.objectContaining({ deficiencyRecordType: "punch_item", deficiencyRecordId: "punch-1" }) }));
      expect(result.record.ref).toBe("PL-009");
      responses[0].deficiencyRecordId = "punch-1";
      await expect(service.raiseDeficiency({ orgId: ORG, projectId: PROJECT, instanceId: "inst-1", itemId: I_HOLD, actor: SITE, payload: {} })).rejects.toMatchObject({ code: "FORM_DEFICIENCY_EXISTS" });
    });

    it("raises a safety observation from a toolbox-talk deficiency", async () => {
      seed({ status: "in_progress", type: "talk" });
      responses = [{ id: `resp-${I_HOLD}`, instanceId: "inst-1", itemId: I_HOLD, value: "fail", isDeficient: true }];
      mockPrisma.formItem.findFirst.mockResolvedValue(ITEM_HOLD);
      mockCreatePunch.mockResolvedValueOnce({ id: "obs-1", ref: "OBS-002" });
      const result = await service.raiseDeficiency({ orgId: ORG, projectId: PROJECT, instanceId: "inst-1", itemId: I_HOLD, actor: SITE, payload: { target: "observation", hazard: "Working at height" } });
      expect(mockCreatePunch).toHaveBeenCalledWith(
        expect.objectContaining({ payload: expect.objectContaining({ kind: "observation", observationType: "safety", hazard: "Working at height", sourceRecordType: "form_instance", sourceRecordId: "inst-1" }) }),
      );
      expect(mockPrisma.formItemResponse.upsert).toHaveBeenCalledWith(expect.objectContaining({ update: expect.objectContaining({ deficiencyRecordType: "observation", deficiencyRecordId: "obs-1" }) }));
      expect(result.record.ref).toBe("OBS-002");
    });
  });

  describe("hold points", () => {
    it("lists pending and failed hold points on an activity, ignoring void inspections and passed items", async () => {
      mockPrisma.formInstance.findMany.mockResolvedValue([
        { id: "a", ref: "ITP-001", title: "Pour A", status: "complete", templateId: TPL, responses: [{ itemId: I_HOLD, value: "pass" }] },
        { id: "b", ref: "ITP-002", title: "Pour B", status: "in_progress", templateId: TPL, responses: [{ itemId: I_HOLD, value: "fail" }] },
        { id: "c", ref: "ITP-003", title: "Pour C", status: "scheduled", templateId: TPL, responses: [] },
      ]);
      const open = await service.openHoldPoints({ projectId: PROJECT, activityId: "act-1" });
      expect(mockPrisma.formInstance.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ activityId: "act-1", type: "itp", status: { not: "void" } }) }));
      expect(open).toEqual([
        expect.objectContaining({ ref: "ITP-002", label: "Rebar cover verified", state: "failed" }),
        expect.objectContaining({ ref: "ITP-003", state: "pending" }),
      ]);
      expect(await service.openHoldPoints({ projectId: PROJECT, activityId: null })).toEqual([]);
      expect(await service.openHoldPoints({ projectId: PROJECT, activityId: "act-1" }, {})).toEqual([]);
    });
  });
});
