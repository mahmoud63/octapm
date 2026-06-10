const mockPrisma = {
  project: {
    create: jest.fn(),
    findFirst: jest.fn(),
    findMany: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  },
};

jest.mock('../../config/db', () => ({ prisma: mockPrisma }));

const projectService = require('../project.service');

const now = new Date('2026-06-08T00:00:00.000Z');

const buildProject = (overrides = {}) => ({
  id: 'project-1',
  orgId: 'org-1',
  name: 'Tower A',
  type: null,
  location: null,
  startDate: null,
  endDate: null,
  completionDate: null,
  duration: null,
  durationUnit: 'months',
  contractValue: null,
  ldRatePerDay: 0,
  weatherAllowanceDays: 20,
  currency: 'USD',
  status: 'active',
  createdAt: now,
  updatedAt: now,
  ...overrides,
});

describe('project service contract metadata', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('creates projects with contract metadata and defaults', async () => {
    mockPrisma.project.create.mockImplementation(({ data }) =>
      Promise.resolve(
        buildProject({
          ...data,
          id: 'project-1',
          createdAt: now,
          updatedAt: now,
        }),
      ),
    );

    const result = await projectService.createProject({
      orgId: 'org-1',
      payload: {
        name: 'Tower A',
        clientName: 'Client Co',
        consultantName: 'Consultant Co',
        contractorName: 'Main Contractor',
        contractType: 'lump_sum',
        contractNumber: 'CON-2026-001',
        startDate: '2026-01-01',
        endDate: '2026-12-31',
        completionDate: '2026-12-31',
        baselineDate: '2026-01-15',
        revisedCompletionDate: '2027-01-15',
        defaultRetentionRate: 7.5,
        ldRatePerDay: 1500,
        weatherAllowanceDays: 30,
        projectCalendar: 'six_day',
        reportingCutoffDay: 20,
      },
    });

    expect(mockPrisma.project.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        orgId: 'org-1',
        clientName: 'Client Co',
        consultantName: 'Consultant Co',
        contractorName: 'Main Contractor',
        contractType: 'lump_sum',
        contractNumber: 'CON-2026-001',
        completionDate: new Date('2026-12-31'),
        baselineDate: new Date('2026-01-15'),
        revisedCompletionDate: new Date('2027-01-15'),
        defaultRetentionRate: 7.5,
        ldRatePerDay: 1500,
        weatherAllowanceDays: 30,
        projectCalendar: 'six_day',
        reportingCutoffDay: 20,
      }),
    });
    expect(result).toMatchObject({
      clientName: 'Client Co',
      defaultRetentionRate: 7.5,
      reportingCutoffDay: 20,
      ldRatePerDay: 1500,
      weatherAllowanceDays: 30,
    });
  });

  it('assigns the project creator as a project member', async () => {
    mockPrisma.project.create.mockImplementation(({ data }) =>
      Promise.resolve(
        buildProject({
          ...data,
          id: 'project-1',
          createdAt: now,
          updatedAt: now,
        }),
      ),
    );

    await projectService.createProject({
      orgId: 'org-1',
      userId: 'planner-1',
      role: 'planning_eng',
      payload: {
        name: 'Tower A',
      },
    });

    expect(mockPrisma.project.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        orgId: 'org-1',
        name: 'Tower A',
        assignments: {
          create: {
            userId: 'planner-1',
            role: 'planning_eng',
          },
        },
      }),
    });
  });

  it('scopes project lists to assigned projects for non-PM users', async () => {
    mockPrisma.project.findMany.mockResolvedValue([buildProject()]);

    const result = await projectService.listProjects({
      orgId: 'org-1',
      userId: 'site-1',
      role: 'site_engineer',
      query: { limit: 20 },
    });

    expect(mockPrisma.project.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          orgId: 'org-1',
          assignments: {
            some: {
              userId: 'site-1',
            },
          },
        },
      }),
    );
    expect(result.items).toHaveLength(1);
  });

  it('returns 403 when a scoped user requests an unassigned project', async () => {
    mockPrisma.project.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(buildProject());

    await expect(
      projectService.getProjectById({
        orgId: 'org-1',
        projectId: 'project-1',
        userId: 'site-1',
        role: 'site_engineer',
      }),
    ).rejects.toMatchObject({
      status: 403,
      code: 'PROJECT_ACCESS_DENIED',
    });
  });

  it('returns defaults for existing projects without new nullable fields', async () => {
    mockPrisma.project.findFirst.mockResolvedValue(
      buildProject({
        clientName: undefined,
        defaultRetentionRate: undefined,
        reportingCutoffDay: undefined,
        projectCalendar: undefined,
      }),
    );

    const result = await projectService.getProjectById({
      orgId: 'org-1',
      projectId: 'project-1',
      userId: 'pm-1',
      role: 'pm',
    });

    expect(result).toMatchObject({
      clientName: null,
      defaultRetentionRate: 5,
      reportingCutoffDay: 25,
      projectCalendar: null,
    });
  });

  it('rejects revised completion before project start', async () => {
    mockPrisma.project.findFirst.mockResolvedValue(
      buildProject({
        startDate: new Date('2026-01-01'),
        endDate: new Date('2026-12-31'),
      }),
    );

    await expect(
      projectService.updateProject({
        orgId: 'org-1',
        projectId: 'project-1',
        userId: 'pm-1',
        role: 'pm',
        payload: { revisedCompletionDate: '2025-12-31' },
      }),
    ).rejects.toMatchObject({ code: 'INVALID_DATES' });

    expect(mockPrisma.project.update).not.toHaveBeenCalled();
  });

  it('normalizes blank optional metadata to null on update', async () => {
    const existing = buildProject({
      clientName: 'Old Client',
      revisedCompletionDate: new Date('2027-01-15'),
      defaultRetentionRate: 7.5,
      startDate: new Date('2026-01-01'),
      endDate: new Date('2026-12-31'),
    });

    mockPrisma.project.findFirst.mockResolvedValue(existing);
    mockPrisma.project.update.mockResolvedValue(
      buildProject({
        ...existing,
        clientName: null,
        revisedCompletionDate: null,
        defaultRetentionRate: null,
      }),
    );

    const result = await projectService.updateProject({
      orgId: 'org-1',
      projectId: 'project-1',
      userId: 'pm-1',
      role: 'pm',
      payload: {
        clientName: '',
        revisedCompletionDate: null,
        defaultRetentionRate: null,
      },
    });

    expect(mockPrisma.project.update).toHaveBeenCalledWith({
      where: { id: 'project-1' },
      data: {
        clientName: null,
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
