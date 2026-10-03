const mockPrisma = {
  $transaction: jest.fn((fn) => fn(mockPrisma)),
  projectTemplate: { findMany: jest.fn(), findFirst: jest.fn(), create: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
  project: { update: jest.fn() },
  projectAssignment: { upsert: jest.fn() },
  projectUserPermission: { upsert: jest.fn() },
  company: { findMany: jest.fn() },
  permissionTemplate: { findMany: jest.fn() },
  user: { findMany: jest.fn() },
  authAuditEvent: { create: jest.fn() },
};
const mockProjectService = { createProject: jest.fn(), getProjectById: jest.fn() };
const mockCompanyPartyService = { upsertProjectPartyWithTx: jest.fn() };
const mockLocationService = { createLocation: jest.fn() };

jest.mock("../../config/db", () => ({ prisma: mockPrisma }));
jest.mock("../project.service", () => mockProjectService);
jest.mock("../company-party.service", () => mockCompanyPartyService);
jest.mock("../location.service", () => mockLocationService);

const service = require("../project-template.service");

const TEMPLATE_ID = "11111111-1111-4111-8111-111111111111";
const COMPANY_ID = "22222222-2222-4222-8222-222222222222";
const PERM_ID = "33333333-3333-4333-8333-333333333333";
const USER_ID = "44444444-4444-4444-8444-444444444444";

describe("project template normalization", () => {
  it("keeps only known settings and validates parties, folders and locations", () => {
    expect(service.normalizeSettings({ currency: "AED", contractType: "lump_sum", bogus: 1, location: "" })).toEqual({
      currency: "AED",
      contractType: "lump_sum",
      location: null,
    });
    expect(() => service.normalizeParties([{ role: "vendor", companyName: "X" }])).toThrow(/role/);
    expect(() => service.normalizeParties([{ role: "owner" }])).toThrow(/companyId or companyName/);
    expect(service.normalizeParties([{ role: "Owner", companyName: " Client Co ", permissionTemplateId: PERM_ID }])).toEqual([
      { role: "owner", companyId: null, companyName: "Client Co", accessLevel: "collaborator", permissionTemplateId: PERM_ID, contactName: null, contactEmail: null },
    ]);
    expect(service.normalizeFolders(["/Contract/", "Drawings/IFC", "Contract", { path: "Photos" }])).toEqual([
      "Contract",
      "Drawings/IFC",
      "Photos",
    ]);
    expect(() => service.normalizeLocations([{ kind: "site" }])).toThrow(/name/);
    expect(service.normalizeLocations([{ name: "Block A", kind: "building", children: [{ name: "L1", kind: "level" }] }])).toEqual([
      { name: "Block A", kind: "building", code: null, children: [{ name: "L1", kind: "level", code: null, children: [] }] },
    ]);
  });
});

describe("create project from template", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPrisma.projectTemplate.findFirst.mockResolvedValue({
      id: TEMPLATE_ID,
      orgId: "org-1",
      name: "Residential tower",
      status: "active",
      settingsJson: { currency: "AED", contractType: "lump_sum", weatherAllowanceDays: 15 },
      partiesJson: [
        { role: "owner", companyId: COMPANY_ID, accessLevel: "reviewer", permissionTemplateId: PERM_ID },
        { role: "consultant", companyName: "Design Co", accessLevel: "collaborator" },
      ],
      foldersJson: ["Contract", "Drawings/IFC"],
      locationsJson: [{ name: "Block A", kind: "building", code: null, children: [{ name: "Level 1", kind: "level", code: null, children: [] }] }],
      assignmentsJson: [{ userId: USER_ID, role: "site_engineer", permissionTemplateId: PERM_ID }],
      _count: { projects: 0 },
    });
    mockProjectService.createProject.mockResolvedValue({ id: "project-1" });
    mockProjectService.getProjectById.mockResolvedValue({ id: "project-1", name: "Marina Heights" });
    mockLocationService.createLocation.mockImplementation(({ payload }) => Promise.resolve({ id: `loc-${payload.name}` }));
  });

  it("applies defaults, parties, folders, locations and assignments", async () => {
    const result = await service.createProjectFromTemplate({
      orgId: "org-1",
      userId: "u1",
      role: "pm",
      templateId: TEMPLATE_ID,
      payload: { name: "Marina Heights", startDate: "2026-10-01", endDate: "2028-03-31", currency: "" },
    });

    expect(mockProjectService.createProject).toHaveBeenCalledWith({
      orgId: "org-1",
      userId: "u1",
      role: "pm",
      // No decision passed: the terms stay withheld (L25 fails safe).
      commercialAccessFor: null,
      payload: expect.objectContaining({
        name: "Marina Heights",
        currency: "AED", // empty request value keeps the template default
        contractType: "lump_sum",
        weatherAllowanceDays: 15,
        startDate: "2026-10-01",
      }),
    });
    expect(mockCompanyPartyService.upsertProjectPartyWithTx).toHaveBeenCalledTimes(2);
    expect(mockCompanyPartyService.upsertProjectPartyWithTx).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: "project-1",
        payload: expect.objectContaining({ role: "owner", companyId: COMPANY_ID, accessLevel: "reviewer", permissionTemplateId: PERM_ID }),
      }),
    );
    expect(mockPrisma.project.update).toHaveBeenCalledWith({
      where: { id: "project-1" },
      data: { templateId: TEMPLATE_ID, documentFoldersJson: ["Contract", "Drawings/IFC"] },
    });
    expect(mockLocationService.createLocation).toHaveBeenCalledTimes(2);
    expect(mockLocationService.createLocation).toHaveBeenLastCalledWith(
      expect.objectContaining({ payload: expect.objectContaining({ name: "Level 1", parentId: "loc-Block A" }) }),
    );
    expect(mockPrisma.projectAssignment.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { projectId_userId: { projectId: "project-1", userId: USER_ID } },
        create: { orgId: "org-1", projectId: "project-1", userId: USER_ID, role: "site_engineer" },
      }),
    );
    expect(mockPrisma.projectUserPermission.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ create: expect.objectContaining({ templateId: PERM_ID, userId: USER_ID }) }),
    );
    expect(result.applied).toEqual({ parties: 2, folders: 2, locations: 2, assignments: 1 });
    expect(result.template).toEqual({ id: TEMPLATE_ID, name: "Residential tower" });
    expect(result.project).toMatchObject({ id: "project-1" });
  });

  it("refuses archived templates", async () => {
    mockPrisma.projectTemplate.findFirst.mockResolvedValue({ id: TEMPLATE_ID, status: "archived", _count: {} });
    await expect(
      service.createProjectFromTemplate({ orgId: "org-1", templateId: TEMPLATE_ID, payload: { name: "X" } }),
    ).rejects.toMatchObject({ code: "PROJECT_TEMPLATE_ARCHIVED" });
    expect(mockProjectService.createProject).not.toHaveBeenCalled();
  });

  it("validates referenced companies, permission templates and users on create", async () => {
    mockPrisma.projectTemplate.findFirst.mockResolvedValue(null);
    mockPrisma.company.findMany.mockResolvedValue([]);
    await expect(
      service.createTemplate({
        orgId: "org-1",
        payload: { name: "T", parties: [{ role: "owner", companyId: COMPANY_ID }] },
      }),
    ).rejects.toMatchObject({ code: "TEMPLATE_COMPANY_NOT_FOUND" });

    mockPrisma.company.findMany.mockResolvedValue([{ id: COMPANY_ID }]);
    mockPrisma.permissionTemplate.findMany.mockResolvedValue([{ id: PERM_ID }]);
    mockPrisma.user.findMany.mockResolvedValue([{ id: USER_ID }]);
    mockPrisma.projectTemplate.create.mockImplementation(({ data }) => Promise.resolve({ id: TEMPLATE_ID, ...data, _count: { projects: 0 } }));
    const created = await service.createTemplate({
      orgId: "org-1",
      actorId: "u1",
      payload: {
        name: "T",
        isDefault: true,
        parties: [{ role: "owner", companyId: COMPANY_ID, permissionTemplateId: PERM_ID }],
        assignments: [{ userId: USER_ID, role: "qs" }],
        folders: ["Contract"],
      },
    });
    expect(mockPrisma.projectTemplate.updateMany).toHaveBeenCalledWith({ where: { orgId: "org-1", isDefault: true }, data: { isDefault: false } });
    expect(created.summary).toEqual({ parties: 1, folders: 1, locations: 0, assignments: 1 });
  });
});
