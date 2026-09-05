const mockPrisma = {
  project: { findFirst: jest.fn() },
  location: {
    findMany: jest.fn(),
    findFirst: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  auditEvent: { create: jest.fn() },
  $transaction: jest.fn((fn) => fn(mockPrisma)),
};

jest.mock("../../config/db", () => ({ prisma: mockPrisma }));
jest.mock("../../events/bus", () => ({
  EVENT_TYPES: { RECORD_CHANGED: "record.changed" },
  buildRecordEvent: jest.fn((event) => event),
  recordOutboundEvent: jest.fn().mockResolvedValue(null),
  publish: jest.fn(),
}));

const locationService = require("../location.service");
const bus = require("../../events/bus");

const baseRow = (overrides = {}) => ({
  id: "loc-1",
  orgId: "org-1",
  projectId: "project-1",
  parentId: null,
  name: "Block A",
  code: null,
  kind: "building",
  path: "loc-1",
  depth: 0,
  sortOrder: 0,
  status: "active",
  description: null,
  createdBy: "pm-1",
  updatedBy: "pm-1",
  archivedAt: null,
  archivedBy: null,
  createdAt: new Date("2026-09-01T00:00:00.000Z"),
  updatedAt: new Date("2026-09-01T00:00:00.000Z"),
  ...overrides,
});

describe("location service", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPrisma.project.findFirst.mockResolvedValue({
      id: "project-1",
      orgId: "org-1",
    });
    mockPrisma.auditEvent.create.mockImplementation(({ data }) =>
      Promise.resolve({ id: "audit-1", createdAt: new Date(), ...data }),
    );
  });

  it("builds an ordered tree with full names and child counts", async () => {
    mockPrisma.location.findMany.mockResolvedValue([
      baseRow({ id: "b", name: "Block B", sortOrder: 1 }),
      baseRow({ id: "a", name: "Block A", sortOrder: 0 }),
      baseRow({
        id: "a-l1",
        name: "Level 1",
        parentId: "a",
        path: "a/a-l1",
        depth: 1,
        kind: "level",
      }),
    ]);

    const result = await locationService.listLocations({
      orgId: "org-1",
      projectId: "project-1",
    });

    expect(mockPrisma.location.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { projectId: "project-1", status: "active" },
      }),
    );
    expect(result.items.map((item) => item.id)).toEqual(["a", "a-l1", "b"]);
    expect(result.tree[0].children[0].fullName).toBe("Block A › Level 1");
    expect(result.tree[0].childCount).toBe(1);
    expect(result.summary).toEqual({
      total: 3,
      active: 3,
      archived: 0,
      roots: 2,
      maxDepth: 2,
    });
  });

  it("creates a child location with the parent path, depth and next sort order", async () => {
    const parent = baseRow({ id: "parent-1", path: "parent-1" });
    mockPrisma.location.findFirst
      .mockResolvedValueOnce(parent) // resolveParent
      .mockResolvedValueOnce(null) // duplicate name check
      .mockResolvedValueOnce({ sortOrder: 2 }); // last sibling
    mockPrisma.location.create.mockImplementation(({ data }) =>
      Promise.resolve(baseRow({ id: "child-1", ...data })),
    );
    mockPrisma.location.update.mockImplementation(({ where, data }) =>
      Promise.resolve(
        baseRow({
          id: where.id,
          parentId: "parent-1",
          depth: 1,
          sortOrder: 3,
          name: "Level 2",
          kind: "level",
          ...data,
        }),
      ),
    );

    const created = await locationService.createLocation({
      orgId: "org-1",
      projectId: "project-1",
      payload: { name: "  Level 2 ", parentId: "parent-1", kind: "level" },
      userId: "pm-1",
      userRole: "pm",
    });

    expect(mockPrisma.location.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          name: "Level 2",
          parentId: "parent-1",
          depth: 1,
          sortOrder: 3,
          kind: "level",
        }),
      }),
    );
    expect(mockPrisma.location.update).toHaveBeenCalledWith({
      where: { id: "child-1" },
      data: { path: "parent-1/child-1" },
    });
    expect(created.path).toBe("parent-1/child-1");
    expect(mockPrisma.auditEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          entityType: "location",
          action: "created",
        }),
      }),
    );
    expect(bus.publish).toHaveBeenCalled();
  });

  it("rejects duplicate sibling names and invalid kinds", async () => {
    mockPrisma.location.findFirst.mockResolvedValueOnce({ id: "existing" });

    await expect(
      locationService.createLocation({
        orgId: "org-1",
        projectId: "project-1",
        payload: { name: "Block A" },
      }),
    ).rejects.toMatchObject({ code: "LOCATION_DUPLICATE_NAME" });

    await expect(
      locationService.createLocation({
        orgId: "org-1",
        projectId: "project-1",
        payload: { name: "Block A", kind: "planet" },
      }),
    ).rejects.toMatchObject({ code: "LOCATION_KIND_INVALID" });
  });

  it("refuses to move a location under its own descendant", async () => {
    const root = baseRow({ id: "root", path: "root" });
    const grandchild = baseRow({
      id: "gc",
      parentId: "child",
      path: "root/child/gc",
      depth: 2,
    });
    mockPrisma.location.findFirst
      .mockResolvedValueOnce(root) // findLocation
      .mockResolvedValueOnce(grandchild); // resolveParent

    await expect(
      locationService.updateLocation({
        orgId: "org-1",
        projectId: "project-1",
        locationId: "root",
        payload: { parentId: "gc" },
      }),
    ).rejects.toMatchObject({ code: "LOCATION_INVALID_PARENT" });
    expect(mockPrisma.location.update).not.toHaveBeenCalled();
  });

  it("rewrites subtree paths and depths when a location moves", async () => {
    const moving = baseRow({ id: "m", path: "m", depth: 0 });
    const newParent = baseRow({ id: "p", path: "p", depth: 0 });
    const child = baseRow({ id: "c", parentId: "m", path: "m/c", depth: 1 });
    mockPrisma.location.findFirst
      .mockResolvedValueOnce(moving) // findLocation
      .mockResolvedValueOnce(newParent) // resolveParent
      .mockResolvedValueOnce(null) // duplicate name under new parent
      .mockResolvedValueOnce(null); // next sort order (no siblings)
    mockPrisma.location.findMany.mockResolvedValueOnce([moving, child]);
    mockPrisma.location.update.mockImplementation(({ where, data }) =>
      Promise.resolve(baseRow({ id: where.id, ...data })),
    );

    const result = await locationService.updateLocation({
      orgId: "org-1",
      projectId: "project-1",
      locationId: "m",
      payload: { parentId: "p" },
      userId: "pm-1",
      userRole: "pm",
    });

    expect(mockPrisma.location.update).toHaveBeenCalledWith({
      where: { id: "c" },
      data: { path: "p/m/c", depth: 2 },
    });
    expect(result.path).toBe("p/m");
    expect(result.depth).toBe(1);
    expect(result.parentId).toBe("p");
  });

  it("archives a subtree and reports the affected ids", async () => {
    const root = baseRow({ id: "root", path: "root" });
    const child = baseRow({ id: "kid", parentId: "root", path: "root/kid", depth: 1 });
    mockPrisma.location.findFirst.mockResolvedValueOnce(root);
    mockPrisma.location.findMany.mockResolvedValueOnce([root, child]);
    mockPrisma.location.update.mockImplementation(({ where, data }) =>
      Promise.resolve(baseRow({ id: where.id, ...data })),
    );

    const result = await locationService.archiveLocation({
      orgId: "org-1",
      projectId: "project-1",
      locationId: "root",
      reason: "Demolished",
      userId: "pm-1",
      userRole: "pm",
    });

    expect(result).toEqual(
      expect.objectContaining({
        archived: true,
        affectedCount: 2,
        affectedIds: ["root", "kid"],
      }),
    );
    expect(mockPrisma.auditEvent.create).toHaveBeenCalledTimes(2);
    expect(mockPrisma.auditEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: "archived",
          reason: "Demolished",
        }),
      }),
    );
  });

  it("blocks restoring a child whose parent is still archived", async () => {
    mockPrisma.location.findFirst
      .mockResolvedValueOnce(
        baseRow({ id: "kid", parentId: "root", path: "root/kid", status: "archived" }),
      )
      .mockResolvedValueOnce({ status: "archived" });

    await expect(
      locationService.restoreLocation({
        orgId: "org-1",
        projectId: "project-1",
        locationId: "kid",
      }),
    ).rejects.toMatchObject({ code: "LOCATION_PARENT_ARCHIVED" });
  });

  it("reorders direct siblings by index", async () => {
    mockPrisma.location.findMany.mockResolvedValueOnce([
      baseRow({ id: "a" }),
      baseRow({ id: "b" }),
    ]);
    mockPrisma.location.update.mockImplementation(({ where, data }) =>
      Promise.resolve(baseRow({ id: where.id, ...data })),
    );

    const rows = await locationService.reorderLocations({
      orgId: "org-1",
      projectId: "project-1",
      payload: { orderedIds: ["b", "a"] },
      userId: "pm-1",
    });

    expect(rows.map((row) => [row.id, row.sortOrder])).toEqual([
      ["b", 0],
      ["a", 1],
    ]);
  });
});
