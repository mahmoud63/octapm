/**
 * Workspaces as things that are made and change kind (enterprise wave ENT-6).
 *
 * An organisation is a workspace of one of two kinds (architecture doc §2):
 * `personal` — what sign-up creates, one member (its owner) plus guests, on
 * the plan the subscription catalogue names for individuals — and `company`,
 * which holds a team. Both get the same furniture at birth: an owner
 * membership, a subscription row, the twelve system permission templates and
 * the default units of measure (ownership doc, "Lifecycle consequences": the
 * seeding happens for both kinds so a conversion has no seeding step).
 *
 * Conversion flips the kind and the plan and nothing else: every row already
 * carries the workspace's orgId, so nothing moves, is copied or re-keyed —
 * the ownership matrix's promise, and what the lifecycle live test counts.
 *
 * `provisionWorkspace` is idempotent: run twice for the same organisation it
 * writes nothing new, so a provisioning that failed half-way can be
 * finished, and the E2E and demo seeds — which are not this file's — could
 * call it without fear.
 */
const { prisma } = require("../config/db");
const { HttpError } = require("../utils/http-error");
const { allocateSlug } = require("../utils/workspace-slug");
const membershipService = require("./membership.service");
const { ensureSubscription } = require("./subscription.service");

const WORKSPACE_KINDS = Object.freeze({ PERSONAL: "personal", COMPANY: "company" });

/**
 * The organisation plan a kind implies. The subscription catalogue
 * (config/plans.js) names `individual` for one person; a company keeps the
 * column's default, `standard`, which is what every company provisioned
 * before this wave carries. Organisation.plan is a label — the billing
 * lifecycle lives on the Subscription row, which this file never re-prices.
 */
const planForKind = (kind) => (kind === WORKSPACE_KINDS.PERSONAL ? "individual" : "standard");

/**
 * The URL handle of a new workspace, when the client knows the column. A
 * test double without the organisation model gets no slug, as before.
 */
const allocateWorkspaceSlug = async (tx, name) => {
  if (!tx?.organisation?.findMany) return undefined;
  try {
    return await allocateSlug(tx, name);
  } catch {
    return undefined;
  }
};

/** Audit line for a workspace event; never the reason the change fails. */
const recordWorkspaceEvent = async ({ tx, orgId, userId = null, actor = null, action, email = null, context = {}, metadata = {} }) => {
  if (!tx?.authAuditEvent?.create) return null;
  try {
    return await tx.authAuditEvent.create({
      data: {
        orgId,
        userId,
        actorId: actor?.id || null,
        actorRole: actor?.role || null,
        entityType: "organisation",
        entityId: orgId,
        action,
        email,
        ipAddress: context.ipAddress || null,
        userAgent: context.userAgent || null,
        metadataJson: metadata,
      },
    });
  } catch {
    return null;
  }
};

/** The organisation row of a new workspace: name, kind, plan and handle. */
const createOrganisationRow = async (tx, { name, kind = WORKSPACE_KINDS.COMPANY, createdByUserId = null }) => {
  const workspaceName = String(name || "").trim();
  return tx.organisation.create({
    data: {
      name: workspaceName,
      kind,
      plan: planForKind(kind),
      slug: await allocateWorkspaceSlug(tx, workspaceName),
      ...(createdByUserId ? { createdByUserId } : {}),
    },
  });
};

/**
 * Everything a workspace holds besides its rows of work, written where it
 * is missing: the subscription, the system permission templates and the
 * default units. Each seed is idempotent on its own key, so this is too.
 */
const provisionWorkspaceDefaults = async ({ tx = prisma, orgId }) => {
  await ensureSubscription(orgId, tx);
  // System permission templates (8 internal roles + 4 external party types);
  // required here, not at the top, because that service reaches back into
  // the ones this one is loaded from.
  await require("./permission-template.service").seedDefaultTemplates({ tx, orgId });
  // A client that predates the unit master (a test double) has nothing to seed.
  if (tx?.unitOfMeasure?.findMany) {
    await require("./uom.service").seedDefaultUnits({ tx, orgId });
  }
};

/**
 * Makes `ownerUserId` the owner of `org` and gives the workspace its
 * defaults. Idempotent: an owner membership that exists is left alone, the
 * creator is recorded only once, and the `workspace.created` audit line is
 * written only when the ownership was.
 */
const provisionWorkspace = async ({ tx = prisma, org, ownerUserId, role = "pm", email = null, actor = null, context = {} }) => {
  if (!org?.createdByUserId && tx?.organisation?.update) {
    await tx.organisation.update({ where: { id: org.id }, data: { createdByUserId: ownerUserId } });
  }
  // The person who created the workspace owns it: the one membership that
  // sign-up and workspace creation may write with ownership (membership doc §1).
  const ensured = await membershipService.ensureMembership({
    tx,
    orgId: org.id,
    userId: ownerUserId,
    role,
    isAdmin: true,
    isOwner: true,
  });
  if (!ensured || ensured.created) {
    await recordWorkspaceEvent({
      tx,
      orgId: org.id,
      userId: ownerUserId,
      actor: actor || { id: ownerUserId, role },
      action: "workspace.created",
      email,
      context,
      metadata: { kind: org.kind, name: org.name, plan: org.plan },
    });
  }
  await provisionWorkspaceDefaults({ tx, orgId: org.id });
  return ensured?.membership ?? null;
};

const organisationView = (org) => ({
  id: org.id,
  name: org.name,
  kind: org.kind,
  slug: org.slug ?? null,
  plan: org.plan,
  status: org.status,
});

/** The answer of a create or a convert: the workspace, the caller's seat in it, every seat they hold. */
const workspaceResult = async ({ tx, org, membership, userId }) => ({
  organisation: organisationView(org),
  workspace: membership ? membershipService.workspaceEntry({ ...membership, org }) : null,
  memberships: await membershipService.listWorkspacesForUser(userId, { tx }),
});

/**
 * A further, company workspace for a signed-in identity (POST
 * /organisations). Any active identity may create one (wave plan, decision
 * default); the caller becomes its owner and administrator with a further
 * membership — the identity's home workspace (User.orgId) is untouched, so
 * nothing about where the person already works changes.
 */
const createWorkspace = async ({ userId, name, kind = WORKSPACE_KINDS.COMPANY, actor = null, context = {} }) => {
  if (kind !== WORKSPACE_KINDS.COMPANY) {
    throw new HttpError(400, "VALIDATION_ERROR", "A signed-in identity creates company workspaces; a personal one is made at sign-up");
  }
  const workspaceName = String(name || "").trim();
  if (!workspaceName) throw new HttpError(400, "VALIDATION_ERROR", "A workspace name is required");

  return prisma.$transaction(async (tx) => {
    const org = await createOrganisationRow(tx, { name: workspaceName, kind, createdByUserId: userId });
    const membership = await provisionWorkspace({ tx, org, ownerUserId: userId, actor, context });
    return workspaceResult({ tx, org, membership, userId });
  });
};

/**
 * personal → company (POST /organisations/:id/convert), by an owner. The
 * kind, the plan and — when given — the name change; the slug is kept: the
 * schema keeps no record of retired handles, and a handle that is freed
 * could be taken by another workspace, which would send old links to the
 * wrong place. No row of any table changes orgId; the owner stays owner;
 * templates and units were seeded at birth so nothing is seeded now.
 *
 * Converting a company is 409 WORKSPACE_ALREADY_COMPANY: there is nothing
 * to convert, and a renamer should not be able to use this route for it.
 */
const convertToCompany = async ({ orgId, actor, name = undefined, context = {} }) => {
  if (!actor?.isOwner) {
    throw new HttpError(403, "OWNER_REQUIRED", "Only a workspace owner can convert it to a company workspace");
  }
  return prisma.$transaction(async (tx) => {
    const org = await tx.organisation.findUnique({ where: { id: orgId } });
    if (!org || org.id !== actor.orgId) {
      throw new HttpError(404, "WORKSPACE_NOT_FOUND", "You are not a member of this workspace");
    }
    if (org.kind !== WORKSPACE_KINDS.PERSONAL) {
      throw new HttpError(409, "WORKSPACE_ALREADY_COMPANY", "This workspace is already a company workspace");
    }
    const owner = await membershipService.findMembership({ tx, orgId, userId: actor.id });
    if (!owner?.isOwner || owner.status !== membershipService.MEMBERSHIP_STATUSES.ACTIVE) {
      throw new HttpError(403, "OWNER_REQUIRED", "Only a workspace owner can convert it to a company workspace");
    }

    const nextName = typeof name === "string" && name.trim() ? name.trim() : org.name;
    const updated = await tx.organisation.update({
      where: { id: orgId },
      data: { kind: WORKSPACE_KINDS.COMPANY, plan: planForKind(WORKSPACE_KINDS.COMPANY), name: nextName },
    });
    await recordWorkspaceEvent({
      tx,
      orgId,
      userId: actor.id,
      actor,
      action: "workspace.converted",
      context,
      metadata: {
        from: WORKSPACE_KINDS.PERSONAL,
        to: WORKSPACE_KINDS.COMPANY,
        plan: { from: org.plan, to: updated.plan },
        name: { from: org.name, to: updated.name },
        slug: updated.slug ?? null,
      },
    });
    return workspaceResult({ tx, org: updated, membership: owner, userId: actor.id });
  });
};

module.exports = {
  WORKSPACE_KINDS,
  convertToCompany,
  createOrganisationRow,
  createWorkspace,
  organisationView,
  planForKind,
  provisionWorkspace,
  provisionWorkspaceDefaults,
};
