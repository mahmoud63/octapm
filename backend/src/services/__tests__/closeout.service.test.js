/**
 * Subcontract closeout.
 *
 * The design worth defending is that half the checklist is derived and cannot
 * be ticked. A tickbox next to "punch list closed" is a tickbox somebody ticks
 * on the way to getting paid; reading the punch register is not.
 */

const mockPrisma = {
  commitment: { findFirst: jest.fn() },
  subcontractCloseout: { findFirst: jest.fn(), create: jest.fn(), update: jest.fn() },
  closeoutItem: { upsert: jest.fn(async () => ({})) },
  subPayApp: { findMany: jest.fn(async () => []) },
  punchItem: { count: jest.fn(async () => 0) },
  projectDocument: { findFirst: jest.fn(async () => ({ id: "doc-1" })) },
};

jest.mock("../../config/db", () => ({ prisma: mockPrisma }));
jest.mock("../audit.service", () => ({
  ENTITY_TYPES: { COMMITMENT: "commitment" },
  ACTIONS: { UPDATED: "updated", APPROVED: "approved" },
  recordEvent: jest.fn(async () => null),
}));
// who may name a document as close-out evidence is decided in document-text.service (certification R29)
const mockLinkable = jest.fn(async () => undefined);
jest.mock("../document-text.service", () => ({ assertDocumentsLinkable: (...args) => mockLinkable(...args) }));

const service = require("../closeout.service");

const ARGS = { orgId: "org-1", projectId: "project-1", commitmentId: "cm-1" };

const commitment = (over = {}) => ({
  id: "cm-1",
  ref: "SC-0001",
  title: "Frame",
  type: "subcontract",
  status: "executed",
  currency: "USD",
  vendorCompanyId: "vendor-1",
  insuranceJson: [{ type: "general_liability", required: true, documentId: "doc-9" }],
  ...over,
});

const record = (items = []) => ({
  id: "closeout-1",
  status: "open",
  notes: null,
  completedAt: null,
  items,
});

/** The handover rows a fresh closeout starts with. */
const handoverRows = () =>
  service.HANDOVER.map((item, index) => ({
    id: `item-${index}`,
    key: item.key,
    label: item.label,
    required: item.required !== false,
    status: "outstanding",
    documentId: null,
    note: null,
    waivedReason: null,
    completedAt: null,
    sortOrder: index,
  }));

const setup = ({ commitmentOver = {}, items = handoverRows(), payApps = [], openPunch = 0 } = {}) => {
  mockPrisma.commitment.findFirst.mockResolvedValue(commitment(commitmentOver));
  mockPrisma.subcontractCloseout.findFirst.mockResolvedValue(record(items));
  mockPrisma.subPayApp.findMany.mockResolvedValue(payApps);
  mockPrisma.punchItem.count.mockResolvedValue(openPunch);
};

const itemFor = (closeout, key) => closeout.items.find((item) => item.key === key);

describe("the derived half", () => {
  beforeEach(() => jest.clearAllMocks());

  it("reads the punch list against this subcontractor, not the whole project", async () => {
    setup({ openPunch: 3 });
    const closeout = await service.buildCloseout(ARGS);

    expect(itemFor(closeout, "punch_closed").status).toBe("outstanding");
    expect(itemFor(closeout, "punch_closed").detail).toBe("3 punch items still open");
    expect(mockPrisma.punchItem.count).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ assigneeCompanyId: "vendor-1" }),
      })
    );
  });

  it("holds the account open while an application is still in review", () => {
    const state = service.accountState({
      commitment: commitment(),
      payApps: [
        { status: "paid", grossThisPeriod: 100, netThisPeriod: 90, paidAmount: 90, retentionThisPeriod: 10 },
        { status: "under_review", grossThisPeriod: 50, netThisPeriod: 45, paidAmount: 0, retentionThisPeriod: 5 },
      ],
    });
    expect(state.ok).toBe(false);
    expect(state.detail).toContain("still open");
  });

  it("holds the account open while approved money is unpaid", () => {
    const state = service.accountState({
      commitment: commitment(),
      payApps: [
        { status: "approved", grossThisPeriod: 100, netThisPeriod: 90, paidAmount: 20, retentionThisPeriod: 10 },
      ],
    });
    expect(state.ok).toBe(false);
    expect(state.detail).toContain("70");
  });

  it("settles the account once everything approved is paid", () => {
    const state = service.accountState({
      commitment: commitment(),
      payApps: [
        { status: "paid", grossThisPeriod: 100, netThisPeriod: 90, paidAmount: 90, retentionThisPeriod: 10 },
      ],
    });
    expect(state.ok).toBe(true);
  });

  it("keeps retention outstanding until it is released", () => {
    const held = service.retentionState({
      payApps: [{ status: "paid", retentionThisPeriod: 12_500 }],
    });
    expect(held.ok).toBe(false);
    expect(held.held).toBe(12_500);

    const none = service.retentionState({ payApps: [{ status: "paid", retentionThisPeriod: 0 }] });
    expect(none.ok).toBe(true);
  });

  it("fails insurance that is on file but expired", () => {
    const state = service.insuranceState(
      commitment({
        insuranceJson: [
          { type: "general_liability", required: true, documentId: "doc-9", expiresAt: "2020-01-01" },
        ],
      })
    );
    expect(state.ok).toBe(false);
    expect(state.detail).toContain("missing or expired");
  });

  it("ignores cover the commitment does not require", () => {
    const state = service.insuranceState(
      commitment({ insuranceJson: [{ type: "auto", required: false, documentId: null }] })
    );
    expect(state.ok).toBe(true);
  });
});

describe("ticking and waiving", () => {
  beforeEach(() => jest.clearAllMocks());

  it("refuses to let a derived check be ticked by hand", async () => {
    setup({ openPunch: 2 });
    await expect(
      service.updateItem({ ...ARGS, key: "punch_closed", payload: { status: "complete" }, userId: "u1" })
    ).rejects.toThrow(expect.objectContaining({ code: "CLOSEOUT_DERIVED_ITEM" }));
  });

  it("lets a derived check be waived, with a reason", async () => {
    setup({ openPunch: 2 });
    await service.updateItem({
      ...ARGS,
      key: "punch_closed",
      payload: { status: "waived", waivedReason: "Remaining snags are the client's own trades" },
      userId: "u1",
    });
    expect(mockPrisma.closeoutItem.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({ status: "waived" }),
      })
    );
  });

  it("insists on a reason for a waiver", async () => {
    setup();
    await expect(
      service.updateItem({ ...ARGS, key: "as_builts", payload: { status: "waived" }, userId: "u1" })
    ).rejects.toThrow(expect.objectContaining({ code: "CLOSEOUT_WAIVER_REASON_REQUIRED" }));
  });

  it("refuses a requirement nobody has heard of", async () => {
    setup();
    await expect(
      service.updateItem({ ...ARGS, key: "free_lunch", payload: {}, userId: "u1" })
    ).rejects.toThrow(expect.objectContaining({ code: "CLOSEOUT_ITEM_UNKNOWN" }));
  });

  it("lets a waiver survive the thing it waived changing underneath it", async () => {
    // The punch list is still open, but somebody waived it. The live answer
    // must not quietly un-waive itself the next time a snag is raised.
    setup({
      openPunch: 4,
      items: [
        ...handoverRows(),
        {
          id: "override-1",
          key: "punch_closed",
          label: "Punch list closed",
          required: true,
          status: "waived",
          waivedReason: "Client trades",
          documentId: null,
          note: null,
          completedAt: new Date(),
          sortOrder: 0,
        },
      ],
    });

    const closeout = await service.buildCloseout(ARGS);
    expect(itemFor(closeout, "punch_closed").status).toBe("waived");
    expect(itemFor(closeout, "punch_closed").waivedReason).toBe("Client trades");
  });
});

describe("the gate", () => {
  beforeEach(() => jest.clearAllMocks());

  it("refuses while anything required is outstanding, and names it", async () => {
    setup({ openPunch: 1 });
    let thrown = null;
    try {
      await service.assertReady(ARGS);
    } catch (error) {
      thrown = error;
    }
    expect(thrown.code).toBe("CLOSEOUT_OUTSTANDING");
    expect(thrown.details.outstanding).toContain("Punch list closed");
    expect(thrown.details.outstanding).toContain("As-built records submitted");
  });

  it("goes ahead on an override, so nobody has to fake the checklist", async () => {
    setup({ openPunch: 1 });
    const closeout = await service.assertReady({
      ...ARGS,
      override: "Retention released against a bank guarantee",
    });
    expect(closeout.ready).toBe(false);
  });

  it("passes once every required item is settled", async () => {
    const done = handoverRows().map((item) => ({ ...item, status: "complete" }));
    setup({ items: done });

    const closeout = await service.buildCloseout(ARGS);
    expect(closeout.ready).toBe(true);
    expect(closeout.outstanding).toEqual([]);
    await expect(service.assertReady(ARGS)).resolves.toBeTruthy();
  });

  it("does not hold an optional item against the gate", async () => {
    // Training and spares are optional; leaving them open must not block.
    const done = handoverRows().map((item) =>
      item.required ? { ...item, status: "complete" } : item
    );
    setup({ items: done });

    const closeout = await service.buildCloseout(ARGS);
    expect(closeout.ready).toBe(true);
  });
});

describe("certification R29 — close-out evidence names only a file its writer may read", () => {
  beforeEach(() => {
    mockLinkable.mockReset();
    mockLinkable.mockImplementation(async () => undefined);
    mockPrisma.closeoutItem.upsert.mockClear();
  });
  afterEach(() => {
    delete mockPrisma.closeoutItem.findUnique;
  });

  it("asks about the evidence as the writer, keeping the item's current evidence, and refuses it as a missing one", async () => {
    setup();
    mockPrisma.closeoutItem.findUnique = jest.fn(async () => ({ documentId: "doc-old" }));
    await service.updateItem({ ...ARGS, key: "training", payload: { status: "complete", documentId: "doc-1" }, userId: "qs-1" });
    const call = mockLinkable.mock.calls[0][0];
    expect(call).toMatchObject({ orgId: "org-1", projectId: "project-1", keys: ["doc-1"], unchanged: ["doc-old"], userId: "qs-1" });
    expect(mockPrisma.closeoutItem.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { closeoutId_key: { closeoutId: "closeout-1", key: "training" } } }));
    expect(call.refuse()).toMatchObject({ status: 404, code: "DOCUMENT_NOT_FOUND" });
    mockPrisma.closeoutItem.upsert.mockClear();
    mockLinkable.mockImplementation(async ({ refuse }) => { throw refuse(); });
    await expect(service.updateItem({ ...ARGS, key: "training", payload: { status: "complete", documentId: "doc-1" }, userId: "qs-1" })).rejects.toMatchObject({ status: 404, code: "DOCUMENT_NOT_FOUND" });
    expect(mockPrisma.closeoutItem.upsert).not.toHaveBeenCalled();
  });

  it("an item marked without evidence names no document", async () => {
    setup();
    await service.updateItem({ ...ARGS, key: "training", payload: { status: "complete" }, userId: "qs-1" });
    expect(mockLinkable).not.toHaveBeenCalled();
  });
});
