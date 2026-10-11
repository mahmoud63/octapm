/**
 * Which OctaPM surface a person's links open on, for one project (domain
 * architecture §14, §28–29).
 *
 * The rule is the one project authorization already applies
 * (project-authorization.service: a person with project-party access and no
 * project assignment acts as `external_party`): such a person — a consultant,
 * any member of an external company on the project — is sent to the external
 * collaboration portal; everyone else to the application. It is decided from
 * the person's standing on the project, never from an e-mail address, and it
 * only chooses a host: what the link opens is still authorized by the API.
 */
const { prisma } = require("../config/db");
const { SURFACES } = require("../config/domains");

/** The ids, among `userIds`, whose links on `projectId` belong to the portal. */
const portalRecipients = async ({ tx = prisma, projectId, userIds }) => {
  const ids = [...new Set((userIds || []).filter(Boolean))];
  if (!projectId || !ids.length || !tx.projectPartyMember?.findMany || !tx.projectAssignment?.findMany) {
    return new Set();
  }
  const [partyMembers, assignments] = await Promise.all([
    tx.projectPartyMember.findMany({
      where: { userId: { in: ids }, status: "active", projectParty: { projectId, status: "active" } },
      select: { userId: true },
    }),
    tx.projectAssignment.findMany({ where: { projectId, userId: { in: ids } }, select: { userId: true } }),
  ]);
  const assigned = new Set(assignments.map((row) => row.userId));
  return new Set(partyMembers.map((row) => row.userId).filter((id) => !assigned.has(id)));
};

/** The surface for one person's links on one project. */
const surfaceForRecipient = async ({ tx = prisma, projectId, userId }) =>
  (await portalRecipients({ tx, projectId, userIds: [userId] })).has(userId) ? SURFACES.PORTAL : SURFACES.APP;

module.exports = { portalRecipients, surfaceForRecipient };
