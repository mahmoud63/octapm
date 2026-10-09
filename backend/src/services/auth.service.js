const {
  createHash,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} = require("crypto");
const bcrypt = require("bcryptjs");
const { prisma } = require("../config/db");
const { HttpError } = require("../utils/http-error");
const {
  createAccessToken,
  createIdentityToken,
  createRefreshToken,
  getAccessTokenExpiresInSeconds,
  getRefreshTokenExpiresAt,
  hashRefreshToken,
  tokenEpochCurrent,
  verifyRefreshToken,
} = require("../utils/tokens");
const membershipService = require("./membership.service");
const authAbuseService = require("./auth-abuse.service");
const organisationService = require("./organisation.service");
const { sendEmail, templates } = require("./email.service");
const companyPartyService = require("./company-party.service");
const { isPublicRegistrationOpen } = require("../config/registration");

const PASSWORD_RESET_EXPIRY_MINUTES = 60;
// A cost-12 hash of a random secret nobody holds: compared against when an
// address has no account, so sign-in costs the same either way (D-ID-1 Q7).
let dummyPasswordHash = null;
const getDummyPasswordHash = async () => {
  if (!dummyPasswordHash) dummyPasswordHash = await bcrypt.hash(randomBytes(24).toString("base64url"), 12);
  return dummyPasswordHash;
};
const INVITATION_EXPIRY_DAYS = 7;

const normalizeEmail = (email) => email.trim().toLowerCase();

const readPositiveInt = (value, fallback) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const addMinutes = (amount) => new Date(Date.now() + amount * 60 * 1000);

const createAccountToken = () => randomBytes(32).toString("base64url");

const hashAccountToken = (token) =>
  createHash("sha256").update(token).digest("hex");

const getPasswordResetExpiresAt = () =>
  addMinutes(
    readPositiveInt(
      process.env.PASSWORD_RESET_TOKEN_MINUTES,
      PASSWORD_RESET_EXPIRY_MINUTES,
    ),
  );

const getInvitationExpiresAt = () =>
  new Date(
    Date.now() +
      readPositiveInt(
        process.env.INVITATION_TOKEN_DAYS,
        INVITATION_EXPIRY_DAYS,
      ) *
        24 *
        60 *
        60 *
        1000,
  );

const getWebAppBaseUrl = () =>
  (
    process.env.WEB_APP_URL ||
    process.env.FRONTEND_URL ||
    process.env.PUBLIC_APP_URL ||
    "http://localhost:5173"
  ).replace(/\/$/, "");

const buildWebAppUrl = (path, token) => {
  const url = new URL(path, `${getWebAppBaseUrl()}/`);
  url.searchParams.set("token", token);
  return url.toString();
};

const recordAuthAuditEvent = async ({
  tx = prisma,
  orgId = null,
  projectId = null,
  userId = null,
  actorId = null,
  actorRole = null,
  entityType,
  entityId = null,
  action,
  email = null,
  ipAddress = null,
  userAgent = null,
  metadata = {},
}) => {
  if (!tx.authAuditEvent?.create) {
    return null;
  }

  return tx.authAuditEvent.create({
    data: {
      orgId,
      projectId,
      userId,
      actorId,
      actorRole,
      entityType,
      entityId,
      action,
      email,
      ipAddress,
      userAgent,
      metadataJson: metadata,
    },
  });
};

const createInvalidResetTokenError = () =>
  new HttpError(
    400,
    "PASSWORD_RESET_TOKEN_INVALID",
    "Password reset token is invalid, expired, or already used",
  );

const createInvalidInvitationTokenError = () =>
  new HttpError(
    400,
    "INVITATION_TOKEN_INVALID",
    "Invitation token is invalid, expired, or already used",
  );

/**
 * The user as a session describes them. With a principal (the membership the
 * session is bound to) the workspace fields — orgId, role, isCompanyAdmin —
 * are the membership's, so a person who is a QS in one workspace and a PM in
 * another is described correctly in each; for the one-membership identities
 * every existing user is, they equal the User columns and nothing changes.
 */
const sanitizeUser = (user, principal = null) => ({
  id: user.id,
  orgId: principal?.orgId ?? user.orgId,
  name: user.name,
  email: user.email,
  phone: user.phone,
  role: principal?.role ?? user.role,
  isCompanyAdmin: Boolean(principal ? principal.isCompanyAdmin : user.isCompanyAdmin),
  status: user.status,
  lastLogin: user.lastLogin,
  mfaEnabled: Boolean(user.mfaEnabled),
  // The SSO link is the active workspace's own (D-ID-1 Q2); a session with no
  // membership behind it has none.
  ssoLinked: Boolean(principal?.ssoLinked),
  createdAt: user.createdAt,
  updatedAt: user.updatedAt,
});

const buildTokenPayload = (principal) => ({
  accessToken: createAccessToken(principal),
  tokenType: "Bearer",
  expiresIn: getAccessTokenExpiresInSeconds(),
});

const buildAuthPayload = (user, principal, refreshSession) => ({
  user: sanitizeUser(user, principal),
  tokens: buildTokenPayload(principal),
  refreshToken: refreshSession.refreshToken,
  refreshTokenExpiresAt: refreshSession.expiresAt,
});

/**
 * A refresh session for a principal. The session row records the membership
 * it was issued for, and the refresh token carries the same `mid`, so a
 * refresh can hold the two to each other and re-mint from the membership.
 */
const createRefreshSession = async (tx, principal, context = {}) => {
  const sessionId = randomUUID();
  const refreshToken = createRefreshToken(
    principal,
    sessionId,
    context.client || "web",
  );
  const expiresAt = getRefreshTokenExpiresAt(refreshToken);

  await tx.refreshSession.create({
    data: {
      id: sessionId,
      userId: principal.id,
      orgId: principal.orgId,
      tokenHash: hashRefreshToken(refreshToken),
      userAgent: context.userAgent || null,
      ipAddress: context.ipAddress || null,
      expiresAt,
      ...(principal.membershipId ? { membershipId: principal.membershipId } : {}),
    },
  });

  return {
    id: sessionId,
    refreshToken,
    expiresAt,
  };
};

/**
 * A session for a user row, bound to their membership in `orgId` (their own
 * organisation unless the caller names another workspace they belong to).
 */
/**
 * Everything a credential event ends besides the tokens the epoch already
 * voids (D-ID-1 Q6): every refresh session, and every SSO sign-in ticket not
 * yet exchanged — a ticket issued before the event would otherwise open a
 * session at the new epoch. Live sockets are dropped by the caller's route.
 *
 * The API keys the person created go too, in every workspace (owner decision
 * Q-KEY): a session that was stolen cannot leave a working key behind. Keys
 * other people created are left alone, those acting as this person included.
 * Each revoked key is audited with `reason`, the event that ended it.
 *
 * Callers hold the User row first, so a key the person is creating either
 * committed before the revocation reads or waits on that row and then fails
 * its epoch hold. The revocation and its audit are a fixed number of
 * statements whatever the count: a stolen session that piled keys up must
 * not be able to time the event out (Q-KEY review M1).
 */
const endIdentitySessions = async (tx, userId, now = new Date(), { reason = null, actorId = null } = {}) => {
  await tx.refreshSession.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: now } });
  if (tx.ssoTicket?.updateMany) {
    await tx.ssoTicket.updateMany({ where: { userId, usedAt: null }, data: { usedAt: now } });
  }
  if (tx.apiClient?.updateMany) {
    const revoked = await tx.apiClient.updateMany({ where: { createdBy: userId, status: "active" }, data: { status: "revoked", revokedAt: now } });
    if (revoked.count) {
      // Only the keys this event revoked carry its instant: one revoked by
      // hand meanwhile keeps its own, and its own audit row (review L1).
      const keys = await tx.apiClient.findMany({ where: { createdBy: userId, status: "revoked", revokedAt: now }, select: { id: true, orgId: true, name: true } });
      await tx.authAuditEvent.createMany({
        data: keys.map((key) => ({ orgId: key.orgId, userId, actorId, entityType: "api_client", entityId: key.id, action: "api_key_revoked", metadataJson: { reason, name: key.name } })),
      });
    }
  }
};

const sessionRevokedError = () =>
  new HttpError(401, "SESSION_REVOKED", "This session has ended; sign in again");

/**
 * Holds the identity at the credential epoch its proof was checked against
 * (D-ID-1 Q6), for the rest of the caller's transaction. A reset, an identity
 * closed or a factor reset updates the User row, so this row lock either
 * waits for it to commit — and then finds the epoch moved and refuses — or
 * makes it wait until the new session is written, which its revocation then
 * covers. Without it, a request that proved itself just before a reset could
 * mint a session at the new epoch just after it.
 *
 * FOR NO KEY UPDATE, not FOR SHARE: the same transaction may go on to update
 * the row (a sign-in stamps lastLogin), and two shared locks upgrading at
 * once deadlock; this lock makes concurrent sessions of one person queue
 * instead. It does not block the key-share locks that inserting a session row
 * takes.
 */
const holdCredentialEpoch = async (tx, userId, epoch) => {
  if (!Number.isInteger(epoch) || typeof tx.$queryRaw !== "function") return;
  const rows = await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${userId} AND "credentialEpoch" = ${epoch} AND "status" = 'active' FOR NO KEY UPDATE`;
  if (!rows.length) throw sessionRevokedError();
};

const createAuthSessionPayload = async (tx, user, context = {}, { orgId = null, ssoOrgId = null, expectedEpoch = null } = {}) => {
  if (expectedEpoch !== null) await holdCredentialEpoch(tx, user.id, expectedEpoch);
  const resolved = await membershipService.resolveSessionPrincipal(tx, user, { orgId });
  const principal = ssoOrgId ? { ...resolved, ssoOrgId } : resolved;
  // Tokens carry the epoch that was proven, not whatever the row says now.
  if (expectedEpoch !== null) principal.credentialEpoch = expectedEpoch;
  const refreshSession = await createRefreshSession(tx, principal, context);
  return buildAuthPayload(user, principal, refreshSession);
};

const createInvalidRefreshTokenError = () =>
  new HttpError(401, "INVALID_REFRESH_TOKEN", "Refresh token is invalid");

const compareTokenHashes = (left, right) => {
  if (!left || !right || left.length !== right.length) {
    return false;
  }

  return timingSafeEqual(Buffer.from(left), Buffer.from(right));
};

const handleRefreshVerifyError = (error) => {
  if (error instanceof HttpError) {
    throw error;
  }

  if (error.name === "TokenExpiredError") {
    throw new HttpError(
      401,
      "REFRESH_TOKEN_EXPIRED",
      "Refresh token has expired",
    );
  }

  if (error.name === "JsonWebTokenError") {
    throw createInvalidRefreshTokenError();
  }

  throw error;
};

const revokeSessionFamily = async (tx, session, now) => {
  const sessionIds = [session.id];
  if (session.replacedBySessionId) {
    sessionIds.push(session.replacedBySessionId);
  }

  await tx.refreshSession.updateMany({
    where: {
      id: { in: sessionIds },
      revokedAt: null,
    },
    data: { revokedAt: now },
  });
};

const revokeSessionIfActive = async (tx, sessionId, now) => {
  await tx.refreshSession.updateMany({
    where: {
      id: sessionId,
      revokedAt: null,
    },
    data: { revokedAt: now },
  });
};

/**
 * A new organisation with its first administrator, who owns it — everything
 * self-service sign-up and the first-administrator bootstrap have in common.
 * Sign-up makes a personal workspace (ENT-6: one member, the individual
 * plan); bootstrap makes the deployment's company. The workspace's furniture
 * — subscription, system permission templates, default units — and the
 * ownership are organisation.service's, shared with POST /organisations, so
 * a workspace is provisioned the same way whichever door it came through.
 * Runs inside the caller's transaction; the caller decides how the password
 * hash was produced.
 */
const provisionOrganisation = async (
  tx,
  {
    orgName,
    name,
    email,
    phone = null,
    passwordHash,
    kind = organisationService.WORKSPACE_KINDS.COMPANY,
    currency = null,
    timezone = null,
  },
) => {
  // A personal workspace with no name given is the person's, not an
  // "Organisation" — the header shows this name beside a Personal badge.
  const fallbackName =
    kind === organisationService.WORKSPACE_KINDS.PERSONAL
      ? `${name.trim()}'s workspace`
      : `${name.trim()} Organisation`;
  const workspaceName = orgName?.trim() || fallbackName;
  const createdOrg = await organisationService.createOrganisationRow(tx, {
    name: workspaceName,
    kind,
    currency,
    timezone,
  });

  const createdUser = await tx.user.create({
    data: {
      orgId: createdOrg.id,
      name: name.trim(),
      email,
      phone: phone || null,
      passwordHash,
      role: "pm",
      isCompanyAdmin: true,
    },
  });

  await organisationService.provisionWorkspace({
    tx,
    org: createdOrg,
    ownerUserId: createdUser.id,
    email,
  });

  return { org: createdOrg, user: createdUser };
};

const createRegistrationClosedError = () =>
  new HttpError(
    403,
    "REGISTRATION_CLOSED",
    "New organisations are created by invitation. Ask your company administrator for an invite.",
  );

const register = async (
  { orgName, name, email, password, phone, currency = null, timezone = null },
  context = {},
) => {
  // Checked before any account lookup, so a closed deployment reveals
  // nothing — not even whether an email is already registered. The route's
  // field validation runs earlier, so a malformed body still gets its 400;
  // those errors describe only the request.
  if (!isPublicRegistrationOpen()) {
    throw createRegistrationClosedError();
  }

  const normalizedEmail = email.trim().toLowerCase();

  const existingUser = await prisma.user.findUnique({
    where: { email: normalizedEmail },
  });

  if (existingUser) {
    throw new HttpError(
      409,
      "EMAIL_ALREADY_EXISTS",
      "An account with this email already exists",
    );
  }

  const passwordHash = await bcrypt.hash(password, 12);

  return prisma.$transaction(async (tx) => {
    // Sign-up makes a personal workspace (ENT-6): one member, the owner, on
    // the individual plan. A team comes with POST /organisations or a
    // conversion; the public registration policy above is unchanged.
    const { org: createdOrg, user: createdUser } = await provisionOrganisation(
      tx,
      {
        orgName,
        name,
        email: normalizedEmail,
        phone,
        passwordHash,
        kind: organisationService.WORKSPACE_KINDS.PERSONAL,
        currency,
        timezone,
      },
    );
    const authPayload = await createAuthSessionPayload(
      tx,
      createdUser,
      context,
    );

    return {
      organisation: {
        id: createdOrg.id,
        name: createdOrg.name,
        kind: createdOrg.kind,
        plan: createdOrg.plan,
        status: createdOrg.status,
        defaultCurrency: createdOrg.defaultCurrency ?? null,
        defaultTimezone: createdOrg.defaultTimezone ?? null,
      },
      ...authPayload,
    };
  });
};

const login = async ({ email, password }, context = {}) => {
  const normalizedEmail = email.trim().toLowerCase();
  await authAbuseService.assertLoginAllowed({
    email: normalizedEmail,
    ipAddress: context.ipAddress,
  });

  // Awaited, not fired and forgotten: with the counts in Postgres, a failure
  // that is still being written when the next attempt arrives would let that
  // attempt through uncounted.
  const recordInvalidLogin = () =>
    authAbuseService.recordLoginFailure({
      email: normalizedEmail,
      ipAddress: context.ipAddress,
    });

  const user = await prisma.user.findUnique({
    where: { email: normalizedEmail },
  });

  // An unknown address does the same password work as a known one, so the
  // answer's timing does not say whether the address has an account (owner
  // decision D-ID-1 Q7); the answer itself is already the same.
  const isPasswordValid = await bcrypt.compare(
    String(password ?? ""),
    user?.passwordHash || (await getDummyPasswordHash()),
  );
  if (!user) {
    await recordInvalidLogin();
    throw new HttpError(
      401,
      "INVALID_CREDENTIALS",
      "Invalid email or password",
    );
  }

  if (!isPasswordValid) {
    await recordInvalidLogin();
    throw new HttpError(
      401,
      "INVALID_CREDENTIALS",
      "Invalid email or password",
    );
  }
  await authAbuseService.recordLoginSuccess({
    email: normalizedEmail,
    ipAddress: context.ipAddress,
  });

  if (user.status !== "active") {
    throw new HttpError(403, "USER_INACTIVE", "Your account is not active");
  }

  // Organisation policies (OCTA-SEC-AUTH-040): SSO-only domains and a second
  // factor. They belong to the workspace being entered, so with one workspace
  // they are checked here as they always were; with several, at the workspace
  // session issue (membership doc §6).
  const entry = await resolveLoginEntry(user);
  const org = entry.orgId ? await readWorkspacePolicy(entry.orgId) : null;
  if (entry.orgId) {
    assertWorkspacePolicy({ org, email: normalizedEmail, isCompanyAdmin: entry.isCompanyAdmin });
  }
  if (user.mfaEnabled) {
    const mfaService = require("./mfa.service");
    await recordAuthAuditEvent({
      orgId: user.orgId,
      userId: user.id,
      entityType: "user",
      entityId: user.id,
      action: "mfa.challenged",
      email: normalizedEmail,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
    }).catch(() => null);
    return {
      mfaRequired: true,
      mfaToken: mfaService.createChallenge(user),
      methods: ["totp", "backup_code"],
    };
  }

  return issueLoginOutcome({ user, entry, org, context });
};

/** Second step of a login with two-factor: the challenge token plus a code from the app or a backup code. */
const completeMfaLogin = async ({ mfaToken, code }, context = {}) => {
  const mfaService = require("./mfa.service");
  const user = await mfaService.resolveChallenge({ mfaToken, code, context });
  await recordAuthAuditEvent({
    orgId: user.orgId,
    userId: user.id,
    entityType: "user",
    entityId: user.id,
    action: "mfa.verified",
    email: user.email,
    ipAddress: context.ipAddress,
    userAgent: context.userAgent,
  });
  const entry = await resolveLoginEntry(user);
  const org = entry.orgId ? await readWorkspacePolicy(entry.orgId) : null;
  return issueLoginOutcome({ user, entry, org, context });
};

// ─── Workspaces ─────────────────────────────────────────────────────────────

const WORKSPACE_POLICY_SELECT = {
  id: true,
  name: true,
  slug: true,
  kind: true,
  status: true,
  ssoEnabled: true,
  ssoRequired: true,
  ssoDomainsJson: true,
  mfaRequired: true,
};

const readWorkspacePolicy = async (orgId) =>
  prisma.organisation?.findUnique
    ? prisma.organisation.findUnique({ where: { id: orgId }, select: WORKSPACE_POLICY_SELECT })
    : null;

/**
 * The SSO-only policy of the workspace being entered. Administrators are
 * exempt — scoped: the exemption is the target workspace's admin flag, not a
 * global one (membership doc §2.1).
 */
const assertWorkspacePolicy = ({ org, email, isCompanyAdmin }) => {
  if (
    org?.ssoEnabled &&
    org.ssoRequired &&
    !isCompanyAdmin &&
    require("./sso.service").domainMatches(email, org.ssoDomainsJson)
  ) {
    throw new HttpError(
      403,
      "SSO_REQUIRED",
      "Your organisation signs in with single sign-on — use the SSO button",
    );
  }
};

/**
 * Where a verified sign-in leads (membership doc §6):
 *   - `legacy`: the person has no membership row at all (seeded before the
 *     backfill) — their User columns name the one workspace, as always;
 *   - `single`: exactly one active membership — tokens bound to it, today's
 *     response for every existing user;
 *   - `none` / `many`: an identity token and the list, for the picker.
 */
const resolveLoginEntry = async (user) => {
  const rows =
    membershipService.hasMembershipModel(prisma) && membershipService.isMembershipReadEnabled()
      ? await membershipService.listMembershipsForUser(user.id)
      : [];
  if (!rows.length) {
    // No row that is not `left`. A row that is `left` means the person was in
    // a workspace and is no longer: that is "no workspace", not "before
    // memberships"; only a person with no row at all is a legacy sign-in.
    const anyRow =
      membershipService.hasMembershipModel(prisma) && membershipService.isMembershipReadEnabled()
        ? await prisma.organizationMembership.count({ where: { userId: user.id } })
        : 0;
    if (!anyRow) {
      return { mode: "legacy", orgId: user.orgId, isCompanyAdmin: Boolean(user.isCompanyAdmin), workspaces: [] };
    }
  }
  const workspaces = rows
    .filter((row) => (row.org?.status ?? "active") === "active")
    .map(membershipService.workspaceEntry);
  const active = workspaces.filter((workspace) => workspace.status === "active");
  if (active.length === 1) {
    return { mode: "single", orgId: active[0].orgId, isCompanyAdmin: active[0].isAdmin || active[0].isOwner, workspaces };
  }
  return { mode: active.length ? "many" : "none", orgId: null, isCompanyAdmin: false, workspaces };
};

const issueLoginOutcome = async ({ user, entry, org, context }) =>
  prisma.$transaction(async (tx) => {
    // The password (and code) were checked against `user` as it was read: a
    // reset that landed since then must not be answered with a session at the
    // new epoch (D-ID-1 Q6).
    const provenEpoch = Number.isInteger(user.credentialEpoch) ? user.credentialEpoch : 0;
    await holdCredentialEpoch(tx, user.id, provenEpoch);
    const updatedUser = await tx.user.update({
      where: { id: user.id },
      data: { lastLogin: new Date() },
    });

    if (!entry.orgId) {
      // No single workspace to enter: the identity is proven, the workspace
      // is chosen with POST /auth/workspaces/:orgId/session.
      return {
        ...(entry.mode === "many" ? { chooseWorkspace: true } : { needsWorkspace: true }),
        identityToken: createIdentityToken({ ...updatedUser, credentialEpoch: provenEpoch }),
        memberships: entry.workspaces,
      };
    }

    const payload = await createAuthSessionPayload(tx, updatedUser, context, { orgId: entry.orgId, expectedEpoch: provenEpoch });
    payload.user.mfaEnrollmentRequired = Boolean(
      org?.mfaRequired && !updatedUser.mfaEnabled,
    );
    return payload;
  });

/**
 * POST /auth/workspaces/:orgId/session (workspace switching doc §2): a valid
 * session or identity token for `userId`, an active membership in `orgId`,
 * the target workspace's policies — and a fresh access + refresh pair bound to
 * that membership on the caller's channel. Nothing is revoked: the other
 * workspace's session family stays valid so the person can switch back.
 */
const issueWorkspaceSession = async ({ userId, orgId, ssoOrgId = null, expectedEpoch = null }, context = {}) => {
  // A session from a company's single sign-on opens that company only (certification
  // finding L10): that company's identity provider vouches for nobody elsewhere.
  if (ssoOrgId && ssoOrgId !== orgId) {
    throw new HttpError(403, "SSO_SESSION_BOUND", "This session came from your company's single sign-on and opens that company only. Sign in with your own password to open another workspace.");
  }
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user || user.status !== "active") {
    throw new HttpError(401, "USER_INACTIVE", "Your account is not active");
  }
  const membership = await membershipService.findMembership({ tx: prisma, orgId, userId });
  const legacyHome = !membership && user.orgId === orgId;
  if (!membership && !legacyHome) {
    throw new HttpError(404, "WORKSPACE_NOT_FOUND", "You are not a member of this workspace");
  }
  if (membership && membership.status !== "active") {
    throw new HttpError(403, "USER_INACTIVE", "Your access to this workspace is not active");
  }
  const org = await readWorkspacePolicy(orgId);
  if (!org || org.status !== "active") {
    throw new HttpError(404, "WORKSPACE_NOT_FOUND", "You are not a member of this workspace");
  }
  // A session this workspace's own single sign-on issued is what its SSO-only
  // policy asks for; any other session is held to the policy.
  if (ssoOrgId !== orgId) {
    assertWorkspacePolicy({
      org,
      email: user.email,
      isCompanyAdmin: membership ? membership.isAdmin || membership.isOwner : Boolean(user.isCompanyAdmin),
    });
  }

  const memberships = await membershipService.listWorkspacesForUser(userId);
  return prisma.$transaction(async (tx) => {
    // Held at the epoch of the token that asked (D-ID-1 Q6), or at the one this
    // request read when the caller has just proven the identity itself.
    const payload = await createAuthSessionPayload(tx, user, context, {
      orgId,
      ssoOrgId,
      expectedEpoch: Number.isInteger(expectedEpoch) ? expectedEpoch : (Number.isInteger(user.credentialEpoch) ? user.credentialEpoch : 0),
    });
    payload.user.mfaEnrollmentRequired = Boolean(org.mfaRequired && !user.mfaEnabled);
    const workspace = membership
      ? membershipService.workspaceEntry({ ...membership, org })
      : { orgId, membershipId: null, slug: org.slug, name: org.name, kind: org.kind, role: user.role, isAdmin: Boolean(user.isCompanyAdmin), isOwner: false, status: "active" };
    for (const action of ["workspace.switched", "session.workspace_issued"]) {
      await recordAuthAuditEvent({
        tx,
        orgId,
        userId,
        entityType: "membership",
        entityId: membership?.id || null,
        action,
        email: user.email,
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
        metadata: { membershipId: membership?.id || null, client: context.client || "web" },
      });
    }
    return { ...payload, workspace, memberships };
  });
};

const refresh = async ({
  refreshToken,
  userAgent,
  ipAddress,
  client = "web",
}) => {
  let payload;

  try {
    payload = verifyRefreshToken(refreshToken);
  } catch (error) {
    handleRefreshVerifyError(error);
  }

  const tokenHash = hashRefreshToken(refreshToken);
  const now = new Date();

  // A refusal that must also revoke something is recorded here and acted on
  // after the transaction. Throwing from inside the transaction rolls back
  // everything it did, which would silently undo the very revocation that
  // makes a replayed token dangerous to keep around.
  let refusal = null;
  const refuse = (session, scope, error) => {
    refusal = { session, scope, error };
    return null;
  };

  const result = await prisma.$transaction(async (tx) => {
    const session = await tx.refreshSession.findUnique({
      where: { id: payload.jti },
      include: { user: true },
    });

    if (
      !session ||
      session.userId !== payload.sub ||
      session.orgId !== payload.orgId ||
      !compareTokenHashes(session.tokenHash, tokenHash)
    ) {
      throw createInvalidRefreshTokenError();
    }

    // A token that turns up on the channel it was not issued for has left the
    // place it was stored. Treat it exactly like a replay.
    if ((payload.cli || "web") !== client) {
      return refuse(
        session,
        "family",
        new HttpError(
          401,
          "REFRESH_TOKEN_CHANNEL_MISMATCH",
          "Refresh token was issued for a different client",
        ),
      );
    }

    if (session.revokedAt) {
      return refuse(
        session,
        "family",
        new HttpError(
          401,
          "REFRESH_TOKEN_REUSED",
          "Refresh token has already been used",
        ),
      );
    }

    if (session.expiresAt <= now) {
      return refuse(
        session,
        "session",
        new HttpError(
          401,
          "REFRESH_TOKEN_EXPIRED",
          "Refresh token has expired",
        ),
      );
    }

    if (!session.user || session.user.status !== "active") {
      return refuse(session, "session", createInvalidRefreshTokenError());
    }
    // A token from before the identity's last credential event (a reset, an
    // identity closed) is dead with its whole family (D-ID-1 Q6).
    if (!tokenEpochCurrent(payload, session.user)) {
      return refuse(
        session,
        "family",
        new HttpError(401, "SESSION_REVOKED", "This session has ended; sign in again"),
      );
    }

    // The token and the stored session must name the same membership, and
    // that membership must still be live: the new pair is minted from the
    // membership row, not from the session's copy of the user (M4). A token
    // issued before memberships carries no `mid` and is held to the person's
    // membership in the session's organisation, or to the User columns when
    // there is none.
    if (payload.mid && session.membershipId && payload.mid !== session.membershipId) {
      throw createInvalidRefreshTokenError();
    }
    const standing = await membershipService.resolveMembershipPrincipal({
      tx,
      userId: session.userId,
      orgId: session.orgId,
      membershipId: payload.mid || session.membershipId || null,
    });
    if (standing.inactive) {
      return refuse(session, "session", createInvalidRefreshTokenError());
    }
    const standingPrincipal = standing.principal || membershipService.principalFromUser(session.user);
    // An SSO session stays bound to its company through every refresh (L10).
    const principal = payload.sso ? { ...standingPrincipal, ssoOrgId: payload.sso } : standingPrincipal;

    // The read above is not a claim: two refreshes with the same token (a
    // retry, two tabs, two API tasks) both see revokedAt still empty. The
    // session is claimed by this conditional write instead. The loser waits
    // on the winner's row lock, then finds revokedAt set and matches nothing,
    // so exactly one of them mints a child session. The loser is treated as
    // the replay it is, and re-reads the session so the family it revokes
    // includes the child the winner has just created.
    const claimed = await tx.refreshSession.updateMany({
      where: { id: session.id, revokedAt: null },
      data: { revokedAt: now },
    });
    if (claimed.count !== 1) {
      const latest = await tx.refreshSession.findUnique({
        where: { id: session.id },
      });
      return refuse(
        latest || session,
        "family",
        new HttpError(
          401,
          "REFRESH_TOKEN_REUSED",
          "Refresh token has already been used",
        ),
      );
    }

    const nextSession = await createRefreshSession(tx, principal, {
      userAgent,
      ipAddress,
      client,
    });

    await tx.refreshSession.update({
      where: { id: session.id },
      data: {
        replacedBySessionId: nextSession.id,
      },
    });

    return buildAuthPayload(session.user, principal, nextSession);
  });

  if (refusal) {
    if (refusal.scope === "family") {
      await revokeSessionFamily(prisma, refusal.session, now);
    } else {
      await revokeSessionIfActive(prisma, refusal.session.id, now);
    }
    throw refusal.error;
  }

  return result;
};

const logout = async ({ refreshToken, client = "web" }) => {
  if (!refreshToken) {
    return { revoked: false };
  }

  let payload;
  try {
    payload = verifyRefreshToken(refreshToken);
  } catch (_error) {
    return { revoked: false };
  }

  // Only the channel a token was issued on may end its session.
  if ((payload.cli || "web") !== client) {
    return { revoked: false };
  }

  const result = await prisma.refreshSession.updateMany({
    where: {
      id: payload.jti,
      tokenHash: hashRefreshToken(refreshToken),
      revokedAt: null,
    },
    data: { revokedAt: new Date() },
  });

  return { revoked: result.count > 0 };
};

/**
 * GET /auth/me: the identity, described in the active workspace (every field
 * as before), plus every workspace the person belongs to and which one the
 * token is for (membership doc §3). With an identity token there is no active
 * workspace and the identity is described from its own columns.
 */
const getProfile = async ({ userId, orgId, principal = null }) => {
  const user = principal?.membershipId || !orgId
    ? await prisma.user.findUnique({ where: { id: userId } })
    : await prisma.user.findFirst({ where: { id: userId, orgId } });

  if (!user) {
    throw new HttpError(404, "USER_NOT_FOUND", "User not found");
  }

  const memberships = await membershipService.listWorkspacesForUser(user.id);
  return {
    ...sanitizeUser(user, principal?.orgId ? principal : null),
    memberships,
    active: principal?.orgId
      ? { orgId: principal.orgId, membershipId: principal.membershipId || null }
      : null,
  };
};

// Reset e-mails still being handed to the transport after their answer went out.
const pendingResetDeliveries = new Set();

/** Waits for the reset e-mails already handed off (tests and in-process proofs). */
const flushPasswordResetDeliveries = async () => {
  while (pendingResetDeliveries.size) {
    await Promise.allSettled([...pendingResetDeliveries]);
  }
};

const requestPasswordReset = async ({ email }, context = {}) => {
  const normalizedEmail = normalizeEmail(email);
  const user = await prisma.user.findUnique({
    where: { email: normalizedEmail },
    include: { org: true },
  });

  const rawToken = createAccountToken();
  const tokenHash = hashAccountToken(rawToken);
  const expiresAt = getPasswordResetExpiresAt();
  const now = new Date();
  const eligible = Boolean(user) && user.status === "active";

  // Every address takes the same path: one transaction that writes the audit
  // line, and for an active account the token too. Nothing waits on the mail
  // provider before the answer, so neither the answer nor its timing says
  // whether the address has an account (owner decision D-ID-1 Q7).
  const resetToken = await prisma.$transaction(async (tx) => {
    if (!eligible) {
      await recordAuthAuditEvent({
        tx,
        orgId: user?.orgId || null,
        userId: user?.id || null,
        entityType: "password_reset",
        action: user
          ? "password_reset_requested_inactive"
          : "password_reset_requested_unknown",
        email: normalizedEmail,
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
      });
      return null;
    }

    await tx.passwordResetToken.updateMany({
      where: {
        userId: user.id,
        usedAt: null,
        revokedAt: null,
        expiresAt: { gt: now },
      },
      data: { revokedAt: now },
    });

    const created = await tx.passwordResetToken.create({
      data: {
        userId: user.id,
        orgId: user.orgId,
        email: normalizedEmail,
        tokenHash,
        userAgent: context.userAgent || null,
        ipAddress: context.ipAddress || null,
        expiresAt,
      },
    });

    await recordAuthAuditEvent({
      tx,
      orgId: user.orgId,
      userId: user.id,
      entityType: "password_reset",
      entityId: created.id,
      action: "password_reset_requested",
      email: normalizedEmail,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      metadata: { expiresAt },
    });

    return created;
  });

  if (resetToken) {
    const resetUrl = buildWebAppUrl("/reset-password", rawToken);
    const template = templates.passwordReset({
      name: user.name,
      resetUrl,
      expiresAt: resetToken.expiresAt,
    });

    // A failed send is recorded, never reported: the answer has to be the same
    // {sent:true} whether or not the address belongs to anyone. The person can
    // simply ask again; the operator finds the failure in the audit trail.
    const delivery = (async () => {
      try {
        await sendEmail({
          to: normalizedEmail,
          ...template,
          metadata: {
            orgId: user.orgId,
            userId: user.id,
            tokenId: resetToken.id,
            type: "password_reset",
          },
        });
      } catch (error) {
        console.error(
          `[auth] password reset email for user ${user.id} was not delivered: ${error?.code || error?.name || "ERROR"}`,
        );
        await recordAuthAuditEvent({
          orgId: user.orgId,
          userId: user.id,
          entityType: "password_reset",
          entityId: resetToken.id,
          action: "password_reset_delivery_failed",
          email: normalizedEmail,
          ipAddress: context.ipAddress,
          userAgent: context.userAgent,
          metadata: {
            code: error?.code || null,
            status: error?.details?.status || error?.status || null,
          },
        }).catch(() => null);
      }
    })();
    pendingResetDeliveries.add(delivery);
    delivery.finally(() => pendingResetDeliveries.delete(delivery));
  }

  return { sent: true };
};

const assertUsablePasswordResetToken = (resetToken, now = new Date()) => {
  if (
    !resetToken ||
    resetToken.usedAt ||
    resetToken.revokedAt ||
    resetToken.expiresAt <= now
  ) {
    throw createInvalidResetTokenError();
  }

  if (!resetToken.user || resetToken.user.status !== "active") {
    throw createInvalidResetTokenError();
  }
};

const resetPassword = async ({ token, password }, context = {}) => {
  const tokenHash = hashAccountToken(token);
  const now = new Date();
  const resetToken = await prisma.passwordResetToken.findUnique({
    where: { tokenHash },
    include: { user: true },
  });

  try {
    assertUsablePasswordResetToken(resetToken, now);
  } catch (error) {
    await recordAuthAuditEvent({
      orgId: resetToken?.orgId || null,
      userId: resetToken?.userId || null,
      entityType: "password_reset",
      entityId: resetToken?.id || null,
      action: "password_reset_rejected",
      email: resetToken?.email || null,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      metadata: { reason: error.code || "invalid_token" },
    });
    throw error;
  }

  const passwordHash = await bcrypt.hash(password, 12);

  await prisma.$transaction(async (tx) => {
    // Claimed first, by a conditional write: two submissions of one link both
    // pass the check above, and only the one that wins this claim may set a
    // password. The other throws here, which rolls its transaction back.
    const claimed = await tx.passwordResetToken.updateMany({
      where: {
        id: resetToken.id,
        usedAt: null,
        revokedAt: null,
        // Judged when claimed, not when the request began: hashing the new
        // password can take long enough for a link to expire meanwhile.
        expiresAt: { gt: new Date() },
      },
      data: { usedAt: now },
    });
    if (claimed.count !== 1) {
      throw createInvalidResetTokenError();
    }

    // A completed reset is a credential event for the whole identity (owner
    // decision D-ID-1 Q6): the epoch moves, so every access, identity and
    // refresh token minted before it is refused everywhere, including the
    // workspace switch that used to mint fresh sessions from an old bearer.
    await tx.user.update({
      where: { id: resetToken.userId },
      data: { passwordHash, credentialEpoch: { increment: 1 } },
    });

    await tx.passwordResetToken.updateMany({
      where: {
        userId: resetToken.userId,
        id: { not: resetToken.id },
        usedAt: null,
        revokedAt: null,
      },
      data: { revokedAt: now },
    });

    await endIdentitySessions(tx, resetToken.userId, now, { reason: "password_reset" });

    await recordAuthAuditEvent({
      tx,
      orgId: resetToken.orgId,
      userId: resetToken.userId,
      entityType: "password_reset",
      entityId: resetToken.id,
      action: "password_reset_completed",
      email: resetToken.email,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
    });
  });

  // Live sockets opened before the reset end too (the route drops them).
  return { reset: true, endedSessionsOf: resetToken.userId };
};

const assertUsableInvitationToken =(invitation, now = new Date()) => {
  if (
    !invitation ||
    invitation.status !== "pending" ||
    invitation.acceptedAt ||
    invitation.revokedAt ||
    invitation.expiresAt <= now
  ) {
    throw createInvalidInvitationTokenError();
  }
};

const getInvitationByRawToken = async (token) =>
  prisma.invitationToken.findUnique({
    where: { tokenHash: hashAccountToken(token) },
    include: {
      org: { select: { id: true, name: true } },
      project: { select: { id: true, name: true } },
      company: { select: { id: true, name: true } },
      projectParty: {
        select: {
          id: true,
          role: true,
          company: { select: { id: true, name: true } },
        },
      },
    },
  });

const getInvitationPreview = async ({ token }) => {
  const invitation = await getInvitationByRawToken(token);
  assertUsableInvitationToken(invitation);

  // An identity that already exists elsewhere is invited like any other
  // (membership doc §5): acceptance gives it a second membership — once the
  // invitee has signed in as that identity and accepts with that session
  // (owner decision L38), so `requiresSignIn` is true for it. A new identity,
  // or one its own workspace is reopening, chooses a password instead. Only
  // the holder of the link — the invitee — can read this.
  const existingUser = await prisma.user.findUnique({
    where: { email: invitation.email },
    select: { id: true, orgId: true, status: true },
  });
  const signsIn = Boolean(existingUser) && existingUser.status === "active";

  return {
    email: invitation.email,
    role: invitation.role,
    org: invitation.org,
    project: invitation.project || null,
    company: invitation.company || invitation.projectParty?.company || null,
    projectParty: invitation.projectParty
      ? {
          id: invitation.projectParty.id,
          role: invitation.projectParty.role,
          company: invitation.projectParty.company,
        }
      : null,
    expiresAt: invitation.expiresAt,
    existingUser: Boolean(existingUser),
    requiresSignIn: signsIn,
    requiresPassword: !signsIn,
  };
};

/**
 * Acceptance by an identity that already exists needs proof that the caller
 * is that identity (membership doc §5 [D]): the emailed link alone would
 * turn a leaked or forwarded invitation into a session for the victim, and
 * from there into every workspace they belong to. The proof is a session of
 * their own — an access or identity token for the same `sub`, passed by the
 * route as `identityUserId` — and nothing else (owner decision L38: the
 * person accepts "using their own authenticated identity/session"). The
 * password alone is not that: it skipped the second factor, the sign-in
 * throttle and the company's single sign-on. A session a company's single
 * sign-on issued vouches for that company only (certification L10). A
 * brand-new identity still sets its password with the token alone.
 */
const assertInvitationIdentityProof = ({ existingUser, identityUserId }) => {
  if (!identityUserId || identityUserId !== existingUser.id) {
    throw new HttpError(
      401,
      "INVITATION_SIGN_IN_REQUIRED",
      "Sign in as the invited account to accept this invitation",
    );
  }
  // A session another company's single sign-on issued proves who the person
  // is (owner decision D-ID-1 Q12) — and nothing more: it never satisfies the
  // inviting workspace's own access policy, so acceptance with it ends in
  // `signInRequired` for that workspace (issueWorkspaceSession refuses to
  // turn an SSO session of one company into a session of another).
};

/** Why a link cannot be used, for the audit line (the caller is told only that it is invalid). */
const invitationRefusalReason = (invitation, now) => {
  if (!invitation) return "unknown";
  if (invitation.acceptedAt || invitation.status === "accepted") return "accepted";
  if (invitation.revokedAt || invitation.status === "revoked") return "revoked";
  if (invitation.expiresAt <= now) return "expired";
  return "not_pending";
};

const acceptInvitation = async (
  { token, name, password, phone, identityUserId = null, identitySsoOrgId = null, identityEpoch = null },
  context = {},
) => {
  // Joining widens access: paused while the emergency switch is off, before
  // anything is read or the link is used (owner decision D-ID-1 Q10).
  membershipService.assertAccessExpansionAllowed();
  const tokenHash = hashAccountToken(token);
  const now = new Date();
  const invitation = await prisma.invitationToken.findUnique({
    where: { tokenHash },
    include: {
      org: true,
      project: { select: { id: true, name: true } },
      company: { select: { id: true, name: true } },
      projectParty: {
        select: {
          id: true,
          role: true,
          companyId: true,
          company: { select: { id: true, name: true } },
        },
      },
    },
  });

  try {
    assertUsableInvitationToken(invitation, now);
  } catch (error) {
    await recordAuthAuditEvent({
      orgId: invitation?.orgId || null,
      projectId: invitation?.projectId || null,
      entityType: "invitation",
      entityId: invitation?.id || null,
      action: "invitation_accept_rejected",
      email: invitation?.email || null,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      metadata: { reason: invitationRefusalReason(invitation, now) },
    });
    throw error;
  }

  const existingUser = await prisma.user.findUnique({
    where: { email: invitation.email },
  });

  const homeOrg = !existingUser || existingUser.orgId === invitation.orgId;
  // User.status belongs to the identity's home workspace (as deactivation
  // already assumes): an identity its home closed is reopened by a
  // re-invitation from home — the pre-membership contract, a new password
  // and status back to active — and by nothing else, so no session is ever
  // minted for an account another workspace cannot see is closed.
  const reactivatesIdentity = Boolean(existingUser) && existingUser.status !== "active";
  const currentMembership = existingUser
    ? await membershipService.findMembership({ tx: prisma, orgId: invitation.orgId, userId: existingUser.id })
    : null;
  try {
    if (reactivatesIdentity && !homeOrg) {
      throw new HttpError(403, "USER_INACTIVE", "This account was closed by its own workspace");
    }
    // A suspension is undone only by the workspace's Activate (owner decision
    // D-ID-1 Q3): a person suspended here — or a closed account homed here
    // that is suspended rather than gone, or homed here before memberships —
    // is not brought back by any link. Only someone who left is reopened.
    const suspendedHere =
      currentMembership?.status === membershipService.MEMBERSHIP_STATUSES.SUSPENDED ||
      (reactivatesIdentity && currentMembership?.status !== membershipService.MEMBERSHIP_STATUSES.LEFT);
    if (suspendedHere) {
      throw createInvalidInvitationTokenError();
    }
    if (existingUser && !reactivatesIdentity) {
      assertInvitationIdentityProof({ existingUser, identityUserId });
    }
    // The party offered must still be the party acceptance would join.
    await companyPartyService.assertPartyOffer({ invitation });
  } catch (error) {
    await recordAuthAuditEvent({
      orgId: invitation.orgId,
      projectId: invitation.projectId,
      userId: existingUser?.id || null,
      entityType: "invitation",
      entityId: invitation.id,
      action: "invitation_accept_rejected",
      email: invitation.email,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      metadata: { reason: error.code || "refused" },
    });
    throw error;
  }

  // Only a new identity, or one being reopened by its home, sets a password
  // here; an active identity's password was its proof and is left alone.
  const setsPassword = !existingUser || reactivatesIdentity;
  if (name !== undefined && name !== null && typeof name !== "string") {
    throw new HttpError(400, "VALIDATION_ERROR", "The name must be text");
  }
  if (!existingUser && !name?.trim()) {
    throw new HttpError(400, "VALIDATION_ERROR", "A name is required to create your account");
  }
  if (setsPassword && !password) {
    throw new HttpError(
      400,
      "INVITATION_PASSWORD_REQUIRED",
      "A password is required to accept this invitation",
    );
  }
  const passwordHash = setsPassword ? await bcrypt.hash(password, 12) : null;

  // The invited membership: a party invitation makes a guest, anything else
  // a member with the invited role. The User columns mirror the membership
  // only in the identity's own organisation (M5 dual-write); an identity
  // invited into a second workspace keeps its name, password and home role.
  // An identity already an active member here keeps its role too: a project
  // or party invitation to them assigns the project and does not re-grade
  // them — a role change goes through changeMembership, with its guards
  // and its audit line.
  const isPartyInvitation = Boolean(invitation.projectPartyId);
  // A person homed here with no membership row at all (seeded before the
  // backfill) is a current member too: their row is written from the User
  // columns and kept, not re-graded by a project or party invitation.
  const legacyMember =
    Boolean(existingUser) && homeOrg && !reactivatesIdentity && !currentMembership &&
    membershipService.hasMembershipModel(prisma) && membershipService.isMembershipWriteEnabled();
  const keepsRole =
    legacyMember ||
    (Boolean(currentMembership) &&
      currentMembership.status === membershipService.MEMBERSHIP_STATUSES.ACTIVE &&
      currentMembership.kind === membershipService.MEMBERSHIP_KINDS.MEMBER);

  let accepted;
  try {
    accepted = await prisma.$transaction(async (tx) => {
      // Acceptance and a new invitation of the same e-mail to the same workspace
      // are made one at a time (inviteUser takes the same lock), so neither
      // judges the other's half-written state.
      if (typeof tx.$executeRaw === "function") {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${invitation.orgId}), hashtext(${invitation.email}))`;
      }
      if (existingUser) {
        // One identity-wide change at a time (D-ID-1 ID-GUARD): a workspace
        // closing this identity or clearing its factor takes the same lock, so
        // it sees this membership once it is written, or this acceptance sees
        // the identity as that change left it.
        await membershipService.lockIdentity(tx, existingUser.id);
        // The person proved themselves with a session at some credential epoch;
        // a reset since then voids that proof (D-ID-1 Q6).
        if (!reactivatesIdentity) await holdCredentialEpoch(tx, existingUser.id, Number.isInteger(identityEpoch) ? identityEpoch : -1);
        // Reopening holds the identity's row from here, and only while it is
        // still closed (Q-KEY review H1). An identity reopened since the read
        // above (by another reopening link; Activate cannot reach a person
        // who left) is an open account, which accepts with its own session;
        // and the row is held before the revocation below reads, as in every
        // other credential event.
        else if (typeof tx.$queryRaw === "function") {
          const stillClosed = await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${existingUser.id} AND "status" <> 'active' FOR NO KEY UPDATE`;
          if (!stillClosed.length) {
            throw new HttpError(401, "INVITATION_SIGN_IN_REQUIRED", "Sign in as the invited account to accept this invitation");
          }
        }
      }
      // The link is claimed first, and only while it is still pending: one
      // revoked, accepted or expired since it was read above — by a newer
      // invitation, a second submission, the clock — writes nothing.
      // Expiry is judged at the claim, not at the start of the request.
      const claimed = await tx.invitationToken.updateMany({
        where: { id: invitation.id, status: "pending", acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } },
        data: { status: "accepted", acceptedAt: now },
      });
      if (claimed.count !== 1) throw createInvalidInvitationTokenError();

      let user;
      if (existingUser) {
        const data = {};
        if (homeOrg) {
          // The home User columns mirror the membership written below: the
          // offered role, and never administration (an invitation confers none).
          if (!keepsRole) {
            data.role = invitation.role;
            data.isCompanyAdmin = false;
          }
          if (reactivatesIdentity) {
            // Reopening a closed account with a password its holder chooses is a
            // credential event: anything minted before is dead (D-ID-1 Q6).
            data.status = "active";
            data.credentialEpoch = { increment: 1 };
            await endIdentitySessions(tx, existingUser.id, now, { reason: "identity_reopened" });
          }
          if (name?.trim()) data.name = name.trim();
          if (phone !== undefined) data.phone = phone || null;
          if (passwordHash) data.passwordHash = passwordHash;
        }

        user = Object.keys(data).length
          ? await tx.user.update({
              where: { id: existingUser.id },
              data,
            })
          : existingUser;
      } else {
        user = await tx.user.create({
          data: {
            orgId: invitation.orgId,
            name: name.trim(),
            email: invitation.email,
            phone: phone || null,
            passwordHash,
            role: invitation.role,
            status: "active",
          },
        });
      }

      // Exactly the membership offered: its role and kind, no administration or
      // ownership, whatever the person held here before (membershipService.acceptOffer).
      // A legacy member's own row is written from the User columns and kept.
      const ensured = legacyMember
        ? { membership: await membershipService.ensureMembershipForUser({ tx, user, orgId: invitation.orgId }), created: true, reactivated: false, kept: true }
        : await membershipService.acceptOffer({
            tx,
            orgId: invitation.orgId,
            userId: user.id,
            role: isPartyInvitation ? membershipService.GUEST_ROLE : invitation.role,
            kind: isPartyInvitation ? membershipService.MEMBERSHIP_KINDS.GUEST : membershipService.MEMBERSHIP_KINDS.MEMBER,
            invitedById: invitation.invitedById || null,
            invitationId: invitation.id,
            joinedAt: now,
          });
      // A membership coming back from suspension or departure brings nothing it
      // held before: its old party places, company memberships and project
      // assignments here go, and only the offered ones are written below.
      if (ensured?.reactivated) {
        await tx.projectPartyMember.updateMany({
          where: { userId: user.id, status: "active", projectParty: { project: { orgId: invitation.orgId } } },
          data: { status: "inactive" },
        });
        await tx.companyMembership.updateMany({
          where: { userId: user.id, orgId: invitation.orgId, status: "active" },
          data: { status: "inactive" },
        });
        await tx.projectAssignment.deleteMany({ where: { userId: user.id, orgId: invitation.orgId } });
      }
      if (ensured) {
        await membershipService.recordMembershipEvent({
          tx,
          orgId: invitation.orgId,
          membership: ensured.membership,
          action: "membership.invitation_accepted",
          actor: invitation.invitedById ? { id: invitation.invitedById } : null,
          context,
          metadata: {
            invitationId: invitation.id,
            created: ensured.created,
            reactivated: ensured.reactivated,
            roleKept: ensured.kept,
            kind: ensured.membership.kind,
            provedBy: existingUser && !reactivatesIdentity ? "session" : null,
          },
        });
      }

      if (invitation.projectPartyId || invitation.companyId) {
        await companyPartyService.acceptProjectPartyInvitation({
          tx,
          invitation,
          user,
        });
      } else if (invitation.projectId) {
        await tx.projectAssignment.upsert({
          where: {
            projectId_userId: {
              projectId: invitation.projectId,
              userId: user.id,
            },
          },
          create: {
            projectId: invitation.projectId,
            userId: user.id,
            role: invitation.role,
            orgId: invitation.orgId,
          },
          update: {
            role: invitation.role,
            orgId: invitation.orgId,
          },
        });
      }

      await tx.invitationToken.update({
        where: { id: invitation.id },
        data: {
          acceptedById: user.id,
          ...(ensured ? { membershipId: ensured.membership.id } : {}),
        },
      });

      const siblings = await tx.invitationToken.findMany({
        where: {
          orgId: invitation.orgId,
          email: invitation.email,
          id: { not: invitation.id },
          status: "pending",
          acceptedAt: null,
          revokedAt: null,
        },
        select: { id: true },
      });
      if (siblings.length) {
        await tx.invitationToken.updateMany({
          where: { id: { in: siblings.map((row) => row.id) }, status: "pending" },
          data: { status: "revoked", revokedAt: now },
        });
        // Audited as revoked only what this update revoked.
        const revoked = await tx.invitationToken.findMany({
          where: { id: { in: siblings.map((row) => row.id) }, status: "revoked", revokedAt: now },
          select: { id: true },
        });
        for (const row of revoked) {
          await recordAuthAuditEvent({
            tx,
            orgId: invitation.orgId,
            userId: user.id,
            entityType: "invitation",
            entityId: row.id,
            action: "invitation_revoked",
            email: invitation.email,
            ipAddress: context.ipAddress,
            userAgent: context.userAgent,
            metadata: { reason: "accepted_other", acceptedInvitationId: invitation.id },
          });
        }
      }

      await recordAuthAuditEvent({
        tx,
        orgId: invitation.orgId,
        projectId: invitation.projectId,
        userId: user.id,
        actorId: invitation.invitedById || null,
        entityType: "invitation",
        entityId: invitation.id,
        action: "invitation_accepted",
        email: invitation.email,
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
        metadata: {
          role: invitation.role,
          projectId: invitation.projectId,
          companyId: invitation.companyId,
          projectPartyId: invitation.projectPartyId,
          provedBy: existingUser && !reactivatesIdentity ? "session" : null,
        },
      });

      return user;
    });
  } catch (error) {
    // Two workspaces' links for the same new address accepted at once (or a
    // sign-up racing an acceptance): the e-mail is unique, so the second
    // identity is refused and its whole transaction — the claim of this link
    // included — rolls back. The identity exists now: this link stays usable
    // by signing in as it (D-ID-1 XORG).
    const target = [].concat(error?.meta?.target || []).join(",");
    if (!existingUser && error?.code === "P2002" && /email/i.test(target)) {
      throw new HttpError(401, "INVITATION_SIGN_IN_REQUIRED", "Sign in as the invited account to accept this invitation");
    }
    // A proof from before the identity's last credential event, refused under
    // the lock, is recorded like every other refused acceptance.
    if (error?.code === "SESSION_REVOKED") {
      await recordAuthAuditEvent({
        orgId: invitation.orgId,
        projectId: invitation.projectId,
        userId: existingUser?.id || null,
        entityType: "invitation",
        entityId: invitation.id,
        action: "invitation_accept_rejected",
        email: invitation.email,
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
        metadata: { reason: "SESSION_REVOKED" },
      }).catch(() => null);
    }
    throw error;
  }

  // The acceptance stands; the session for the workspace just joined is issued
  // as every workspace session is (issueWorkspaceSession): the workspace's
  // single-sign-on policy and second-factor enrolment apply, and a session a
  // company's single sign-on issued stays bound to it. A reopened account, or
  // one the workspace's policy sends to its single sign-on, signs in instead.
  const signIn = (reason) => ({ accepted: true, signInRequired: true, orgId: invitation.orgId, reason });
  if (reactivatesIdentity) {
    return signIn({ code: "SIGN_IN_REQUIRED", message: "Your account is open again: sign in with your new password" });
  }
  try {
    // The SSO binding is carried only from the accepting identity's own session;
    // a bearer of anyone else (a colleague's session in the same browser, on a
    // brand-new account's acceptance) lends it nothing.
    const ownSso = identityUserId && identityUserId === accepted.id ? identitySsoOrgId : null;
    // The epoch the acceptance proved: the bearer's for an existing identity,
    // the one the acceptance itself wrote for a new one — never whatever the
    // row says by the time the session is issued (a reset may have landed).
    const ownEpoch =
      identityUserId && identityUserId === accepted.id && Number.isInteger(identityEpoch)
        ? identityEpoch
        : Number.isInteger(accepted.credentialEpoch) ? accepted.credentialEpoch : 0;
    return await issueWorkspaceSession({ userId: accepted.id, orgId: invitation.orgId, ssoOrgId: ownSso, expectedEpoch: ownEpoch }, context);
  } catch (error) {
    if (error instanceof HttpError && error.status < 500) return signIn({ code: error.code, message: error.message });
    throw error;
  }
};

// ─── First administrator ────────────────────────────────────────────────────
//
// With self-service registration closed in production, a brand-new deployment
// has no way in: nobody can register, and invitations need an inviter. These
// two functions, run from `npm run admin:bootstrap` as a one-off task, create
// the first organisation and its company administrator.
//
// No password is ever supplied. The administrator gets an unusable random
// password (the plaintext is discarded at once, as SSO provisioning does) and
// a single-use set-password link — an ordinary password-reset token, completed
// by the existing reset page and POST /auth/reset-password.

// Two-int advisory lock key: its own namespace, so it can never collide with
// the single-bigint hashtext() locks the financial services take.
const BOOTSTRAP_LOCK_CLASS = 918274;
const BOOTSTRAP_LOCK_ID = 1;
const BOOTSTRAP_TRANSACTION = { maxWait: 10_000, timeout: 30_000 };
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const takeBootstrapLock = (tx) =>
  tx.$executeRaw`SELECT pg_advisory_xact_lock(${BOOTSTRAP_LOCK_CLASS}::int, ${BOOTSTRAP_LOCK_ID}::int)`;

const createBootstrapRefusal = (message) =>
  new HttpError(409, "BOOTSTRAP_NOT_EMPTY", message);

// The bootstrap link has its own lifetime, deliberately not
// PASSWORD_RESET_TOKEN_MINUTES: with --print-link it is written to stdout,
// which on ECS is a CloudWatch log group, and anyone who can read that group
// can set the password of the only company administrator until the link is
// used or expires. So it is short by default and can never be long. A value
// outside 5..60 (or not a whole number) is refused rather than clamped, so an
// operator who asked for a day is told no instead of silently getting an hour.
const BOOTSTRAP_LINK_DEFAULT_MINUTES = 30;
const BOOTSTRAP_LINK_MIN_MINUTES = 5;
const BOOTSTRAP_LINK_MAX_MINUTES = 60;

const resolveBootstrapLinkMinutes = (value = process.env.BOOTSTRAP_LINK_MINUTES) => {
  const raw = value === undefined || value === null ? "" : String(value).trim();
  if (raw === "") return BOOTSTRAP_LINK_DEFAULT_MINUTES;
  const minutes = /^\d+$/.test(raw) ? Number(raw) : Number.NaN;
  if (
    !Number.isSafeInteger(minutes) ||
    minutes < BOOTSTRAP_LINK_MIN_MINUTES ||
    minutes > BOOTSTRAP_LINK_MAX_MINUTES
  ) {
    throw new HttpError(
      400,
      "BOOTSTRAP_LINK_MINUTES_INVALID",
      `BOOTSTRAP_LINK_MINUTES must be a whole number of minutes from ${BOOTSTRAP_LINK_MIN_MINUTES} to ${BOOTSTRAP_LINK_MAX_MINUTES} (default ${BOOTSTRAP_LINK_DEFAULT_MINUTES}); got "${raw}"`,
    );
  }
  return minutes;
};

const issueSetPasswordToken = async (tx, user, now, lifetimeMinutes) => {
  const rawToken = createAccountToken();
  const created = await tx.passwordResetToken.create({
    data: {
      userId: user.id,
      orgId: user.orgId,
      email: user.email,
      tokenHash: hashAccountToken(rawToken),
      expiresAt: new Date(now.getTime() + lifetimeMinutes * 60 * 1000),
      createdAt: now,
    },
  });
  return { rawToken, token: created };
};

const bootstrapFirstAdministrator = async ({ orgName, name, email }) => {
  const cleanOrgName = String(orgName || "").trim();
  const cleanName = String(name || "").trim();
  const normalizedEmail = String(email || "").trim().toLowerCase();
  if (!cleanOrgName || !cleanName || !EMAIL_PATTERN.test(normalizedEmail)) {
    throw new HttpError(
      400,
      "VALIDATION_ERROR",
      "An organisation name, an administrator name and a valid email are required",
    );
  }
  // Checked before anything is written: a refused lifetime must not leave an
  // organisation behind with no link.
  const linkMinutes = resolveBootstrapLinkMinutes();

  // Hashed outside the transaction: bcrypt at 12 rounds is slow, and the
  // advisory lock should be held only while the database is being read and
  // written.
  const passwordHash = await bcrypt.hash(randomBytes(32).toString("base64url"), 12);
  const now = new Date();

  const result = await prisma.$transaction(async (tx) => {
    // Serialises concurrent runs: the second waits here, then sees the first
    // one's organisation and refuses, instead of both seeing an empty database.
    await takeBootstrapLock(tx);

    const [organisations, users] = await Promise.all([
      tx.organisation.count(),
      tx.user.count(),
    ]);
    if (organisations > 0 || users > 0) {
      throw createBootstrapRefusal(
        "The database already holds organisations or users; the first administrator can only be created in an empty database",
      );
    }

    const { org, user } = await provisionOrganisation(tx, {
      orgName: cleanOrgName,
      name: cleanName,
      email: normalizedEmail,
      passwordHash,
    });
    const { rawToken, token } = await issueSetPasswordToken(tx, user, now, linkMinutes);

    await recordAuthAuditEvent({
      tx,
      orgId: org.id,
      userId: user.id,
      entityType: "organisation",
      entityId: org.id,
      action: "organisation_bootstrapped",
      email: normalizedEmail,
      metadata: { tokenId: token.id, expiresAt: token.expiresAt },
    });

    return { org, user, rawToken, token };
  }, BOOTSTRAP_TRANSACTION);

  return {
    organisation: { id: result.org.id, name: result.org.name },
    user: sanitizeUser(result.user),
    setPasswordUrl: buildWebAppUrl("/reset-password", result.rawToken),
    expiresAt: result.token.expiresAt,
    linkMinutes,
  };
};

/**
 * A fresh link when the first one expired unused. Only while the deployment
 * is still exactly as bootstrap left it — one organisation, one administrator
 * who has never signed in or set a password — so it can never be used to take
 * over an account that is already in use.
 */
const reissueBootstrapLink = async ({ email }) => {
  const normalizedEmail = String(email || "").trim().toLowerCase();
  const linkMinutes = resolveBootstrapLinkMinutes();
  const now = new Date();

  const result = await prisma.$transaction(async (tx) => {
    await takeBootstrapLock(tx);

    const [organisations, users] = await Promise.all([
      tx.organisation.count(),
      tx.user.count(),
    ]);
    const user = normalizedEmail
      ? await tx.user.findUnique({ where: { email: normalizedEmail } })
      : null;
    // The administrator's links are locked before "has a password been set"
    // is judged, so a reset completing the first link right now either has
    // committed — and is seen below — or waits, and then finds that link
    // revoked (D-ID-1 N3).
    if (user && typeof tx.$queryRaw === "function") {
      await tx.$queryRaw`SELECT "id" FROM "PasswordResetToken" WHERE "userId" = ${user.id} FOR UPDATE`;
    }
    const passwordsSet = user
      ? await tx.passwordResetToken.count({
          where: { userId: user.id, usedAt: { not: null } },
        })
      : 0;
    if (
      organisations !== 1 ||
      users !== 1 ||
      !user ||
      !user.isCompanyAdmin ||
      user.status !== "active" ||
      user.lastLogin ||
      passwordsSet > 0
    ) {
      throw createBootstrapRefusal(
        "A new link is only issued to the bootstrapped administrator, before their first sign-in",
      );
    }

    await tx.passwordResetToken.updateMany({
      where: { userId: user.id, usedAt: null, revokedAt: null },
      data: { revokedAt: now },
    });
    const { rawToken, token } = await issueSetPasswordToken(tx, user, now, linkMinutes);

    await recordAuthAuditEvent({
      tx,
      orgId: user.orgId,
      userId: user.id,
      entityType: "organisation",
      entityId: user.orgId,
      action: "organisation_bootstrap_link_reissued",
      email: normalizedEmail,
      metadata: { tokenId: token.id, expiresAt: token.expiresAt },
    });

    return { user, rawToken, token };
  }, BOOTSTRAP_TRANSACTION);

  return {
    user: sanitizeUser(result.user),
    setPasswordUrl: buildWebAppUrl("/reset-password", result.rawToken),
    expiresAt: result.token.expiresAt,
    linkMinutes,
  };
};

module.exports = {
  bootstrapFirstAdministrator,
  provisionOrganisation,
  reissueBootstrapLink,
  resolveBootstrapLinkMinutes,
  register,
  login,
  completeMfaLogin,
  refresh,
  logout,
  getProfile,
  requestPasswordReset,
  flushPasswordResetDeliveries,
  resetPassword,
  getInvitationPreview,
  acceptInvitation,
  createAuthSessionPayload,
  endIdentitySessions,
  holdCredentialEpoch,
  issueWorkspaceSession,
  sanitizeUser,
};
