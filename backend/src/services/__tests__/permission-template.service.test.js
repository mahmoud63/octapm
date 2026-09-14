const mockPrisma = {
  $transaction: jest.fn((fn) => fn(mockPrisma)),
  permissionTemplate: {
    findFirst: jest.fn(),
    findMany: jest.fn(),
    create: jest.fn(),
    createMany: jest.fn(),
    update: jest.fn(),
  },
  permissionTemplateTool: { deleteMany: jest.fn(), createMany: jest.fn() },
  permissionTemplateGrant: { deleteMany: jest.fn(), createMany: jest.fn() },
  projectUserPermission: {
    findFirst: jest.fn(),
    findMany: jest.fn(),
    upsert: jest.fn(),
    deleteMany: jest.fn(),
  },
  projectParty: { findFirst: jest.fn(), findMany: jest.fn(), update: jest.fn() },
  projectPartyMember: { findFirst: jest.fn() },
  projectAssignment: { findFirst: jest.fn(), findMany: jest.fn() },
  user: { findFirst: jest.fn() },
  authAuditEvent: { create: jest.fn() },
};

jest.mock("../../config/db", () => ({ prisma: mockPrisma }));

const service = require("../permission-template.service");
const { permissionPolicy } = require("../../config/permissions");

const TEMPLATE_ID = "11111111-1111-4111-8111-111111111111";

const template = (overrides = {}) => ({
  id: TEMPLATE_ID,
  orgId: "org-1",
  name: "Custom",
  kind: "internal",
  baseRole: "site_engineer",
  basePartyRole: null,
  status: "active",
  tools: [],
  grants: [],
  ...overrides,
});

describe("permission template semantics", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    service.invalidateTemplateCache();
  });

  it("with no tool rows a template is exactly its base role", () => {
    const compiled = service.compileTemplate(template());

    expect(service.templateAllows(compiled, { module: "progress", action: "read" })).toBe(true);
    expect(
      service.templateAllows(compiled, {
        module: "progress",
        action: "submit",
        transition: "submission.submit",
      }),
    ).toBe(true);
    expect(service.templateAllows(compiled, { module: "schedule", action: "update" })).toBe(false);
    expect(service.templateAllows(compiled, { module: "ipc", action: "certify" })).toBe(false);
    expect(service.effectiveLevel(compiled, "progress")).toBe("standard");
    // user_management is not readable by site engineers → hidden by default
    expect(service.effectiveLevel(compiled, "user_management")).toBe("none");
  });

  it("applies none / read_only / admin levels per module", () => {
    const compiled = service.compileTemplate(
      template({
        tools: [
          { module: "progress", level: "none" },
          { module: "schedule", level: "read_only" },
          { module: "ipc", level: "admin" },
        ],
      }),
    );

    expect(service.templateAllows(compiled, { module: "progress", action: "read" })).toBe(false);
    expect(service.templateAllows(compiled, { module: "schedule", action: "read" })).toBe(true);
    expect(service.templateAllows(compiled, { module: "schedule", action: "export" })).toBe(true);
    expect(service.templateAllows(compiled, { module: "schedule", action: "update" })).toBe(false);
    expect(
      service.templateAllows(compiled, {
        module: "schedule",
        action: "read",
        transition: "revision.approve",
      }),
    ).toBe(false);
    expect(service.templateAllows(compiled, { module: "ipc", action: "certify" })).toBe(true);
    expect(
      service.templateAllows(compiled, {
        module: "ipc",
        action: "certify",
        transition: "ipc.certify",
      }),
    ).toBe(true);
  });

  it("grants add single actions or transitions on top of the level", () => {
    const compiled = service.compileTemplate(
      template({
        tools: [{ module: "schedule", level: "read_only" }],
        grants: [
          { module: "schedule", action: "update", transition: null, key: "schedule|action:update" },
          {
            module: "schedule",
            action: null,
            transition: "revision.approve",
            key: "schedule|transition:revision.approve",
          },
        ],
      }),
    );

    expect(service.templateAllows(compiled, { module: "schedule", action: "update" })).toBe(true);
    expect(service.templateAllows(compiled, { module: "schedule", action: "delete" })).toBe(false);
    expect(
      service.templateAllows(compiled, {
        module: "schedule",
        action: "approve",
        transition: "revision.approve",
      }),
    ).toBe(true);
    expect(
      service.templateAllows(compiled, {
        module: "schedule",
        action: "approve",
        transition: "revision.reject",
      }),
    ).toBe(false);
  });

  it("per-user overrides win over the template", () => {
    const compiled = service.compileTemplate(
      template({ tools: [{ module: "cost", level: "none" }] }),
      { tools: { cost: "read_only" }, grants: ["cost|action:create"] },
    );
    expect(service.templateAllows(compiled, { module: "cost", action: "read" })).toBe(true);
    expect(service.templateAllows(compiled, { module: "cost", action: "create" })).toBe(true);
    expect(service.templateAllows(compiled, { module: "cost", action: "delete" })).toBe(false);
  });

  it("external templates evaluate against the party policy", () => {
    const compiled = service.compileTemplate(
      template({ kind: "external", baseRole: null, basePartyRole: "consultant" }),
    );
    expect(
      service.templateAllows(compiled, {
        module: "submittal",
        action: "approve",
        transition: "submittal.approve",
      }),
    ).toBe(true);
    expect(service.templateAllows(compiled, { module: "cost", action: "read" })).toBe(false);
    expect(service.effectiveLevel(compiled, "cost")).toBe("none");
  });

  it("builds an org matrix from the static policy and flags company admin modules", () => {
    const matrix = service.resolveOrgPermissions({
      user: { id: "u1", orgId: "org-1", role: "site_engineer", isCompanyAdmin: true },
    });
    expect(matrix.source).toBe("org");
    expect(matrix.modules.progress.actions).toEqual(
      expect.arrayContaining(["read", "create", "submit"]),
    );
    expect(matrix.modules.user_management.level).toBe("admin");
    expect(matrix.modules.user_management.visible).toBe(true);
    expect(Object.keys(matrix.modules).sort()).toEqual(
      Object.keys(permissionPolicy.modules).sort(),
    );

    const plain = service.resolveOrgPermissions({ user: { role: "site_engineer" } });
    expect(plain.modules.user_management.visible).toBe(false);
    expect(plain.modules.user_management.level).toBe("none");
  });
});

describe("permission template resolution against the database", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    service.invalidateTemplateCache();
  });

  it("prefers the project user assignment, then the party template, then the role", async () => {
    mockPrisma.projectUserPermission.findFirst.mockResolvedValue({
      id: "pup-1",
      templateId: TEMPLATE_ID,
      overridesJson: {},
    });
    mockPrisma.permissionTemplate.findFirst.mockResolvedValue(
      template({ tools: [{ module: "schedule", level: "admin" }] }),
    );

    const resolved = await service.resolveProjectPermissions({
      orgId: "org-1",
      projectId: "project-1",
      user: { id: "u1", role: "site_engineer" },
      projectAccess: { role: "site_engineer", partyAccess: [] },
    });
    expect(resolved.source).toBe("template");
    expect(resolved.template).toEqual({ id: TEMPLATE_ID, name: "Custom" });
    expect(resolved.modules.schedule.level).toBe("admin");

    // Compiled templates are cached per id for 15 s; drop it to swap definitions.
    service.invalidateTemplateCache(TEMPLATE_ID);
    mockPrisma.projectUserPermission.findFirst.mockResolvedValue(null);
    mockPrisma.projectParty.findFirst.mockResolvedValue({
      id: "party-1",
      permissionTemplateId: TEMPLATE_ID,
    });
    mockPrisma.permissionTemplate.findFirst.mockResolvedValue(
      template({ kind: "external", baseRole: null, basePartyRole: "owner" }),
    );
    const viaParty = await service.resolveProjectPermissions({
      orgId: "org-1",
      projectId: "project-1",
      user: { id: "u1", role: "site_engineer" },
      projectAccess: {
        role: "external_party",
        partyAccess: [{ projectPartyId: "party-1", role: "owner" }],
      },
    });
    expect(viaParty.source).toBe("party_template");
    expect(viaParty.modules.progress.actions).toEqual(["read", "export"]);

    mockPrisma.projectParty.findFirst.mockResolvedValue(null);
    const viaRole = await service.resolveProjectPermissions({
      orgId: "org-1",
      projectId: "project-1",
      user: { id: "u1", role: "site_engineer" },
      projectAccess: { role: "qs", scope: "assignment", partyAccess: [] },
    });
    expect(viaRole.source).toBe("assignment");
    expect(viaRole.template).toBeNull();
    expect(viaRole.modules.boq.actions).toEqual(
      expect.arrayContaining(["read", "create", "update"]),
    );
  });

  it("attaches the compiled template to req.projectAccess and never throws", async () => {
    mockPrisma.projectUserPermission.findFirst.mockRejectedValue(new Error("db down"));
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    const req = { user: { id: "u1" }, projectAccess: { id: "project-1", partyAccess: [] } };
    await expect(service.attachTemplateContext({ req })).resolves.toBeNull();
    expect(req.projectAccess.template).toBeUndefined();
    errorSpy.mockRestore();

    mockPrisma.projectUserPermission.findFirst.mockResolvedValue({
      id: "pup-1",
      templateId: TEMPLATE_ID,
      overridesJson: {},
    });
    mockPrisma.permissionTemplate.findFirst.mockResolvedValue(template());
    await service.attachTemplateContext({ req });
    expect(req.projectAccess.template.id).toBe(TEMPLATE_ID);
    expect(req.projectAccess.templateSource).toBe("template");
  });

  it("seeds the twelve default templates once per organisation", async () => {
    mockPrisma.permissionTemplate.findMany.mockResolvedValue([]);
    mockPrisma.permissionTemplate.createMany.mockResolvedValue({ count: 12 });
    const first = await service.seedDefaultTemplates({ orgId: "org-1" });
    expect(first.created).toBe(12);
    const rows = mockPrisma.permissionTemplate.createMany.mock.calls[0][0].data;
    expect(rows).toHaveLength(12);
    expect(rows.filter((row) => row.kind === "internal")).toHaveLength(8);
    expect(rows.filter((row) => row.kind === "external")).toHaveLength(4);
    expect(rows.every((row) => row.isSystem && row.isDefault)).toBe(true);

    mockPrisma.permissionTemplate.findMany.mockResolvedValue(
      service.DEFAULT_TEMPLATES.map((row) => ({ name: row.name })),
    );
    const second = await service.seedDefaultTemplates({ orgId: "org-1" });
    expect(second.created).toBe(0);
    expect(mockPrisma.permissionTemplate.createMany).toHaveBeenCalledTimes(1);
  });

  it("validates modules, levels, grants and base roles on create", async () => {
    await expect(
      service.createTemplate({
        orgId: "org-1",
        payload: { name: "Bad", tools: [{ module: "nope", level: "admin" }] },
      }),
    ).rejects.toMatchObject({ code: "PERMISSION_MODULE_INVALID" });
    await expect(
      service.createTemplate({
        orgId: "org-1",
        payload: { name: "Bad", tools: [{ module: "schedule", level: "owner" }] },
      }),
    ).rejects.toMatchObject({ code: "PERMISSION_LEVEL_INVALID" });
    await expect(
      service.createTemplate({
        orgId: "org-1",
        payload: {
          name: "Bad",
          grants: [{ module: "schedule", transition: "does.not.exist" }],
        },
      }),
    ).rejects.toMatchObject({ code: "PERMISSION_GRANT_INVALID" });
    await expect(
      service.createTemplate({
        orgId: "org-1",
        payload: { name: "Bad", kind: "external", baseRole: "pm" },
      }),
    ).rejects.toMatchObject({ code: "PERMISSION_TEMPLATE_KIND_MISMATCH" });
    await expect(
      service.createTemplate({ orgId: "org-1", payload: { name: "   " } }),
    ).rejects.toMatchObject({ code: "PERMISSION_TEMPLATE_NAME_REQUIRED" });

    mockPrisma.permissionTemplate.findFirst.mockResolvedValue(null);
    mockPrisma.permissionTemplate.create.mockImplementation(({ data }) =>
      Promise.resolve(
        template({
          ...data,
          tools: data.tools.create,
          grants: data.grants.create,
          _count: { userPermissions: 0, projectParties: 0 },
        }),
      ),
    );
    const created = await service.createTemplate({
      orgId: "org-1",
      actorId: "u1",
      actorRole: "pm",
      payload: {
        name: "Field lead",
        baseRole: "site_engineer",
        tools: [{ module: "schedule", level: "read_only" }],
        grants: [{ module: "schedule", action: "update" }, "schedule|action:update"],
      },
    });
    expect(created.tools).toEqual([{ module: "schedule", level: "read_only" }]);
    expect(created.grants).toHaveLength(1);
    expect(created.grants[0].key).toBe("schedule|action:update");
    expect(mockPrisma.authAuditEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          entityType: "permission_template",
          action: "created",
          actorId: "u1",
        }),
      }),
    );
  });

  it("refuses to archive system defaults or templates still in use", async () => {
    mockPrisma.permissionTemplate.findFirst.mockResolvedValue(
      template({ isSystem: true, _count: { userPermissions: 0, projectParties: 0 } }),
    );
    await expect(
      service.archiveTemplate({ orgId: "org-1", templateId: TEMPLATE_ID }),
    ).rejects.toMatchObject({ code: "PERMISSION_TEMPLATE_SYSTEM_LOCKED" });

    mockPrisma.permissionTemplate.findFirst.mockResolvedValue(
      template({ _count: { userPermissions: 2, projectParties: 1 } }),
    );
    await expect(
      service.archiveTemplate({ orgId: "org-1", templateId: TEMPLATE_ID }),
    ).rejects.toMatchObject({ status: 409, code: "PERMISSION_TEMPLATE_IN_USE" });
  });

  it("requires project membership before assigning a template to a user", async () => {
    mockPrisma.user.findFirst.mockResolvedValue({ id: "u2" });
    mockPrisma.projectAssignment.findFirst.mockResolvedValue(null);
    mockPrisma.projectPartyMember.findFirst.mockResolvedValue(null);
    await expect(
      service.setProjectUserPermission({
        orgId: "org-1",
        projectId: "project-1",
        userId: "u2",
        payload: { templateId: TEMPLATE_ID },
      }),
    ).rejects.toMatchObject({ code: "PROJECT_USER_NOT_MEMBER" });

    mockPrisma.projectAssignment.findFirst.mockResolvedValue({ id: "pa-1" });
    mockPrisma.permissionTemplate.findFirst.mockResolvedValue(template());
    mockPrisma.projectUserPermission.upsert.mockResolvedValue({
      id: "pup-1",
      templateId: TEMPLATE_ID,
      overridesJson: { tools: { cost: "none" } },
      assignedBy: "u1",
      updatedAt: new Date("2026-09-05T00:00:00Z"),
      template: { id: TEMPLATE_ID, name: "Custom", status: "active" },
    });
    const saved = await service.setProjectUserPermission({
      orgId: "org-1",
      projectId: "project-1",
      userId: "u2",
      actorId: "u1",
      payload: { templateId: TEMPLATE_ID, overrides: { tools: { cost: "none" } } },
    });
    expect(saved.template).toEqual({ id: TEMPLATE_ID, name: "Custom" });
    expect(mockPrisma.projectUserPermission.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { projectId_userId: { projectId: "project-1", userId: "u2" } },
        create: expect.objectContaining({ overridesJson: { tools: { cost: "none" } } }),
      }),
    );
  });

  it("only allows external templates on project parties", async () => {
    mockPrisma.projectParty.findFirst.mockResolvedValue({ id: "party-1" });
    mockPrisma.permissionTemplate.findFirst.mockResolvedValue(template({ kind: "internal" }));
    await expect(
      service.setPartyTemplate({
        orgId: "org-1",
        projectId: "project-1",
        partyId: "party-1",
        payload: { templateId: TEMPLATE_ID },
      }),
    ).rejects.toMatchObject({ code: "PERMISSION_TEMPLATE_KIND_MISMATCH" });
  });
});

describe("Phase 21D — integrity (release challenge, tenth pass)", () => {
  it("the projects a template refuses (CX21-492) are read from member templates first and from the templates of active parties only", async () => {
    mockPrisma.projectUserPermission.findMany = jest.fn(async () => []);
    mockPrisma.projectPartyMember.findMany = jest.fn(async () => []);
    await service.projectsWhereTemplateDenies({ orgId: "org-1", userId: "u1", module: "task", action: "read" });
    expect(mockPrisma.projectPartyMember.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ userId: "u1", status: "active", projectParty: expect.objectContaining({ status: "active" }) }) }));
  });
});
