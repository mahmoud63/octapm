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
  verifyRefreshToken,
} = require("../utils/tokens");
const membershipService = require("./membership.service");
const authAbuseService = require("./auth-abuse.service");
const organisationService = require("./organisation.service");
const { sendEmail, templates } = require("./email.service");
const companyPartyService = require("./company-party.service");
const { isPublicRegistrationOpen } = require("../config/registration");

const PASSWORD_RESET_EXPIRY_MINUTES = 60;
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
  ssoLinked: Boolean(user.ssoSubject),
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
const createAuthSessionPayload = async (tx, user, context = {}, { orgId = null } = {}) => {
  const principal = await membershipService.resolveSessionPrincipal(tx, user, { orgId });
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
  { orgName, name, email, phone = null, passwordHash, kind = organisationService.WORKSPACE_KINDS.COMPANY },
) => {
  // A personal workspace with no name given is the person's, not an
  // "Organisation" — the header shows this name beside a Personal badge.
  const fallbackName =
    kind === organisationService.WORKSPACE_KINDS.PERSONAL
      ? `${name.trim()}'s workspace`
      : `${name.trim()} Organisation`;
  const workspaceName = orgName?.trim() || fallbackName;
  const createdOrg = await organisationService.createOrganisationRow(tx, { name: workspaceName, kind });

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
  { orgName, name, email, password, phone },
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

  if (!user) {
    await recordInvalidLogin();
    throw new HttpError(
      401,
      "INVALID_CREDENTIALS",
      "Invalid email or password",
    );
  }

  const isPasswordValid = await bcrypt.compare(password, user.passwordHash);
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
    const updatedUser = await tx.user.update({
      where: { id: user.id },
      data: { lastLogin: new Date() },
    });

    if (!entry.orgId) {
      // No single workspace to enter: the identity is proven, the workspace
      // is chosen with POST /auth/workspaces/:orgId/session.
      return {
        ...(entry.mode === "many" ? { chooseWorkspace: true } : { needsWorkspace: true }),
        identityToken: createIdentityToken(updatedUser),
        memberships: entry.workspaces,
      };
    }

    const payload = await createAuthSessionPayload(tx, updatedUser, context, { orgId: entry.orgId });
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
const issueWorkspaceSession = async ({ userId, orgId }, context = {}) => {
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
  assertWorkspacePolicy({
    org,
    email: user.email,
    isCompanyAdmin: membership ? membership.isAdmin || membership.isOwner : Boolean(user.isCompanyAdmin),
  });

  const memberships = await membershipService.listWorkspacesForUser(userId);
  return prisma.$transaction(async (tx) => {
    const payload = await createAuthSessionPayload(tx, user, context, { orgId });
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
    const principal = standing.principal || membershipService.principalFromUser(session.user);

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

const requestPasswordReset = async ({ email }, context = {}) => {
  const normalizedEmail = normalizeEmail(email);
  const user = await prisma.user.findUnique({
    where: { email: normalizedEmail },
    include: { org: true },
  });

  if (!user || user.status !== "active") {
    await recordAuthAuditEvent({
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
    return { sent: true };
  }

  const rawToken = createAccountToken();
  const tokenHash = hashAccountToken(rawToken);
  const expiresAt = getPasswordResetExpiresAt();
  const now = new Date();

  const resetToken = await prisma.$transaction(async (tx) => {
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

  const resetUrl = buildWebAppUrl("/reset-password", rawToken);
  const template = templates.passwordReset({
    name: user.name,
    resetUrl,
    expiresAt: resetToken.expiresAt,
  });

  // A failed send is recorded, never reported. The answer has to be the same
  // {sent:true} whether or not the address belongs to anyone: a 5xx here only
  // for real accounts would tell a stranger which emails are registered. The
  // person can simply ask again; the operator finds the failure in the audit
  // trail and the log.
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
        expiresAt: { gt: now },
      },
      data: { usedAt: now },
    });
    if (claimed.count !== 1) {
      throw createInvalidResetTokenError();
    }

    await tx.user.update({
      where: { id: resetToken.userId },
      data: { passwordHash },
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

    await tx.refreshSession.updateMany({
      where: {
        userId: resetToken.userId,
        revokedAt: null,
      },
      data: { revokedAt: now },
    });

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

  return { reset: true };
};

const assertUsableInvitationToken = (invitation, now = new Date()) => {
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
  // invitee has proved they are that identity, by password or by a session
  // of their own, so `requiresPassword` is true for every existing identity
  // (a client without a session asks for the password it already knows).
  const existingUser = await prisma.user.findUnique({
    where: { email: invitation.email },
    select: { id: true, orgId: true, status: true },
  });

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
    // A new identity chooses one; an existing identity proves itself with it.
    requiresPassword: true,
  };
};

/**
 * Acceptance by an identity that already exists needs proof that the caller
 * is that identity (membership doc §5 [D]): the emailed link alone would
 * turn a leaked or forwarded invitation into a session for the victim, and
 * from there into every workspace they belong to. The proof is a session of
 * their own — an access or identity token for the same `sub`, passed by the
 * route as `identityUserId` — or the account password, which is compared and
 * never rewritten. A brand-new identity still sets its password with the
 * token alone, as it always has.
 */
const assertInvitationIdentityProof = async ({ existingUser, identityUserId, password }) => {
  if (identityUserId && identityUserId === existingUser.id) return;
  if (password && (await bcrypt.compare(password, existingUser.passwordHash))) return;
  throw new HttpError(
    401,
    "INVITATION_SIGN_IN_REQUIRED",
    "Sign in as the invited account, or enter its password, to accept this invitation",
  );
};

const acceptInvitation = async (
  { token, name, password, phone, identityUserId = null },
  context = {},
) => {
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
      metadata: { reason: error.code || "invalid_token" },
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
  try {
    if (reactivatesIdentity && !homeOrg) {
      throw new HttpError(403, "USER_INACTIVE", "This account was closed by its own workspace");
    }
    if (existingUser && !reactivatesIdentity) {
      await assertInvitationIdentityProof({ existingUser, identityUserId, password });
    }
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
  const currentMembership = existingUser
    ? await membershipService.findMembership({ tx: prisma, orgId: invitation.orgId, userId: existingUser.id })
    : null;
  const keepsRole =
    Boolean(currentMembership) &&
    currentMembership.status === membershipService.MEMBERSHIP_STATUSES.ACTIVE &&
    currentMembership.kind === membershipService.MEMBERSHIP_KINDS.MEMBER;

  return prisma.$transaction(async (tx) => {
    let user;
    if (existingUser) {
      const data = {};
      if (homeOrg) {
        if (!keepsRole) data.role = invitation.role;
        if (reactivatesIdentity) data.status = "active";
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

    const ensured = keepsRole
      ? { membership: currentMembership, created: false, reactivated: false }
      : await membershipService.ensureMembership({
          tx,
          orgId: invitation.orgId,
          userId: user.id,
          role: isPartyInvitation ? membershipService.GUEST_ROLE : invitation.role,
          kind: isPartyInvitation ? membershipService.MEMBERSHIP_KINDS.GUEST : membershipService.MEMBERSHIP_KINDS.MEMBER,
          invitedById: invitation.invitedById || null,
          invitationId: invitation.id,
          joinedAt: now,
        });
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
          roleKept: keepsRole,
          kind: ensured.membership.kind,
          provedBy: existingUser && !reactivatesIdentity ? (identityUserId ? "session" : "password") : null,
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
        status: "accepted",
        acceptedAt: now,
        acceptedById: user.id,
        ...(ensured ? { membershipId: ensured.membership.id } : {}),
      },
    });

    await tx.invitationToken.updateMany({
      where: {
        orgId: invitation.orgId,
        email: invitation.email,
        id: { not: invitation.id },
        status: "pending",
        acceptedAt: null,
        revokedAt: null,
      },
      data: {
        status: "revoked",
        revokedAt: now,
      },
    });

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
      },
    });

    return createAuthSessionPayload(tx, user, context, { orgId: invitation.orgId });
  });
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
  resetPassword,
  getInvitationPreview,
  acceptInvitation,
  createAuthSessionPayload,
  issueWorkspaceSession,
  sanitizeUser,
};
