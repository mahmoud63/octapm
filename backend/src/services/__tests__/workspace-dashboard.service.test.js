const mockPrisma = {
  project: { findMany: jest.fn(), findFirst: jest.fn() },
  activity: { findMany: jest.fn() },
  scheduleRevision: { count: jest.fn(), findMany: jest.fn() },
  progressSubmission: { count: jest.fn(), findMany: jest.fn() },
  dailyReport: { count: jest.fn() },
  siteDiary: { count: jest.fn() },
  ipcCertificate: { count: jest.fn(), findMany: jest.fn() },
  ipcItem: { count: jest.fn(), findMany: jest.fn() },
  procurementOrder: { findMany: jest.fn() },
  procurementPackage: { findMany: jest.fn() },
  procurementPoLine: { findMany: jest.fn() },
  activityMaterial: { findMany: jest.fn() },
  longLeadItem: { findMany: jest.fn() },
  ncrRecord: { findMany: jest.fn() },
  itpRecord: { findMany: jest.fn() },
  safetyIncident: { findMany: jest.fn() },
  rfi: { findMany: jest.fn() },
  submittal: { findMany: jest.fn() },
  changeOrder: { findMany: jest.fn() },
  risk: { findMany: jest.fn() },
  task: { findMany: jest.fn() },
};

const mockBuildOfficialEvReport = jest.fn();

jest.mock("../../config/db", () => ({ prisma: mockPrisma }));
jest.mock("../earned-value.service", () => ({
  buildOfficialEvReport: mockBuildOfficialEvReport,
}));

const workspaceDashboardService = require("../workspace-dashboard.service");

const project = {
  id: "project-1",
  name: "Crescent Tower",
  status: "active",
  startDate: new Date("2019-01-01T00:00:00.000Z"),
  endDate: new Date("2020-01-01T00:00:00.000Z"),
  contractValue: 25000000,
  currency: "USD",
  updatedAt: new Date("2020-01-02T00:00:00.000Z"),
};

describe("workspace dashboard service", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPrisma.project.findMany.mockResolvedValue([project]);
    mockPrisma.activity.findMany.mockResolvedValue([
      {
        id: "activity-1",
        projectId: project.id,
        name: "Foundations",
        wbsCode: "A1000",
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
        id: "revision-1",
        projectId: project.id,
        label: "Baseline Rev A",
        activityCount: 22,
        submittedAt: new Date("2020-01-02T00:00:00.000Z"),
        createdAt: new Date("2020-01-01T00:00:00.000Z"),
        project: { name: project.name },
      },
    ]);
    mockPrisma.progressSubmission.count.mockResolvedValue(2);
    mockPrisma.progressSubmission.findMany.mockResolvedValue([
      {
        id: "progress-1",
        projectId: project.id,
        pctComplete: 62,
        submittedAt: new Date("2020-01-03T00:00:00.000Z"),
        activity: { name: "Foundations", wbsCode: "A1000" },
        project: { name: project.name },
      },
    ]);
    mockPrisma.dailyReport.count.mockResolvedValue(1);
    mockPrisma.siteDiary.count.mockResolvedValue(0);
    mockPrisma.ipcCertificate.count.mockResolvedValue(1);
    mockPrisma.ipcItem.count.mockResolvedValue(1);
    mockPrisma.ipcCertificate.findMany
      .mockResolvedValueOnce([
        {
          id: "ipc-cert-1",
          projectId: project.id,
          period: "IPC-01",
          totalCert: 100000,
          netPayable: 95000,
          submittedAt: new Date("2020-01-04T00:00:00.000Z"),
          project: { name: project.name, currency: project.currency },
        },
      ])
      .mockResolvedValueOnce([
        {
          id: "ipc-pay-1",
          projectId: project.id,
          period: "IPC-00",
          netPayable: 50000,
          balanceDue: 20000,
          paymentStatus: "partially_paid",
          retentionStatus: "held",
          certifiedAt: new Date("2020-01-03T00:00:00.000Z"),
          dueDate: new Date("2020-01-15T00:00:00.000Z"),
          project: { name: project.name, currency: project.currency },
        },
      ]);
    mockPrisma.ipcItem.findMany.mockResolvedValue([]);
    mockPrisma.procurementOrder.findMany.mockResolvedValue([
      {
        id: "po-1",
        projectId: project.id,
        activityId: "activity-1",
        ref: "PO-001",
        item: "Tower crane",
        status: "planned",
        leadWeeks: 12,
        requiredTiming: "activity_start",
        needOffsetDays: 0,
        bufferDays: 14,
        deliveryDate: null,
        warehouseStatus: "not_received",
        activity: {
          id: "activity-1",
          name: "Foundations",
          wbsCode: "A1000",
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
    mockPrisma.procurementPackage.findMany.mockResolvedValue([]);
    mockPrisma.procurementPoLine.findMany.mockResolvedValue([]);
    mockPrisma.activityMaterial.findMany.mockResolvedValue([]);
    mockPrisma.longLeadItem.findMany.mockResolvedValue([]);
    mockPrisma.ncrRecord.findMany.mockResolvedValue([
      {
        id: "ncr-1",
        projectId: project.id,
        ref: "NCR-001",
        severity: "major",
        description: "Concrete cube failure",
        status: "open",
        dueDate: new Date("2020-01-01T00:00:00.000Z"),
        project: { name: project.name },
      },
    ]);
    mockPrisma.itpRecord.findMany.mockResolvedValue([
      {
        id: "itp-1",
        projectId: project.id,
        status: "failed",
        dueDate: new Date("2020-01-01T00:00:00.000Z"),
      },
    ]);
    mockPrisma.safetyIncident.findMany.mockResolvedValue([]);
    mockPrisma.rfi.findMany.mockResolvedValue([
      {
        id: "rfi-1",
        projectId: project.id,
        ref: "RFI-001",
        subject: "Clarify slab opening",
        status: "open",
        dueDate: new Date("2020-01-01T00:00:00.000Z"),
        responseRequiredBy: null,
        project: { name: project.name },
      },
    ]);
    mockPrisma.submittal.findMany.mockResolvedValue([
      {
        id: "submittal-1",
        projectId: project.id,
        ref: "SUB-001",
        title: "Concrete mix design",
        status: "under_review",
        dueDate: new Date("2020-01-01T00:00:00.000Z"),
        project: { name: project.name },
      },
    ]);
    mockPrisma.changeOrder.findMany.mockResolvedValue([
      {
        id: "co-1",
        projectId: project.id,
        ref: "CO-001",
        description: "Added slab opening",
        value: 12500,
        scheduleImpact: 2,
        status: "pending",
        submittedDate: new Date("2020-01-03T00:00:00.000Z"),
        approvedAt: null,
        updatedAt: new Date("2020-01-03T00:00:00.000Z"),
        project: { name: project.name, currency: project.currency },
      },
      {
        id: "co-2",
        projectId: project.id,
        ref: "CO-002",
        description: "Approved finish change",
        value: 5000,
        scheduleImpact: 1,
        status: "approved",
        submittedDate: new Date("2020-01-02T00:00:00.000Z"),
        approvedAt: new Date("2020-01-04T00:00:00.000Z"),
        updatedAt: new Date("2020-01-04T00:00:00.000Z"),
        project: { name: project.name, currency: project.currency },
      },
    ]);
    mockPrisma.risk.findMany.mockResolvedValue([
      {
        id: "risk-1",
        projectId: project.id,
        ref: "RSK-001",
        description: "Utility diversion may delay excavation",
        severity: "high",
        status: "submitted",
        owner: "Planning Engineer",
        dueDate: new Date("2020-01-10T00:00:00.000Z"),
        escalationLevel: 1,
        closeoutSubmittedAt: new Date("2020-01-04T00:00:00.000Z"),
        updatedAt: new Date("2020-01-04T00:00:00.000Z"),
        project: { name: project.name },
        activityLinks: [
          {
            activityId: "activity-1",
            scheduleImpactDays: 5,
            activity: {
              id: "activity-1",
              name: "Foundations",
              activityCode: "A1000",
              wbsCode: "A1000",
            },
          },
        ],
      },
      {
        id: "risk-2",
        projectId: project.id,
        ref: "RSK-002",
        description: "Temporary works review is overdue",
        severity: "medium",
        status: "open",
        owner: "Site Engineer",
        dueDate: new Date("2020-01-01T00:00:00.000Z"),
        escalationLevel: 2,
        closeoutSubmittedAt: null,
        updatedAt: new Date("2020-01-02T00:00:00.000Z"),
        project: { name: project.name },
        activityLinks: [
          {
            activityId: "activity-1",
            scheduleImpactDays: 2,
            activity: {
              id: "activity-1",
              name: "Foundations",
              activityCode: "A1000",
              wbsCode: "A1000",
            },
          },
        ],
      },
    ]);
    mockPrisma.task.findMany.mockResolvedValue([
      {
        id: "task-1",
        projectId: project.id,
        taskNumber: "TSK-0001",
        title: "Close site access action",
        status: "todo",
        priority: "critical",
        dueDate: new Date("2020-01-01T00:00:00.000Z"),
        updatedAt: new Date("2020-01-04T00:00:00.000Z"),
        assignee: { id: "site-1", name: "Site Engineer" },
        activity: { id: "activity-1", name: "Foundations", wbsCode: "A1000" },
        project: { name: project.name },
      },
    ]);
    mockBuildOfficialEvReport.mockResolvedValue({
      spi: 0.88,
      cpi: 0.94,
      reporting: { cutoffDate: "2020-01-31T23:59:59.999Z" },
      sourceSummary: {
        ac: {
          officialActualActivities: 1,
          missingActualActivities: 0,
        },
      },
    });
  });

  it("returns an empty workspace state when no projects exist", async () => {
    mockPrisma.project.findMany.mockResolvedValueOnce([]);

    const result = await workspaceDashboardService.getWorkspaceDashboard({
      orgId: "org-1",
      userId: "pm-1",
      role: "pm",
    });

    expect(result.summary.totalProjects).toBe(0);
    expect(result.summary.portfolioHealthScore).toBeNull();
    expect(result.emptyState).toEqual(
      expect.objectContaining({ title: "No projects yet" }),
    );
    expect(mockPrisma.activity.findMany).not.toHaveBeenCalled();
  });

  it("aggregates construction health, workflow queues, and module targets", async () => {
    const result = await workspaceDashboardService.getWorkspaceDashboard({
      orgId: "org-1",
      userId: "pm-1",
      role: "pm",
    });

    expect(result.summary).toEqual(
      expect.objectContaining({
        totalProjects: 1,
        activeProjects: 1,
        delayedActivities: 1,
        criticalActivities: 1,
        approvalQueueCount: 9,
        procurementAtRisk: 1,
        overdueNcrRfi: 3,
        openTasks: 1,
        overdueTasks: 1,
      }),
    );
    expect(result.dataFreshness).toEqual(
      expect.objectContaining({
        cutoffDate: "2020-01-31T23:59:59.999Z",
      }),
    );
    expect(result.officialKpis).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "portfolioHealth",
          sourceStatus: "approved-or-official",
          cutoffDate: "2020-01-31T23:59:59.999Z",
        }),
        expect.objectContaining({
          key: "costActuals",
          value: 1,
          target: expect.objectContaining({
            module: "cost",
            child: "activity",
            source: "cost_record.actual_through_date",
          }),
        }),
        expect.objectContaining({
          key: "openTasks",
          value: 1,
          detail: "1 overdue persisted tasks",
          target: expect.objectContaining({
            module: "tasks",
            status: "todo",
            source: "task",
          }),
        }),
      ]),
    );
    expect(result.pendingReview).toEqual(
      expect.objectContaining({
        total: 10,
        metrics: expect.arrayContaining([
          expect.objectContaining({
            key: "changeOrders",
            count: 1,
            excludedFromOfficialKpis: true,
            target: expect.objectContaining({
              module: "commercial",
              child: "change-orders",
              status: "pending",
            }),
          }),
          expect.objectContaining({
            key: "riskCloseouts",
            count: 1,
            excludedFromOfficialKpis: true,
            target: expect.objectContaining({
              module: "schedule",
              child: "risks",
              status: "submitted",
              source: "risk",
            }),
          }),
        ]),
      }),
    );
    expect(result.healthDimensions.map((item) => item.key)).toEqual([
      "schedule",
      "cost",
      "commercial",
      "supplyChain",
      "quality",
      "safety",
      "docControl",
    ]);
    expect(result.workflowQueues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "scheduleApprovals",
          count: 1,
          defaultTarget: expect.objectContaining({
            module: "schedule",
            child: "revisions",
          }),
        }),
        expect.objectContaining({
          key: "progressApprovals",
          count: 3,
          defaultTarget: expect.objectContaining({
            module: "schedule",
            child: "progress",
          }),
        }),
        expect.objectContaining({
          key: "ipcActions",
          count: 3,
          defaultTarget: expect.objectContaining({
            module: "commercial",
            child: "ipc",
          }),
        }),
        expect.objectContaining({
          key: "procurementRisks",
          count: 1,
          defaultTarget: expect.objectContaining({
            module: "schedule",
            child: "longLead",
          }),
        }),
        expect.objectContaining({
          key: "pendingChangeOrders",
          count: 1,
          defaultTarget: expect.objectContaining({
            module: "commercial",
            child: "change-orders",
          }),
        }),
        expect.objectContaining({
          key: "riskCloseouts",
          count: 1,
          defaultTarget: expect.objectContaining({
            module: "schedule",
            child: "risks",
            source: "risk",
            status: "submitted",
          }),
        }),
        expect.objectContaining({
          key: "overdueRiskMitigations",
          count: 1,
          defaultTarget: expect.objectContaining({
            module: "schedule",
            child: "risks",
            source: "risk",
            status: "overdue",
          }),
        }),
        expect.objectContaining({
          key: "overdueTasks",
          count: 1,
          defaultTarget: expect.objectContaining({
            module: "tasks",
          }),
        }),
        expect.objectContaining({
          key: "overdueSubmittals",
          count: 1,
          defaultTarget: expect.objectContaining({
            module: "docControl",
            child: "submittals",
          }),
        }),
      ]),
    );
    expect(result.projectHealth[0]).toEqual(
      expect.objectContaining({
        id: project.id,
        name: project.name,
        workflowActions: 12,
        riskMitigations: 2,
        procurementRisks: 1,
        pendingChangeOrders: 1,
        overdueNcrRfi: 3,
        openTasks: 1,
        overdueTasks: 1,
      }),
    );
  });

  it("scopes non-PM dashboards to assigned projects", async () => {
    mockPrisma.project.findMany.mockResolvedValueOnce([]);

    await workspaceDashboardService.getWorkspaceDashboard({
      orgId: "org-1",
      userId: "qs-1",
      role: "qs",
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
                  userId: "qs-1",
                },
              },
            },
            {
              parties: {
                some: {
                  status: "active",
                  members: {
                    some: {
                      userId: "qs-1",
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
  });

  // Certification R7: the overdue RFI and submittal queues hold what the
  // caller's own registers hold — party routing where they reach a project
  // through a party, an RFI draft only to its author and manager.
  // Certification N3: every queue is also kept to the projects where the
  // caller may read its module; with no module reader, that is every project.
  const inModuleProjects = (where, ids) => ({ AND: [where, { projectId: { in: ids } }] });

  it("lists RFIs and submittals as each project's registers list them to the caller", async () => {
    const PARTY_DRAFT = { OR: [{ status: { not: "draft" } }, { createdBy: "se-1" }, { managerUserId: "se-1" }] };
    const routedTo = (ids) => ({ OR: [{ ownerPartyId: { in: ids } }, { reviewerPartyId: { in: ids } }, { approverPartyId: { in: ids } }] });
    mockPrisma.project.findMany.mockResolvedValueOnce([project, { ...project, id: "project-2", name: "Harbour Works" }]);
    // project-1 through a party only, project-2 by assignment
    mockPrisma.project.findFirst.mockImplementation(async ({ where }) =>
      where.id === "project-1"
        ? { id: "project-1", orgId: "org-1", assignments: [], parties: [{ id: "pp-1", companyId: "co-1", role: "subcontractor", accessLevel: "collaborator", company: { id: "co-1", name: "Sub X", status: "active" }, members: [{ id: "m-1", role: "member", status: "active" }] }] }
        : { id: "project-2", orgId: "org-1", assignments: [{ role: "site_engineer" }], parties: [] },
    );

    await workspaceDashboardService.getWorkspaceDashboard({ orgId: "org-1", userId: "se-1", role: "site_engineer" });

    expect(mockPrisma.rfi.findMany.mock.calls[0][0].where).toEqual(inModuleProjects({
      AND: [
        { archivedAt: null, OR: [{ projectId: { in: ["project-2"] } }, { projectId: "project-1", AND: [routedTo(["pp-1"])] }] },
        PARTY_DRAFT,
      ],
    }, ["project-1", "project-2"]));
    expect(mockPrisma.submittal.findMany.mock.calls[0][0].where).toEqual(inModuleProjects({
      archivedAt: null,
      OR: [{ projectId: { in: ["project-2"] } }, { projectId: "project-1", AND: [routedTo(["pp-1"])] }],
    }, ["project-1", "project-2"]));
  });

  it("keeps a PM's queues to the projects' records, with RFI drafts only their own, and a company-wide read unfiltered", async () => {
    await workspaceDashboardService.getWorkspaceDashboard({ orgId: "org-1", userId: "pm-1", role: "pm" });
    expect(mockPrisma.project.findFirst).not.toHaveBeenCalled();
    expect(mockPrisma.rfi.findMany.mock.calls[0][0].where).toEqual(inModuleProjects({
      AND: [
        { archivedAt: null, OR: [{ projectId: { in: ["project-1"] } }] },
        { OR: [{ status: { not: "draft" } }, { createdBy: "pm-1" }, { managerUserId: "pm-1" }] },
      ],
    }, ["project-1"]));
    expect(mockPrisma.submittal.findMany.mock.calls[0][0].where).toEqual(inModuleProjects({ archivedAt: null, OR: [{ projectId: { in: ["project-1"] } }] }, ["project-1"]));

    jest.clearAllMocks();
    mockPrisma.project.findMany.mockResolvedValueOnce([project]);
    await workspaceDashboardService.getWorkspaceDashboard({ orgId: "org-1", userId: null, role: "pm", isCompanyAdmin: true, allProjects: true });
    expect(mockPrisma.rfi.findMany.mock.calls[0][0].where).toEqual(inModuleProjects({ projectId: { in: ["project-1"] }, archivedAt: null }, ["project-1"]));
    expect(mockPrisma.submittal.findMany.mock.calls[0][0].where).toEqual(inModuleProjects({ projectId: { in: ["project-1"] }, archivedAt: null }, ["project-1"]));
  });

  it("keeps every other queue to the projects where the caller may read its module, and tasks to the task list's rule (N3)", async () => {
    mockPrisma.project.findMany.mockResolvedValueOnce([project, { ...project, id: "project-2", name: "Harbour Works" }]);
    // project-1: a party guest who reads the schedule and progress only and sees only their own tasks;
    // project-2: a member who reads every module and every task.
    const moduleAccessFor = async (projectId) =>
      projectId === "project-1"
        ? { can: (moduleName) => ["schedule", "progress", "task", "rfi", "submittal"].includes(moduleName), projectWideTasks: false }
        : { can: () => true, projectWideTasks: true };
    await workspaceDashboardService.getWorkspaceDashboard({ orgId: "org-1", userId: "pm-1", role: "pm", moduleAccessFor });
    const projectsOf = (model) => mockPrisma[model].findMany.mock.calls[0][0].where.projectId;
    expect(projectsOf("changeOrder")).toEqual({ in: ["project-2"] });
    expect(projectsOf("risk")).toEqual({ in: ["project-2"] });
    expect(projectsOf("safetyIncident")).toEqual({ in: ["project-2"] });
    expect(projectsOf("ncrRecord")).toEqual({ in: ["project-2"] });
    expect(projectsOf("procurementOrder")).toEqual({ in: ["project-2"] });
    expect(projectsOf("longLeadItem")).toEqual({ in: ["project-2"] });
    expect(projectsOf("activity")).toEqual({ in: ["project-1", "project-2"] });
    expect(mockPrisma.task.findMany.mock.calls[0][0].where).toEqual({
      archivedAt: null,
      OR: [
        { projectId: { in: ["project-2"] } },
        { projectId: { in: ["project-1"] }, OR: [{ assigneeId: "pm-1" }, { createdById: "pm-1" }] },
      ],
    });
  });
});
