/**
 * owner-recovery.service approveRecovery (owner decision D-ID-1 Q13), round 4
 * (Codex D-ID-1 diff review r3, adjudicated LOW): the approving operator was
 * proven (allow-list, active, two-factor, a current code) before the
 * transaction, and the approval could then wait on the request's lock and on
 * the target's (org, e-mail) lock while the operator's own password reset,
 * administrator MFA reset or identity closure committed. Ownership was then
 * granted on a proof that no longer stood. The approval now holds the
 * approver's credential epoch (auth.service holdCredentialEpoch) after the
 * target's lock: an operator whose epoch moved, or whose identity closed,
 * meanwhile is refused RECOVERY_OPERATOR_NOT_ALLOWED, the refusal is recorded,
 * and nothing is granted.
 *
 * A mocked-Prisma suite; the hold is auth.service's own, evaluated against the
 * store by the columns its statement names.
 */
const ORG = "11111111-1111-4111-8111-111111111111";
const TARGET = "22222222-2222-4222-8222-222222222222";
const OP1 = "33333333-3333-4333-8333-333333333333";
const OP2 = "44444444-4444-4444-8444-444444444444";
const REQ = "55555555-5555-4555-8555-555555555555";

const store = { orgs: [], users: [], memberships: [], audit: [] };
const trace = [];
let txDepth = 0;

// auth.service holdCredentialEpoch: `SELECT "id" FROM "User" WHERE "id" = $1
// AND "credentialEpoch" = $2 AND "status" = 'active' FOR NO KEY UPDATE`.
const evaluateUserHold = (strings, values) => {
  const sql = strings.join("?");
  if (!/FROM "User"/.test(sql)) throw new Error(`unexpected raw query: ${sql}`);
  const conditions = [];
  strings.slice(0, -1).forEach((segment, index) => {
    const column = segment.match(/"(\w+)"\s*=\s*$/);
    if (column) conditions.push([column[1], values[index]]);
  });
  for (const literal of sql.matchAll(/"(\w+)"\s*=\s*'([^']*)'/g)) conditions.push([literal[1], literal[2]]);
  return store.users
    .filter((user) => conditions.every(([column, value]) => (column === "credentialEpoch" ? user[column] ?? 0 : user[column]) === value))
    .map((user) => ({ id: user.id }));
};

const defaultLock = async (strings, ...values) => {
  trace.push({ kind: "lock", sql: strings.join("?"), values, inTransaction: txDepth > 0 });
  return 1;
};
const defaultHold = async (strings, ...values) => {
  trace.push({ kind: "hold", sql: strings.join("?"), values, inTransaction: txDepth > 0 });
  return evaluateUserHold(strings, values);
};

const mockPrisma = {
  organisation: {
    findUnique: jest.fn(async ({ where }) => store.orgs.find((org) => org.id === where.id) || null),
  },
  user: {
    findUnique: jest.fn(async ({ where }) => {
      const row = store.users.find((user) => (where.email !== undefined ? user.email === where.email : user.id === where.id));
      return row ? { ...row } : null;
    }),
    update: jest.fn(async ({ where, data }) => {
      trace.push({ kind: "user.update", inTransaction: txDepth > 0 });
      const row = store.users.find((user) => user.id === where.id);
      Object.assign(row, data);
      return { ...row };
    }),
  },
  organizationMembership: {
    findFirst: jest.fn(async ({ where }) => {
      const row = store.memberships.find((membership) => (where.id ? membership.id === where.id : membership.orgId === where.orgId && membership.userId === where.userId));
      return row ? { ...row } : null;
    }),
    updateMany: jest.fn(async ({ where, data }) => {
      trace.push({ kind: "grant", inTransaction: txDepth > 0 });
      const row = store.memberships.find((membership) => membership.id === where.id && (where.status === undefined || membership.status === where.status));
      if (!row) return { count: 0 };
      Object.assign(row, data);
      return { count: 1 };
    }),
  },
  authAuditEvent: {
    findFirst: jest.fn(async ({ where }) => {
      if (where.action === "owner_recovery.requested") {
        return store.audit.find((row) => row.id === where.id && row.action === where.action && row.entityType === where.entityType) || null;
      }
      if (where.action === "owner_recovery.executed") {
        return store.audit.find((row) => row.action === where.action && row.metadataJson?.requestId === where.metadataJson?.equals) || null;
      }
      return null;
    }),
    create: jest.fn(async ({ data }) => {
      const row = { id: `audit-${store.audit.length + 1}`, ...data };
      store.audit.push(row);
      return row;
    }),
  },
  $executeRaw: jest.fn(defaultLock),
  $queryRaw: jest.fn(defaultHold),
  $transaction: jest.fn(async (fn) => {
    txDepth += 1;
    try {
      return await fn(mockPrisma);
    } finally {
      txDepth -= 1;
    }
  }),
};

jest.mock("../../config/db", () => ({ prisma: mockPrisma }));
// The operator's authenticator code is proven by mfa.service; here it is valid.
jest.mock("../mfa.service", () => ({ verifyAuthenticatorCode: jest.fn(async () => true) }));

const ownerRecovery = require("../owner-recovery.service");

const env = { NODE_ENV: "test", RECOVERY_OPERATOR_EMAILS: "op1@octapm.test, op2@octapm.test" };
const approve = () => ownerRecovery.approveRecovery({ requestId: REQ, operatorEmail: "op2@octapm.test", totp: "123456", env });
const approver = () => store.users.find((user) => user.id === OP2);
const HOLD_SQL = /FROM "User" WHERE "id" = \? AND "credentialEpoch" = \? AND "status" = 'active' FOR NO KEY UPDATE$/;

describe("owner recovery: the approving operator's proof stands only while their identity does (D-ID-1 round 4)", () => {
  // approveRecovery requires auth.service (the epoch hold) on first use; it is
  // loaded here so its load time is not charged to the first test's timeout.
  beforeAll(() => {
    require("../auth.service");
  }, 60000);

  beforeEach(() => {
    jest.clearAllMocks();
    mockPrisma.$executeRaw.mockImplementation(defaultLock);
    mockPrisma.$queryRaw.mockImplementation(defaultHold);
    trace.length = 0;
    txDepth = 0;
    store.orgs = [{ id: ORG, status: "active" }];
    store.users = [
      { id: TARGET, orgId: ORG, email: "target@example.test", status: "active", mfaEnabled: false, isCompanyAdmin: false, credentialEpoch: 0 },
      { id: OP1, orgId: null, email: "op1@octapm.test", status: "active", mfaEnabled: true, credentialEpoch: 0 },
      { id: OP2, orgId: null, email: "op2@octapm.test", status: "active", mfaEnabled: true, credentialEpoch: 2 },
    ];
    store.memberships = [{ id: "m-target", orgId: ORG, userId: TARGET, role: "qs", kind: "member", isAdmin: false, isOwner: false, status: "active" }];
    store.audit = [
      {
        id: REQ,
        orgId: ORG,
        userId: TARGET,
        actorId: OP1,
        entityType: "owner_recovery",
        entityId: TARGET,
        action: "owner_recovery.requested",
        metadataJson: {
          ticket: "SUP-1",
          reason: "The sole owner lost both mailbox and password.",
          operatorEmail: "op1@octapm.test",
          expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
          singleOperator: false,
        },
      },
    ];
  });

  it("holds the approver at the epoch proven before the transaction, after the target's lock and before the grant (control: the grant is made)", async () => {
    await expect(approve()).resolves.toEqual({ requestId: REQ, orgId: ORG, userId: TARGET, owner: true, admin: true });
    expect(trace.map((entry) => entry.kind)).toEqual(["lock", "lock", "hold", "grant", "user.update"]);
    expect(trace[0]).toMatchObject({ values: ["owner_recovery", REQ], inTransaction: true });
    expect(trace[1]).toMatchObject({ values: [ORG, "target@example.test"], inTransaction: true });
    expect(trace[2]).toMatchObject({ values: [OP2, 2], inTransaction: true });
    expect(trace[2].sql).toMatch(HOLD_SQL);
    expect(store.memberships[0]).toMatchObject({ isOwner: true, isAdmin: true });
    expect(store.audit.map((row) => row.action)).toEqual(
      expect.arrayContaining(["membership.admin_granted", "membership.owner_granted", "owner_recovery.executed"]),
    );
  });

  it.each([
    ["the operator's password reset (the epoch moved)", (operator) => { operator.credentialEpoch += 1; }],
    ["an administrator's MFA reset of the operator (the epoch moved)", (operator) => { operator.credentialEpoch += 1; }],
    ["the closure of the operator's identity", (operator) => { operator.status = "inactive"; }],
  ])("refuses RECOVERY_OPERATOR_NOT_ALLOWED, records the refusal and grants nothing, when %s committed while the approval waited for the target's lock", async (_label, event) => {
    mockPrisma.$executeRaw.mockImplementation(async (strings, ...values) => {
      // The credential event held the operator's row and committed while
      // this approval waited for the target's (org, e-mail) lock.
      if (values[0] === ORG) event(approver());
      return defaultLock(strings, ...values);
    });
    await expect(approve()).rejects.toMatchObject({ status: 403, code: "RECOVERY_OPERATOR_NOT_ALLOWED" });
    // The hold was asked at the epoch proven before the wait, and found nothing.
    expect(trace.filter((entry) => entry.kind === "hold").map((entry) => entry.values)).toEqual([[OP2, 2]]);
    expect(mockPrisma.organizationMembership.updateMany).not.toHaveBeenCalled();
    expect(mockPrisma.user.update).not.toHaveBeenCalled();
    expect(store.memberships[0]).toMatchObject({ isOwner: false, isAdmin: false, status: "active" });
    const actions = store.audit.map((row) => row.action);
    expect(actions).not.toContain("owner_recovery.executed");
    expect(actions.filter((action) => action.startsWith("membership."))).toEqual([]);
    expect(store.audit.at(-1)).toMatchObject({
      action: "owner_recovery.refused",
      entityType: "owner_recovery",
      metadataJson: { step: "approve", requestId: REQ, operatorEmail: "op2@octapm.test", code: "RECOVERY_OPERATOR_NOT_ALLOWED" },
    });
  });

  it("passes any other failure of the hold on unchanged: only an ended proof is an operator refusal", async () => {
    mockPrisma.$queryRaw.mockImplementation(async () => {
      throw Object.assign(new Error("connection reset"), { code: "P1017" });
    });
    await expect(approve()).rejects.toMatchObject({ message: "connection reset", code: "P1017" });
    expect(mockPrisma.organizationMembership.updateMany).not.toHaveBeenCalled();
    expect(store.audit.at(-1)).toMatchObject({ action: "owner_recovery.refused", metadataJson: expect.objectContaining({ code: "P1017" }) });
  });
});
