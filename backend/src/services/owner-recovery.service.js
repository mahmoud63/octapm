const { prisma } = require("../config/db");
const { HttpError } = require("../utils/http-error");
const membershipService = require("./membership.service");
const mfaService = require("./mfa.service");

/**
 * Sole-owner recovery (owner decision D-ID-1 Q13): a workspace whose only
 * owner has lost both their mailbox and their password cannot be recovered
 * through the product, because no administrator may set another person's
 * password or move their e-mail. Support restores control by making an
 * existing, active member of that workspace its owner — after verifying the
 * request outside the product (docs/operations/OWNER_RECOVERY_RUNBOOK.md).
 *
 * Operator-only: it runs from `npm run ops:recover-owner` with database
 * access, and is reachable from no web or API route. Each step is confirmed
 * by an operator — an OctaPM identity on RECOVERY_OPERATOR_EMAILS with
 * two-factor on — with a current authenticator code (used once). A request
 * names one workspace, one person, a ticket and a reason, and a different
 * operator approves it (two-person rule; a single operator may approve their
 * own request only outside production, and only when the request said so).
 * It grants ownership and administration to that person and changes nothing
 * else: no password, e-mail, factor or session is touched or shown.
 *
 * Every step is an AuthAuditEvent row (entityType `owner_recovery`), which
 * nothing in the product updates or deletes: the request, the approval and
 * the execution, each with the operator, ticket and reason.
 */

const REQUEST_TTL_MS = 24 * 60 * 60 * 1000;
const ENTITY = "owner_recovery";
const ACTIONS = Object.freeze({
  REQUESTED: "owner_recovery.requested",
  EXECUTED: "owner_recovery.executed",
  REFUSED: "owner_recovery.refused",
});
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const isProduction = (env = process.env) => env.NODE_ENV === "production";

const refuse = (code, message) => new HttpError(403, code, message);

const operatorAllowList = (env = process.env) =>
  new Set(
    String(env.RECOVERY_OPERATOR_EMAILS || "")
      .split(/[,\s]+/)
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean),
  );

/**
 * The operator, proven: on the allow-list, an active identity with two-factor
 * on, and a current authenticator code that has not been used before.
 */
const verifyOperator = async ({ email, totp, env = process.env }) => {
  const normalized = String(email || "").trim().toLowerCase();
  if (!normalized || !operatorAllowList(env).has(normalized)) {
    throw refuse("RECOVERY_OPERATOR_NOT_ALLOWED", "This operator is not on RECOVERY_OPERATOR_EMAILS");
  }
  const operator = await prisma.user.findUnique({ where: { email: normalized } });
  if (!operator || operator.status !== "active") {
    throw refuse("RECOVERY_OPERATOR_NOT_ALLOWED", "This operator is not an active OctaPM identity");
  }
  if (!operator.mfaEnabled) {
    throw refuse("RECOVERY_OPERATOR_MFA_REQUIRED", "The operator must have two-factor authentication on");
  }
  if (!(await mfaService.verifyAuthenticatorCode({ user: operator, code: totp }))) {
    throw refuse("RECOVERY_OPERATOR_CODE_INVALID", "The authenticator code is not valid or was already used");
  }
  return operator;
};

const audit = (tx, { orgId, userId = null, actorId = null, action, metadata }) =>
  tx.authAuditEvent.create({
    data: { orgId, userId, actorId, entityType: ENTITY, entityId: userId, action, metadataJson: metadata },
  });

/** The person the request names must be an active member of exactly that workspace now. */
const assertActiveMember = async ({ tx = prisma, orgId, userId }) => {
  const org = await tx.organisation.findUnique({ where: { id: orgId }, select: { id: true, status: true } });
  if (!org || org.status !== "active") throw new HttpError(404, "ORG_NOT_FOUND", "No active workspace has this id");
  const membership = await membershipService.findMembership({ tx, orgId, userId });
  const user = await tx.user.findUnique({ where: { id: userId }, select: { id: true, status: true, orgId: true } });
  if (!user || user.status !== "active" || !membership || membership.status !== membershipService.MEMBERSHIP_STATUSES.ACTIVE || membership.kind !== membershipService.MEMBERSHIP_KINDS.MEMBER) {
    throw new HttpError(409, "RECOVERY_TARGET_NOT_ACTIVE_MEMBER", "The person must be an active member of this workspace");
  }
  return { membership, user };
};

const requestRecovery = async ({ orgId, userId, ticket, reason, operatorEmail, totp, singleOperator = false, env = process.env }) => {
  if (!UUID.test(String(orgId || "")) || !UUID.test(String(userId || ""))) {
    throw new HttpError(400, "VALIDATION_ERROR", "--org and --user must be ids");
  }
  const ticketRef = String(ticket || "").trim();
  const why = String(reason || "").trim();
  if (!ticketRef || ticketRef.length > 120) throw new HttpError(400, "VALIDATION_ERROR", "--ticket is required (at most 120 characters)");
  if (why.length < 10 || why.length > 1000) throw new HttpError(400, "VALIDATION_ERROR", "--reason is required (10 to 1000 characters)");
  if (singleOperator && isProduction(env)) {
    throw refuse("RECOVERY_TWO_PERSON_REQUIRED", "Production requires a second operator to approve");
  }
  const operator = await verifyOperator({ email: operatorEmail, totp, env });
  await assertActiveMember({ orgId, userId });
  const expiresAt = new Date(Date.now() + REQUEST_TTL_MS);
  const row = await audit(prisma, {
    orgId,
    userId,
    actorId: operator.id,
    action: ACTIONS.REQUESTED,
    metadata: { ticket: ticketRef, reason: why, operatorEmail: operator.email, expiresAt: expiresAt.toISOString(), singleOperator: Boolean(singleOperator) },
  });
  return { requestId: row.id, orgId, userId, expiresAt };
};

const approveRecovery = async ({ requestId, operatorEmail, totp, env = process.env }) => {
  if (!UUID.test(String(requestId || ""))) throw new HttpError(400, "VALIDATION_ERROR", "--request must be an id");
  const request = await prisma.authAuditEvent.findFirst({ where: { id: requestId, entityType: ENTITY, action: ACTIONS.REQUESTED } });
  if (!request) throw new HttpError(404, "RECOVERY_REQUEST_NOT_FOUND", "No recovery request has this id");
  const meta = request.metadataJson || {};
  if (!meta.expiresAt || new Date(meta.expiresAt) <= new Date()) {
    throw new HttpError(409, "RECOVERY_REQUEST_EXPIRED", "This request has expired; make a new one");
  }
  const approver = await verifyOperator({ email: operatorEmail, totp, env });
  const sameOperator = approver.id === request.actorId;
  if (sameOperator && (isProduction(env) || !meta.singleOperator)) {
    throw refuse("RECOVERY_TWO_PERSON_REQUIRED", "A different operator must approve this request");
  }

  // Granting ownership widens access: paused while the emergency membership
  // switch is off, like every other grant (D-ID-1 Q10).
  membershipService.assertAccessExpansionAllowed();

  return prisma.$transaction(async (tx) => {
    // One execution per request, whoever approves it and however often.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${ENTITY}), hashtext(${request.id}))`;
    // Judged again under the lock: an approval that waited here must not carry
    // out a request that expired meanwhile.
    if (new Date(meta.expiresAt) <= new Date()) {
      throw new HttpError(409, "RECOVERY_REQUEST_EXPIRED", "This request has expired; make a new one");
    }
    const done = await tx.authAuditEvent.findFirst({
      where: { entityType: ENTITY, action: ACTIONS.EXECUTED, orgId: request.orgId, metadataJson: { path: ["requestId"], equals: request.id } },
    });
    if (done) throw new HttpError(409, "RECOVERY_REQUEST_USED", "This request has already been carried out");
    // Under the lock a suspension of this person here takes, so the grant
    // cannot land on a membership suspended a moment ago.
    const target = await tx.user.findUnique({ where: { id: request.userId }, select: { email: true } });
    if (target) await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${request.orgId}), hashtext(${target.email}))`;
    // The approving operator's proof stands only while their own identity does:
    // a reset, factor reset or closure of the operator that landed while this
    // approval waited ends it (D-ID-1 Q6, Q13).
    try {
      await require("./auth.service").holdCredentialEpoch(tx, approver.id, Number.isInteger(approver.credentialEpoch) ? approver.credentialEpoch : 0);
    } catch (error) {
      if (error?.code === "SESSION_REVOKED") {
        throw refuse("RECOVERY_OPERATOR_NOT_ALLOWED", "The approving operator's credentials changed during the approval");
      }
      throw error;
    }
    const { membership, user } = await assertActiveMember({ tx, orgId: request.orgId, userId: request.userId });
    const granted = await tx.organizationMembership.updateMany({
      where: { id: membership.id, status: membershipService.MEMBERSHIP_STATUSES.ACTIVE },
      data: { isOwner: true, isAdmin: true },
    });
    if (granted.count !== 1) {
      throw new HttpError(409, "RECOVERY_TARGET_NOT_ACTIVE_MEMBER", "The person must be an active member of this workspace");
    }
    if (user.orgId === request.orgId) {
      await tx.user.update({ where: { id: user.id }, data: { isCompanyAdmin: true } });
    }
    // And once more after the last statement that can wait (the target's lock,
    // the membership and person rows): the grant stands only if the request was
    // still live when it was written. Expired now, the transaction rolls back.
    if (new Date(meta.expiresAt) <= new Date()) {
      throw new HttpError(409, "RECOVERY_REQUEST_EXPIRED", "This request has expired; make a new one");
    }
    for (const action of [membership.isAdmin ? null : "membership.admin_granted", membership.isOwner ? null : "membership.owner_granted"].filter(Boolean)) {
      await membershipService.recordMembershipEvent({
        tx,
        orgId: request.orgId,
        membership,
        action,
        actor: { id: approver.id },
        metadata: { via: "owner_recovery", requestId: request.id, ticket: meta.ticket },
      });
    }
    await audit(tx, {
      orgId: request.orgId,
      userId: request.userId,
      actorId: approver.id,
      action: ACTIONS.EXECUTED,
      metadata: { requestId: request.id, ticket: meta.ticket, reason: meta.reason, requestedBy: meta.operatorEmail, approvedBy: approver.email },
    });
    return { requestId: request.id, orgId: request.orgId, userId: request.userId, owner: true, admin: true };
  });
};

/**
 * Every refused attempt is recorded too — who tried, against what, and why it
 * was refused — so a wrong code, an operator off the list or a self-approval
 * leaves a trace, not just a successful run.
 */
const auditRefusal = async ({ orgId = null, userId = null, operatorEmail, step, requestId = null, error }) => {
  await prisma.authAuditEvent
    .create({
      data: {
        orgId: UUID.test(String(orgId || "")) ? orgId : null,
        userId: UUID.test(String(userId || "")) ? userId : null,
        entityType: ENTITY,
        entityId: UUID.test(String(userId || "")) ? userId : null,
        action: ACTIONS.REFUSED,
        metadataJson: { step, requestId, operatorEmail: String(operatorEmail || "").trim().toLowerCase() || null, code: error?.code || "REFUSED" },
      },
    })
    .catch(() => null);
};

const withRefusalAudit = (step, fn, describe) => async (args) => {
  try {
    return await fn(args);
  } catch (error) {
    await auditRefusal({ ...describe(args), step, error });
    throw error;
  }
};

module.exports = {
  ACTIONS,
  REQUEST_TTL_MS,
  requestRecovery: withRefusalAudit("request", requestRecovery, (args) => ({ orgId: args.orgId, userId: args.userId, operatorEmail: args.operatorEmail })),
  approveRecovery: withRefusalAudit("approve", approveRecovery, (args) => ({ operatorEmail: args.operatorEmail, requestId: UUID.test(String(args.requestId || "")) ? args.requestId : null })),
  operatorAllowList,
};
