jest.mock("../../config/db", () => ({ prisma: {} }));

const {
  applyPartyWorkflowVisibility,
  assertPartyWorkflowAccess,
  withDefaultOwnerParty,
  upsertProjectPartyWithTx,
} = require("../company-party.service");

const partyAccess = {
  scope: "party",
  assignmentRole: null,
  partyAccess: [
    {
      projectPartyId: "party-1",
      role: "consultant",
      companyId: "company-1",
    },
  ],
};

describe("company party workflow access", () => {
  it("limits party-scoped workflow lists to routed party ids", () => {
    const where = {
      projectId: "project-1",
      OR: [{ subject: { contains: "slab", mode: "insensitive" } }],
    };

    expect(applyPartyWorkflowVisibility(where, partyAccess)).toEqual({
      projectId: "project-1",
      AND: [
        { OR: [{ subject: { contains: "slab", mode: "insensitive" } }] },
        {
          OR: [
            { ownerPartyId: { in: ["party-1"] } },
            { reviewerPartyId: { in: ["party-1"] } },
            { approverPartyId: { in: ["party-1"] } },
          ],
        },
      ],
    });
  });

  it("treats null project access as non-party-scoped instead of throwing", () => {
    const where = { projectId: "project-1" };

    expect(applyPartyWorkflowVisibility(where, null)).toEqual(where);
    expect(withDefaultOwnerParty({ subject: "RFI" }, null)).toEqual({
      subject: "RFI",
    });
    expect(() =>
      assertPartyWorkflowAccess({
        projectAccess: null,
        record: { ownerPartyId: "party-1" },
      }),
    ).not.toThrow();
  });

  it("allows routed records and denies cross-party workflow records", () => {
    expect(() =>
      assertPartyWorkflowAccess({
        projectAccess: partyAccess,
        record: { ownerPartyId: "party-1" },
      }),
    ).not.toThrow();

    try {
      assertPartyWorkflowAccess({
        projectAccess: partyAccess,
        record: { ownerPartyId: "party-2" },
      });
      throw new Error("Expected cross-party access denial");
    } catch (error) {
      expect(error).toMatchObject({
        status: 403,
        code: "PROJECT_PARTY_RECORD_ACCESS_DENIED",
      });
    }
  });

  it("defaults new party-scoped workflow records to the caller party", () => {
    expect(withDefaultOwnerParty({ subject: "RFI" }, partyAccess)).toMatchObject({
      subject: "RFI",
      ownerPartyId: "party-1",
    });

    expect(
      withDefaultOwnerParty(
        { subject: "RFI", reviewerPartyId: "party-reviewer" },
        partyAccess,
      ),
    ).toEqual({ subject: "RFI", reviewerPartyId: "party-reviewer" });
  });
});

// Codex D-ID-1 diff review r2 #6: party PATCH (and project PATCH, which syncs
// its parties through the same updater) could hand a party's members a broader
// template, profile, permissions, access level or role — or bring a closed
// party back — while the emergency membership switch was off (owner decision
// D-ID-1 Q10). upsertProjectPartyWithTx now refuses any such change with 503;
// closing a party and editing its contact details still work.
describe("project party updates under the emergency membership switch", () => {
  const store = { parties: [] };
  const companies = [
    { id: "company-1", orgId: "org-1", name: "Consult Co" },
    { id: "company-2", orgId: "org-1", name: "Build Co" },
  ];
  const templates = [
    { id: "tpl-restrictive", orgId: "org-1" },
    { id: "tpl-broad", orgId: "org-1" },
  ];
  // Equality on plain values; the relation filter `project: { orgId }` holds
  // for every party here (all are on project-1 of org-1).
  const matches = (row, where) =>
    Object.entries(where).every(([key, wanted]) => key === "project" || row[key] === wanted);
  const withCompany = (party) => ({ ...party, company: companies.find((company) => company.id === party.companyId) || null });
  const tx = {
    project: { findFirst: jest.fn(async ({ where }) => (where.id === "project-1" && where.orgId === "org-1" ? { id: "project-1", orgId: "org-1" } : null)) },
    company: {
      findFirst: jest.fn(async ({ where }) => companies.find((company) => company.orgId === where.orgId && (where.id ? company.id === where.id : company.name === where.name)) || null),
      create: jest.fn(async () => {
        throw new Error("no company is created here");
      }),
    },
    permissionTemplate: { findFirst: jest.fn(async ({ where }) => templates.find((template) => template.id === where.id && template.orgId === where.orgId) || null) },
    projectParty: {
      findFirst: jest.fn(async ({ where }) => {
        const row = store.parties.find((party) => matches(party, where));
        return row ? withCompany(row) : null;
      }),
      update: jest.fn(async ({ where, data }) => {
        const index = store.parties.findIndex((party) => party.id === where.id);
        store.parties[index] = { ...store.parties[index], ...data };
        return withCompany(store.parties[index]);
      }),
      create: jest.fn(async ({ data }) => {
        const row = { id: `party-${store.parties.length + 1}`, ...data };
        store.parties.push(row);
        return withCompany(row);
      }),
    },
  };
  const upsert = (payload) => upsertProjectPartyWithTx({ tx, orgId: "org-1", projectId: "project-1", payload });
  const party1 = () => store.parties.find((party) => party.id === "party-1");
  let previous;
  const switchOff = () => {
    process.env.AUTH_MEMBERSHIP_WRITE = "false";
  };

  beforeEach(() => {
    jest.clearAllMocks();
    previous = process.env.AUTH_MEMBERSHIP_WRITE;
    delete process.env.AUTH_MEMBERSHIP_WRITE;
    store.parties = [
      { id: "party-1", projectId: "project-1", companyId: "company-1", role: "consultant", contactName: "Ann", contactEmail: "ann@consult.test", contactPhone: null, accessLevel: "read_only", permissionProfile: "default_consultant", permissionsJson: {}, permissionTemplateId: "tpl-restrictive", status: "active" },
      { id: "party-closed", projectId: "project-1", companyId: "company-2", role: "contractor", contactName: null, contactEmail: null, contactPhone: null, accessLevel: "collaborator", permissionProfile: "default_contractor", permissionsJson: {}, permissionTemplateId: null, status: "inactive" },
    ];
  });
  afterEach(() => {
    if (previous === undefined) delete process.env.AUTH_MEMBERSHIP_WRITE;
    else process.env.AUTH_MEMBERSHIP_WRITE = previous;
  });

  it.each([
    ["a broader template", { permissionTemplateId: "tpl-broad" }],
    ["no template (the restriction removed)", { permissionTemplateId: null }],
    ["a higher access level", { accessLevel: "admin" }],
    ["another permission profile", { permissionProfile: "custom_full" }],
    ["explicit permissions", { permissions: { rfi: ["read", "write"] } }],
    ["another role", { role: "contractor" }],
    ["another company", { companyId: "company-2" }],
    ["a broader template beside a contact edit", { contactName: "Ann B", permissionTemplateId: "tpl-broad" }],
  ])("refuses a party PATCH to %s while the switch is off (503), and the party is unchanged", async (_label, change) => {
    switchOff();
    const before = { ...party1() };
    await expect(upsert({ partyId: "party-1", ...change })).rejects.toMatchObject({ status: 503, code: "MEMBERSHIP_WRITES_SUSPENDED" });
    expect(tx.projectParty.update).not.toHaveBeenCalled();
    expect(tx.projectParty.create).not.toHaveBeenCalled();
    expect(party1()).toEqual(before);
  });

  it("refuses to bring a closed party back while the switch is off (503), and it stays closed", async () => {
    switchOff();
    await expect(upsert({ companyId: "company-2", role: "contractor" })).rejects.toMatchObject({ status: 503, code: "MEMBERSHIP_WRITES_SUSPENDED" });
    expect(tx.projectParty.update).not.toHaveBeenCalled();
    expect(tx.projectParty.create).not.toHaveBeenCalled();
    expect(store.parties.find((party) => party.id === "party-closed").status).toBe("inactive");
  });

  it("still edits a party's contact details, re-sends its own values, and closes it while the switch is off", async () => {
    switchOff();
    const edited = await upsert({ partyId: "party-1", contactName: "Ann Baker", contactEmail: "ann.baker@consult.test", contactPhone: "+1 555 0100" });
    expect(edited).toMatchObject({ contactName: "Ann Baker", contactEmail: "ann.baker@consult.test", contactPhone: "+1 555 0100", accessLevel: "read_only", permissionProfile: "default_consultant", permissionTemplateId: "tpl-restrictive", status: "active" });
    const resent = await upsert({ partyId: "party-1", role: "consultant", accessLevel: "read_only", permissionTemplateId: "tpl-restrictive", companyId: "company-1" });
    expect(resent).toMatchObject({ role: "consultant", accessLevel: "read_only", permissionTemplateId: "tpl-restrictive" });
    const closed = await upsert({ partyId: "party-1", status: "inactive" });
    expect(closed).toMatchObject({ status: "inactive", accessLevel: "read_only", permissionTemplateId: "tpl-restrictive" });
    expect(tx.projectParty.update).toHaveBeenCalledTimes(3);
  });

  it("lets the same widening changes through with the switch on", async () => {
    const widened = await upsert({ partyId: "party-1", permissionTemplateId: "tpl-broad", accessLevel: "admin" });
    expect(widened).toMatchObject({ permissionTemplateId: "tpl-broad", accessLevel: "admin" });
    const reopened = await upsert({ companyId: "company-2", role: "contractor" });
    expect(reopened).toMatchObject({ id: "party-closed", status: "active" });
  });
});
