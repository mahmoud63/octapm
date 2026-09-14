const mockPrisma = {
  project: {
    findMany: jest.fn(),
  },
  rfi: {
    findMany: jest.fn(),
  },
  task: {
    findMany: jest.fn(),
  },
  changeOrder: {
    findMany: jest.fn(),
  },
};

jest.mock("../../config/db", () => ({ prisma: mockPrisma }));

const searchService = require("../search.service");

const projectRow = (patch = {}) => ({
  id: "project-1",
  orgId: "org-1",
  name: "Hospital Tower",
  type: "Healthcare",
  location: "Baton Rouge",
  clientName: "LSU",
  contractNumber: "CON-001",
  status: "active",
  archivedAt: null,
  assignments: [],
  parties: [],
  createdAt: new Date("2026-06-01T00:00:00.000Z"),
  updatedAt: new Date("2026-06-12T00:00:00.000Z"),
  ...patch,
});

const projectParty = (patch = {}) => ({
  id: "party-1",
  companyId: "company-1",
  role: "contractor",
  accessLevel: "collaborator",
  permissionProfile: null,
  company: {
    id: "company-1",
    name: "Delta Concrete",
    status: "active",
  },
  members: [
    {
      id: "member-1",
      role: "coordinator",
      status: "active",
    },
  ],
  ...patch,
});

describe("global search service", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPrisma.project.findMany.mockResolvedValue([]);
    mockPrisma.rfi.findMany.mockResolvedValue([]);
    mockPrisma.task.findMany.mockResolvedValue([]);
    mockPrisma.changeOrder.findMany.mockResolvedValue([]);
  });

  it("limits party-scoped RFI results to routed party records", async () => {
    mockPrisma.project.findMany.mockResolvedValue([
      projectRow({ parties: [projectParty()] }),
    ]);
    mockPrisma.rfi.findMany.mockResolvedValue([
      {
        id: "rfi-1",
        projectId: "project-1",
        ref: "RFI-001",
        subject: "Clarify slab opening",
        status: "open",
        priority: "high",
        dueDate: new Date("2026-06-18T00:00:00.000Z"),
        createdAt: new Date("2026-06-10T00:00:00.000Z"),
        updatedAt: new Date("2026-06-11T00:00:00.000Z"),
      },
    ]);

    const result = await searchService.globalSearch({
      orgId: "org-1",
      userId: "user-1",
      role: "site_engineer",
      query: {
        q: "slab",
        type: "rfi",
      },
    });

    expect(mockPrisma.project.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          orgId: "org-1",
          OR: expect.any(Array),
        }),
      }),
    );
    expect(mockPrisma.rfi.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          AND: expect.arrayContaining([
            {
              OR: [
                {
                  AND: expect.arrayContaining([
                    { projectId: "project-1" },
                    {
                      OR: [
                        { ownerPartyId: { in: ["party-1"] } },
                        { reviewerPartyId: { in: ["party-1"] } },
                        { approverPartyId: { in: ["party-1"] } },
                      ],
                    },
                  ]),
                },
              ],
            },
            expect.objectContaining({
              OR: expect.arrayContaining([
                { subject: { contains: "slab", mode: "insensitive" } },
              ]),
            }),
          ]),
          archivedAt: null,
        }),
      }),
    );
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      type: "rfi",
      title: "Clarify slab opening",
      projectName: "Hospital Tower",
    });
  });

  it("keeps non-project-wide users limited to assigned or created tasks", async () => {
    mockPrisma.project.findMany.mockResolvedValue([
      projectRow({
        assignments: [{ role: "site_engineer" }],
      }),
    ]);
    mockPrisma.task.findMany.mockResolvedValue([
      {
        id: "task-1",
        projectId: "project-1",
        taskNumber: "TSK-0003",
        title: "Confirm embed plates",
        label: "field",
        priority: "high",
        status: "todo",
        dueDate: new Date("2026-06-19T00:00:00.000Z"),
        createdAt: new Date("2026-06-10T00:00:00.000Z"),
        updatedAt: new Date("2026-06-11T00:00:00.000Z"),
      },
    ]);

    await searchService.globalSearch({
      orgId: "org-1",
      userId: "user-1",
      role: "site_engineer",
      query: {
        q: "embed",
        type: "task",
      },
    });

    expect(mockPrisma.task.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          orgId: "org-1",
          AND: expect.arrayContaining([
            {
              OR: [
                {
                  AND: [
                    { projectId: "project-1" },
                    {
                      OR: [{ assigneeId: "user-1" }, { createdById: "user-1" }],
                    },
                  ],
                },
              ],
            },
          ]),
          archivedAt: null,
        }),
      }),
    );
  });

  it("applies type, project, status, and date filters", async () => {
    mockPrisma.project.findMany.mockResolvedValue([
      projectRow({ id: "project-2", name: "Airport Expansion" }),
    ]);
    mockPrisma.changeOrder.findMany.mockResolvedValue([
      {
        id: "co-1",
        projectId: "project-2",
        ref: "CO-009",
        description: "Add temporary access road",
        category: "scope",
        status: "approved",
        value: 25000,
        scheduleImpact: 3,
        createdAt: new Date("2026-06-09T00:00:00.000Z"),
        updatedAt: new Date("2026-06-12T00:00:00.000Z"),
      },
    ]);

    const result = await searchService.globalSearch({
      orgId: "org-1",
      userId: "pm-1",
      role: "pm",
      query: {
        q: "access",
        type: "change-order",
        projectId: "project-2",
        status: "approved",
        dateFrom: "2026-06-01T00:00:00.000Z",
      },
    });

    expect(mockPrisma.project.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          orgId: "org-1",
          id: "project-2",
        }),
      }),
    );
    expect(mockPrisma.changeOrder.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: { in: ["approved"] },
          updatedAt: { gte: new Date("2026-06-01T00:00:00.000Z") },
        }),
      }),
    );
    expect(mockPrisma.rfi.findMany).not.toHaveBeenCalled();
    expect(result.items[0]).toMatchObject({
      type: "change_order",
      status: "approved",
      url: expect.stringContaining("module=commercial"),
    });
  });
});

describe("Phase 21D — integrity (release challenge, third pass)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPrisma.project.findMany.mockResolvedValue([projectRow(), projectRow({ id: "project-2", name: "Riverside Tower" })]);
    mockPrisma.rfi.findMany.mockResolvedValue([]);
    mockPrisma.task.findMany.mockResolvedValue([]);
    mockPrisma.changeOrder.findMany.mockResolvedValue([]);
  });

  it("CX21-431: a key limited to one project is refused another, sees only its own, and only the modules its scopes allow", async () => {
    const apiClient = { scopes: ["*:read"], projectIds: ["project-1"] };
    await expect(
      searchService.globalSearch({ orgId: "org-1", userId: "user-1", role: "pm", query: { type: "project", projectId: "project-2" }, apiClient }),
    ).rejects.toMatchObject({ code: "FORBIDDEN_PROJECT", status: 403 });
    const own = await searchService.globalSearch({ orgId: "org-1", userId: "user-1", role: "pm", query: { q: "tower", type: "project" }, apiClient });
    expect(own.items.map((item) => item.projectId)).toEqual(["project-1"]);
    const scoped = { scopes: ["report:read"], projectIds: [] };
    const none = await searchService.globalSearch({ orgId: "org-1", userId: "user-1", role: "pm", query: { q: "slab", type: "rfi" }, apiClient: scoped });
    expect(mockPrisma.rfi.findMany).not.toHaveBeenCalled();
    expect(none.items).toEqual([]);
  });
});

describe("Phase 21D — integrity (release challenge, tenth pass)", () => {
  const rfiRow = () => ({ id: "rfi-9", projectId: "project-1", ref: "RFI-009", subject: "Slab spec", status: "open", priority: "high", dueDate: null, createdAt: new Date("2026-06-10T00:00:00.000Z"), updatedAt: new Date("2026-06-11T00:00:00.000Z") });
  const template = (id) => ({ id, name: "No RFIs", kind: "internal", baseRole: "pm", status: "active", tools: [{ module: "rfi", level: "none" }], grants: [] });

  afterEach(() => {
    delete mockPrisma.projectUserPermission;
    delete mockPrisma.permissionTemplate;
  });

  it("CX21-514: a project whose permission template refuses a module is not searched for that module — for a member template and for a party template", async () => {
    mockPrisma.project.findMany.mockResolvedValue([projectRow({ assignments: [{ role: "pm" }] })]);
    mockPrisma.rfi.findMany.mockResolvedValue([rfiRow()]);
    mockPrisma.projectUserPermission = { findMany: jest.fn(async () => [{ projectId: "project-1", templateId: "tpl-no-rfi-a", overridesJson: {} }]) };
    mockPrisma.permissionTemplate = { findFirst: jest.fn(async ({ where }) => template(where.id)) };
    const denied = await searchService.globalSearch({ orgId: "org-1", userId: "user-1", role: "pm", query: { q: "slab", type: "rfi" } });
    expect(denied.items.filter((row) => row.type === "rfi")).toHaveLength(0);
    expect(mockPrisma.rfi.findMany).not.toHaveBeenCalled();
    expect(mockPrisma.projectUserPermission.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ userId: "user-1", projectId: { in: ["project-1"] } }) }));

    // through a party's template, when no member template is set
    mockPrisma.projectUserPermission.findMany.mockResolvedValue([]);
    mockPrisma.projectParty = { findMany: jest.fn(async () => [{ id: "party-1", projectId: "project-1", permissionTemplateId: "tpl-no-rfi-b" }]) };
    mockPrisma.project.findMany.mockResolvedValue([projectRow({ parties: [projectParty()] })]);
    const deniedByParty = await searchService.globalSearch({ orgId: "org-1", userId: "user-1", role: "site_engineer", query: { q: "slab", type: "rfi" } });
    expect(deniedByParty.items.filter((row) => row.type === "rfi")).toHaveLength(0);
    expect(mockPrisma.projectParty.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ id: { in: ["party-1"] }, status: "active" }) }));
    delete mockPrisma.projectParty;

    // and without a template the role's policy answers as before
    mockPrisma.project.findMany.mockResolvedValue([projectRow({ assignments: [{ role: "pm" }] })]);
    const allowed = await searchService.globalSearch({ orgId: "org-1", userId: "user-1", role: "pm", query: { q: "slab", type: "rfi" } });
    expect(allowed.items.filter((row) => row.type === "rfi")).toHaveLength(1);
  });
});
