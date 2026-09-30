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

  // A caller's transaction client as Prisma gives it: raw SQL, no $transaction.
  const transactionClient = (create) => {
    const sql = [];
    return {
      sql,
      tx: {
        $executeRawUnsafe: jest.fn(async (statement) => {
          sql.push(statement.replace(/outbound_event_[0-9a-f]{16}/, "sp"));
          return 0;
        }),
        outboundEvent: { create },
      },
    };
  };
  const recordEvent = { type: bus.EVENT_TYPES.RECORD_CHANGED, orgId: "org-1", projectId: "p-1" };

  it("inside a caller's transaction, writes the outbound event under its own savepoint and releases it", async () => {
    const { tx, sql } = transactionClient(jest.fn(async ({ data }) => ({ id: data.id })));
    const row = await bus.recordOutboundEvent({ tx, event: recordEvent });
    expect(typeof row.id).toBe("string");
    expect(sql).toEqual(["SAVEPOINT sp", "RELEASE SAVEPOINT sp"]);
    expect(tx.$executeRawUnsafe.mock.calls[0][0]).toMatch(/^SAVEPOINT outbound_event_[0-9a-f]{16}$/);
  });

  it("a refused outbound insert is rolled back to its savepoint and rethrown as it was — the caller's transaction is intact", async () => {
    const refused = Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
    const { tx, sql } = transactionClient(jest.fn().mockRejectedValue(refused));
    const thrown = await bus.recordOutboundEvent({ tx, event: recordEvent }).catch((error) => error);
    expect(thrown).toBe(refused);
    expect(thrown.transactionAborted).toBeUndefined();
    expect(sql).toEqual(["SAVEPOINT sp", "ROLLBACK TO SAVEPOINT sp", "RELEASE SAVEPOINT sp"]);
  });

  it("a savepoint that cannot be rolled back to says the caller's transaction is aborted", async () => {
    const { tx } = transactionClient(jest.fn().mockRejectedValue(new Error("refused")));
    tx.$executeRawUnsafe.mockImplementation(async (statement) => {
      if (statement.startsWith("ROLLBACK")) throw new Error("connection lost");
      return 0;
    });
    const thrown = await bus.recordOutboundEvent({ tx, event: recordEvent }).catch((error) => error);
    expect([thrown.message, thrown.transactionAborted]).toEqual(["connection lost", true]);
  });

  it("the base client (it can open transactions) writes the outbound event without a savepoint", async () => {
    const create = jest.fn(async ({ data }) => ({ id: data.id }));
    const client = { $transaction: jest.fn(), $executeRawUnsafe: jest.fn(), outboundEvent: { create } };
    await bus.recordOutboundEvent({ tx: client, event: recordEvent });
    expect(client.$executeRawUnsafe).not.toHaveBeenCalled();
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("an event recorded in a transaction is announced once its row is visible after COMMIT, and never if the transaction rolled back", async () => {
    jest.useFakeTimers();
    const received = [];
    const unsubscribe = bus.subscribe((event) => received.push(event.id));
    const { tx } = transactionClient(jest.fn());
    const committed = new Set();
    const client = { outboundEvent: { findUnique: jest.fn(async ({ where }) => (committed.has(where.id) ? { id: where.id } : null)) } };
    const settle = async (ms) => {
      await jest.advanceTimersByTimeAsync(ms);
    };

    bus.publishRecorded({ ...recordEvent, id: "evt-commits" }, { tx, client, delayMs: 100 });
    bus.publishRecorded({ ...recordEvent, id: "evt-rolls-back" }, { tx, client, delayMs: 100 });
    await settle(100);
    // Neither transaction has committed yet: nothing is announced.
    expect(received).toEqual([]);
    committed.add("evt-commits");
    await settle(400);
    expect(received).toEqual(["evt-commits"]);
    // The other never commits: never announced, and asked no more after the window.
    await settle(60000);
    expect(received).toEqual(["evt-commits"]);
    const asked = client.outboundEvent.findUnique.mock.calls.filter(([query]) => query.where.id === "evt-rolls-back").length;
    await settle(60000);
    expect(client.outboundEvent.findUnique.mock.calls.filter(([query]) => query.where.id === "evt-rolls-back").length).toBe(asked);
    unsubscribe();
  });

  it("an event published outside a transaction is announced after the delay, without a lookup", () => {
    jest.useFakeTimers();
    const received = [];
    const unsubscribe = bus.subscribe((event) => received.push(event.id));
    const client = { outboundEvent: { findUnique: jest.fn() } };
    bus.publishRecorded({ ...recordEvent, id: "evt-base" }, { tx: { $transaction: jest.fn(), $executeRawUnsafe: jest.fn() }, client, delayMs: 100 });
    jest.advanceTimersByTime(100);
    expect(received).toEqual(["evt-base"]);
    expect(client.outboundEvent.findUnique).not.toHaveBeenCalled();
    unsubscribe();
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
