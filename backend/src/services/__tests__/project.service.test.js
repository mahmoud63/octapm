const mockPrisma = {
  $transaction: jest.fn((fn) => fn(mockPrisma)),
  project: {
    create: jest.fn(),
    findFirst: jest.fn(),
    findMany: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  },
};
const mockAuditService = {
  ACTIONS: { ARCHIVED: "archived" },
  ENTITY_TYPES: { PROJECT: "project" },
  recordEvent: jest.fn(),
};
const mockCompanyPartyService = {
  sanitizeProjectParty: jest.fn((party) => party),
  syncProjectParties: jest.fn(),
};

jest.mock("../../config/db", () => ({ prisma: mockPrisma }));
jest.mock("../audit.service", () => mockAuditService);
jest.mock("../company-party.service", () => mockCompanyPartyService);

const projectService = require("../project.service");

const now = new Date("2026-06-08T00:00:00.000Z");

const buildProject = (overrides = {}) => ({
  id: "project-1",
  orgId: "org-1",
  name: "Tower A",
  type: null,
  location: null,
  startDate: null,
  endDate: null,
  completionDate: null,
  dataDate: null,
  duration: null,
  durationUnit: "months",
  contractValue: null,
  ldRatePerDay: 0,
  weatherAllowanceDays: 20,
  currency: "USD",
  status: "active",
  archivedAt: null,
  archivedBy: null,
  createdAt: now,
  updatedAt: now,
  ...overrides,
});

describe("project service contract metadata", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("creates projects with contract metadata and defaults", async () => {
    let createdProject;
    mockPrisma.project.create.mockImplementation(({ data }) =>
      Promise.resolve(
        (createdProject = buildProject({
          ...data,
          id: "project-1",
          createdAt: now,
          updatedAt: now,
        })),
      ),
    );
    mockPrisma.project.findFirst.mockImplementation(() =>
      Promise.resolve(createdProject),
    );

    const result = await projectService.createProject({
      orgId: "org-1",
      // The creator may read the project's commercial terms (ipc:read).
      commercialAccessFor: async () => true,
      payload: {
        name: "Tower A",
        clientName: "Client Co",
        consultantName: "Consultant Co",
        contractorName: "Main Contractor",
        contractType: "lump_sum",
        contractNumber: "CON-2026-001",
        startDate: "2026-01-01",
        endDate: "2026-12-31",
        completionDate: "2026-12-31",
        baselineDate: "2026-01-15",
        dataDate: "2026-06-30",
        revisedCompletionDate: "2027-01-15",
        defaultRetentionRate: 7.5,
        ldRatePerDay: 1500,
        weatherAllowanceDays: 30,
        projectCalendar: "six_day",
        reportingCutoffDay: 20,
      },
    });

    expect(mockPrisma.project.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        orgId: "org-1",
        clientName: "Client Co",
        consultantName: "Consultant Co",
        contractorName: "Main Contractor",
        contractType: "lump_sum",
        contractNumber: "CON-2026-001",
        completionDate: new Date("2026-12-31"),
        baselineDate: new Date("2026-01-15"),
        dataDate: new Date("2026-06-30"),
        revisedCompletionDate: new Date("2027-01-15"),
        defaultRetentionRate: 7.5,
        ldRatePerDay: 1500,
        weatherAllowanceDays: 30,
        projectCalendar: "six_day",
        reportingCutoffDay: 20,
      }),
    });
    expect(mockCompanyPartyService.syncProjectParties).toHaveBeenCalledWith({
      tx: mockPrisma,
      orgId: "org-1",
      projectId: "project-1",
      parties: [
        { role: "owner", companyName: "Client Co" },
        { role: "consultant", companyName: "Consultant Co" },
        { role: "contractor", companyName: "Main Contractor" },
      ],
    });
    expect(result).toMatchObject({
      clientName: "Client Co",
      dataDate: new Date("2026-06-30"),
      defaultRetentionRate: 7.5,
      reportingCutoffDay: 20,
      ldRatePerDay: 1500,
      weatherAllowanceDays: 30,
    });
  });

  it("assigns the project creator as a project member", async () => {
    let createdProject;
    mockPrisma.project.create.mockImplementation(({ data }) =>
      Promise.resolve(
        (createdProject = buildProject({
          ...data,
          id: "project-1",
          createdAt: now,
          updatedAt: now,
        })),
      ),
    );
    mockPrisma.project.findFirst.mockImplementation(() =>
      Promise.resolve(createdProject),
    );

    await projectService.createProject({
      orgId: "org-1",
      userId: "planner-1",
      role: "planning_eng",
      payload: {
        name: "Tower A",
      },
    });

    expect(mockPrisma.project.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        orgId: "org-1",
        name: "Tower A",
        assignments: {
          create: {
            userId: "planner-1",
            role: "planning_eng",
          },
        },
      }),
    });
  });

  it("scopes project lists to assigned projects for non-PM users", async () => {
    mockPrisma.project.findMany.mockResolvedValue([buildProject()]);

    const result = await projectService.listProjects({
      orgId: "org-1",
      userId: "site-1",
      role: "site_engineer",
      query: { limit: 20 },
    });

    expect(mockPrisma.project.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          orgId: "org-1",
          archivedAt: null,
          OR: expect.arrayContaining([
            {
              assignments: {
                some: {
                  userId: "site-1",
                },
              },
            },
            {
              parties: {
                some: {
                  status: "active",
                  members: {
                    some: {
                      userId: "site-1",
                      status: "active",
                    },
                  },
                },
              },
            },
          ]),
        }),
      }),
    );
    expect(result.items).toHaveLength(1);
  });

  it("returns 403 when a scoped user requests an unassigned project", async () => {
    mockPrisma.project.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(buildProject());

    await expect(
      projectService.getProjectById({
        orgId: "org-1",
        projectId: "project-1",
        userId: "site-1",
        role: "site_engineer",
      }),
    ).rejects.toMatchObject({
      status: 403,
      code: "PROJECT_ACCESS_DENIED",
    });
  });

  it("archives projects instead of hard deleting them", async () => {
    const existing = buildProject();
    mockPrisma.project.findFirst.mockResolvedValue(existing);
    mockPrisma.project.update.mockImplementation(({ data }) =>
      Promise.resolve({
        ...existing,
        ...data,
      }),
    );

    const result = await projectService.deleteProject({
      orgId: "org-1",
      projectId: "project-1",
      userId: "pm-1",
      role: "pm",
    });

    expect(mockPrisma.project.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "project-1" },
        data: expect.objectContaining({
          status: "archived",
          archivedAt: expect.any(Date),
          archivedBy: "pm-1",
        }),
      }),
    );
    expect(mockPrisma.project.delete).not.toHaveBeenCalled();
    expect(mockAuditService.recordEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        entityType: "project",
        entityId: "project-1",
        action: "archived",
        actorId: "pm-1",
        oldStatus: "active",
        newStatus: "archived",
      }),
    );
    expect(result).toMatchObject({
      id: "project-1",
      archived: true,
      deleted: false,
      status: "archived",
    });
  });

  it("exposes a canonical effective project role from the user assignment", async () => {
    mockPrisma.project.findFirst.mockResolvedValue(
      buildProject({
        assignments: [{ role: "Project Manager" }],
      }),
    );

    const result = await projectService.getProjectById({
      orgId: "org-1",
      projectId: "project-1",
      userId: "site-1",
      role: "site_engineer",
    });

    expect(mockPrisma.project.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        include: expect.objectContaining({
          assignments: {
            where: { userId: "site-1" },
            select: { role: true },
            take: 1,
          },
          parties: expect.any(Object),
        }),
      }),
    );
    expect(result.projectAccess).toMatchObject({
      role: "pm",
      effectiveRole: "pm",
      assignmentRole: "pm",
      orgRole: "site_engineer",
    });
    expect(result.effectiveRole).toBe("pm");
  });

  it("exposes scoped project-party access when no assignment exists", async () => {
    mockPrisma.project.findFirst.mockResolvedValue(
      buildProject({
        assignments: [],
        parties: [
          {
            id: "party-1",
            companyId: "company-1",
            role: "consultant",
            accessLevel: "reviewer",
            permissionProfile: "default_consultant",
            company: { id: "company-1", name: "Consultant Co" },
            members: [{ role: "member" }],
          },
        ],
      }),
    );

    const result = await projectService.getProjectById({
      orgId: "org-1",
      projectId: "project-1",
      userId: "consultant-1",
      role: "finance",
    });

    expect(result.projectAccess).toMatchObject({
      role: "external_party",
      effectiveRole: "external_party",
      assignmentRole: null,
      orgRole: "finance",
      scope: "party",
      partyRole: "consultant",
      partyAccess: [
        expect.objectContaining({
          projectPartyId: "party-1",
          companyId: "company-1",
          companyName: "Consultant Co",
          role: "consultant",
        }),
      ],
    });
    expect(result.effectiveRole).toBe("external_party");
  });

  it("returns defaults for existing projects without new nullable fields", async () => {
    mockPrisma.project.findFirst.mockResolvedValue(
      buildProject({
        clientName: undefined,
        defaultRetentionRate: undefined,
        reportingCutoffDay: undefined,
        projectCalendar: undefined,
      }),
    );

    const result = await projectService.getProjectById({
      orgId: "org-1",
      projectId: "project-1",
      userId: "pm-1",
      role: "pm",
      commercialAccessFor: async () => true,
    });

    expect(result).toMatchObject({
      clientName: null,
      defaultRetentionRate: 5,
      reportingCutoffDay: 25,
      projectCalendar: null,
    });
  });

  it("rejects revised completion before project start", async () => {
    mockPrisma.project.findFirst.mockResolvedValue(
      buildProject({
        startDate: new Date("2026-01-01"),
        endDate: new Date("2026-12-31"),
      }),
    );

    await expect(
      projectService.updateProject({
        orgId: "org-1",
        projectId: "project-1",
        userId: "pm-1",
        role: "pm",
        payload: { revisedCompletionDate: "2025-12-31" },
      }),
    ).rejects.toMatchObject({ code: "INVALID_DATES" });

    expect(mockPrisma.project.update).not.toHaveBeenCalled();
  });

  it("normalizes blank optional metadata to null on update", async () => {
    const existing = buildProject({
      clientName: "Old Client",
      revisedCompletionDate: new Date("2027-01-15"),
      defaultRetentionRate: 7.5,
      startDate: new Date("2026-01-01"),
      endDate: new Date("2026-12-31"),
    });

    const updatedProject = buildProject({
      ...existing,
      clientName: null,
      revisedCompletionDate: null,
      defaultRetentionRate: null,
    });
    mockPrisma.project.findFirst
      .mockResolvedValueOnce(existing)
      .mockResolvedValueOnce(updatedProject);
    mockPrisma.project.update.mockResolvedValue(updatedProject);

    const result = await projectService.updateProject({
      orgId: "org-1",
      projectId: "project-1",
      userId: "pm-1",
      role: "pm",
      commercialAccessFor: async () => true,
      payload: {
        clientName: "",
        dataDate: null,
        revisedCompletionDate: null,
        defaultRetentionRate: null,
      },
    });

    expect(mockPrisma.project.update).toHaveBeenCalledWith({
      where: { id: "project-1" },
      data: {
        clientName: null,
        dataDate: null,
        revisedCompletionDate: null,
        defaultRetentionRate: null,
      },
    });
    expect(result).toMatchObject({
      clientName: null,
      revisedCompletionDate: null,
      defaultRetentionRate: 5,
    });
  });
});

describe("certification L25 — the project's commercial terms follow ipc:read", () => {
  const priced = (overrides = {}) =>
    buildProject({
      contractValue: 78800000,
      ldRatePerDay: 39400,
      defaultRetentionRate: 7.5,
      ...overrides,
    });
  const WITHHELD = {
    contractValue: null,
    ldRatePerDay: null,
    defaultRetentionRate: null,
    commercialTermsWithheld: true,
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("withholds the terms from a caller who may not read them, and when nobody said", async () => {
    mockPrisma.project.findFirst.mockResolvedValue(priced());
    const refused = await projectService.getProjectById({
      orgId: "org-1",
      projectId: "project-1",
      userId: "guest-1",
      role: "site_engineer",
      commercialAccessFor: async () => false,
    });
    expect(refused).toMatchObject({ ...WITHHELD, name: "Tower A", currency: "USD" });

    const unsaid = await projectService.getProjectById({
      orgId: "org-1",
      projectId: "project-1",
      userId: "guest-1",
      role: "site_engineer",
    });
    expect(unsaid).toMatchObject(WITHHELD);

    const allowed = await projectService.getProjectById({
      orgId: "org-1",
      projectId: "project-1",
      userId: "pm-1",
      role: "pm",
      commercialAccessFor: async (projectId) => projectId === "project-1",
    });
    expect(allowed).toMatchObject({
      contractValue: 78800000,
      ldRatePerDay: 39400,
      defaultRetentionRate: 7.5,
      commercialTermsWithheld: false,
    });
  });

  it("decides the list per project", async () => {
    mockPrisma.project.findMany.mockResolvedValue([
      priced({ id: "project-1" }),
      priced({ id: "project-2", contractValue: 1000 }),
    ]);
    const decide = jest.fn(async (projectId) => projectId === "project-2");

    const result = await projectService.listProjects({
      orgId: "org-1",
      userId: "qs-1",
      role: "qs",
      query: { limit: 20 },
      commercialAccessFor: decide,
    });

    expect(decide).toHaveBeenCalledWith("project-1");
    expect(decide).toHaveBeenCalledWith("project-2");
    expect(result.items[0]).toMatchObject({ id: "project-1", ...WITHHELD });
    expect(result.items[1]).toMatchObject({
      id: "project-2",
      contractValue: 1000,
      commercialTermsWithheld: false,
    });
  });

  it("an edit by a caller the terms are withheld from leaves them as they stand", async () => {
    const existing = priced();
    mockPrisma.project.findFirst.mockResolvedValue(existing);
    mockPrisma.project.update.mockResolvedValue(existing);

    const result = await projectService.updateProject({
      orgId: "org-1",
      projectId: "project-1",
      userId: "planner-1",
      role: "planning_eng",
      commercialAccessFor: async () => false,
      payload: {
        name: "Tower A (renamed)",
        contractValue: 1,
        ldRatePerDay: 0,
        defaultRetentionRate: 5,
      },
    });

    expect(mockPrisma.project.update).toHaveBeenCalledWith({
      where: { id: "project-1" },
      data: { name: "Tower A (renamed)" },
    });
    expect(result).toMatchObject(WITHHELD);

    mockPrisma.project.update.mockClear();
    await expect(
      projectService.updateProject({
        orgId: "org-1",
        projectId: "project-1",
        userId: "planner-1",
        role: "planning_eng",
        commercialAccessFor: async () => false,
        payload: { ldRatePerDay: 0 },
      }),
    ).rejects.toMatchObject({ status: 400, code: "NO_UPDATES" });
    expect(mockPrisma.project.update).not.toHaveBeenCalled();
  });

  it("an edit by a caller who may read the terms changes them", async () => {
    const existing = priced();
    mockPrisma.project.findFirst.mockResolvedValue(existing);
    mockPrisma.project.update.mockResolvedValue(existing);

    await projectService.updateProject({
      orgId: "org-1",
      projectId: "project-1",
      userId: "pm-1",
      role: "pm",
      commercialAccessFor: async () => true,
      payload: { ldRatePerDay: 40000 },
    });

    expect(mockPrisma.project.update).toHaveBeenCalledWith({
      where: { id: "project-1" },
      data: { ldRatePerDay: 40000 },
    });
  });

  it("the workspace dashboard states a contract value, and the total, only where the terms may be read", async () => {
    mockPrisma.project.findMany.mockResolvedValue([
      { id: "project-1", contractValue: 100 },
      { id: "project-2", contractValue: 250 },
    ]);
    const dashboard = {
      summary: { totalProjects: 2, totalContractValue: 350 },
      projectHealth: [
        { id: "project-1", contractValue: 100, overallScore: 70 },
        { id: "project-2", contractValue: 250, overallScore: 80 },
      ],
    };
    const call = (decide) =>
      projectService.withheldDashboardContractValues({
        dashboard,
        orgId: "org-1",
        userId: "u-1",
        role: "qs",
        commercialAccessFor: decide,
      });

    const partly = await call(async (projectId) => projectId === "project-2");
    expect(partly.projectHealth[0]).toEqual({
      id: "project-1",
      contractValue: null,
      contractValueWithheld: true,
      overallScore: 70,
    });
    expect(partly.projectHealth[1]).toEqual(dashboard.projectHealth[1]);
    expect(partly.summary).toEqual({
      totalProjects: 2,
      totalContractValue: 250,
      totalContractValueWithheld: true,
    });

    const none = await call(async () => false);
    expect(none.summary.totalContractValue).toBeNull();
    expect(none.projectHealth.every((row) => row.contractValue === null)).toBe(true);

    expect(await call(async () => true)).toBe(dashboard);
    expect(mockPrisma.project.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ orgId: "org-1", archivedAt: null }),
      }),
    );
  });
});
