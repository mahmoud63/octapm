/**
 * The task API mounted outside a project honours an API key's project list
 * (Phase 21D, CX21-486).
 */
const mockPrisma = {
  task: { findMany: jest.fn(async () => []), count: jest.fn(async () => 0) },
  project: { findFirst: jest.fn(async () => ({ id: "p2", orgId: "org-1" })) },
  $transaction: jest.fn(async (fn) => fn(mockPrisma)),
};
jest.mock("../../config/db", () => ({ prisma: mockPrisma }));
const mockDenies = jest.fn(async () => []);
jest.mock("../permission-template.service", () => ({ projectsWhereTemplateDenies: mockDenies }));
const service = require("../task.service");

describe("Phase 21D — integrity (release challenge, eighth pass)", () => {
  it("CX21-486: a key's task list is narrowed to its projects, and a task cannot be created on another", async () => {
    await service.listTasks({ orgId: "org-1", userId: "u1", role: "pm", query: {}, projectIds: ["p1"] });
    expect(mockPrisma.task.findMany.mock.calls.at(-1)[0].where).toMatchObject({ projectId: { in: ["p1"] } });
    await expect(service.createTask({ orgId: "org-1", payload: { projectId: "p2", title: "Snag" }, userId: "u1", userRole: "pm", allowedProjectIds: ["p1"] })).rejects.toMatchObject({ code: "FORBIDDEN_PROJECT", status: 403 });
  });
});

describe("Phase 21D — integrity (release challenge, ninth pass)", () => {
  it("CX21-492: a task list across projects leaves out the projects whose permission template refuses this person the tasks module — for a session and for a key", async () => {
    mockDenies.mockResolvedValue(["p2"]);
    await service.listTasks({ orgId: "org-1", userId: "u1", role: "pm", query: {} });
    expect(mockDenies).toHaveBeenCalledWith(expect.objectContaining({ orgId: "org-1", userId: "u1", module: "task", action: "read" }));
    expect(mockPrisma.task.findMany.mock.calls.at(-1)[0].where).toMatchObject({ projectId: { notIn: ["p2"] } });
    await service.listTasks({ orgId: "org-1", userId: "u1", role: "pm", query: {}, projectIds: ["p1", "p2"] });
    expect(mockPrisma.task.findMany.mock.calls.at(-1)[0].where).toMatchObject({ projectId: { in: ["p1"] } });
    mockDenies.mockResolvedValue([]);
  });
});

describe("Phase 21D — integrity (release challenge, eleventh pass)", () => {
  afterEach(() => { delete mockPrisma.projectAssignment; });

  it("CX21-525: across projects, each project is seen with the role held there — a wide organisation role narrowed by an assignment sees only its own tasks on that project, and a narrow one widened by an assignment sees that project whole", async () => {
    mockPrisma.projectAssignment = { findMany: jest.fn(async () => [{ projectId: "p9", role: "site_engineer" }, { projectId: "p3", role: "planning_eng" }]) };
    await service.listTasks({ orgId: "org-1", userId: "u1", role: "planning_eng", query: {} });
    let where = mockPrisma.task.findMany.mock.calls.at(-1)[0].where;
    expect(where.AND).toEqual(expect.arrayContaining([{ OR: [{ projectId: { notIn: ["p9"] } }, { OR: [{ assigneeId: "u1" }, { createdById: "u1" }] }] }]));
    expect(where.OR).toBeUndefined();
    await service.listTasks({ orgId: "org-1", userId: "u1", role: "site_engineer", query: {} });
    where = mockPrisma.task.findMany.mock.calls.at(-1)[0].where;
    expect(where.AND).toEqual(expect.arrayContaining([{ OR: [{ projectId: { in: ["p3"] } }, { OR: [{ assigneeId: "u1" }, { createdById: "u1" }] }] }]));
    expect(where.OR).toBeUndefined();
    // and with no narrowing assignment, a wide role's list is left as it was
    mockPrisma.projectAssignment.findMany.mockResolvedValue([]);
    await service.listTasks({ orgId: "org-1", userId: "u1", role: "pm", query: {} });
    where = mockPrisma.task.findMany.mock.calls.at(-1)[0].where;
    expect(where.AND || []).toEqual([]);
  });
});

describe("Phase 21D — integrity (release challenge, twelfth pass)", () => {
  afterEach(() => { delete mockPrisma.projectAssignment; delete mockPrisma.projectPartyMember; });

  it("CX21-536: a project reached only through a party membership narrows a wide role to its own tasks there, and a role that sees every project is not narrowed by an assignment", async () => {
    mockPrisma.projectAssignment = { findMany: jest.fn(async () => []) };
    mockPrisma.projectPartyMember = { findMany: jest.fn(async () => [{ projectParty: { projectId: "p5" } }]) };
    await service.listTasks({ orgId: "org-1", userId: "u1", role: "planning_eng", query: {} });
    let where = mockPrisma.task.findMany.mock.calls.at(-1)[0].where;
    expect(where.AND).toEqual(expect.arrayContaining([{ OR: [{ projectId: { notIn: ["p5"] } }, { OR: [{ assigneeId: "u1" }, { createdById: "u1" }] }] }]));
    expect(mockPrisma.projectPartyMember.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ userId: "u1", status: "active", projectParty: { status: "active" } }) }));
    mockPrisma.projectAssignment.findMany.mockResolvedValue([{ projectId: "p9", role: "site_engineer" }]);
    await service.listTasks({ orgId: "org-1", userId: "u1", role: "pm", query: {} });
    where = mockPrisma.task.findMany.mock.calls.at(-1)[0].where;
    expect(where.AND || []).toEqual([]);
  });
});
