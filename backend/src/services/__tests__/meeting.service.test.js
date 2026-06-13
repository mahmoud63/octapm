const mockPrisma = {
  $transaction: jest.fn((callback) => callback(mockPrisma)),
  meeting: {
    count: jest.fn(),
    create: jest.fn(),
    findFirst: jest.fn(),
    findMany: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
  },
  meetingAttendee: {
    createMany: jest.fn(),
    deleteMany: jest.fn(),
  },
  meetingAgendaItem: {
    createMany: jest.fn(),
    deleteMany: jest.fn(),
  },
  meetingDecision: {
    createMany: jest.fn(),
    deleteMany: jest.fn(),
  },
  meetingActionItem: {
    create: jest.fn(),
    deleteMany: jest.fn(),
    update: jest.fn(),
  },
  meetingDistribution: {
    create: jest.fn(),
  },
  meetingComment: {
    create: jest.fn(),
  },
  activity: {
    findMany: jest.fn(),
  },
  user: {
    findMany: jest.fn(),
  },
  projectParty: {
    findMany: jest.fn(),
  },
  task: {
    findMany: jest.fn(),
  },
  auditEvent: {
    create: jest.fn(),
  },
  recordHistorySnapshot: {
    create: jest.fn(),
  },
};

const mockCreateNotifications = jest.fn();
const mockCreateTask = jest.fn();
const mockAssertProjectAccess = jest.fn();

jest.mock("../../config/db", () => ({ prisma: mockPrisma }));
jest.mock("../notification.service", () => ({
  NOTIFICATION_CATEGORIES: {
    WORKFLOW: "workflow",
  },
  createNotifications: mockCreateNotifications,
}));
jest.mock("../task.service", () => ({
  createTask: mockCreateTask,
}));
jest.mock("../project-authorization.service", () => ({
  assertProjectAccess: mockAssertProjectAccess,
}));

const meetingService = require("../meeting.service");

const now = new Date("2026-06-12T12:00:00.000Z");
const orgId = "org-1";
const projectId = "22222222-2222-4222-8222-222222222222";
const meetingId = "33333333-3333-4333-8333-333333333333";
const ownerId = "44444444-4444-4444-8444-444444444444";

const user = (patch = {}) => ({
  id: ownerId,
  name: "Site Engineer",
  email: "site@example.com",
  role: "site_engineer",
  ...patch,
});

const meetingRow = (patch = {}) => ({
  id: meetingId,
  orgId,
  projectId,
  project: { id: projectId, name: "Tower Project" },
  activityId: null,
  activity: null,
  meetingNumber: "MTG-0001",
  title: "Weekly coordination",
  meetingType: "coordination",
  location: "Site office",
  scheduledAt: new Date("2026-06-15T08:00:00.000Z"),
  startedAt: null,
  endedAt: null,
  status: "draft",
  objective: "Coordinate site access",
  minutesText: "Discussed pour access.",
  nextMeetingAt: null,
  chairId: null,
  chair: null,
  createdById: "creator-1",
  createdBy: user({ id: "creator-1", name: "Planner", role: "planning_eng" }),
  updatedById: "creator-1",
  updatedBy: null,
  distributedById: null,
  distributedBy: null,
  distributedAt: null,
  archivedAt: null,
  archivedBy: null,
  attendees: [],
  agendaItems: [],
  decisions: [],
  actionItems: [],
  distributions: [],
  comments: [],
  createdAt: now,
  updatedAt: now,
  ...patch,
});

const actionItemRow = (patch = {}) => ({
  id: "55555555-5555-4555-8555-555555555555",
  orgId,
  projectId,
  meetingId,
  activityId: null,
  taskId: null,
  itemNumber: "AI-001",
  title: "Confirm gate access",
  description: "Confirm access before concrete pour",
  ownerId,
  ownerName: null,
  ownerEmail: null,
  dueDate: new Date("2026-06-20T00:00:00.000Z"),
  priority: "high",
  status: "open",
  createdAt: now,
  updatedAt: now,
  ...patch,
});

describe("meeting service", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPrisma.$transaction.mockImplementation((callback) =>
      callback(mockPrisma),
    );
    mockAssertProjectAccess.mockResolvedValue({
      id: projectId,
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
    mockPrisma.activity.findMany.mockResolvedValue([]);
    mockPrisma.user.findMany.mockResolvedValue([user()]);
    mockPrisma.projectParty.findMany.mockResolvedValue([]);
    mockPrisma.task.findMany.mockResolvedValue([]);
    mockCreateTask.mockResolvedValue({
      id: "66666666-6666-4666-8666-666666666666",
    });
    mockCreateNotifications.mockResolvedValue({
      created: 1,
      recipients: [ownerId],
    });
  });

  it("creates meeting minutes and links action items to persisted tasks", async () => {
    const createdMeeting = meetingRow();
    const createdAction = actionItemRow();
    const linkedAction = actionItemRow({
      taskId: "66666666-6666-4666-8666-666666666666",
      owner: user(),
      task: {
        id: "66666666-6666-4666-8666-666666666666",
        taskNumber: "TSK-0001",
        title: "Confirm gate access",
        status: "todo",
        dueDate: new Date("2026-06-20T00:00:00.000Z"),
        assigneeId: ownerId,
      },
    });

    mockPrisma.meeting.count.mockResolvedValue(0);
    mockPrisma.meeting.create.mockResolvedValue(createdMeeting);
    mockPrisma.meetingActionItem.create.mockResolvedValue(createdAction);
    mockPrisma.meetingActionItem.update.mockResolvedValue(linkedAction);
    mockPrisma.meeting.findUnique.mockResolvedValue(
      meetingRow({ actionItems: [linkedAction] }),
    );

    const result = await meetingService.createMeeting({
      orgId,
      projectId,
      payload: {
        title: "Weekly coordination",
        location: "Site office",
        minutesText: "Discussed pour access.",
        actionItems: [
          {
            title: "Confirm gate access",
            description: "Confirm access before concrete pour",
            ownerId,
            dueDate: "2026-06-20",
            priority: "high",
          },
        ],
      },
      userId: "creator-1",
      userRole: "planning_eng",
    });

    expect(result.meetingNumber).toBe("MTG-0001");
    expect(result.actionItems[0].taskId).toBe(
      "66666666-6666-4666-8666-666666666666",
    );
    expect(mockCreateTask).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId,
        payload: expect.objectContaining({
          title: "Confirm gate access",
          label: "action",
          assigneeId: ownerId,
          dueDate: "2026-06-20T00:00:00.000Z",
        }),
      }),
    );
    expect(mockPrisma.auditEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          entityType: "meeting",
          action: "created",
        }),
      }),
    );
  });

  it("distributes meeting minutes with history rows, notifications, and audit", async () => {
    const current = meetingRow({
      attendees: [
        {
          id: "attendee-1",
          orgId,
          projectId,
          meetingId,
          activityId: null,
          userId: ownerId,
          user: user(),
          projectPartyId: null,
          projectParty: null,
          name: null,
          email: null,
          companyName: null,
          role: "attendee",
          attendanceStatus: "attended",
          distributionRequired: true,
          attendedAt: null,
          createdAt: now,
          updatedAt: now,
        },
      ],
    });
    const distribution = {
      id: "77777777-7777-4777-8777-777777777777",
      orgId,
      projectId,
      meetingId,
      activityId: null,
      recipientUserId: ownerId,
      projectPartyId: null,
      recipientName: "Site Engineer",
      recipientEmail: "site@example.com",
      companyName: null,
      channel: "email",
      status: "sent",
      message: "Issued for action",
      sentById: "creator-1",
      sentAt: now,
      metadataJson: {},
      createdAt: now,
      updatedAt: now,
    };

    mockPrisma.meeting.findFirst.mockResolvedValue(current);
    mockPrisma.user.findMany.mockResolvedValue([user()]);
    mockPrisma.meetingDistribution.create.mockResolvedValue(distribution);
    mockPrisma.meeting.update.mockResolvedValue(
      meetingRow({
        status: "distributed",
        distributedAt: now,
        distributedById: "creator-1",
      }),
    );
    mockPrisma.meeting.findUnique.mockResolvedValue(
      meetingRow({
        status: "distributed",
        distributions: [distribution],
      }),
    );

    const result = await meetingService.distributeMeeting({
      orgId,
      projectId,
      meetingId,
      payload: { message: "Issued for action" },
      userId: "creator-1",
      userRole: "planning_eng",
    });

    expect(result.distributionCount).toBe(1);
    expect(mockPrisma.meetingDistribution.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          meetingId,
          recipientUserId: ownerId,
          message: "Issued for action",
        }),
      }),
    );
    expect(mockCreateNotifications).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "meeting.distributed",
        recipientUserIds: [ownerId],
        entityType: "meeting",
        entityId: meetingId,
      }),
    );
    expect(mockPrisma.auditEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          entityType: "meeting",
          action: "status_changed",
          newStatus: "distributed",
        }),
      }),
    );
  });
});
