/**
 * A notification names its record in words — never by its database id
 * (owner, 2026-09-28: the field app's Notifications screen read "BOQ
 * allocation 0766b8b4-… needs approval").
 *
 *   an allocation with an activity code: "BOQ allocation for Activity A120 …"
 *   an allocation with no code: the BOQ row's description — for a reader of
 *     the BOQ only (utils/boq-figures); anyone else the kind alone
 *   nothing readable: the kind alone, "BOQ allocation needs approval"
 *   a notice about one of the bill's own records (an allocation, a BOQ
 *     revision) reaches only a reader of the BOQ on its project; a row
 *     stored before that rule is left out of what anyone else reads
 *   a row stored before the rule is re-rendered where it is read (list,
 *     summary, one row, read/archive answers, email, push) and never
 *     rewritten; its link is its own
 *
 * The live proof is services/__live__/notification-readable-subjects.live.test.js.
 */
const IDENTIFIER = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

const now = new Date("2026-09-28T12:00:00.000Z");
const PROJECT = "4735659e-cfd0-464d-a0b2-21c4b23960fc";
const ALLOCATION = "0766b8b4-d88d-45e1-b1fc-8423788b1bfb";
const LOADING = "725e3383-6222-4b0b-afb3-fd9c3481358b";
const REVISION = "5b0b8f5e-1111-4c1c-9d1d-2e2e2e2e2e2e";

const mockPrisma = {
  $transaction: jest.fn(),
  user: { findMany: jest.fn() },
  project: { findMany: jest.fn() },
  activityBoqAllocation: { findFirst: jest.fn(), findMany: jest.fn() },
  activityCostLoading: { findFirst: jest.fn(), findMany: jest.fn() },
  scheduleRevision: { findFirst: jest.fn(), findMany: jest.fn() },
  notification: {
    create: jest.fn(),
    findMany: jest.fn(),
    findFirst: jest.fn(),
    count: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
  },
  notificationPreference: { findMany: jest.fn(), createMany: jest.fn(), upsert: jest.fn() },
  notificationDeliveryAttempt: { create: jest.fn(), findMany: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
};

const mockSendEmail = jest.fn();
const mockPublish = jest.fn();
// Who may read the BOQ on the project: decided by utils/boq-figures on the
// request the project's routes would see. Here, by the person's id.
const mockBoqReaders = new Set();

jest.mock("../../config/db", () => ({ prisma: mockPrisma }));
jest.mock("../email.service", () => ({ sendEmail: mockSendEmail }));
jest.mock("../../events/bus", () => ({
  publish: mockPublish,
  EVENT_TYPES: { NOTIFICATION_CREATED: "notification.created" },
}));
jest.mock("../membership.service", () => ({
  ...jest.requireActual("../membership.service"),
  resolveRequestPrincipal: jest.fn(async ({ userId, orgId }) => ({ id: userId, orgId, role: "pm" })),
}));
jest.mock("../../middleware/project-access", () => ({
  requestForProject: jest.fn(async (req, projectId) => ({ user: req.user, params: { projectId } })),
}));
jest.mock("../../utils/boq-figures", () => ({
  canReadBoq: jest.fn((req) => Boolean(req?.user && mockBoqReaders.has(req.user.id))),
}));

const notificationService = require("../notification.service");
const pushService = require("../push.service");

const pm = (id) => ({ id, orgId: "org-1", name: id, email: `${id}@example.com`, role: "pm" });

const submitted = (recordType, recordId, extra = {}) => ({
  id: `event-${recordId}`,
  orgId: "org-1",
  projectId: PROJECT,
  recordType,
  recordId,
  workflowType: recordType,
  action: "submitted",
  decision: "submitted",
  fromStatus: "draft",
  toStatus: "submitted",
  actorId: "actor-1",
  metadata: {},
  ...extra,
});

const created = () => mockPrisma.notification.create.mock.calls.map(([{ data }]) => data);
const byRecipient = () => Object.fromEntries(created().map((row) => [row.recipientUserId, row]));

describe("a notification names its record in words, never by its id", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockBoqReaders.clear();
    mockPrisma.$transaction.mockImplementation((callback) => callback(mockPrisma));
    mockPrisma.notificationPreference.findMany.mockResolvedValue([]);
    mockPrisma.notification.create.mockImplementation(async ({ data }) => ({
      id: `not-${mockPrisma.notification.create.mock.calls.length}`,
      ...data,
      createdAt: now,
      updatedAt: now,
    }));
    mockPrisma.notificationDeliveryAttempt.create.mockResolvedValue({});
    mockPrisma.notificationDeliveryAttempt.updateMany.mockResolvedValue({ count: 1 });
    mockSendEmail.mockResolvedValue({ delivered: true, provider: "webhook" });
    // An approval request goes to the project managers.
    mockPrisma.user.findMany.mockImplementation(async ({ where }) =>
      where?.role ? [pm("pm-1"), pm("pm-2")] : [],
    );
  });

  afterEach(() => {
    // Nothing a person reads carries an identifier; the realtime badge event neither.
    for (const row of created()) {
      expect(row.title).not.toMatch(IDENTIFIER);
      expect(row.message).not.toMatch(IDENTIFIER);
      expect(row.title).not.toContain("Workflow record");
      expect(row.message).not.toContain("Workflow record");
    }
    for (const [event] of mockPublish.mock.calls) expect(event.payload.title).not.toMatch(IDENTIFIER);
  });

  it("an allocation with an activity code: 'BOQ allocation for Activity A120 needs approval', link unchanged", async () => {
    mockBoqReaders.add("pm-1").add("pm-2");
    mockPrisma.activityBoqAllocation.findFirst.mockResolvedValue({
      id: ALLOCATION,
      projectId: PROJECT,
      activity: { activityCode: "A120" },
      boqItem: { description: "Concrete Foundations" },
    });

    await notificationService.createWorkflowNotifications({
      tx: mockPrisma,
      workflowEvent: submitted("activity_boq_allocation", ALLOCATION),
    });

    // The record is read with the words it is named by.
    expect(mockPrisma.activityBoqAllocation.findFirst).toHaveBeenCalledWith({
      where: { id: ALLOCATION, projectId: PROJECT },
      include: { activity: { select: { activityCode: true } }, boqItem: { select: { description: true } } },
    });
    const rows = byRecipient();
    expect(Object.keys(rows).sort()).toEqual(["pm-1", "pm-2"]);
    for (const row of Object.values(rows)) {
      expect(row.title).toBe("BOQ allocation for Activity A120 needs approval");
      expect(row.message).toBe("BOQ allocation: Activity A120. Status moved to submitted.");
      // The link still opens the record.
      expect(row.actionUrl).toBe(`/projects/${PROJECT}?recordId=${ALLOCATION}&source=activity_boq_allocation`);
      expect(row.entityId).toBe(ALLOCATION);
    }
  });

  it("an allocation with no activity code: the BOQ row's description for a reader of the BOQ, and nothing for anyone else", async () => {
    mockBoqReaders.add("pm-1");
    mockPrisma.activityBoqAllocation.findFirst.mockResolvedValue({
      id: ALLOCATION,
      projectId: PROJECT,
      activity: { activityCode: null },
      boqItem: { description: "Concrete Foundations" },
    });

    await notificationService.createWorkflowNotifications({
      tx: mockPrisma,
      workflowEvent: submitted("activity_boq_allocation", ALLOCATION),
    });

    const rows = byRecipient();
    expect(rows["pm-1"].title).toBe("BOQ allocation for Concrete Foundations needs approval");
    expect(rows["pm-1"].message).toBe("BOQ allocation: Concrete Foundations. Status moved to submitted.");
    // pm-2 may not read the BOQ: no notice at all, and no realtime badge.
    expect(Object.keys(rows)).toEqual(["pm-1"]);
    expect(mockPublish).toHaveBeenCalledWith(
      expect.objectContaining({ recipientUserIds: ["pm-1"], payload: expect.objectContaining({ title: "BOQ allocation needs approval" }) }),
    );
  });

  it("a member who may not read the BOQ receives no notice about an allocation or a BOQ revision, nor its realtime badge", async () => {
    mockPrisma.activityBoqAllocation.findFirst.mockResolvedValue({
      id: ALLOCATION,
      projectId: PROJECT,
      activity: { activityCode: "C900" },
      boqItem: { description: "Concrete Foundations" },
    });

    await notificationService.createWorkflowNotifications({ tx: mockPrisma, workflowEvent: submitted("activity_boq_allocation", ALLOCATION) });
    await notificationService.createWorkflowNotifications({ tx: mockPrisma, workflowEvent: submitted("boq_revision", REVISION) });
    // Neither project manager reads the BOQ: nothing is written, nothing published.
    expect(created()).toEqual([]);
    expect(mockPublish).not.toHaveBeenCalled();

    // The one who does is told; the other is not.
    mockBoqReaders.add("pm-2");
    await notificationService.createWorkflowNotifications({
      tx: mockPrisma,
      workflowEvent: submitted("activity_boq_allocation", ALLOCATION, { id: "event-2" }),
    });
    expect(created().map((row) => [row.recipientUserId, row.title])).toEqual([["pm-2", "BOQ allocation for Activity C900 needs approval"]]);
    expect(mockPublish.mock.calls.map(([event]) => event.recipientUserIds)).toEqual([["pm-2"]]);

    // Any other record's notice reaches both, as before.
    mockPrisma.scheduleRevision.findFirst.mockResolvedValue({ id: REVISION, projectId: PROJECT, label: "Rev 3" });
    await notificationService.createWorkflowNotifications({ tx: mockPrisma, workflowEvent: submitted("schedule_revision", REVISION) });
    expect(created().filter((row) => row.entityType === "schedule_revision").map((row) => row.recipientUserId).sort()).toEqual(["pm-1", "pm-2"]);
  });

  it("nothing readable (the record is gone): the kind alone, 'BOQ allocation needs approval'", async () => {
    mockBoqReaders.add("pm-1").add("pm-2");
    mockPrisma.activityBoqAllocation.findFirst.mockResolvedValue(null);

    await notificationService.createWorkflowNotifications({
      tx: mockPrisma,
      workflowEvent: submitted("activity_boq_allocation", ALLOCATION),
    });

    expect(created().map((row) => [row.title, row.message])).toEqual([
      ["BOQ allocation needs approval", "BOQ allocation needs approval. Status moved to submitted."],
      ["BOQ allocation needs approval", "BOQ allocation needs approval. Status moved to submitted."],
    ]);
  });

  it("an activity code of nothing but spaces, or one shaped like an id, is not a name", async () => {
    mockBoqReaders.add("pm-2");
    mockPrisma.activityBoqAllocation.findFirst
      .mockResolvedValueOnce({ id: ALLOCATION, projectId: PROJECT, activity: { activityCode: "   " }, boqItem: null })
      .mockResolvedValueOnce({ id: ALLOCATION, projectId: PROJECT, activity: { activityCode: ALLOCATION }, boqItem: { description: LOADING } });

    await notificationService.createWorkflowNotifications({ tx: mockPrisma, workflowEvent: submitted("activity_boq_allocation", ALLOCATION) });
    mockBoqReaders.add("pm-1");
    await notificationService.createWorkflowNotifications({ tx: mockPrisma, workflowEvent: submitted("activity_boq_allocation", ALLOCATION, { id: "event-2" }) });

    expect(new Set(created().map((row) => row.title))).toEqual(new Set(["BOQ allocation needs approval"]));
  });

  it("a cost loading is named by its activity's code, or its name when it has none", async () => {
    mockPrisma.activityCostLoading.findFirst
      .mockResolvedValueOnce({ id: LOADING, projectId: PROJECT, activity: { activityCode: "A130", name: "Pour slab" } })
      .mockResolvedValueOnce({ id: LOADING, projectId: PROJECT, activity: { activityCode: null, name: "Pour slab" } });

    await notificationService.createWorkflowNotifications({ tx: mockPrisma, workflowEvent: submitted("activity_cost_loading", LOADING) });
    await notificationService.createWorkflowNotifications({
      tx: mockPrisma,
      workflowEvent: submitted("activity_cost_loading", LOADING, { id: "event-2" }),
    });

    expect(created().map((row) => row.title)).toEqual([
      "Cost loading for Activity A130 needs approval",
      "Cost loading for Activity A130 needs approval",
      "Cost loading for Pour slab needs approval",
      "Cost loading for Pour slab needs approval",
    ]);
  });

  it("a schedule revision's message names it by its label, not 'Workflow record'", async () => {
    mockPrisma.scheduleRevision.findFirst.mockResolvedValue({ id: REVISION, projectId: PROJECT, label: "Rev 2 recovery" });

    await notificationService.createWorkflowNotifications({ tx: mockPrisma, workflowEvent: submitted("schedule_revision", REVISION) });

    expect(created()[0].title).toBe("Schedule revision Rev 2 recovery needs approval");
    expect(created()[0].message).toBe("Schedule revision: Rev 2 recovery. Status moved to submitted.");
  });
});

describe("a notification stored before the rule is re-rendered where it is read, never rewritten", () => {
  // Rows as the shared database holds them (the 714 rows the owner counted).
  const legacy = (overrides = {}) => ({
    id: "not-legacy-1",
    orgId: "org-1",
    projectId: PROJECT,
    recipientUserId: "user-1",
    actorId: null,
    type: "workflow",
    category: "approval",
    event: "workflow.submitted",
    title: `BOQ allocation ${ALLOCATION} needs approval`,
    message: "BOQ allocation: Workflow record. Status moved to submitted.",
    priority: "high",
    readAt: null,
    archivedAt: null,
    dueAt: null,
    actionUrl: `/projects/${PROJECT}?recordId=${ALLOCATION}&source=activity_boq_allocation`,
    entityType: "activity_boq_allocation",
    entityId: ALLOCATION,
    metadataJson: { action: "submitted", toStatus: "submitted", recordId: ALLOCATION, recordType: "activity_boq_allocation" },
    deliveryAttempts: [],
    createdAt: now,
    updatedAt: now,
    ...overrides,
  });
  const legacyLoading = legacy({
    id: "not-legacy-2",
    event: "workflow.approved",
    title: `Cost loading ${LOADING} approved`,
    message: "Cost loading: Workflow record. Status moved to approved. Checked against the baseline.",
    actionUrl: `/projects/${PROJECT}?recordId=${LOADING}&source=activity_cost_loading`,
    entityType: "activity_cost_loading",
    entityId: LOADING,
    metadataJson: { action: "approved", toStatus: "approved", fromStatus: "submitted" },
  });
  const legacyRevision = legacy({
    id: "not-legacy-3",
    title: "Schedule revision Rev 1 needs approval",
    message: "Schedule revision: Workflow record. Status moved to under_review.",
    actionUrl: `/projects/${PROJECT}/schedule/revisions?recordId=${REVISION}&source=schedule_revision`,
    entityType: "schedule_revision",
    entityId: REVISION,
  });
  const current = legacy({ id: "not-current", title: "RFI RFI-004 needs approval", message: "RFI: Embeds. Status moved to open.", entityType: "rfi", entityId: "c0ffee00-0000-4000-8000-000000000000" });

  beforeEach(() => {
    jest.clearAllMocks();
    mockBoqReaders.clear();
    // user-1 reads the BOQ unless a test says otherwise.
    mockBoqReaders.add("user-1");
    mockPrisma.activityBoqAllocation.findMany.mockResolvedValue([
      { id: ALLOCATION, projectId: PROJECT, activity: { activityCode: "A120" }, boqItem: { description: "Concrete Foundations" } },
    ]);
    mockPrisma.activityCostLoading.findMany.mockResolvedValue([
      { id: LOADING, projectId: PROJECT, activity: { activityCode: null, name: "Pour slab" } },
    ]);
    mockPrisma.scheduleRevision.findMany.mockResolvedValue([{ id: REVISION, projectId: PROJECT, label: "Rev 1" }]);
  });

  afterEach(() => {
    // Reading never writes the row back.
    expect(mockPrisma.notification.update).not.toHaveBeenCalled();
    expect(mockPrisma.notification.updateMany).not.toHaveBeenCalled();
  });

  it("the list: readable titles and messages, the rest of the message kept, the link and the entity the row's own", async () => {
    mockPrisma.notification.findMany.mockResolvedValue([legacy(), legacyLoading, legacyRevision, current]);

    const { rows } = await notificationService.listNotifications({
      orgId: "org-1",
      userId: "user-1",
      viewer: { id: "user-1", orgId: "org-1" },
    });

    expect(rows.map((row) => [row.title, row.message])).toEqual([
      ["BOQ allocation for Activity A120 needs approval", "BOQ allocation: Activity A120. Status moved to submitted."],
      ["Cost loading for Pour slab approved", "Cost loading: Pour slab. Status moved to approved. Checked against the baseline."],
      ["Schedule revision Rev 1 needs approval", "Schedule revision: Rev 1. Status moved to under_review."],
      ["RFI RFI-004 needs approval", "RFI: Embeds. Status moved to open."],
    ]);
    expect(rows.map((row) => row.actionUrl)).toEqual([legacy().actionUrl, legacyLoading.actionUrl, legacyRevision.actionUrl, current.actionUrl]);
    expect(rows[0].entityId).toBe(ALLOCATION);
    for (const row of rows) {
      expect(row.title).not.toMatch(IDENTIFIER);
      expect(row.message).not.toMatch(IDENTIFIER);
    }
    // The records are read from the rows' own projects.
    expect(mockPrisma.activityBoqAllocation.findMany).toHaveBeenCalledWith({
      where: { id: { in: [ALLOCATION] }, projectId: { in: [PROJECT] } },
      include: { activity: { select: { activityCode: true } }, boqItem: { select: { description: true } } },
    });
    // One read of the projects their BOQ-record rows are on, then the page;
    // a row with nothing to re-render costs no further read.
    expect(mockPrisma.notification.findMany).toHaveBeenCalledTimes(2);
    expect(mockPrisma.notification.findMany.mock.calls[0][0]).toEqual({
      where: { orgId: "org-1", recipientUserId: "user-1", entityType: { in: ["boq_revision", "activity_boq_allocation", "boq_item"] } },
      distinct: ["projectId"],
      select: { projectId: true },
    });
    // user-1 reads the BOQ there: the page is not narrowed.
    expect(mockPrisma.notification.findMany.mock.calls[1][0].where).not.toHaveProperty("AND");
  });

  it("an id in the reviewer's own words is taken out, never replaced by this record's name — the rest is kept as written", async () => {
    const OTHER = "61807fe6-bf4e-4a3c-9215-17ad0761da04";
    mockPrisma.notification.findMany.mockResolvedValue([
      // Written in words, with a reason naming another allocation.
      legacy({ id: "reason-1", event: "workflow.rejected", title: "BOQ allocation for Activity A120 rejected", message: `BOQ allocation: Activity A120. Status moved to rejected. Duplicate of allocation ${OTHER}` }),
      // Stored before the rule, with the same reason.
      legacy({ id: "reason-2", event: "workflow.rejected", title: `BOQ allocation ${ALLOCATION} rejected`, message: `BOQ allocation: Workflow record. Status moved to rejected. Duplicate of allocation ${OTHER}.` }),
    ]);
    const { rows } = await notificationService.listNotifications({ orgId: "org-1", userId: "user-1", viewer: { id: "user-1", orgId: "org-1" } });
    expect(rows.map((row) => row.message)).toEqual([
      "BOQ allocation: Activity A120. Status moved to rejected. Duplicate of allocation",
      "BOQ allocation: Activity A120. Status moved to rejected. Duplicate of allocation.",
    ]);
    for (const row of rows) expect(row.message).not.toMatch(/Duplicate of allocation Activity A120/);
  });

  it("a stored allocation whose activity has no code: the description for a BOQ reader", async () => {
    mockPrisma.activityBoqAllocation.findMany.mockResolvedValue([
      { id: ALLOCATION, projectId: PROJECT, activity: { activityCode: null }, boqItem: { description: "Concrete Foundations" } },
    ]);
    mockPrisma.notification.findMany.mockResolvedValue([legacy()]);
    const { rows } = await notificationService.listNotifications({ orgId: "org-1", userId: "user-1", viewer: { id: "user-1", orgId: "org-1" } });

    expect(rows[0].title).toBe("BOQ allocation for Concrete Foundations needs approval");
  });

  it("a stored BOQ-record row for someone who may not read that BOQ is left out of the list, the summary, one notification and mark-all-read", async () => {
    const OTHER = "9d0c0de0-0000-4000-8000-000000000000";
    const boqFigures = jest.requireMock("../../utils/boq-figures");
    // Their BOQ-record rows are on two projects; they read the BOQ on OTHER only.
    boqFigures.canReadBoq.mockImplementation((req) => req?.params?.projectId === OTHER);
    mockPrisma.notification.findMany.mockImplementation(async (args) =>
      args.distinct ? [{ projectId: PROJECT }, { projectId: OTHER }] : [],
    );
    mockPrisma.notification.count.mockResolvedValue(0);
    mockPrisma.notification.findFirst.mockResolvedValue(null);
    mockPrisma.notification.updateMany.mockResolvedValue({ count: 0 });
    const viewer = { id: "user-1", orgId: "org-1" };
    const kept = {
      OR: [
        { entityType: null },
        { entityType: { notIn: ["boq_revision", "activity_boq_allocation", "boq_item"] } },
        { projectId: { notIn: [PROJECT] } },
      ],
    };

    try {
      await notificationService.listNotifications({ orgId: "org-1", userId: "user-1", viewer });
      await notificationService.getNotificationSummary({ orgId: "org-1", userId: "user-1", viewer });
      await expect(
        notificationService.getNotificationForUser({ orgId: "org-1", userId: "user-1", viewer, notificationId: "not-legacy-1" }),
      ).rejects.toMatchObject({ status: 404, code: "NOTIFICATION_NOT_FOUND" });
      await notificationService.markAllRead({ orgId: "org-1", userId: "user-1", viewer });

      const pages = mockPrisma.notification.findMany.mock.calls.map(([args]) => args).filter((args) => !args.distinct);
      expect(pages.map((args) => args.where.AND)).toEqual([[kept], [kept]]);
      expect(mockPrisma.notification.count.mock.calls.map(([args]) => args.where.AND)).toEqual([[kept], [kept], [kept]]);
      expect(mockPrisma.notification.findFirst.mock.calls[0][0].where.AND).toEqual([kept]);
      // Mark-all-read is the one write, and it is scoped to what they read.
      expect(mockPrisma.notification.updateMany.mock.calls[0][0].where).toEqual({
        orgId: "org-1",
        recipientUserId: "user-1",
        inAppVisible: true,
        readAt: null,
        archivedAt: null,
        AND: [kept],
      });
    } finally {
      boqFigures.canReadBoq.mockImplementation((req) => Boolean(req?.user && mockBoqReaders.has(req.user.id)));
      mockPrisma.notification.findMany.mockReset();
      // The afterEach guard is for reading; this test's one write is asserted above.
      mockPrisma.notification.updateMany.mockClear();
    }
  });

  it("a stored row whose record is gone reads as its kind", async () => {
    mockPrisma.activityBoqAllocation.findMany.mockResolvedValue([]);
    mockPrisma.notification.findMany.mockResolvedValue([legacy({ event: "workflow.approved", title: `BOQ allocation ${ALLOCATION} approved`, message: "BOQ allocation: Workflow record. Status moved to approved.", metadataJson: {} })]);

    const { rows } = await notificationService.listNotifications({ orgId: "org-1", userId: "user-1" });

    expect(rows[0].title).toBe("BOQ allocation approved");
    expect(rows[0].message).toBe("BOQ allocation approved. Status moved to approved.");
  });

  it("one notification, the summary, and the read and archive answers", async () => {
    mockPrisma.notification.findFirst.mockResolvedValue(legacy());
    mockPrisma.notification.count.mockResolvedValue(1);
    mockPrisma.notification.findMany.mockResolvedValue([legacyLoading]);

    const one = await notificationService.getNotificationForUser({ orgId: "org-1", userId: "user-1", notificationId: "not-legacy-1" });
    const summary = await notificationService.getNotificationSummary({ orgId: "org-1", userId: "user-1" });
    mockPrisma.notification.update.mockResolvedValueOnce(legacy({ readAt: now })).mockResolvedValueOnce(legacy({ archivedAt: now }));
    const readAnswer = await notificationService.markNotificationRead({ orgId: "org-1", userId: "user-1", notificationId: "not-legacy-1" });
    const archived = await notificationService.archiveNotification({ orgId: "org-1", userId: "user-1", notificationId: "not-legacy-1" });
    // Marking read and archiving write readAt / archivedAt only.
    for (const [call] of mockPrisma.notification.update.mock.calls) {
      expect(Object.keys(call.data)).toEqual(expect.arrayContaining([expect.stringMatching(/^(readAt|archivedAt)$/)]));
      expect(call.data).not.toHaveProperty("title");
      expect(call.data).not.toHaveProperty("message");
    }
    mockPrisma.notification.update.mockClear();

    expect(one.title).toBe("BOQ allocation for Activity A120 needs approval");
    expect(summary.recent[0].title).toBe("Cost loading for Pour slab approved");
    expect(readAnswer.title).toBe("BOQ allocation for Activity A120 needs approval");
    expect(archived.message).toBe("BOQ allocation: Activity A120. Status moved to submitted.");
  });

  it("an email and a push say what the in-app row says", async () => {
    mockPrisma.notificationDeliveryAttempt.updateMany.mockResolvedValue({ count: 1 });
    mockSendEmail.mockResolvedValue({ delivered: true, provider: "webhook" });
    mockPrisma.notificationDeliveryAttempt.findMany.mockResolvedValue([
      {
        id: "attempt-1",
        notificationId: "not-legacy-1",
        userId: "user-1",
        channel: "email",
        status: "pending",
        attemptNumber: 1,
        notification: { ...legacy(), recipient: { id: "user-1", email: "pm@example.com", name: "PM" } },
      },
    ]);

    await notificationService.processPendingEmailDeliveries({ now });
    const payload = await pushService.buildPushPayload({ notification: legacy(), userId: "user-1" });

    expect(mockSendEmail).toHaveBeenCalledWith(
      expect.objectContaining({ subject: "BOQ allocation for Activity A120 needs approval" }),
    );
    const email = mockSendEmail.mock.calls[0][0];
    expect(email.body.split("\n")[0]).toBe("BOQ allocation: Activity A120. Status moved to submitted.");
    // The link in the email is the row's own (it carries the id; that is where it belongs).
    expect(email.body).toContain(legacy().actionUrl);
    expect(payload).toMatchObject({
      title: "BOQ allocation for Activity A120 needs approval",
      body: "BOQ allocation: Activity A120. Status moved to submitted.",
      url: legacy().actionUrl,
      entityType: "activity_boq_allocation",
      entityId: ALLOCATION,
    });
  });
});
