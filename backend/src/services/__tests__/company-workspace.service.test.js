const mockPrisma = {
  $transaction: jest.fn((fn) => fn(mockPrisma)),
  company: { findMany: jest.fn(), findFirst: jest.fn(), create: jest.fn(), update: jest.fn() },
  user: { count: jest.fn() },
  procurementSupplier: { findMany: jest.fn() },
  costCode: { findMany: jest.fn(), findFirst: jest.fn(), create: jest.fn(), update: jest.fn() },
  companyEquipment: { findMany: jest.fn(), findFirst: jest.fn(), create: jest.fn(), update: jest.fn() },
  authAuditEvent: { create: jest.fn() },
};

jest.mock("../../config/db", () => ({ prisma: mockPrisma }));

const service = require("../company-workspace.service");

const VENDOR_ID = "11111111-1111-4111-8111-111111111111";

describe("company workspace: vendors", () => {
  beforeEach(() => jest.clearAllMocks());

  it("creates a vendor or promotes an existing company with the same name", async () => {
    mockPrisma.company.findFirst.mockResolvedValue(null);
    mockPrisma.company.create.mockImplementation(({ data }) =>
      Promise.resolve({ id: VENDOR_ID, ...data, _count: { memberships: 0, projectParties: 0, procurementSuppliers: 0 } }),
    );
    const created = await service.createVendor({
      orgId: "org-1",
      actorId: "u1",
      payload: { name: " Acme Steel ", trades: "Steel, rebar, steel", leadTimeReliability: 92, email: "sales@acme.test" },
    });
    expect(mockPrisma.company.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          orgId: "org-1",
          type: "vendor",
          isVendor: true,
          name: "Acme Steel",
          trades: ["Steel", "rebar"],
          vendorProfileJson: { leadTimeReliability: 92 },
        }),
      }),
    );
    expect(created).toMatchObject({ name: "Acme Steel", isVendor: true, trades: ["Steel", "rebar"] });
    expect(mockPrisma.authAuditEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ entityType: "vendor", action: "created" }) }),
    );

    mockPrisma.company.findFirst.mockResolvedValue({ id: VENDOR_ID, name: "Acme Steel", type: "external", isVendor: false });
    mockPrisma.company.update.mockImplementation(({ data }) =>
      Promise.resolve({ id: VENDOR_ID, name: "Acme Steel", ...data, _count: {} }),
    );
    const promoted = await service.createVendor({ orgId: "org-1", payload: { name: "acme steel" } });
    expect(mockPrisma.company.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: VENDOR_ID }, data: expect.objectContaining({ isVendor: true, type: "vendor" }) }),
    );
    expect(promoted.isVendor).toBe(true);
  });

  it("rejects empty names and duplicate renames", async () => {
    await expect(service.createVendor({ orgId: "org-1", payload: { name: "  " } })).rejects.toMatchObject({
      code: "VENDOR_NAME_REQUIRED",
    });
    mockPrisma.company.findFirst
      .mockResolvedValueOnce({ id: VENDOR_ID, name: "Acme", vendorProfileJson: {} })
      .mockResolvedValueOnce({ id: "other" });
    await expect(
      service.updateVendor({ orgId: "org-1", vendorId: VENDOR_ID, payload: { name: "Beta" } }),
    ).rejects.toMatchObject({ code: "VENDOR_DUPLICATE_NAME" });
  });

  it("builds the supplier de-duplication report", async () => {
    mockPrisma.procurementSupplier.findMany.mockResolvedValue([
      { id: "s1", name: "Acme", projectId: "p1", companyId: VENDOR_ID, status: "approved", project: { name: "Tower A" }, company: { id: VENDOR_ID, name: "Acme" } },
      { id: "s2", name: "ACME", projectId: "p2", companyId: VENDOR_ID, status: "approved", project: { name: "Tower B" }, company: { id: VENDOR_ID, name: "Acme" } },
      { id: "s3", name: "Solo", projectId: "p1", companyId: "c2", status: "approved", project: { name: "Tower A" }, company: { id: "c2", name: "Solo" } },
      { id: "s4", name: "Orphan", projectId: "p2", companyId: null, status: "pending", project: { name: "Tower B" }, company: null },
    ]);
    const report = await service.vendorMigrationReport({ orgId: "org-1" });
    expect(report.summary).toEqual({ suppliers: 4, linked: 3, unlinked: 1, vendors: 2, mergedVendors: 1 });
    expect(report.merged[0]).toMatchObject({ companyId: VENDOR_ID, name: "Acme" });
    expect(report.merged[0].suppliers).toHaveLength(2);
    expect(report.unlinked).toEqual([{ supplierId: "s4", name: "Orphan", projectId: "p2", projectName: "Tower B" }]);
  });
});

describe("company workspace: cost codes", () => {
  beforeEach(() => jest.clearAllMocks());

  it("validates categories, uppercases codes and rejects duplicates", async () => {
    await expect(
      service.createCostCode({ orgId: "org-1", payload: { code: "01-100", name: "Excavation", category: "plumbing" } }),
    ).rejects.toMatchObject({ code: "COST_CODE_CATEGORY_INVALID" });

    mockPrisma.costCode.findFirst.mockResolvedValueOnce({ id: "dup" });
    await expect(
      service.createCostCode({ orgId: "org-1", payload: { code: "01-100", name: "Excavation" } }),
    ).rejects.toMatchObject({ code: "COST_CODE_DUPLICATE" });

    mockPrisma.costCode.findFirst.mockResolvedValue(null);
    mockPrisma.costCode.create.mockImplementation(({ data }) => Promise.resolve({ id: "cc1", ...data, _count: { children: 0 } }));
    const created = await service.createCostCode({
      orgId: "org-1",
      payload: { code: "01-100", name: "Excavation", category: "labour" },
    });
    expect(created).toMatchObject({ code: "01-100", category: "labour", childCount: 0 });
  });

  it("imports rows and wires parents by code in a second pass", async () => {
    mockPrisma.costCode.findMany.mockResolvedValue([{ id: "existing-01", code: "01" }]);
    mockPrisma.costCode.update.mockImplementation(({ where, data }) => Promise.resolve({ id: where.id, code: data.code || "01", ...data }));
    mockPrisma.costCode.create.mockImplementation(({ data }) => Promise.resolve({ id: `new-${data.code}`, ...data }));

    const result = await service.importCostCodes({
      orgId: "org-1",
      rows: [
        { code: "01", name: "General" },
        { code: "01-100", name: "Excavation", parentCode: "01", category: "labour" },
        { code: "02", name: "Concrete" },
      ],
    });

    expect(result).toEqual({ created: 2, updated: 1 });
    expect(mockPrisma.costCode.update).toHaveBeenCalledWith({
      where: { id: "new-01-100" },
      data: { parentId: "existing-01" },
    });
    await expect(service.importCostCodes({ orgId: "org-1", rows: [] })).rejects.toMatchObject({ code: "COST_CODE_ROWS_REQUIRED" });
  });
});

describe("company workspace: equipment masters", () => {
  beforeEach(() => jest.clearAllMocks());

  it("creates equipment with a validated rate and blocks duplicate names", async () => {
    mockPrisma.companyEquipment.findFirst.mockResolvedValue(null);
    mockPrisma.companyEquipment.create.mockImplementation(({ data }) => Promise.resolve({ id: "eq1", ...data, _count: { equipment: 0 } }));
    const created = await service.createCompanyEquipment({
      orgId: "org-1",
      payload: { name: "Tower crane", rateType: "daily", rate: "1250.555" },
    });
    expect(created).toMatchObject({ name: "Tower crane", rateType: "daily", rate: 1250.56 });

    await expect(
      service.createCompanyEquipment({ orgId: "org-1", payload: { name: "Crane", rateType: "weekly" } }),
    ).rejects.toMatchObject({ code: "INVALID_RATE_TYPE" });

    mockPrisma.companyEquipment.findFirst.mockResolvedValue({ id: "dup" });
    await expect(
      service.createCompanyEquipment({ orgId: "org-1", payload: { name: "tower crane" } }),
    ).rejects.toMatchObject({ code: "EQUIPMENT_DUPLICATE" });
  });
});

describe("company workspace: directory", () => {
  it("lists companies with counts and a user summary", async () => {
    mockPrisma.company.findMany.mockResolvedValue([
      { id: "c1", orgId: "org-1", name: "Acme", isVendor: true, status: "active", trades: [], vendorProfileJson: {}, _count: { memberships: 2, projectParties: 3, procurementSuppliers: 1 } },
      { id: "c2", orgId: "org-1", name: "Owner Co", isVendor: false, status: "active", trades: [], vendorProfileJson: {}, _count: { memberships: 0, projectParties: 1, procurementSuppliers: 0 } },
    ]);
    mockPrisma.user.count.mockResolvedValueOnce(12).mockResolvedValueOnce(10);
    const result = await service.listDirectory({ orgId: "org-1", query: { search: "co" } });
    expect(result.summary).toEqual({ companies: 2, vendors: 1, users: 12, activeUsers: 10 });
    expect(result.items[0]).toMatchObject({ name: "Acme", memberCount: 2, projectCount: 3, supplierCount: 1 });
  });
});
