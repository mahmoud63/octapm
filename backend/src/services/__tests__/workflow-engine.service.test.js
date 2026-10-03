const table = () => ({
  findFirst: jest.fn(async () => null),
  findMany: jest.fn(async () => []),
  create: jest.fn(async ({ data }) => ({ id: `new-${Math.random().toString(36).slice(2, 7)}`, ...data })),
  createMany: jest.fn(async ({ data }) => ({ count: data.length })),
  update: jest.fn(async ({ data, where }) => ({ id: where.id, ...data })),
  updateMany: jest.fn(async () => ({ count: 0 })),
});

const state = { instance: null, assignments: [] };
const mockPrisma = {
  $transaction: jest.fn((fn) => fn(mockPrisma)),
  $queryRaw: jest.fn(async () => []),
  workflowTemplate: table(),
  workflowInstance: table(),
  workflowStepAssignment: table(),
  approvalWorkflowEvent: { create: jest.fn(async ({ data }) => ({ id: "evt", ...data })) },
  changeOrder: { findFirst: jest.fn() },
  // The record rules a party member's runs are judged by (certification L41).
  commitment: { findMany: jest.fn(async () => []) },
  subPayApp: { findMany: jest.fn(async () => []) },
  user: { findMany: jest.fn(async () => []) },
  projectAssignment: { findMany: jest.fn(async () => [{ userId: "pm-1", role: "pm" }, { userId: "fin-1", role: "finance" }, { userId: "qs-1", role: "qs" }]) },
  projectPartyMember: { findMany: jest.fn(async () => []) },
  projectUserPermission: { findMany: jest.fn(async () => []) },
};
const mockNotifications = { NOTIFICATION_CATEGORIES: { APPROVAL: "approval", WORKFLOW: "workflow", OVERDUE: "overdue" }, createNotifications: jest.fn(async () => ({ created: 1 })) };
const mockAudit = { ENTITY_TYPES: { WORKFLOW_TEMPLATE: "workflow_template" }, ACTIONS: { CREATED: "created", UPDATED: "updated" }, recordEvent: jest.fn(async () => ({})) };
const mockChangeOrders = { approveChangeOrder: jest.fn(async () => ({ status: "approved" })), rejectChangeOrder: jest.fn(async () => ({ status: "rejected" })) };

jest.mock("../../config/db", () => ({ prisma: mockPrisma }));
jest.mock("../notification.service", () => mockNotifications);
jest.mock("../audit.service", () => mockAudit);
jest.mock("../change-order.service", () => mockChangeOrders);

const engine = require("../workflow-engine.service");

const changeOrder = (value = 12000) => ({ id: "co-1", projectId: "p1", ref: "CO-007", description: "Extra piling", status: "pending", value, category: "scope", scheduleImpact: 3 });
const pmTemplate = (overrides = {}) => ({ id: "tpl-default", orgId: "org-1", projectId: null, tool: "change_order", name: "PM approval", isDefault: true, priority: 0, status: "active", rulesJson: [], startStep: "pm_approval", stepsJson: engine.normalizeTemplate({ tool: "change_order", name: "x", steps: engine.DEFAULT_TEMPLATES.change_order.steps }).stepsJson, ...overrides });
const bigTemplate = () => ({ id: "tpl-big", orgId: "org-1", projectId: null, tool: "change_order", name: "Finance above 50k", isDefault: false, priority: 10, status: "active", rulesJson: engine.EXAMPLE_TEMPLATE.rules, startStep: "pm_approval", stepsJson: engine.normalizeTemplate({ tool: "change_order", name: "x", steps: engine.EXAMPLE_TEMPLATE.steps }).stepsJson });

const wireInstanceStore = () => {
  mockPrisma.workflowInstance.create.mockImplementation(async ({ data }) => {
    state.instance = { id: "inst-1", ...data, assignments: [], template: { id: data.templateId, name: "t", tool: data.tool } };
    return state.instance;
  });
  mockPrisma.workflowInstance.update.mockImplementation(async ({ data }) => {
    state.instance = { ...state.instance, ...data, assignments: state.assignments.filter((row) => row.instanceId === state.instance.id) };
    return state.instance;
  });
  mockPrisma.workflowInstance.findFirst.mockImplementation(async ({ where }) => {
    if (!state.instance) return null;
    if (where.status === "running" && state.instance.status !== "running") return null;
    if (where.id && where.id !== state.instance.id) return null;
    return { ...state.instance, assignments: state.assignments.filter((row) => row.instanceId === state.instance.id), project: { id: "p1", name: "Tower" } };
  });
  mockPrisma.workflowStepAssignment.createMany.mockImplementation(async ({ data }) => {
    for (const row of data) state.assignments.push({ id: `as-${state.assignments.length + 1}`, status: "pending", isOverride: false, ...row });
    return { count: data.length };
  });
  mockPrisma.workflowStepAssignment.update.mockImplementation(async ({ where, data }) => {
    const row = state.assignments.find((item) => item.id === where.id);
    if (!row) return { id: where.id, ...data };
    Object.assign(row, data);
    return row;
  });
  mockPrisma.workflowStepAssignment.updateMany.mockImplementation(async ({ where, data }) => {
    let count = 0;
    for (const row of state.assignments) {
      const inIds = where.id?.in ? where.id.in.includes(row.id) : true;
      const matchesInstance = where.instanceId ? row.instanceId === where.instanceId : true;
      const matchesStatus = where.status ? row.status === where.status : true;
      if (inIds && matchesInstance && matchesStatus) {
        Object.assign(row, data);
        count += 1;
      }
    }
    return { count };
  });
  mockPrisma.workflowStepAssignment.create.mockImplementation(async ({ data }) => {
    const row = { id: `as-${state.assignments.length + 1}`, status: "pending", ...data };
    state.assignments.push(row);
    return row;
  });
};

describe("workflow engine", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    state.instance = null;
    state.assignments = [];
    wireInstanceStore();
    mockPrisma.changeOrder.findFirst.mockResolvedValue(changeOrder());
    mockPrisma.workflowTemplate.findMany.mockResolvedValue([bigTemplate(), pmTemplate()]);
  });

  it("validates templates: unique keys, assignees, responses and targets", () => {
    expect(() => engine.normalizeTemplate({ tool: "nope", name: "x", steps: [] })).toThrow(expect.objectContaining({ code: "WORKFLOW_TOOL_UNKNOWN" }));
    expect(() => engine.normalizeTemplate({ tool: "change_order", name: "x", steps: [] })).toThrow(expect.objectContaining({ code: "WORKFLOW_TEMPLATE_STEPS_REQUIRED" }));
    expect(() => engine.normalizeTemplate({ tool: "change_order", name: "x", steps: [{ name: "A", type: "response", assignees: [], responses: [{ label: "ok", next: "end_success" }] }] })).toThrow(expect.objectContaining({ code: "WORKFLOW_TEMPLATE_ASSIGNEE" }));
    expect(() => engine.normalizeTemplate({ tool: "change_order", name: "x", steps: [{ name: "A", type: "response", assignees: [{ type: "role", role: "pm" }], responses: [{ label: "ok", next: "missing_step" }] }] })).toThrow(expect.objectContaining({ code: "WORKFLOW_TEMPLATE_TARGET" }));
    const normalized = engine.normalizeTemplate({ tool: "change_order", name: "Route", steps: [{ name: "PM approval", type: "response", assignees: [{ type: "role", role: "PM" }], days: "5", responses: [{ label: "Approve", next: "end_success" }, { label: "Reject", next: "end_fail" }] }] });
    expect(normalized.stepsJson[0]).toMatchObject({ key: "pm_approval", days: 5, assignees: [{ type: "role", role: "pm" }], escalateRoles: ["pm"], responses: [{ key: "approve", tone: "positive" }, { key: "reject", tone: "negative" }] });
    expect(normalized.startStep).toBe("pm_approval");
  });

  it("picks the rule-bearing template for large amounts and the default otherwise", async () => {
    expect((await engine.pickTemplate({ orgId: "org-1", projectId: "p1", tool: "change_order", context: { amount: 80000 } })).id).toBe("tpl-big");
    expect((await engine.pickTemplate({ orgId: "org-1", projectId: "p1", tool: "change_order", context: { amount: 12000 } })).id).toBe("tpl-default");
    expect(engine.evaluateCondition({ category: "Scope" }, { field: "category", op: "in", value: ["scope", "design"] })).toBe(true);
    expect(engine.evaluateCondition({ amount: 5 }, { field: "amount", op: "between", value: 1 })).toBe(false);
  });

  it("starts the default route: assigns the PM, notifies, records the event", async () => {
    const instance = await engine.startInstance({ orgId: "org-1", projectId: "p1", tool: "change_order", recordId: "co-1", actor: { id: "qs-1", role: "qs" }, trigger: "auto" });
    expect(mockPrisma.workflowInstance.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ templateId: "tpl-default", tool: "change_order", recordId: "co-1", recordRef: "CO-007", contextJson: expect.objectContaining({ amount: 12000 }) }) }));
    expect(state.assignments).toEqual([expect.objectContaining({ stepKey: "pm_approval", userId: "pm-1", status: "pending", dueAt: expect.any(Date) })]);
    expect(mockNotifications.createNotifications).toHaveBeenCalledWith(expect.objectContaining({ event: "workflow.step_assigned", recipientUserIds: ["pm-1"], priority: "high" }));
    expect(mockPrisma.approvalWorkflowEvent.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ recordType: "change_order", recordId: "co-1", workflowType: "workflow_engine", action: "workflow.started" }) }));
    expect(instance).toMatchObject({ status: "running", currentStepKey: "pm_approval", currentStep: expect.objectContaining({ assignments: [expect.objectContaining({ userId: "pm-1" })] }) });
    await expect(engine.startInstance({ orgId: "org-1", projectId: "p1", tool: "change_order", recordId: "co-1", actor: { id: "qs-1" } })).rejects.toMatchObject({ code: "WORKFLOW_ALREADY_RUNNING" });
    await expect(engine.assertNotLocked({ tool: "change_order", projectId: "p1", recordId: "co-1" })).rejects.toMatchObject({ code: "WORKFLOW_RUNNING", details: { instanceId: "inst-1" } });
  });

  it("routes a large change order through the condition to finance and applies approval at the end", async () => {
    mockPrisma.changeOrder.findFirst.mockResolvedValue(changeOrder(300000));
    await engine.startInstance({ orgId: "org-1", projectId: "p1", tool: "change_order", recordId: "co-1", actor: { id: "qs-1" }, trigger: "auto" });
    expect(state.instance.templateId).toBe("tpl-big");
    expect(state.assignments.map((row) => [row.stepKey, row.userId])).toEqual([["pm_approval", "pm-1"]]);

    await engine.respond({ orgId: "org-1", projectId: "p1", instanceId: "inst-1", actor: { id: "pm-1", role: "pm" }, response: "approve", comment: "Fine" });
    // condition (300,000 ≥ 250,000) → finance sign-off
    expect(state.instance.currentStepKey).toBe("finance_signoff");
    expect(state.assignments.map((row) => [row.stepKey, row.userId, row.status])).toEqual([["pm_approval", "pm-1", "responded"], ["finance_signoff", "fin-1", "pending"]]);
    expect(state.instance.stepsJson.find((step) => step.key === "check_amount").state).toMatchObject({ status: "done", result: true });
    expect(mockChangeOrders.approveChangeOrder).not.toHaveBeenCalled();

    await expect(engine.respond({ orgId: "org-1", projectId: "p1", instanceId: "inst-1", actor: { id: "qs-1", role: "qs" }, response: "approve" })).rejects.toMatchObject({ code: "WORKFLOW_NOT_ASSIGNED" });
    await expect(engine.respond({ orgId: "org-1", projectId: "p1", instanceId: "inst-1", actor: { id: "fin-1", role: "finance" }, response: "reject" })).rejects.toMatchObject({ code: "WORKFLOW_COMMENT_REQUIRED" });

    const done = await engine.respond({ orgId: "org-1", projectId: "p1", instanceId: "inst-1", actor: { id: "fin-1", role: "finance" }, response: "approve", comment: "Budget available" });
    expect(state.instance).toMatchObject({ status: "succeeded", outcome: "success", currentStepKey: null, applyStatus: "applied" });
    expect(mockChangeOrders.approveChangeOrder).toHaveBeenCalledWith(expect.objectContaining({ orgId: "org-1", projectId: "p1", coId: "co-1", comment: "Budget available", userId: "fin-1", viaWorkflow: true }));
    expect(done.status).toBe("succeeded");
  });

  it("a smaller change order skips finance; a rejection ends the run and rejects the record", async () => {
    mockPrisma.changeOrder.findFirst.mockResolvedValue(changeOrder(80000));
    await engine.startInstance({ orgId: "org-1", projectId: "p1", tool: "change_order", recordId: "co-1", actor: { id: "qs-1" } });
    expect(state.instance.templateId).toBe("tpl-big");
    await engine.respond({ orgId: "org-1", projectId: "p1", instanceId: "inst-1", actor: { id: "pm-1", role: "pm" }, response: "approve" });
    expect(state.instance).toMatchObject({ status: "succeeded", outcome: "success" });
    expect(mockChangeOrders.approveChangeOrder).toHaveBeenCalledTimes(1);

    state.instance = null;
    state.assignments = [];
    mockPrisma.changeOrder.findFirst.mockResolvedValue(changeOrder(12000));
    await engine.startInstance({ orgId: "org-1", projectId: "p1", tool: "change_order", recordId: "co-1", actor: { id: "qs-1" } });
    await engine.respond({ orgId: "org-1", projectId: "p1", instanceId: "inst-1", actor: { id: "pm-1", role: "pm" }, response: "reject", comment: "Not in scope" });
    expect(state.instance).toMatchObject({ status: "failed", outcome: "fail" });
    expect(mockChangeOrders.rejectChangeOrder).toHaveBeenCalledWith(expect.objectContaining({ coId: "co-1", reason: "Not in scope", viaWorkflow: true }));
  });

  it("requireAll waits for every assignee; a PM may respond on behalf when allowed", async () => {
    const template = pmTemplate({ stepsJson: engine.normalizeTemplate({ tool: "change_order", name: "x", steps: [{ key: "both", name: "PM and finance", type: "response", requireAll: true, assignees: [{ type: "role", role: "pm" }, { type: "role", role: "finance" }], responses: [{ key: "approve", label: "Approve", next: "end_success" }, { key: "reject", label: "Reject", next: "end_fail", requireComment: true }] }] }).stepsJson, startStep: "both" });
    mockPrisma.workflowTemplate.findMany.mockResolvedValue([template]);
    await engine.startInstance({ orgId: "org-1", projectId: "p1", tool: "change_order", recordId: "co-1", actor: { id: "qs-1" } });
    expect(state.assignments.map((row) => row.userId)).toEqual(["pm-1", "fin-1"]);
    await engine.respond({ orgId: "org-1", projectId: "p1", instanceId: "inst-1", actor: { id: "pm-1", role: "pm" }, response: "approve" });
    expect(state.instance.status).toBe("running");
    expect(mockChangeOrders.approveChangeOrder).not.toHaveBeenCalled();
    await engine.respond({ orgId: "org-1", projectId: "p1", instanceId: "inst-1", actor: { id: "override-pm", role: "pm" }, response: "approve", canOverride: true });
    expect(state.assignments.find((row) => row.userId === "override-pm")).toMatchObject({ isOverride: true, status: "responded" });
    expect(state.assignments.find((row) => row.userId === "fin-1").status).toBe("skipped");
    expect(state.instance).toMatchObject({ status: "succeeded" });
  });

  it("records an apply failure without losing the decision, and cancel unlocks the record", async () => {
    mockChangeOrders.approveChangeOrder.mockRejectedValueOnce(Object.assign(new Error("Needs proof"), { code: "CHANGE_ORDER_APPROVAL_PROOF_REQUIRED" }));
    await engine.startInstance({ orgId: "org-1", projectId: "p1", tool: "change_order", recordId: "co-1", actor: { id: "qs-1" } });
    await engine.respond({ orgId: "org-1", projectId: "p1", instanceId: "inst-1", actor: { id: "pm-1", role: "pm" }, response: "approve" });
    expect(state.instance).toMatchObject({ status: "succeeded", applyStatus: "failed", applyError: "CHANGE_ORDER_APPROVAL_PROOF_REQUIRED: Needs proof" });
    expect(mockNotifications.createNotifications).toHaveBeenCalledWith(expect.objectContaining({ event: "workflow.apply_failed", recipientRoles: ["pm"] }));

    state.instance = null;
    state.assignments = [];
    await engine.startInstance({ orgId: "org-1", projectId: "p1", tool: "change_order", recordId: "co-1", actor: { id: "qs-1" } });
    await engine.cancelInstance({ orgId: "org-1", projectId: "p1", instanceId: "inst-1", actor: { id: "pm-1" }, reason: "Withdrawn" });
    expect(state.instance).toMatchObject({ status: "cancelled", cancelReason: "Withdrawn", applyStatus: "skipped" });
    expect(state.assignments[0].status).toBe("skipped");
    await expect(engine.assertNotLocked({ tool: "change_order", projectId: "p1", recordId: "co-1" })).resolves.toBeNull();
  });

  it("escalates steps past their SLA to the assignee and the escalation roles", async () => {
    const now = new Date("2026-09-12T08:00:00Z");
    mockPrisma.workflowStepAssignment.findMany.mockResolvedValueOnce([
      { id: "as-9", instanceId: "inst-9", stepKey: "pm_approval", stepName: "PM approval", userId: "pm-1", status: "pending", dueAt: new Date("2026-09-10T00:00:00Z"), escalatedAt: null, instance: { id: "inst-9", orgId: "org-1", projectId: "p1", tool: "change_order", recordId: "co-1", recordRef: "CO-007", recordTitle: "Extra piling", status: "running", currentStepKey: "pm_approval", escalationLevel: 2, templateId: "tpl-default", stepsJson: pmTemplate().stepsJson, assignments: [], template: { id: "tpl-default", name: "PM approval" } } },
    ]);
    mockPrisma.projectAssignment.findMany.mockResolvedValue([{ userId: "pm-1", role: "pm" }, { userId: "pm-2", role: "pm" }]);
    mockPrisma.$queryRaw.mockResolvedValueOnce([{ id: "as-9", userId: "pm-1", stepName: "PM approval", dueAt: new Date("2026-09-10T00:00:00Z") }]);
    const result = await engine.runEscalationScan({ now });
    expect(result).toEqual({ scanned: 1, escalated: 1 });
    // One claim for the whole step, scoped to this instance and step and to
    // rows still pending, unescalated and overdue.
    expect(mockPrisma.$queryRaw).toHaveBeenCalledTimes(1);
    const [sql, ...values] = mockPrisma.$queryRaw.mock.calls[0];
    expect(sql.join("?")).toMatch(/UPDATE "WorkflowStepAssignment"[\s\S]*"escalatedAt" IS NULL[\s\S]*RETURNING/);
    expect(values).toEqual([now, "inst-9", "pm_approval", "pending", now]);
    expect(mockPrisma.workflowInstance.update).toHaveBeenCalledWith({ where: { id: "inst-9" }, data: { escalationLevel: { increment: 1 } } });
    expect(mockNotifications.createNotifications).toHaveBeenCalledWith(expect.objectContaining({ event: "workflow.escalated", recipientUserIds: ["pm-2"] }));
    expect(mockNotifications.createNotifications).toHaveBeenCalledWith(expect.objectContaining({ event: "workflow.step_overdue", recipientUserIds: ["pm-1"] }));
  });

  it("leaves a step another scan already claimed, whatever this scan read", async () => {
    const now = new Date("2026-09-12T08:00:00Z");
    const instance = { id: "inst-9", orgId: "org-1", projectId: "p1", tool: "change_order", recordId: "co-1", recordRef: "CO-007", recordTitle: "Extra piling", status: "running", currentStepKey: "pm_approval", escalationLevel: 0, templateId: "tpl-default", stepsJson: pmTemplate().stepsJson, assignments: [], template: { id: "tpl-default", name: "PM approval" } };
    const overdue = (id, userId) => ({ id, instanceId: "inst-9", stepKey: "pm_approval", stepName: "PM approval", userId, status: "pending", dueAt: new Date("2026-09-10T00:00:00Z"), escalatedAt: null, instance });
    mockPrisma.workflowStepAssignment.findMany.mockResolvedValueOnce([overdue("as-1", "pm-1"), overdue("as-2", "qs-1")]);
    // The other scan's claim took every overdue row of the step first.
    mockPrisma.$queryRaw.mockResolvedValueOnce([]);
    const result = await engine.runEscalationScan({ now });
    expect(result).toEqual({ scanned: 2, escalated: 0 });
    expect(mockPrisma.$queryRaw).toHaveBeenCalledTimes(1); // once per step, not per row
    expect(mockPrisma.workflowInstance.update).not.toHaveBeenCalled();
    expect(mockPrisma.approvalWorkflowEvent.create).not.toHaveBeenCalled();
    expect(mockNotifications.createNotifications).not.toHaveBeenCalled();
  });

  it("reminds every assignee the step claim took, and escalates the instance once", async () => {
    const now = new Date("2026-09-12T08:00:00Z");
    const instance = { id: "inst-9", orgId: "org-1", projectId: "p1", tool: "change_order", recordId: "co-1", recordRef: "CO-007", recordTitle: "Extra piling", status: "running", currentStepKey: "pm_approval", escalationLevel: 0, templateId: "tpl-default", stepsJson: pmTemplate().stepsJson, assignments: [], template: { id: "tpl-default", name: "PM approval" } };
    mockPrisma.workflowStepAssignment.findMany.mockResolvedValueOnce([
      { id: "as-2", instanceId: "inst-9", stepKey: "pm_approval", stepName: "PM approval", userId: "qs-1", status: "pending", dueAt: new Date("2026-09-10T00:00:00Z"), escalatedAt: null, instance },
    ]);
    // The claim also took an overdue row this scan never read (beyond its page).
    mockPrisma.$queryRaw.mockResolvedValueOnce([
      { id: "as-1", userId: "pm-1", stepName: "PM approval", dueAt: new Date("2026-09-10T00:00:00Z") },
      { id: "as-2", userId: "qs-1", stepName: "PM approval", dueAt: new Date("2026-09-10T00:00:00Z") },
    ]);
    mockPrisma.projectAssignment.findMany.mockResolvedValue([{ userId: "pm-1", role: "pm" }, { userId: "pm-2", role: "pm" }]);
    const result = await engine.runEscalationScan({ now });
    expect(result).toEqual({ scanned: 1, escalated: 2 });
    expect(mockPrisma.workflowInstance.update).toHaveBeenCalledTimes(1);
    const sent = mockNotifications.createNotifications.mock.calls.map(([payload]) => [payload.event, payload.recipientUserIds]);
    expect(sent).toEqual([
      ["workflow.escalated", ["pm-2"]],
      ["workflow.step_overdue", ["qs-1"]],
      ["workflow.step_overdue", ["pm-1"]],
    ]);
  });

  it("seeds one default per tool plus the worked example", async () => {
    mockPrisma.workflowTemplate.findFirst.mockResolvedValue(null);
    const result = await engine.seedDefaultTemplates({ orgId: "org-1", actor: { id: "admin" } });
    expect(result.created).toBe(Object.keys(engine.DEFAULT_TEMPLATES).length + 1);
    const created = mockPrisma.workflowTemplate.create.mock.calls.map((call) => call[0].data);
    expect(created.filter((row) => row.isDefault).map((row) => row.tool).sort()).toEqual(Object.keys(engine.DEFAULT_TEMPLATES).sort());
    expect(created.find((row) => row.name === engine.EXAMPLE_TEMPLATE.name)).toMatchObject({ isDefault: false, rulesJson: [{ field: "amount", op: "gte", value: 50000 }] });
    expect(created.find((row) => row.tool === "sub_pay_app").stepsJson.map((step) => step.key)).toEqual(["qs_review", "pm_approval"]);
  });
});

describe("certification L41 — a run is shown as its record is", () => {
  const MODULE_READS = { site: ["workflow"], qs: ["workflow", "change_order", "ipc", "cost", "commitment", "sub_pay_app"], guest: ["workflow", "commitment", "sub_pay_app"] };
  const viewerOf = (who, { userId = `${who}-1`, party = false } = {}) => ({
    id: userId,
    userId,
    canRead: (moduleName) => MODULE_READS[who].includes(moduleName),
    partyIds: party ? ["party-x"] : null,
    companyIds: party ? ["company-x"] : null,
  });
  const run = (id, tool, recordId, assignees = ["pm-1"]) => ({ id, orgId: "org-1", projectId: "p1", tool, recordId, recordRef: id, status: "cancelled", contextJson: { ref: id, amount: 1000 }, stepsJson: [], assignments: assignees.map((userId, index) => ({ id: `${id}-as-${index}`, stepKey: "review", userId, status: "skipped" })), template: { id: "t", name: "t", tool } });
  const rows = [
    run("co-run", "change_order", "co-1"),
    run("ipc-run", "ipc_certificate", "ipc-1"),
    run("own-commitment-run", "commitment", "cm-own"),
    run("foreign-commitment-run", "commitment", "cm-foreign"),
    run("assigned-co-run", "change_order", "co-2", ["site-1"]),
  ];

  beforeEach(() => {
    jest.clearAllMocks();
    mockPrisma.commitment.findMany.mockImplementation(async ({ where }) => (where.id.in.includes("cm-own") ? [{ id: "cm-own" }] : []));
  });

  it("lists a run to its record's readers and its assignees only, the party rule included", async () => {
    mockPrisma.workflowInstance.findMany.mockResolvedValue(rows);
    const asGuest = await engine.listInstances({ orgId: "org-1", projectId: "p1", viewer: viewerOf("guest", { party: true }) });
    expect(asGuest.map((row) => row.id)).toEqual(["own-commitment-run"]);
    expect(mockPrisma.commitment.findMany).toHaveBeenCalledWith({ where: { id: { in: ["cm-own", "cm-foreign"] }, OR: [{ vendorCompanyId: { in: ["company-x"] } }, { createdBy: "guest-1" }] }, select: { id: true } });
    // The query is narrowed to the tools the viewer reads and the runs assigned to them.
    expect(mockPrisma.workflowInstance.findMany.mock.calls[0][0].where.AND).toEqual([{ OR: [{ tool: { in: ["commitment", "sub_pay_app"] } }, { assignments: { some: { userId: "guest-1" } } }] }]);

    const asSite = await engine.listInstances({ orgId: "org-1", projectId: "p1", viewer: viewerOf("site") });
    expect(asSite.map((row) => row.id)).toEqual(["assigned-co-run"]);

    const asQs = await engine.listInstances({ orgId: "org-1", projectId: "p1", viewer: viewerOf("qs") });
    expect(asQs.map((row) => row.id)).toEqual(rows.map((row) => row.id));

    const internal = await engine.listInstances({ orgId: "org-1", projectId: "p1" });
    expect(internal).toHaveLength(rows.length);
    expect(mockPrisma.workflowInstance.findMany.mock.calls.at(-1)[0].where.AND).toBeUndefined();
  });

  it("answers a run the viewer may not see as one that does not exist", async () => {
    const byId = (id) => async () => ({ ...rows.find((row) => row.id === id), project: { id: "p1", name: "Tower" } });
    mockPrisma.workflowInstance.findFirst.mockImplementationOnce(byId("ipc-run"));
    await expect(engine.getInstance({ orgId: "org-1", projectId: "p1", instanceId: "ipc-run", viewer: viewerOf("site") })).rejects.toMatchObject({ status: 404, code: "WORKFLOW_INSTANCE_NOT_FOUND" });
    mockPrisma.workflowInstance.findFirst.mockImplementationOnce(byId("foreign-commitment-run"));
    await expect(engine.getInstance({ orgId: "org-1", projectId: "p1", instanceId: "foreign-commitment-run", viewer: viewerOf("guest", { party: true }) })).rejects.toMatchObject({ status: 404 });
    mockPrisma.workflowInstance.findFirst.mockImplementationOnce(byId("own-commitment-run"));
    await expect(engine.getInstance({ orgId: "org-1", projectId: "p1", instanceId: "own-commitment-run", viewer: viewerOf("guest", { party: true }) })).resolves.toMatchObject({ id: "own-commitment-run", context: { amount: 1000 } });
    mockPrisma.workflowInstance.findFirst.mockImplementationOnce(byId("assigned-co-run"));
    await expect(engine.getInstance({ orgId: "org-1", projectId: "p1", instanceId: "assigned-co-run", viewer: viewerOf("site") })).resolves.toMatchObject({ id: "assigned-co-run" });
  });

  it("lists a tool's routes only to its module's readers", async () => {
    const templates = [pmTemplate(), { ...pmTemplate(), id: "tpl-ipc", tool: "ipc_certificate" }, { ...pmTemplate(), id: "tpl-cm", tool: "commitment" }];
    mockPrisma.workflowTemplate.findMany.mockResolvedValue(templates);
    expect((await engine.listTemplates({ orgId: "org-1", projectId: "p1", viewer: viewerOf("guest", { party: true }) })).map((row) => row.id)).toEqual(["tpl-cm"]);
    expect((await engine.listTemplates({ orgId: "org-1", projectId: "p1", viewer: viewerOf("qs") })).map((row) => row.id)).toEqual(["tpl-default", "tpl-ipc", "tpl-cm"]);
    expect(await engine.listTemplates({ orgId: "org-1", projectId: "p1" })).toHaveLength(3);
  });

  it("refuses to start, decide or cancel a run on a record the viewer may not read, before anything moves", async () => {
    await expect(engine.startInstance({ orgId: "org-1", projectId: "p1", tool: "change_order", recordId: "co-1", actor: { id: "site-1" }, viewer: viewerOf("site") })).rejects.toMatchObject({ status: 404, code: "WORKFLOW_RECORD_NOT_FOUND" });
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    mockPrisma.workflowInstance.findFirst.mockResolvedValueOnce({ ...run("running-co", "change_order", "co-1"), status: "running" });
    await expect(engine.respond({ orgId: "org-1", projectId: "p1", instanceId: "running-co", actor: { id: "site-1" }, response: "approve", canOverride: true, viewer: viewerOf("site") })).rejects.toMatchObject({ status: 404, code: "WORKFLOW_INSTANCE_NOT_FOUND" });
    mockPrisma.workflowInstance.findFirst.mockResolvedValueOnce({ ...run("running-co", "change_order", "co-1"), status: "running" });
    await expect(engine.cancelInstance({ orgId: "org-1", projectId: "p1", instanceId: "running-co", actor: { id: "site-1" }, viewer: viewerOf("site") })).rejects.toMatchObject({ status: 404, code: "WORKFLOW_INSTANCE_NOT_FOUND" });
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    expect(mockPrisma.workflowStepAssignment.update).not.toHaveBeenCalled();
  });
});

describe("Phase 21D — integrity (release challenge, ninth pass)", () => {
  it("CX21-494: the inbox of a key limited to some projects holds those projects' steps only", async () => {
    mockPrisma.workflowStepAssignment.findMany.mockResolvedValueOnce([]);
    await engine.myAssignments({ orgId: "org-1", userId: "u1", projectIds: ["p1"] });
    expect(mockPrisma.workflowStepAssignment.findMany.mock.calls.at(-1)[0].where).toMatchObject({ orgId: "org-1", userId: "u1", projectId: { in: ["p1"] } });
    mockPrisma.workflowStepAssignment.findMany.mockResolvedValueOnce([]);
    await engine.myAssignments({ orgId: "org-1", userId: "u1" });
    expect(mockPrisma.workflowStepAssignment.findMany.mock.calls.at(-1)[0].where.projectId).toBeUndefined();
  });
});
