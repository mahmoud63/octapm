/**
 * The roles a person can be invited or created with are the policy's roles (Phase 22B):
 * a Quality Engineer invited by email used to become a Site Engineer.
 */
jest.mock("../../config/db", () => ({ prisma: {} }));
const { ALLOWED_ROLES } = require("../user.service");
const { permissionPolicy } = require("../../config/permissions");

describe("invitable roles", () => {
  it("cover every role in shared/permissions.json, the quality engineer included", () => {
    const policyRoles = permissionPolicy.roles.map((role) => role.id);
    expect([...ALLOWED_ROLES].sort()).toEqual([...policyRoles].sort());
    expect(ALLOWED_ROLES).toContain("quality_engineer");
  });
});
