/**
 * Certification CERT-2: an activity material's master entry must be one of the
 * project's own — another company's (or one that exists nowhere) is answered as
 * missing, before anything is written.
 */

const mockTx = {
  procurementSupplier: { findFirst: jest.fn(), create: jest.fn() },
  procurementPackage: { findFirst: jest.fn() },
  materialMaster: { findFirst: jest.fn() },
  activityMaterial: { create: jest.fn(), update: jest.fn(), delete: jest.fn(async () => ({})) },
  procurementLeadTimeAlert: { findMany: jest.fn(async () => []), update: jest.fn(async ({ data }) => data) },
};
const mockPrisma = {
  project: { findFirst: jest.fn() },
  activity: { findFirst: jest.fn() },
  activityMaterial: { findFirst: jest.fn() },
  $transaction: jest.fn(async (fn) => fn(mockTx)),
};
jest.mock("../../config/db", () => ({ prisma: mockPrisma }));
jest.mock("../procurement.service", () => ({
  ACTIVITY_SELECT: { id: true },
  syncLeadTimeAlert: jest.fn(async () => null),
  enrichActivityMaterial: jest.fn((row) => row),
}));

const materialService = require("../material.service");

const OWN_MASTER = "11111111-1111-4111-8111-111111111111";
const FOREIGN_MASTER = "22222222-2222-4222-8222-222222222222";

describe("activity material: the master entry is the project's own", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPrisma.project.findFirst.mockResolvedValue({ id: "p1", orgId: "org-1" });
    mockPrisma.activity.findFirst.mockResolvedValue({ id: "a1", projectId: "p1" });
    mockTx.materialMaster.findFirst.mockImplementation(async ({ where }) => (where.id === OWN_MASTER && where.projectId === "p1" ? { id: OWN_MASTER, projectId: "p1" } : null));
    mockTx.activityMaterial.create.mockImplementation(async ({ data }) => ({ id: "m1", ...data }));
  });

  const add = (materialMasterId) =>
    materialService.addMaterial({ orgId: "org-1", projectId: "p1", activityId: "a1", payload: { name: "Rebar", unit: "TON", qty: 5, materialMasterId }, actor: { id: "u1" } });

  it("adds a material that names the project's own master entry", async () => {
    const row = await add(OWN_MASTER);
    expect(row.materialMasterId).toBe(OWN_MASTER);
    expect(mockTx.materialMaster.findFirst).toHaveBeenCalledWith({ where: { id: OWN_MASTER, projectId: "p1" } });
  });

  it("refuses another company's master entry as missing, and writes nothing", async () => {
    await expect(add(FOREIGN_MASTER)).rejects.toMatchObject({ status: 404, code: "MATERIAL_NOT_FOUND" });
    expect(mockTx.activityMaterial.create).not.toHaveBeenCalled();
  });

  it("answers an id that exists nowhere the same way (no 500 from the foreign key)", async () => {
    await expect(add("33333333-3333-4333-8333-333333333333")).rejects.toMatchObject({ status: 404, code: "MATERIAL_NOT_FOUND" });
    expect(mockTx.activityMaterial.create).not.toHaveBeenCalled();
  });

  it("leaves a material without a master entry alone", async () => {
    const row = await add(undefined);
    expect(mockTx.materialMaster.findFirst).not.toHaveBeenCalled();
    expect(row.id).toBe("m1");
  });
});

/**
 * CERT-2 (alerts-money-5): deleting a planned material must not take its
 * package's lead-time alert with it. The alert's link to the material
 * cascades on delete, so a package alert whose worst risk was the material was
 * deleted outright while the package's other lines were still late.
 */
describe("deleting a material: its package's lead-time alert is kept and worked again", () => {
  const procurement = require("../procurement.service");
  beforeEach(() => {
    jest.clearAllMocks();
    mockPrisma.project.findFirst.mockResolvedValue({ id: "p1", orgId: "org-1" });
    mockPrisma.activity.findFirst.mockResolvedValue({ id: "a1", projectId: "p1" });
    mockPrisma.activityMaterial.findFirst.mockResolvedValue({ id: "m1", activityId: "a1", procurementPackageId: "pkg-1", poLines: [], usages: [] });
    mockTx.procurementLeadTimeAlert.findMany.mockResolvedValue([]);
  });

  it("releases the package alert's link to the material before the delete, then syncs that package", async () => {
    mockTx.procurementLeadTimeAlert.findMany.mockResolvedValue([{ id: "alert-pkg", packageId: "pkg-1" }]);
    await expect(materialService.deleteMaterial({ orgId: "org-1", projectId: "p1", activityId: "a1", materialId: "m1" })).resolves.toEqual({ deleted: true });
    expect(mockTx.procurementLeadTimeAlert.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { projectId: "p1", activityMaterialId: "m1", packageId: { not: null } } }));
    expect(mockTx.procurementLeadTimeAlert.update).toHaveBeenCalledWith({ where: { id: "alert-pkg" }, data: { activityMaterialId: null } });
    expect(mockTx.procurementLeadTimeAlert.update.mock.invocationCallOrder[0]).toBeLessThan(mockTx.activityMaterial.delete.mock.invocationCallOrder[0]);
    expect(procurement.syncLeadTimeAlert).toHaveBeenCalledWith(expect.objectContaining({ tx: mockTx, projectId: "p1", packageRow: { id: "pkg-1" } }));
    expect(mockTx.activityMaterial.delete.mock.invocationCallOrder[0]).toBeLessThan(procurement.syncLeadTimeAlert.mock.invocationCallOrder[0]);
  });

  it("a material no package alert points at is simply deleted", async () => {
    await materialService.deleteMaterial({ orgId: "org-1", projectId: "p1", activityId: "a1", materialId: "m1" });
    expect(mockTx.activityMaterial.delete).toHaveBeenCalledWith({ where: { id: "m1" } });
    expect(mockTx.procurementLeadTimeAlert.update).not.toHaveBeenCalled();
    expect(procurement.syncLeadTimeAlert).not.toHaveBeenCalled();
  });
});
