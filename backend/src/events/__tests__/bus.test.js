const bus = require("../bus");

describe("domain event bus", () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it("normalizes events and assigns ids and timestamps", () => {
    const event = bus.publish(
      {
        type: bus.EVENT_TYPES.RECORD_CHANGED,
        orgId: "org-1",
        projectId: "project-1",
        entityType: "rfi",
        entityId: "rfi-1",
        action: "updated",
        actorId: "user-1",
        payload: { summary: { ref: "RFI-01", password: "x" } },
        recipientUserIds: ["u1", "u1", null],
      },
      { delayMs: 0 },
    );

    expect(event).toEqual(
      expect.objectContaining({
        type: "record.changed",
        orgId: "org-1",
        projectId: "project-1",
        entityType: "rfi",
        entityId: "rfi-1",
        action: "updated",
        actorId: "user-1",
        recipientUserIds: ["u1"],
      }),
    );
    expect(typeof event.id).toBe("string");
    expect(new Date(event.occurredAt).toISOString()).toBe(event.occurredAt);
  });

  it("rejects events without a type or org", () => {
    expect(bus.publish({ orgId: "org-1" }, { delayMs: 0 })).toBeNull();
    expect(bus.publish({ type: "x" }, { delayMs: 0 })).toBeNull();
  });

  it("delivers to subscribers and honours unsubscribe", () => {
    const received = [];
    const unsubscribe = bus.subscribe((event) => received.push(event));

    bus.publish(
      { type: bus.EVENT_TYPES.RECORD_CHANGED, orgId: "org-1" },
      { delayMs: 0 },
    );
    expect(received).toHaveLength(1);

    unsubscribe();
    bus.publish(
      { type: bus.EVENT_TYPES.RECORD_CHANGED, orgId: "org-1" },
      { delayMs: 0 },
    );
    expect(received).toHaveLength(1);
  });

  it("defers delivery when a delay is configured so commits land first", () => {
    jest.useFakeTimers();
    const received = [];
    const unsubscribe = bus.subscribe((event) => received.push(event));

    bus.publish(
      { type: bus.EVENT_TYPES.RECORD_CHANGED, orgId: "org-1" },
      { delayMs: 100 },
    );
    expect(received).toHaveLength(0);
    jest.advanceTimersByTime(100);
    expect(received).toHaveLength(1);

    unsubscribe();
  });

  it("isolates subscriber failures from publishers", () => {
    const failing = bus.subscribe(() => {
      throw new Error("boom");
    });
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});

    expect(() =>
      bus.publish(
        { type: bus.EVENT_TYPES.RECORD_CHANGED, orgId: "org-1" },
        { delayMs: 0 },
      ),
    ).not.toThrow();

    failing();
    errorSpy.mockRestore();
  });

  it("persists outbound events only when the model exists", async () => {
    const create = jest.fn().mockResolvedValue({ id: "evt-1" });
    const event = {
      type: bus.EVENT_TYPES.NOTIFICATION_CREATED,
      orgId: "org-1",
      recipientUserIds: ["u1"],
      payload: { count: 1 },
    };

    await expect(bus.recordOutboundEvent({ tx: {}, event })).resolves.toBeNull();
    await bus.recordOutboundEvent({ tx: { outboundEvent: { create } }, event });

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          orgId: "org-1",
          type: "notification.created",
          recipientUserIds: ["u1"],
          payloadJson: { count: 1 },
        }),
      }),
    );
  });

  it("builds record change events with compact summaries", () => {
    const event = bus.buildRecordEvent({
      orgId: "org-1",
      projectId: "project-1",
      entityType: "location",
      entityId: "loc-1",
      action: "created",
      oldStatus: null,
      newStatus: "active",
      summary: { name: "Level 1" },
    });

    expect(event).toEqual(
      expect.objectContaining({
        type: "record.changed",
        entityType: "location",
        payload: {
          oldStatus: null,
          newStatus: "active",
          summary: { name: "Level 1" },
        },
      }),
    );
  });
});
