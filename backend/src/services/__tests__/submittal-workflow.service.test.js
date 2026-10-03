const { referenceCounterMock } = require("./helpers/reference-counter-mock");
const mockPrisma = {
  ...referenceCounterMock(),
  $transaction: jest.fn((fn) => fn(mockPrisma)),
  project: { findFirst: jest.fn(async () => ({ id: "project-1", name: "Tower" })) },
  user: { findMany: jest.fn(async ({ where }) => (where.id?.in || []).map((id) => ({ id, name: id, email: null }))) },
  activity: { findFirst: jest.fn(async () => ({ startDate: new Date("2026-10-01T00:00:00Z") })) },
  projectPartyMember: { findMany: jest.fn(async () => []) },
  projectAssignment: { findMany: jest.fn(async () => []) },
  submittal: { findFirst: jest.fn(), update: jest.fn(async ({ data }) => ({ ...data })), updateMany: jest.fn(async () => ({ count: 1 })), findMany: jest.fn(async () => []) },
  submittalStep: { create: jest.fn(), update: jest.fn(), updateMany: jest.fn(async () => ({ count: 0 })), findMany: jest.fn(async () => []) },
  submittalStepAssignment: { create: jest.fn(), update: jest.fn(async () => ({})), updateMany: jest.fn(async () => ({ count: 0 })) },
  submittalWorkflowTemplate: { findFirst: jest.fn(), findMany: jest.fn(async () => []), create: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
  submittalPackage: { findFirst: jest.fn(), findUnique: jest.fn(async () => ({ projectId: "project-1" })), findMany: jest.fn(async () => []), aggregate: jest.fn(async () => ({ _max: { number: 2 } })), create: jest.fn(), update: jest.fn(async () => ({})) },
  workflowActivityLink: { upsert: jest.fn(async (args) => args.create) },
  // The shared reference check (tenant-references.service): everyone but "other-company-*" is a member.
  organizationMembership: { findMany: jest.fn(async ({ where }) => (where.userId?.in || []).filter((id) => !id.startsWith("other-company-")).map((userId) => ({ userId }))) },
};
const mockAudit = { ENTITY_TYPES: { SUBMITTAL: "submittal", SUBMITTAL_PACKAGE: "submittal_package", SUBMITTAL_WORKFLOW_TEMPLATE: "submittal_workflow_template" }, ACTIONS: { CREATED: "created", UPDATED: "updated", STATUS_CHANGED: "status_changed" }, recordEvent: jest.fn(async () => ({})) };
const mockNotifications = { NOTIFICATION_CATEGORIES: { APPROVAL: "approval", ASSIGNMENT: "assignment" }, createNotifications: jest.fn(async () => ({ created: 1 })) };
const mockSubmittalService = { updateSubmittal: jest.fn(async () => ({})), submitSubmittal: jest.fn(async () => ({})) };

jest.mock("../../config/db", () => ({ prisma: mockPrisma }));
jest.mock("../audit.service", () => mockAudit);
jest.mock("../notification.service", () => mockNotifications);
jest.mock("../submittal.service", () => mockSubmittalService);
jest.mock("../workflow-support.service", () => ({
  RECORD_TYPES: { SUBMITTAL: "submittal" },
  attachWorkflowDetailsToRecords: async ({ records }) => records.map((row) => ({ ...row, attachments: [], activityLinks: [], history: [], revisions: [] })),
}));

const service = require("../submittal-workflow.service");

const TEMPLATE = {
  id: "tpl-1",
  orgId: "org-1",
  projectId: null,
  name: "Contractor check, then consultant review",
  stepsJson: [
    { sortOrder: 0, name: "Contractor check", mode: "sequential", days: 3, assignees: [{ type: "role", role: "pm" }] },
    { sortOrder: 1, name: "Consultant review", mode: "parallel", days: 10, assignees: [{ type: "party_role", role: "consultant" }, { type: "user", userId: "user-eng" }] },
  ],
};

const assignment = (overrides = {}) => ({ id: `asg-${overrides.userId || "x"}`, userId: "user-arch", role: "consultant", status: "pending", user: { id: overrides.userId || "user-arch", name: "Aisha" }, ...overrides });
const step = (overrides = {}) => ({ id: "step-2", submittalId: "sub-1", revisionNumber: 0, sortOrder: 1, name: "Consultant review", mode: "parallel", days: 10, status: "active", startedAt: new Date(), dueAt: new Date(Date.now() + 5 * 86_400_000), assignments: [assignment({ userId: "user-arch" }), assignment({ userId: "user-eng", role: "user", user: { id: "user-eng", name: "Eli" } })], ...overrides });
const submittal = (overrides = {}) => ({
  id: "sub-1",
  projectId: "project-1",
  ref: "SUB-004",
  title: "Curtain wall shop drawings",
  status: "under_review",
  revision: "A",
  revisionNumber: 0,
  currentStepId: "step-2",
  workflowTemplateId: "tpl-1",
  activityId: "act-1",
  leadTimeWeeks: 6,
  requiredOnSite: null,
  managerUserId: "user-pm",
  createdBy: "user-site",
  distributionJson: ["user-qs"],
  steps: [step({ id: "step-1", sortOrder: 0, name: "Contractor check", mode: "sequential", status: "approved", assignments: [assignment({ userId: "user-pm", role: "pm", status: "approved" })] }), step()],
  package: null,
  workflowTemplate: { id: "tpl-1", name: TEMPLATE.name, stepsJson: TEMPLATE.stepsJson },
  managerUser: { id: "user-pm", name: "Priya", email: null },
  activity: { id: "act-1", name: "Facade", startDate: new Date("2026-10-01T00:00:00Z") },
  ...overrides,
});

describe("submittal workflow", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPrisma.submittal.findFirst.mockResolvedValue(submittal());
    mockPrisma.submittalWorkflowTemplate.findFirst.mockResolvedValue(TEMPLATE);
    mockPrisma.projectPartyMember.findMany.mockResolvedValue([{ userId: "user-arch", projectParty: { role: "consultant" } }]);
    mockPrisma.projectAssignment.findMany.mockResolvedValue([{ userId: "user-pm", role: "Project Manager" }, { userId: "user-site", role: "site_engineer" }]);
    let stepCount = 0;
    mockPrisma.submittalStep.create.mockImplementation(async ({ data }) => {
      stepCount += 1;
      return { id: `new-step-${stepCount}`, ...data, assignments: data.assignments.create.map((row, index) => ({ id: `new-asg-${stepCount}-${index}`, ...row, status: "pending", user: { id: row.userId, name: row.userId } })) };
    });
    mockPrisma.submittalStep.update.mockImplementation(async ({ where, data }) => ({ id: where.id, sortOrder: where.id === "new-step-1" ? 0 : 1, name: "step", mode: "sequential", ...data, assignments: [{ id: "a1", userId: "user-pm", status: "pending" }] }));
  });

  it("validates workflow templates and sums their review days", () => {
    expect(() => service.normalizeSteps([])).toThrow(expect.objectContaining({ code: "SUBMITTAL_TEMPLATE_STEPS_REQUIRED" }));
    expect(() => service.normalizeSteps([{ name: "Review", assignees: [] }])).toThrow(expect.objectContaining({ code: "SUBMITTAL_TEMPLATE_ASSIGNEE_REQUIRED" }));
    expect(() => service.normalizeSteps([{ name: "Review", assignees: [{ type: "party_role", role: "architect" }] }])).toThrow(expect.objectContaining({ code: "SUBMITTAL_TEMPLATE_ASSIGNEE_INVALID" }));
    const steps = service.normalizeSteps([{ name: " GC check ", days: "3", assignees: [{ type: "role", role: "PM" }] }, { name: "Design", mode: "parallel", days: 10, assignees: [{ type: "party_role", role: "consultant" }] }]);
    expect(steps[0]).toEqual({ sortOrder: 0, name: "GC check", mode: "sequential", days: 3, assignees: [{ type: "role", role: "pm" }] });
    expect(service.reviewDaysFor(steps)).toBe(13);
  });

  it("computes submit-by from the need date, lead time and review days, and the schedule impact of a late approval", () => {
    expect(service.computeSubmitBy({ requiredOnSite: "2026-10-01T00:00:00Z", leadTimeWeeks: 6, reviewDays: 13 })).toEqual(new Date("2026-08-07T00:00:00Z"));
    expect(service.computeSubmitBy({ activityStart: new Date("2026-10-01T00:00:00Z"), leadTimeWeeks: 0, reviewDays: 0 })).toEqual(new Date("2026-10-01T00:00:00Z"));
    expect(service.computeSubmitBy({ leadTimeWeeks: 6 })).toBeNull();
    expect(service.computeScheduleImpactDays({ activityStart: new Date("2026-10-01T00:00:00Z"), leadTimeWeeks: 6, approvedAt: new Date("2026-08-01T00:00:00Z") })).toBe(0);
    expect(service.computeScheduleImpactDays({ activityStart: new Date("2026-10-01T00:00:00Z"), leadTimeWeeks: 6, approvedAt: new Date("2026-09-01T00:00:00Z") })).toBe(12);
  });

  it("resolves step assignees from users, party roles and project roles", async () => {
    const resolved = await service.resolveAssignees({ orgId: "org-1", projectId: "project-1", assignees: [{ type: "user", userId: "user-eng" }, { type: "party_role", role: "consultant" }, { type: "role", role: "pm" }, { type: "user", userId: "user-eng" }] });
    expect(resolved).toEqual([
      { userId: "user-eng", role: "user" },
      { userId: "user-arch", role: "consultant" },
      { userId: "user-pm", role: "pm" },
    ]);
  });

  it("starts the review route on submission: steps created, first step active with a due date, assignees notified", async () => {
    const existing = submittal({ status: "pending", currentStepId: null, steps: [] });
    const updated = { ...existing, status: "under_review" };
    const patch = await service.onStatusChange({ orgId: "org-1", projectId: "project-1", existing, updated, actorId: "user-site" });
    expect(mockPrisma.submittalStep.create).toHaveBeenCalledTimes(2);
    expect(mockPrisma.submittalStep.create.mock.calls[1][0].data.assignments.create).toEqual([{ userId: "user-eng", role: "user" }, { userId: "user-arch", role: "consultant" }]);
    expect(mockPrisma.submittalStep.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "new-step-1" }, data: expect.objectContaining({ status: "active", dueAt: expect.any(Date) }) }));
    expect(patch.currentStepId).toBe("new-step-1");
    expect(patch.ballInCourtUserId).toBe("user-pm");
    await service.afterStatusChange({ orgId: "org-1", projectId: "project-1", submittal: updated, patch, actorId: "user-site" });
    expect(mockNotifications.createNotifications).toHaveBeenCalledWith(expect.objectContaining({ event: "submittal.step_assigned", recipientUserIds: ["user-pm"] }));
  });

  it("refuses to start when a step has nobody to review it", async () => {
    mockPrisma.projectPartyMember.findMany.mockResolvedValue([]);
    mockPrisma.user.findMany.mockResolvedValue([]);
    const existing = submittal({ status: "pending", steps: [] });
    await expect(service.onStatusChange({ orgId: "org-1", projectId: "project-1", existing, updated: { ...existing, status: "under_review" } })).rejects.toMatchObject({ code: "SUBMITTAL_STEP_UNASSIGNED" });
  });

  it("bumps the revision when a returned submittal is resubmitted", async () => {
    mockPrisma.submittalStep.findMany.mockResolvedValue([{ id: "old", status: "rejected" }]);
    const existing = submittal({ status: "resubmit", steps: [] });
    const patch = await service.onStatusChange({ orgId: "org-1", projectId: "project-1", existing, updated: { ...existing, status: "under_review" } });
    expect(mockPrisma.submittal.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ revisionNumber: 1, responseCode: null }) }));
    expect(patch.revisionNumber).toBe(1);
    expect(mockPrisma.submittalStep.create.mock.calls[0][0].data.revisionNumber).toBe(1);
  });

  it("parallel steps wait for everyone; the last approval advances or completes", async () => {
    const first = await service.decideStep({ orgId: "org-1", projectId: "project-1", submittalId: "sub-1", payload: { decision: "approve", responseCode: "approved_as_noted", comment: "Fix the sill detail" }, userId: "user-arch", userRole: "external_party" });
    expect(mockPrisma.submittalStepAssignment.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "asg-user-arch" }, data: expect.objectContaining({ status: "approved", responseCode: "approved_as_noted" }) }));
    expect(mockPrisma.submittal.update).toHaveBeenCalledWith(expect.objectContaining({ data: { ballInCourtUserId: "user-eng" } }));
    expect(mockSubmittalService.updateSubmittal).not.toHaveBeenCalled();
    expect(first.activeStep).toBeTruthy();

    mockPrisma.submittal.findFirst.mockResolvedValue(submittal({ steps: [submittal().steps[0], step({ assignments: [assignment({ userId: "user-arch", status: "approved" }), assignment({ userId: "user-eng", role: "user" })] })] }));
    await service.decideStep({ orgId: "org-1", projectId: "project-1", submittalId: "sub-1", payload: { decision: "approve" }, userId: "user-eng", userRole: "planning_eng" });
    expect(mockPrisma.submittalStep.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "step-2" }, data: expect.objectContaining({ status: "approved" }) }));
    expect(mockSubmittalService.updateSubmittal).toHaveBeenCalledWith(expect.objectContaining({ payload: expect.objectContaining({ status: "approved", responseCode: "approved", responseCodeLabel: "Approved" }) }));
  });

  it("the first rejection stops the step and returns the submittal with the response code", async () => {
    await expect(service.decideStep({ orgId: "org-1", projectId: "project-1", submittalId: "sub-1", payload: { decision: "reject" }, userId: "user-arch" })).rejects.toMatchObject({ code: "SUBMITTAL_DECISION_COMMENT_REQUIRED" });
    await service.decideStep({ orgId: "org-1", projectId: "project-1", submittalId: "sub-1", payload: { decision: "reject", responseCode: "revise_resubmit", comment: "Wrong glass spec" }, userId: "user-arch", userRole: "external_party" });
    expect(mockPrisma.submittalStep.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "step-2" }, data: expect.objectContaining({ status: "rejected" }) }));
    expect(mockPrisma.submittalStepAssignment.updateMany).toHaveBeenCalledWith({ where: { stepId: "step-2", status: "pending" }, data: { status: "skipped" } });
    expect(mockSubmittalService.updateSubmittal).toHaveBeenCalledWith(expect.objectContaining({ payload: expect.objectContaining({ status: "resubmit", responseCode: "revise_resubmit", reason: "Wrong glass spec" }) }));
  });

  it("only assigned reviewers decide, except the PM, and nobody decides twice", async () => {
    await expect(service.decideStep({ orgId: "org-1", projectId: "project-1", submittalId: "sub-1", payload: { decision: "approve" }, userId: "user-stranger", userRole: "site_engineer" })).rejects.toMatchObject({ code: "SUBMITTAL_NOT_ASSIGNED" });
    mockPrisma.submittalStepAssignment.create.mockResolvedValue({ id: "asg-pm", userId: "user-pm", status: "pending" });
    await service.decideStep({ orgId: "org-1", projectId: "project-1", submittalId: "sub-1", payload: { decision: "approve" }, userId: "user-pm", userRole: "pm" });
    expect(mockPrisma.submittalStepAssignment.create).toHaveBeenCalledWith({ data: { stepId: "step-2", userId: "user-pm", role: "pm" } });
    mockPrisma.submittal.findFirst.mockResolvedValue(submittal({ steps: [step({ assignments: [assignment({ userId: "user-arch", status: "approved" })] })] }));
    await expect(service.decideStep({ orgId: "org-1", projectId: "project-1", submittalId: "sub-1", payload: { decision: "approve" }, userId: "user-arch" })).rejects.toMatchObject({ code: "SUBMITTAL_ALREADY_DECIDED" });
  });

  it("on approval skips leftover steps, records the schedule impact on the activity and distributes the outcome", async () => {
    const existing = submittal();
    const updated = { ...existing, status: "approved", responseCode: "approved_as_noted", responseCodeLabel: "Approved as noted", reviewedOn: new Date("2026-09-01T00:00:00Z") };
    const patch = await service.onStatusChange({ orgId: "org-1", projectId: "project-1", existing, updated, actorId: "user-pm" });
    expect(mockPrisma.submittalStep.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ status: { in: ["pending", "active"] } }), data: expect.objectContaining({ status: "skipped" }) }));
    expect(mockPrisma.workflowActivityLink.upsert).toHaveBeenCalledWith(expect.objectContaining({ create: expect.objectContaining({ relationType: "submittal_lead_time", scheduleImpactDays: 12 }) }));
    expect(patch.scheduleImpactDays).toBe(12);
    await service.afterStatusChange({ orgId: "org-1", projectId: "project-1", submittal: { ...updated, ...patch }, patch, actorId: "user-pm" });
    expect(mockNotifications.createNotifications).toHaveBeenCalledWith(expect.objectContaining({ event: "submittal.approved", recipientUserIds: expect.arrayContaining(["user-site", "user-qs"]), priority: "high" }));
  });

  it("packages number themselves, hold each submittal once and derive their status", async () => {
    mockPrisma.submittal.findMany.mockResolvedValueOnce([{ id: "sub-1", packageId: null }, { id: "sub-2", packageId: "other" }]);
    mockPrisma.submittalPackage.create.mockResolvedValue({ id: "pkg-3" });
    await expect(service.createPackage({ orgId: "org-1", projectId: "project-1", payload: { name: "Facade package", submittalIds: ["sub-1", "sub-2"] }, actor: { id: "user-pm" } })).rejects.toMatchObject({ code: "SUBMITTAL_IN_ANOTHER_PACKAGE" });
    expect(mockPrisma.submittalPackage.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ number: 3, ref: "PKG-003", name: "Facade package" }) }));
    expect(service.packageStatusFor([{ status: "approved" }, { status: "approved" }])).toBe("closed");
    expect(service.packageStatusFor([{ status: "approved" }, { status: "under_review" }])).toBe("submitted");
    expect(service.packageStatusFor([{ status: "pending" }])).toBe("open");
  });

  it("submits and decides a package as one action, reporting per item", async () => {
    mockPrisma.submittalPackage.findFirst.mockResolvedValue({ id: "pkg-1", projectId: "project-1", ref: "PKG-001", name: "Facade", status: "open", submittals: [{ id: "sub-1", ref: "SUB-004", status: "pending" }, { id: "sub-9", ref: "SUB-009", status: "approved" }], managerUser: null, activity: null });
    mockSubmittalService.submitSubmittal.mockRejectedValueOnce(Object.assign(new Error("no file"), { code: "SUBMITTAL_REVISION_REQUIRED" }));
    const sent = await service.submitPackage({ orgId: "org-1", projectId: "project-1", packageId: "pkg-1", payload: {}, userId: "user-site", userRole: "site_engineer" });
    expect(sent.results).toEqual([
      { submittalId: "sub-1", ref: "SUB-004", submitted: false, error: "SUBMITTAL_REVISION_REQUIRED" },
      { submittalId: "sub-9", ref: "SUB-009", skipped: true, reason: "approved" },
    ]);
    mockPrisma.submittalPackage.findFirst.mockResolvedValue({ id: "pkg-1", projectId: "project-1", ref: "PKG-001", name: "Facade", status: "submitted", submittals: [{ id: "sub-1", ref: "SUB-004", status: "under_review" }], managerUser: null, activity: null });
    const decided = await service.decidePackage({ orgId: "org-1", projectId: "project-1", packageId: "pkg-1", payload: { decision: "approve" }, userId: "user-arch", userRole: "external_party" });
    expect(decided.results).toEqual([{ submittalId: "sub-1", ref: "SUB-004", decided: true }]);
  });

  describe("party routing (certification findings L42 / FILES-X1)", () => {
    const partyX = { scope: "party", role: "external_party", assignmentRole: null, partyAccess: [{ projectPartyId: "party-x", role: "subcontractor" }] };
    const item = (id, ownerPartyId) => ({ id, ref: id.toUpperCase(), status: "pending", ownerPartyId, reviewerPartyId: null, approverPartyId: null });
    const pkg = (submittals, createdBy = "user-y") => ({ id: "pkg-1", projectId: "project-1", ref: "PKG-001", name: "Mixed", status: "open", createdBy, submittals, managerUser: null, activity: null });

    it("opens a submittal only for the company it is routed to; internal callers open any", async () => {
      mockPrisma.submittal.findFirst.mockResolvedValue(submittal({ ownerPartyId: "party-y" }));
      await expect(service.getSubmittal({ orgId: "org-1", projectId: "project-1", submittalId: "sub-1", projectAccess: partyX })).rejects.toMatchObject({ code: "PROJECT_PARTY_RECORD_ACCESS_DENIED", status: 403 });
      await expect(service.getSubmittal({ orgId: "org-1", projectId: "project-1", submittalId: "sub-1", projectAccess: null })).resolves.toMatchObject({ id: "sub-1" });
      mockPrisma.submittal.findFirst.mockResolvedValue(submittal({ ownerPartyId: null, approverPartyId: "party-x" }));
      await expect(service.getSubmittal({ orgId: "org-1", projectId: "project-1", submittalId: "sub-1", projectAccess: partyX })).resolves.toMatchObject({ id: "sub-1" });
    });

    it("shows a party member a package only through their own submittals, and refuses the rest", async () => {
      mockPrisma.submittalPackage.findFirst.mockResolvedValue(pkg([item("sub-x", "party-x"), item("sub-y", "party-y")]));
      const shared = await service.getPackage({ orgId: "org-1", projectId: "project-1", packageId: "pkg-1", projectAccess: partyX, viewerId: "user-x" });
      expect(shared.items.map((row) => row.id)).toEqual(["sub-x"]);
      expect(shared.items[0]).not.toHaveProperty("ownerPartyId");
      const internal = await service.getPackage({ orgId: "org-1", projectId: "project-1", packageId: "pkg-1" });
      expect(internal.items.map((row) => row.id)).toEqual(["sub-x", "sub-y"]);

      mockPrisma.submittalPackage.findFirst.mockResolvedValue(pkg([item("sub-y", "party-y")]));
      await expect(service.getPackage({ orgId: "org-1", projectId: "project-1", packageId: "pkg-1", projectAccess: partyX, viewerId: "user-x" })).rejects.toMatchObject({ code: "PROJECT_PARTY_RECORD_ACCESS_DENIED" });
      await expect(service.updatePackage({ orgId: "org-1", projectId: "project-1", packageId: "pkg-1", payload: { description: "x" }, actor: { id: "user-x" }, projectAccess: partyX })).rejects.toMatchObject({ code: "PROJECT_PARTY_RECORD_ACCESS_DENIED" });
      expect(mockPrisma.submittalPackage.update).not.toHaveBeenCalled();

      // An empty package the member made is still theirs.
      mockPrisma.submittalPackage.findFirst.mockResolvedValue(pkg([], "user-x"));
      await expect(service.getPackage({ orgId: "org-1", projectId: "project-1", packageId: "pkg-1", projectAccess: partyX, viewerId: "user-x" })).resolves.toMatchObject({ id: "pkg-1", items: [] });
    });

    it("lists packages for a party member through their routed submittals only", async () => {
      mockPrisma.submittalPackage.findMany.mockResolvedValue([pkg([item("sub-x", "party-x"), item("sub-y", "party-y")]), { ...pkg([item("sub-y2", "party-y")]), id: "pkg-2" }]);
      const listed = await service.listPackages({ orgId: "org-1", projectId: "project-1", projectAccess: partyX, viewerId: "user-x" });
      expect(listed.items.map((row) => [row.id, row.items.map((i) => i.id)])).toEqual([["pkg-1", ["sub-x"]]]);
      expect(mockPrisma.submittalPackage.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ projectId: "project-1", OR: expect.any(Array) }) }));
    });

    it("lets a party member package and take out only their own submittals", async () => {
      mockPrisma.submittalPackage.findFirst.mockResolvedValue(pkg([item("sub-x", "party-x"), item("sub-y", "party-y")]));
      mockPrisma.submittal.findMany.mockResolvedValue([{ id: "sub-y", packageId: null, ownerPartyId: "party-y", reviewerPartyId: null, approverPartyId: null }]);
      await expect(service.addPackageItems({ orgId: "org-1", projectId: "project-1", packageId: "pkg-1", submittalIds: ["sub-y"], actor: { id: "user-x" }, projectAccess: partyX })).rejects.toMatchObject({ code: "PROJECT_PARTY_RECORD_ACCESS_DENIED" });
      mockPrisma.submittal.findFirst.mockResolvedValue({ id: "sub-y", ownerPartyId: "party-y", reviewerPartyId: null, approverPartyId: null });
      await expect(service.removePackageItem({ orgId: "org-1", projectId: "project-1", packageId: "pkg-1", submittalId: "sub-y", actor: { id: "user-x" }, projectAccess: partyX })).rejects.toMatchObject({ code: "PROJECT_PARTY_RECORD_ACCESS_DENIED" });
      expect(mockPrisma.submittal.updateMany).not.toHaveBeenCalled();
      mockPrisma.submittal.findMany.mockResolvedValue([{ id: "sub-x2", packageId: null, ownerPartyId: "party-x", reviewerPartyId: null, approverPartyId: null }]);
      await expect(service.addPackageItems({ orgId: "org-1", projectId: "project-1", packageId: "pkg-1", submittalIds: ["sub-x2"], actor: { id: "user-x" }, projectAccess: partyX })).resolves.toMatchObject({ id: "pkg-1" });
      expect(mockPrisma.submittal.updateMany).toHaveBeenCalledWith({ where: { id: { in: ["sub-x2"] } }, data: { packageId: "pkg-1" } });
    });
  });

  describe("review-step reviewers and the decide route (review findings R4, R11)", () => {
    // The consultant's party is not on the record: it was assigned through a party-role step.
    const consultant = { scope: "party", role: "external_party", assignmentRole: null, partyAccess: [{ projectPartyId: "party-c", role: "consultant" }] };
    const routedElsewhere = (overrides = {}) => submittal({ ownerPartyId: "party-x", reviewerPartyId: null, approverPartyId: null, ...overrides });

    it("opens a submittal to a reviewer its review route names, and to nobody else outside its routing", async () => {
      mockPrisma.submittal.findFirst.mockResolvedValue(routedElsewhere());
      await expect(service.getSubmittal({ orgId: "org-1", projectId: "project-1", submittalId: "sub-1", projectAccess: consultant, viewerId: "user-arch" })).resolves.toMatchObject({ id: "sub-1", activeStep: expect.objectContaining({ id: "step-2" }) });
      await expect(service.getSubmittal({ orgId: "org-1", projectId: "project-1", submittalId: "sub-1", projectAccess: consultant, viewerId: "user-other" })).rejects.toMatchObject({ code: "PROJECT_PARTY_RECORD_ACCESS_DENIED", status: 403 });
      await expect(service.getSubmittal({ orgId: "org-1", projectId: "project-1", submittalId: "sub-1", projectAccess: consultant })).rejects.toMatchObject({ code: "PROJECT_PARTY_RECORD_ACCESS_DENIED" });
    });

    it("refuses an unrouted, unassigned party member's decision the same whatever the status, before anything is written", async () => {
      for (const overrides of [{ status: "pending", steps: [] }, { status: "under_review", steps: [] }, { status: "under_review" }]) {
        mockPrisma.submittal.findFirst.mockResolvedValue(routedElsewhere(overrides));
        await expect(service.decideStep({ orgId: "org-1", projectId: "project-1", submittalId: "sub-1", payload: { decision: "approve" }, userId: "user-other", userRole: "external_party", projectAccess: consultant })).rejects.toMatchObject({ code: "PROJECT_PARTY_RECORD_ACCESS_DENIED", status: 403 });
      }
      expect(mockPrisma.submittalStepAssignment.update).not.toHaveBeenCalled();
      expect(mockPrisma.submittalStepAssignment.create).not.toHaveBeenCalled();
      // internal callers keep the plain answers
      mockPrisma.submittal.findFirst.mockResolvedValue(routedElsewhere({ status: "pending", steps: [] }));
      await expect(service.decideStep({ orgId: "org-1", projectId: "project-1", submittalId: "sub-1", payload: { decision: "approve" }, userId: "user-pm", userRole: "pm", projectAccess: { scope: "assignment", assignmentRole: "pm", partyAccess: [] } })).rejects.toMatchObject({ code: "SUBMITTAL_NOT_UNDER_REVIEW" });
    });

    it("lets the named reviewer decide alone and in a package, with the party access the routes send", async () => {
      mockPrisma.submittal.findFirst.mockResolvedValue(routedElsewhere());
      await service.decideStep({ orgId: "org-1", projectId: "project-1", submittalId: "sub-1", payload: { decision: "approve" }, userId: "user-arch", userRole: "external_party", projectAccess: consultant });
      expect(mockPrisma.submittalStepAssignment.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "asg-user-arch" } }));

      jest.clearAllMocks();
      const item = { id: "sub-1", ref: "SUB-004", status: "under_review", ownerPartyId: "party-x", reviewerPartyId: null, approverPartyId: null, steps: [{ assignments: [{ userId: "user-arch" }] }] };
      const other = { id: "sub-9", ref: "SUB-009", status: "under_review", ownerPartyId: "party-x", reviewerPartyId: null, approverPartyId: null, steps: [{ assignments: [{ userId: "user-eng" }] }] };
      mockPrisma.submittalPackage.findFirst.mockResolvedValue({ id: "pkg-1", projectId: "project-1", ref: "PKG-001", name: "Facade", status: "submitted", createdBy: "user-site", submittals: [item, other], managerUser: null, activity: null });
      mockPrisma.submittal.findFirst.mockResolvedValue(routedElsewhere());
      const decided = await service.decidePackage({ orgId: "org-1", projectId: "project-1", packageId: "pkg-1", payload: { decision: "approve" }, userId: "user-arch", userRole: "external_party", projectAccess: consultant });
      expect(decided.results).toEqual([{ submittalId: "sub-1", ref: "SUB-004", decided: true }]);
      expect(decided.package.items.map((row) => row.id)).toEqual(["sub-1"]);
      expect(decided.package.items[0]).not.toHaveProperty("steps");
      await expect(service.getPackage({ orgId: "org-1", projectId: "project-1", packageId: "pkg-1", projectAccess: consultant, viewerId: "user-nobody" })).rejects.toMatchObject({ code: "PROJECT_PARTY_RECORD_ACCESS_DENIED" });
    });

    it("lists a package to the reviewer its items name", async () => {
      mockPrisma.submittalPackage.findMany.mockResolvedValue([]);
      await service.listPackages({ orgId: "org-1", projectId: "project-1", projectAccess: consultant, viewerId: "user-arch" });
      const where = mockPrisma.submittalPackage.findMany.mock.calls[0][0].where;
      expect(where.OR).toEqual(expect.arrayContaining([{ createdBy: "user-arch" }, { submittals: { some: { steps: { some: { assignments: { some: { userId: "user-arch" } } } } } } }]));
    });
  });

  describe("a new review cycle carries no response code of the last one (found reproducing review finding R3)", () => {
    it("clears the last cycle's code when a returned submittal is sent again, with or without a review route", async () => {
      for (const workflowTemplateId of [null, "tpl-1"]) {
        jest.clearAllMocks();
        mockPrisma.submittalStep.findMany.mockResolvedValue([]);
        const existing = submittal({ status: "rejected", responseCode: "rejected", responseCodeLabel: "Rejected", workflowTemplateId, steps: [] });
        const patch = await service.onStatusChange({ orgId: "org-1", projectId: "project-1", existing, updated: { ...existing, status: "under_review" } });
        expect(patch).toMatchObject({ responseCode: null, responseCodeLabel: null });
        expect(mockPrisma.submittal.update).toHaveBeenCalledWith({ where: { id: "sub-1" }, data: { responseCode: null, responseCodeLabel: null } });
      }
    });

    it("keeps a code set together with the new cycle, and touches nothing on creation or within a cycle", async () => {
      const existing = submittal({ status: "rejected", responseCode: "rejected", workflowTemplateId: null, steps: [] });
      expect(await service.onStatusChange({ orgId: "org-1", projectId: "project-1", existing, updated: { ...existing, status: "under_review", responseCode: "approved_as_noted" } })).not.toHaveProperty("responseCode");
      expect(await service.onStatusChange({ orgId: "org-1", projectId: "project-1", existing: {}, updated: { ...existing, status: "under_review" } })).not.toHaveProperty("responseCode");
      const inReview = submittal({ responseCode: "custom", workflowTemplateId: null });
      expect(await service.onStatusChange({ orgId: "org-1", projectId: "project-1", existing: inReview, updated: { ...inReview } })).toEqual({});
      expect(mockPrisma.submittal.update).not.toHaveBeenCalled();
    });
  });

  describe("review routes are the project team's (certification finding X-PARTY-2)", () => {
    const partyX = { scope: "party", role: "external_party", assignmentRole: null, partyAccess: [{ projectPartyId: "party-x", role: "consultant" }] };
    const staff = { scope: "assignment", role: "planning_eng", assignmentRole: "planning_eng", partyAccess: [] };
    const payload = { name: "Self review", steps: [{ name: "Review", assignees: [{ type: "user", userId: "user-x" }] }] };

    it("refuses whoever neither manages workflows nor reviews submittals for the company, and any external party on reviewing alone", async () => {
      await expect(service.createTemplate({ orgId: "org-1", projectId: "project-1", payload, access: { projectAccess: staff, canManageWorkflows: false, canReviewSubmittals: false } })).rejects.toMatchObject({ code: "FORBIDDEN", status: 403 });
      await expect(service.createTemplate({ orgId: "org-1", projectId: "project-1", payload, access: { projectAccess: partyX, canManageWorkflows: false, canReviewSubmittals: true } })).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(service.updateTemplate({ orgId: "org-1", projectId: "project-1", templateId: "tpl-1", payload, access: { projectAccess: partyX, canManageWorkflows: false, canReviewSubmittals: false } })).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(service.archiveTemplate({ orgId: "org-1", projectId: "project-1", templateId: "tpl-1", access: { projectAccess: partyX, canManageWorkflows: false, canReviewSubmittals: false } })).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect(mockPrisma.submittalWorkflowTemplate.create).not.toHaveBeenCalled();
      expect(mockPrisma.submittalWorkflowTemplate.update).not.toHaveBeenCalled();
      expect(mockPrisma.submittalWorkflowTemplate.updateMany).not.toHaveBeenCalled();
    });

    it("allows the workflow manager, the company's own reviewers, and the company workspace", () => {
      expect(() => service.assertCanManageRoutes({ projectAccess: partyX, canManageWorkflows: true, canReviewSubmittals: false })).not.toThrow();
      expect(() => service.assertCanManageRoutes({ projectAccess: staff, canManageWorkflows: false, canReviewSubmittals: true })).not.toThrow();
      expect(() => service.assertCanManageRoutes(null)).not.toThrow();
    });
  });

  describe("a route names only the company's people (CERT-2 injection sweep)", () => {
    const steps = (userId) => [
      { name: "Technical check", mode: "sequential", days: 5, assignees: [{ type: "user", userId }] },
      { name: "Project manager", mode: "sequential", days: 3, assignees: [{ type: "role", role: "pm" }] },
    ];

    it("refuses another company's person before anything is written, and stores the company's own", async () => {
      await expect(service.createTemplate({ orgId: "org-1", projectId: "project-1", payload: { name: "Route", steps: steps("other-company-user") } })).rejects.toMatchObject({ status: 404, code: "USER_NOT_FOUND" });
      expect(mockPrisma.organizationMembership.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ orgId: "org-1", userId: { in: ["other-company-user"] } }) }));
      expect(mockPrisma.submittalWorkflowTemplate.create).not.toHaveBeenCalled();
      expect(mockAudit.recordEvent).not.toHaveBeenCalled();

      mockPrisma.submittalWorkflowTemplate.create.mockImplementationOnce(async ({ data }) => ({ id: "tpl-9", ...data }));
      const made = await service.createTemplate({ orgId: "org-1", projectId: "project-1", payload: { name: "Route", steps: steps("user-eng") } });
      expect(made.steps[0].assignees).toEqual([{ type: "user", userId: "user-eng" }]);
    });

    it("refuses an edit that names another company's person; an edit that leaves the steps alone is not checked", async () => {
      mockPrisma.submittalWorkflowTemplate.findFirst.mockResolvedValue({ ...TEMPLATE, projectId: "project-1" });
      await expect(service.updateTemplate({ orgId: "org-1", projectId: "project-1", templateId: "tpl-1", payload: { steps: steps("other-company-user") } })).rejects.toMatchObject({ status: 404, code: "USER_NOT_FOUND" });
      expect(mockPrisma.submittalWorkflowTemplate.update).not.toHaveBeenCalled();

      mockPrisma.organizationMembership.findMany.mockClear();
      mockPrisma.submittalWorkflowTemplate.update.mockImplementationOnce(async ({ data }) => ({ ...TEMPLATE, projectId: "project-1", ...data }));
      await service.updateTemplate({ orgId: "org-1", projectId: "project-1", templateId: "tpl-1", payload: { description: "Renamed" } });
      expect(mockPrisma.organizationMembership.findMany).not.toHaveBeenCalled();
      expect(mockPrisma.submittalWorkflowTemplate.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ description: "Renamed" }) }));
    });
  });
});
