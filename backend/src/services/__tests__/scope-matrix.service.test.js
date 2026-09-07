/**
 * The scope and responsibility matrix.
 *
 * The rule worth defending is that a matrix cannot be agreed with holes in it.
 * Agreeing a scope where nobody owns the crane is agreeing to argue about the
 * crane later, and the whole point of the screen is to make that impossible to
 * do by accident.
 */

const mockPrisma = {
  scopeMatrix: { findFirst: jest.fn(), findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
  scopeMatrixItem: { deleteMany: jest.fn(), createMany: jest.fn() },
  commitment: { findFirst: jest.fn() },
  $transaction: (fn) => fn(mockPrisma),
};

jest.mock("../../config/db", () => ({ prisma: mockPrisma }));
jest.mock("../audit.service", () => ({
  ENTITY_TYPES: { COMMITMENT: "commitment" },
  ACTIONS: { UPDATED: "updated", APPROVED: "approved" },
  recordEvent: jest.fn(async () => null),
}));

const service = require("../scope-matrix.service");

const item = (over = {}) => ({
  id: "item-1",
  kind: "scope",
  section: "Works",
  description: "Installation",
  responsibility: "subcontractor",
  notes: null,
  sortOrder: 0,
  ...over,
});

const matrix = (items) => ({
  id: "matrix-1",
  projectId: "project-1",
  commitmentId: "cm-1",
  bidPackageId: null,
  title: "SC-001 — scope and responsibility",
  status: "draft",
  notes: null,
  agreedAt: null,
  items,
});

describe("the matrix", () => {
  it("counts what is still unallocated, which is the point of the screen", () => {
    const result = service.serialize(
      matrix([
        item({ id: "a", responsibility: "subcontractor" }),
        item({ id: "b", description: "Crane", responsibility: null }),
        item({ id: "c", description: "Waste removal", responsibility: null }),
        item({ id: "d", kind: "exclusion", description: "Painting", responsibility: null }),
      ])
    );

    expect(result.summary.unallocated).toBe(2);
    expect(result.summary.allocated).toBe(1);
    // An exclusion is a statement, not work, so it is never "unallocated".
    expect(result.summary.byKind.exclusion).toBe(1);
  });

  it("labels each party in words rather than leaving a code on screen", () => {
    const result = service.serialize(matrix([item({ responsibility: "by_others" })]));
    expect(result.items[0].responsibilityLabel).toBe("By others");
  });

  it("opens with the rows that cause arguments already listed", () => {
    const descriptions = service.STARTER.map((row) => row.description);
    for (const row of ['Crane and lifting', 'Daily cleanup', 'Waste removal from site', 'Inspection requests']) {
      expect(descriptions).toContain(row);
    }
    // And they start unallocated, so the question is asked rather than assumed.
    expect(service.STARTER.every((row) => row.responsibility === undefined)).toBe(true);
  });
});

describe("normalising a row", () => {
  it("refuses an unknown party", () => {
    expect(() => service.normalizeItem({ description: "Crane", responsibility: "nobody" }, 0)).toThrow(
      expect.objectContaining({ code: "SCOPE_PARTY_INVALID" })
    );
  });

  it("refuses to allocate a clarification to anybody", () => {
    // A clarification is a statement about the scope, not work within it.
    expect(() =>
      service.normalizeItem(
        { kind: "clarification", description: "Rates assume daytime working", responsibility: "gc" },
        0
      )
    ).toThrow(expect.objectContaining({ code: "SCOPE_PARTY_NOT_ALLOWED" }));
  });

  it("insists on a description", () => {
    expect(() => service.normalizeItem({ description: "   " }, 0)).toThrow(
      expect.objectContaining({ code: "SCOPE_TEXT_REQUIRED" })
    );
  });

  it("keeps the order it was given when none is stated", () => {
    expect(service.normalizeItem({ description: "Crane" }, 7).sortOrder).toBe(7);
  });
});

describe("agreeing", () => {
  beforeEach(() => jest.clearAllMocks());

  it("refuses while any row of work has nobody against it, and names them", async () => {
    mockPrisma.scopeMatrix.findFirst.mockResolvedValue(
      matrix([
        item({ id: "a" }),
        item({ id: "b", description: "Crane and lifting", responsibility: null }),
      ])
    );

    let thrown = null;
    try {
      await service.agree({ orgId: "org-1", projectId: "project-1", commitmentId: "cm-1", userId: "u1" });
    } catch (error) {
      thrown = error;
    }

    expect(thrown.code).toBe("SCOPE_MATRIX_INCOMPLETE");
    expect(thrown.details.rows).toContain("Crane and lifting");
    expect(mockPrisma.scopeMatrix.update).not.toHaveBeenCalled();
  });

  it("agrees once every row of work is owned", async () => {
    mockPrisma.scopeMatrix.findFirst.mockResolvedValue(
      matrix([item({ id: "a" }), item({ id: "b", responsibility: "gc" })])
    );
    mockPrisma.scopeMatrix.update.mockResolvedValue(matrix([]));

    await service.agree({ orgId: "org-1", projectId: "project-1", commitmentId: "cm-1", userId: "u1" });
    expect(mockPrisma.scopeMatrix.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "agreed" }) })
    );
  });

  it("ignores unallocated statements, which are not work", async () => {
    mockPrisma.scopeMatrix.findFirst.mockResolvedValue(
      matrix([
        item({ id: "a" }),
        item({ id: "b", kind: "inclusion", description: "Includes making good", responsibility: null }),
        item({ id: "c", kind: "interface", description: "Coordinate with M&E", responsibility: null }),
      ])
    );
    mockPrisma.scopeMatrix.update.mockResolvedValue(matrix([]));

    await service.agree({ orgId: "org-1", projectId: "project-1", commitmentId: "cm-1", userId: "u1" });
    expect(mockPrisma.scopeMatrix.update).toHaveBeenCalled();
  });
});

describe("changing an agreed matrix", () => {
  beforeEach(() => jest.clearAllMocks());

  it("is refused until it is reopened", async () => {
    mockPrisma.scopeMatrix.findFirst.mockResolvedValue({ id: "matrix-1", status: "agreed" });
    await expect(
      service.replaceItems({
        orgId: "org-1",
        projectId: "project-1",
        commitmentId: "cm-1",
        userId: "u1",
        payload: { items: [] },
      })
    ).rejects.toThrow(expect.objectContaining({ code: "SCOPE_MATRIX_AGREED" }));
  });

  it("needs a reason to reopen, because the contract quotes it", async () => {
    mockPrisma.scopeMatrix.findFirst.mockResolvedValue(matrix([item()]));
    mockPrisma.scopeMatrix.findFirst.mockResolvedValue({ ...matrix([item()]), status: "agreed" });

    await expect(
      service.reopen({ orgId: "org-1", projectId: "project-1", commitmentId: "cm-1", userId: "u1" })
    ).rejects.toThrow(expect.objectContaining({ code: "SCOPE_REOPEN_REASON_REQUIRED" }));
  });
});
