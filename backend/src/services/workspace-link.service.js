const { prisma } = require("../config/db");
const { HttpError } = require("../utils/http-error");
const membershipService = require("./membership.service");
const { workspaceSegment } = require("../utils/record-links");

/**
 * Where a legacy link belongs (workspace switching doc §5, deep-link rule
 * §108). Links minted before this wave — and the routes the web client still
 * navigates by — name a project and no workspace. The client asks here which
 * of the caller's own workspaces owns the project so it can put the link
 * under `/o/{slug}/…`, or offer a switch when that workspace is not the one
 * the session is bound to.
 *
 * The answer is drawn only from workspaces the identity belongs to: a project
 * of any other organisation is "not found", the same answer as a project that
 * does not exist, so the endpoint tells nobody what they could not open
 * anyway. Whether the member may open the project itself is the project
 * page's question (`assertProjectAccess`), not this one's.
 */
const resolveProjectWorkspace = async ({ userId, projectId, activeOrgId = null }) => {
  const workspaces = (await membershipService.listWorkspacesForUser(userId)).filter(
    (workspace) => workspace.status === "active",
  );
  const orgIds = workspaces.map((workspace) => workspace.orgId);
  if (!orgIds.length) {
    // An identity from before the membership backfill: its User row names its
    // one workspace, and that is the only place its links can point.
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { orgId: true } });
    if (user?.orgId) orgIds.push(user.orgId);
  }
  const project = orgIds.length
    ? await prisma.project.findFirst({
        where: { id: projectId, orgId: { in: orgIds } },
        select: { id: true, name: true, orgId: true, org: { select: { id: true, slug: true, name: true, kind: true } } },
      })
    : null;
  if (!project) {
    throw new HttpError(404, "PROJECT_NOT_FOUND", "Project not found");
  }
  const workspace = workspaces.find((entry) => entry.orgId === project.orgId) || {
    orgId: project.orgId,
    membershipId: null,
    slug: project.org?.slug || null,
    name: project.org?.name || null,
    kind: project.org?.kind || "company",
    role: null,
    isAdmin: false,
    isOwner: false,
    status: "active",
  };
  return {
    project: { id: project.id, name: project.name },
    workspace: { ...workspace, segment: workspaceSegment({ slug: workspace.slug, id: workspace.orgId }) },
    active: activeOrgId ? activeOrgId === project.orgId : null,
  };
};

module.exports = { resolveProjectWorkspace };
