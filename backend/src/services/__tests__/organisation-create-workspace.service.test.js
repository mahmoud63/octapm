/**
 * organisation.service createWorkspace and the emergency switch (owner
 * decision D-ID-1 Q10), round 4 (Codex D-ID-1 diff review r3, adjudicated
 * LOW, pre-existing): with AUTH_MEMBERSHIP_WRITE=false, provisioning's
 * ensureMembership writes no owner membership (it answers null), yet the
 * organisation row, its subscription and its templates still committed and
 * POST /organisations answered 201 — an ownerless workspace. createWorkspace
 * now refuses 503 MEMBERSHIP_WRITES_SUSPENDED before anything is read or
 * written; with the switch on it creates the workspace with its owner.
 */
const mockTx = {
  $executeRaw: jest.fn(async () => 1),
  user: { findUnique: jest.fn(async () => ({ credentialEpoch: 0 })) },
  organisation: { create: jest.fn(async ({ data }) => ({ id: "org-new", status: "active", ...data })) },
  organizationMembership: {
    findFirst: jest.fn(async () => null),
    create: jest.fn(async ({ data }) => ({ id: "m-new", ...data })),
    findMany: jest.fn(async () => []),
  },
  authAuditEvent: { create: jest.fn(async ({ data }) => ({ id: "audit-1", ...data })) },
};
const mockPrisma = { $transaction: jest.fn(async (fn) => fn(mockTx)) };

jest.mock("../../config/db", () => ({ prisma: mockPrisma }));
jest.mock("../subscription.service", () => ({ ensureSubscription: jest.fn(async () => null) }));
jest.mock("../permission-template.service", () => ({ seedDefaultTemplates: jest.fn(async () => null) }));
jest.mock("../auth.service", () => ({ holdCredentialEpoch: jest.fn(async () => undefined) }));

const organisationService = require("../organisation.service");
const { ensureSubscription } = require("../subscription.service");
const { seedDefaultTemplates } = require("../permission-template.service");
const authService = require("../auth.service");

const withSwitchOff = async (fn) => {
  const previous = process.env.AUTH_MEMBERSHIP_WRITE;
  process.env.AUTH_MEMBERSHIP_WRITE = "false";
  try {
    return await fn();
  } finally {
    if (previous === undefined) delete process.env.AUTH_MEMBERSHIP_WRITE;
    else process.env.AUTH_MEMBERSHIP_WRITE = previous;
  }
};

const create = () =>
  organisationService.createWorkspace({
    userId: "user-1",
    name: "Acme Build",
    actor: { id: "user-1", role: "pm", credentialEpoch: 0 },
  });

describe("createWorkspace and the emergency switch (D-ID-1 round 4)", () => {
  beforeEach(() => jest.clearAllMocks());

  it("refuses 503 MEMBERSHIP_WRITES_SUSPENDED while the switch is off, before any lock, read or write", async () => {
    await withSwitchOff(() => expect(create()).rejects.toMatchObject({ status: 503, code: "MEMBERSHIP_WRITES_SUSPENDED" }));
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    expect(mockTx.$executeRaw).not.toHaveBeenCalled();
    expect(authService.holdCredentialEpoch).not.toHaveBeenCalled();
    expect(mockTx.organisation.create).not.toHaveBeenCalled();
    expect(mockTx.organizationMembership.create).not.toHaveBeenCalled();
    expect(ensureSubscription).not.toHaveBeenCalled();
    expect(seedDefaultTemplates).not.toHaveBeenCalled();
    expect(mockTx.authAuditEvent.create).not.toHaveBeenCalled();
  });

  it("creates the workspace with its owner's membership while the switch is on (control)", async () => {
    const result = await create();
    expect(mockTx.organisation.create).toHaveBeenCalledTimes(1);
    expect(mockTx.organisation.create.mock.calls[0][0].data).toMatchObject({ name: "Acme Build", kind: "company", createdByUserId: "user-1" });
    expect(mockTx.organizationMembership.create).toHaveBeenCalledTimes(1);
    expect(mockTx.organizationMembership.create.mock.calls[0][0].data).toMatchObject({ orgId: "org-new", userId: "user-1", isOwner: true, isAdmin: true, status: "active" });
    expect(ensureSubscription).toHaveBeenCalledWith("org-new", mockTx);
    expect(result.organisation).toMatchObject({ id: "org-new", name: "Acme Build", kind: "company" });
  });
});
