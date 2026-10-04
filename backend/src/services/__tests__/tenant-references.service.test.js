/**
 * Certification CERT-2: the tenant-reference helpers judge every value they
 * are given. A value that is not an identifier (an array, a number, an object)
 * is refused like a missing record — it used to be dropped, so
 * ["<another company's id>"] skipped the check while the caller stored or
 * looked up what it read from the same field.
 */
const mockPrisma = {
  organizationMembership: { findMany: jest.fn() },
  company: { findMany: jest.fn() },
  activity: { findMany: jest.fn() },
};
jest.mock("../../config/db", () => ({ prisma: mockPrisma }));

const refs = require("../tenant-references.service");

const OWN = "11111111-1111-4111-8111-111111111111";
const FOREIGN = "22222222-2222-4222-8222-222222222222";

beforeEach(() => {
  jest.clearAllMocks();
  mockPrisma.organizationMembership.findMany.mockImplementation(async ({ where }) => where.userId.in.filter((id) => id === OWN).map((userId) => ({ userId })));
  mockPrisma.company.findMany.mockImplementation(async ({ where }) => where.id.in.filter((id) => id === OWN).map((id) => ({ id })));
  mockPrisma.activity.findMany.mockImplementation(async ({ where }) => where.id.in.filter((id) => id === OWN).map((id) => ({ id })));
});

const SHAPES = [[FOREIGN], [[FOREIGN]], { id: FOREIGN }, 12345, true];

describe("values that are not identifiers are refused, not dropped", () => {
  it.each(SHAPES.map((shape) => [JSON.stringify(shape), shape]))("assertMembers refuses %s", async (_label, shape) => {
    await expect(refs.assertMembers({ orgId: "org-1", userIds: [shape] })).rejects.toMatchObject({ status: 404, code: "USER_NOT_FOUND" });
    await expect(refs.assertMembers({ orgId: "org-1", userIds: shape })).rejects.toMatchObject({ status: 404 });
  });

  it.each(SHAPES.map((shape) => [JSON.stringify(shape), shape]))("assertCompanies refuses %s", async (_label, shape) => {
    await expect(refs.assertCompanies({ orgId: "org-1", companyIds: [OWN, shape] })).rejects.toMatchObject({ status: 404, code: "COMPANY_NOT_FOUND" });
  });

  it.each(SHAPES.map((shape) => [JSON.stringify(shape), shape]))("assertProjectRows refuses %s", async (_label, shape) => {
    await expect(refs.assertProjectRows({ model: "activity", projectId: "p1", ids: shape, code: "ACTIVITY_NOT_FOUND", message: "Activity not found" })).rejects.toMatchObject({ status: 404, code: "ACTIVITY_NOT_FOUND" });
  });

  it("a wrapped id of the caller's own is refused too: the shape is wrong, whoever it names", async () => {
    await expect(refs.assertMembers({ orgId: "org-1", userIds: [[OWN]] })).rejects.toMatchObject({ code: "USER_NOT_FOUND" });
    expect(mockPrisma.organizationMembership.findMany).not.toHaveBeenCalled();
  });
});

describe("plain identifiers are judged as before", () => {
  it("passes the organisation's own, skips empty values and refuses another company's", async () => {
    await expect(refs.assertMembers({ orgId: "org-1", userIds: [OWN, null, undefined, "", ` ${OWN} `] })).resolves.toEqual([OWN]);
    await expect(refs.assertCompanies({ orgId: "org-1", companyIds: OWN })).resolves.toEqual([OWN]);
    await expect(refs.assertProjectRows({ model: "activity", projectId: "p1", ids: new Set([OWN]), code: "ACTIVITY_NOT_FOUND", message: "x" })).resolves.toEqual([OWN]);
    await expect(refs.assertMembers({ orgId: "org-1", userIds: [OWN, FOREIGN] })).rejects.toMatchObject({ status: 404, code: "USER_NOT_FOUND" });
    await expect(refs.assertMembers({ orgId: "org-1", userIds: null })).resolves.toEqual([]);
  });
});
