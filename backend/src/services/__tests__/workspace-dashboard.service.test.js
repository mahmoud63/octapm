const mockPrisma = {
  project: { findMany: jest.fn() },
  activity: { findMany: jest.fn() },
  scheduleRevision: { count: jest.fn(), findMany: jest.fn() },
  progressSubmission: { count: jest.fn(), findMany: jest.fn() },
  dailyReport: { count: jest.fn() },
  siteDiary: { count: jest.fn() },
  ipcCertificate: { count: jest.fn(), findMany: jest.fn() },
  ipcItem: { count: jest.fn(), findMany: jest.fn() },
  procurementOrder: { findMany: jest.fn() },
  longLeadItem: { findMany: jest.fn() },
  ncrRecord: { findMany: jest.fn() },
  itpRecord: { findMany: jest.fn() },
  safetyIncident: { findMany: jest.fn() },
  rfi: { findMany: jest.fn() },
  submittal: { findMany: jest.fn() },
  changeOrder: { findMany: jest.fn() },
};

const mockBuildOfficialEvReport = jest.fn();

jest.mock('../../config/db', () => ({ prisma: mockPrisma }));
jest.mock('../earned-value.service', () => ({
  buildOfficialEvReport: mockBuildOfficialEvReport,
}));

const workspaceDashboardService = require('../workspace-dashboard.service');

const project = {
  id: 'project-1',
  name: 'Crescent Tower',
  status: 'active',
  startDate: new Date('2019-01-01T00:00:00.000Z'),
  endDate: new Date('2020-01-01T00:00:00.000Z'),
  contractValue: 25000000,
  currency: 'USD',
  updatedAt: new Date('2020-01-02T00:00:00.000Z'),
};

describe('workspace dashboard service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPrisma.project.findMany.mockResolvedValue([project]);
    mockPrisma.activity.findMany.mockResolvedValue([
      {
        id: 'activity-1',
        projectId: project.id,
        name: 'Foundations',
        wbsCode: 'A1000',
        earlyFinish: 5,
        endDate: null,
        isCritical: true,
        isMilestone: false,
        progress: [{ pctComplete: 40 }],
      },
    ]);
    mockPrisma.scheduleRevision.count.mockResolvedValue(1);
    mockPrisma.scheduleRevision.findMany.mockResolvedValue([
      {
        id: 'revision-1',
        projectId: project.id,
        label: 'Baseline Rev A',
        activityCount: 22,
        submittedAt: new Date('2020-01-02T00:00:00.000Z'),
        createdAt: new Date('2020-01-01T00:00:00.000Z'),
        project: { name: project.name },
      },
    ]);
    mockPrisma.progressSubmission.count.mockResolvedValue(2);
    mockPrisma.progressSubmission.findMany.mockResolvedValue([
      {
        id: 'progress-1',
        projectId: project.id,
        pctComplete: 62,
        submittedAt: new Date('2020-01-03T00:00:00.000Z'),
        activity: { name: 'Foundations', wbsCode: 'A1000' },
        project: { name: project.name },
      },
    ]);
    mockPrisma.dailyReport.count.mockResolvedValue(1);
    mockPrisma.siteDiary.count.mockResolvedValue(0);
    mockPrisma.ipcCertificate.count.mockResolvedValue(1);
    mockPrisma.ipcItem.count.mockResolvedValue(1);
    mockPrisma.ipcCertificate.findMany.mockResolvedValue([
      {
        id: 'ipc-cert-1',
        projectId: project.id,
        period: 'IPC-01',
        totalCert: 100000,
        netPayable: 95000,
        submittedAt: new Date('2020-01-04T00:00:00.000Z'),
        project: { name: project.name, currency: project.currency },
      },
    ]);
    mockPrisma.ipcItem.findMany.mockResolvedValue([]);
    mockPrisma.procurementOrder.findMany.mockResolvedValue([
      {
        id: 'po-1',
        projectId: project.id,
        activityId: 'activity-1',
        ref: 'PO-001',
        item: 'Tower crane',
        status: 'planned',
        leadWeeks: 12,
        requiredTiming: 'activity_start',
        needOffsetDays: 0,
        bufferDays: 14,
        deliveryDate: null,
        warehouseStatus: 'not_received',
        activity: {
          id: 'activity-1',
          name: 'Foundations',
          wbsCode: 'A1000',
          startDate: null,
          endDate: null,
          earlyStart: 30,
          earlyFinish: 60,
          baselineStart: null,
          baselineFinish: null,
          lateStart: null,
          lateFinish: null,
          isCritical: true,
          totalFloat: 0,
        },
      },
    ]);
    mockPrisma.longLeadItem.findMany.mockResolvedValue([]);
    mockPrisma.ncrRecord.findMany.mockResolvedValue([
      {
        id: 'ncr-1',
        projectId: project.id,
        ref: 'NCR-001',
        severity: 'major',
        description: 'Concrete cube failure',
        status: 'open',
        dueDate: new Date('2020-01-01T00:00:00.000Z'),
        project: { name: project.name },
      },
    ]);
    mockPrisma.itpRecord.findMany.mockResolvedValue([
      {
        id: 'itp-1',
        projectId: project.id,
        status: 'failed',
        dueDate: new Date('2020-01-01T00:00:00.000Z'),
      },
    ]);
    mockPrisma.safetyIncident.findMany.mockResolvedValue([]);
    mockPrisma.rfi.findMany.mockResolvedValue([
      {
        id: 'rfi-1',
        projectId: project.id,
        ref: 'RFI-001',
        subject: 'Clarify slab opening',
        status: 'open',
        dueDate: new Date('2020-01-01T00:00:00.000Z'),
        responseRequiredBy: null,
        project: { name: project.name },
      },
    ]);
    mockPrisma.submittal.findMany.mockResolvedValue([
      {
        id: 'submittal-1',
        projectId: project.id,
        status: 'under_review',
        dueDate: new Date('2020-01-01T00:00:00.000Z'),
      },
    ]);
    mockPrisma.changeOrder.findMany.mockResolvedValue([
      { id: 'co-1', projectId: project.id },
    ]);
    mockBuildOfficialEvReport.mockResolvedValue({ spi: 0.88, cpi: 0.94 });
  });

  it('returns an empty workspace state when no projects exist', async () => {
    mockPrisma.project.findMany.mockResolvedValueOnce([]);

    const result = await workspaceDashboardService.getWorkspaceDashboard({
      orgId: 'org-1',
      userId: 'pm-1',
      role: 'pm',
    });

    expect(result.summary.totalProjects).toBe(0);
    expect(result.summary.portfolioHealthScore).toBeNull();
    expect(result.emptyState).toEqual(
      expect.objectContaining({ title: 'No projects yet' }),
    );
    expect(mockPrisma.activity.findMany).not.toHaveBeenCalled();
  });

  it('aggregates construction health, workflow queues, and module targets', async () => {
    const result = await workspaceDashboardService.getWorkspaceDashboard({
      orgId: 'org-1',
      userId: 'pm-1',
      role: 'pm',
    });

    expect(result.summary).toEqual(
      expect.objectContaining({
        totalProjects: 1,
        activeProjects: 1,
        delayedActivities: 1,
        criticalActivities: 1,
        approvalQueueCount: 6,
        procurementAtRisk: 1,
        overdueNcrRfi: 2,
      }),
    );
    expect(result.healthDimensions.map((item) => item.key)).toEqual([
      'schedule',
      'cost',
      'commercial',
      'supplyChain',
      'quality',
      'safety',
      'docControl',
    ]);
    expect(result.workflowQueues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: 'scheduleApprovals',
          count: 1,
          defaultTarget: expect.objectContaining({
            module: 'schedule',
            child: 'revisions',
          }),
        }),
        expect.objectContaining({
          key: 'progressApprovals',
          count: 3,
          defaultTarget: expect.objectContaining({
            module: 'schedule',
            child: 'progress',
          }),
        }),
        expect.objectContaining({
          key: 'ipcActions',
          count: 2,
          defaultTarget: expect.objectContaining({
            module: 'commercial',
            child: 'ipc',
          }),
        }),
        expect.objectContaining({
          key: 'procurementRisks',
          count: 1,
          defaultTarget: expect.objectContaining({
            module: 'schedule',
            child: 'longLead',
          }),
        }),
      ]),
    );
    expect(result.projectHealth[0]).toEqual(
      expect.objectContaining({
        id: project.id,
        name: project.name,
        workflowActions: 6,
        procurementRisks: 1,
        overdueNcrRfi: 2,
      }),
    );
  });

  it('scopes non-PM dashboards to assigned projects', async () => {
    mockPrisma.project.findMany.mockResolvedValueOnce([]);

    await workspaceDashboardService.getWorkspaceDashboard({
      orgId: 'org-1',
      userId: 'qs-1',
      role: 'qs',
    });

    expect(mockPrisma.project.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          orgId: 'org-1',
          assignments: {
            some: {
              userId: 'qs-1',
            },
          },
        },
      }),
    );
  });
});
