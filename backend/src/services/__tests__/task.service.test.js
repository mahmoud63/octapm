const mockPrisma = {
  $transaction: jest.fn((callback) => callback(mockPrisma)),
  task: {
    count: jest.fn(),
    create: jest.fn(),
    findMany: jest.fn(),
    findFirst: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
  },
  taskComment: {
    create: jest.fn(),
  },
  taskAttachment: {
    createMany: jest.fn(),
    deleteMany: jest.fn(),
  },
  taskHistory: {
    create: jest.fn(),
  },
  activity: {
    findFirst: jest.fn(),
  },
  user: {
    findFirst: jest.fn(),
  },
  projectDocument: {
    findMany: jest.fn(),
  },
  auditEvent: {
    create: jest.fn(),
  },
  recordHistorySnapshot: {
    create: jest.fn(),
  },
};

const mockEmitTaskNotification = jest.fn();
const mockAssertProjectAccess = jest.fn();

jest.mock("../../config/db", () => ({ prisma: mockPrisma }));
jest.mock("../notification.service", () => ({
  emitTaskNotification: mockEmitTaskNotification,
}));
jest.mock("../project-authorization.service", () => ({
  assertProjectAccess: mockAssertProjectAccess,
  canAccessAllProjects: jest.fn((role) => ["pm", "super_admin"].includes(role)),
  getProjectAccessWhere: jest.fn(({ userId, role }) =>
    role === "pm"
      ? {}
      : { assignments: { some: { userId } } },
  ),
}));

const taskService = require("../task.service");

const now = new Date("2026-06-12T12:00:00.000Z");

const taskRow = (patch = {}) => ({
  id: "11111111-1111-4111-8111-111111111111",
  orgId: "org-1",
  projectId: "22222222-2222-4222-8222-222222222222",
  activityId: null,
  taskNumber: "TSK-0001",
  title: "Resolve access issue",
  description: "Coordinate gate access before concrete pour",
  label: "field",
  priority: "high",
  status: "todo",
  dueDate: new Date("2026-06-20T00:00:00.000Z"),
  assigneeId: "33333333-3333-4333-8333-333333333333",
  createdById: "creator-1",
  updatedById: "creator-1",
  closedById: null,
  closedAt: null,
  archivedAt: null,
  archivedBy: null,
  createdAt: now,
  updatedAt: now,
  project: {
    id: "22222222-2222-4222-8222-222222222222",
    name: "Tower Project",
  },
  activity: null,
  assignee: {
    id: "33333333-3333-4333-8333-333333333333",
    name: "Site Engineer",
    email: "site@example.com",
    role: "site_engineer",
  },
  createdBy: {
    id: "creator-1",
    name: "Planner",
    email: "planner@example.com",
    role: "planning_eng",
  },
  updatedBy: null,
  closedBy: null,
  comments: [],
  attachments: [],
  history: [],
  ...patch,
});

describe("task service", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPrisma.$transaction.mockImplementation((callback) =>
      callback(mockPrisma),
    );
    mockAssertProjectAccess.mockResolvedValue({
      id: "22222222-2222-4222-8222-222222222222",
      role: "planning_eng",
    });
    mockPrisma.auditEvent.create.mockImplementation(({ data }) => ({
      id: "audit-1",
      ...data,
      occurredAt: data.occurredAt || now,
      createdAt: now,
    }));
    mockPrisma.recordHistorySnapshot.create.mockResolvedValue({
      id: "snapshot-1",
    });
    mockPrisma.taskHistory.create.mockImplementation(({ data }) => ({
      id: "history-1",
      ...data,
      createdAt: now,
    }));
    mockEmitTaskNotification.mockResolvedValue({
      created: 1,
      recipients: ["33333333-3333-4333-8333-333333333333"],
    });
  });

  it("creates persisted project tasks and emits assignee notifications", async () => {
    const created = taskRow();
    mockPrisma.task.count.mockResolvedValue(0);
    mockPrisma.user.findFirst.mockResolvedValue(created.assignee);
    mockPrisma.task.create.mockResolvedValue(created);
    mockPrisma.task.findUnique.mockResolvedValue(created);

    const result = await taskService.createTask({
      orgId: "org-1",
      projectId: "22222222-2222-4222-8222-222222222222",
      payload: {
        title: created.title,
        description: created.description,
        label: created.label,
        priority: created.priority,
        dueDate: "2026-06-20",
        assigneeId: created.assigneeId,
      },
      userId: "creator-1",
      userRole: "planning_eng",
    });

    expect(result.taskNumber).toBe("TSK-0001");
    expect(mockPrisma.task.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          orgId: "org-1",
          projectId: "22222222-2222-4222-8222-222222222222",
          title: created.title,
          assigneeId: created.assigneeId,
        }),
      }),
    );
    expect(mockEmitTaskNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: created.id,
        assigneeIds: [created.assigneeId],
        event: "task.assigned",
      }),
    );
    expect(mockPrisma.auditEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          entityType: "task",
          action: "created",
        }),
      }),
    );
  });

  it("limits non-PM workspace lists to assigned or created tasks", async () => {
    mockPrisma.task.findMany.mockResolvedValue([taskRow()]);

    await taskService.listTasks({
      orgId: "org-1",
      userId: "33333333-3333-4333-8333-333333333333",
      role: "site_engineer",
      query: { limit: 25 },
    });

    expect(mockPrisma.task.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: [
            { assigneeId: "33333333-3333-4333-8333-333333333333" },
            { createdById: "33333333-3333-4333-8333-333333333333" },
          ],
        }),
      }),
    );
  });

  it("updates status and records comments in task history", async () => {
    const existing = taskRow();
    const updated = taskRow({
      status: "done",
      closedAt: now,
      closedById: "creator-1",
      comments: [
        {
          id: "comment-1",
          taskId: existing.id,
          body: "Closed after site confirmation",
          authorId: "creator-1",
          author: existing.createdBy,
          createdAt: now,
          updatedAt: now,
        },
      ],
    });
    mockPrisma.task.findFirst.mockResolvedValue(existing);
    mockPrisma.task.update.mockResolvedValue(updated);
    mockPrisma.task.findUnique.mockResolvedValue(updated);
    mockPrisma.taskComment.create.mockResolvedValue(updated.comments[0]);

    const result = await taskService.updateTask({
      orgId: "org-1",
      projectId: existing.projectId,
      taskId: existing.id,
      payload: {
        status: "done",
        comment: "Closed after site confirmation",
      },
      userId: "creator-1",
      userRole: "planning_eng",
    });

    expect(result.status).toBe("done");
    expect(mockPrisma.taskComment.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        taskId: existing.id,
        body: "Closed after site confirmation",
      }),
    });
    expect(mockPrisma.taskHistory.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: "status_changed",
        fromStatus: "todo",
        toStatus: "done",
      }),
    });
  });
});
