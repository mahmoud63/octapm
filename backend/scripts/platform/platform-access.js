#!/usr/bin/env node
/**
 * Grant, revoke or list OctaPM platform access (PlatformUserAccess).
 * The ONLY way platform access is created — there is no API for it.
 *
 *   node scripts/platform/platform-access.js --list
 *   node scripts/platform/platform-access.js --grant  --email a@b.c --reason "..." --by "Operator Name" [--apply]
 *   node scripts/platform/platform-access.js --revoke --email a@b.c --by "Operator Name" [--apply]
 *
 * Without --apply it prints what it would do and writes nothing. It refuses a
 * database that is not on this machine (or NODE_ENV=production) unless
 * ALLOW_DATA_SCRIPT names that exact database (utils/data-script-guard.js).
 * Every grant/revoke is also recorded in PlatformAuditEvent.
 */
const { exitUnlessDataScriptAllowed } = require("../../src/utils/data-script-guard");

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const value = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : null;
};
const fail = (message) => {
  console.error(`platform-access: ${message}`);
  process.exit(1);
};

const mode = ["list", "grant", "revoke"].filter(flag);
if (mode.length !== 1) fail("choose exactly one of --list, --grant, --revoke");

const target = exitUnlessDataScriptAllowed("platform-access");
const { prisma } = require("../../src/config/db");

const auditRow = (action, user, by) => ({
  actorUserId: user.id,
  actorEmail: `script:${String(by).slice(0, 120)}`,
  actorRole: "script",
  action,
  targetType: "user",
  targetId: user.id,
  method: "CLI",
  path: "scripts/platform/platform-access.js",
  statusCode: 200,
});

const main = async () => {
  if (mode[0] === "list") {
    const rows = await prisma.platformUserAccess.findMany({
      orderBy: { grantedAt: "asc" },
      include: { user: { select: { email: true, name: true, status: true, mfaEnabled: true } } },
    });
    console.log(`${target.target}: ${rows.length} platform access row(s)`);
    for (const r of rows) {
      console.log(
        `  ${r.status.padEnd(8)} ${r.role}  ${r.user.email}  (${r.user.name}; account ${r.user.status}; mfa ${r.user.mfaEnabled ? "on" : "OFF"})  granted ${r.grantedAt.toISOString()} by ${r.grantedBy}${r.revokedAt ? `; revoked ${r.revokedAt.toISOString()} by ${r.revokedBy}` : ""}`,
      );
    }
    return;
  }

  const email = (value("email") || "").trim().toLowerCase();
  const by = (value("by") || "").trim();
  if (!email) fail("--email is required");
  if (!by) fail("--by (the operator's name) is required");
  const user = await prisma.user.findUnique({ where: { email }, select: { id: true, email: true, status: true, mfaEnabled: true } });
  if (!user) fail(`no account with email ${email}`);
  const existing = await prisma.platformUserAccess.findUnique({ where: { userId: user.id } });
  const apply = flag("apply");

  if (mode[0] === "grant") {
    const reason = (value("reason") || "").trim();
    if (!reason) fail("--reason is required for a grant");
    if (user.status !== "active") fail(`account ${email} is ${user.status}; only an active account can hold platform access`);
    if (existing?.status === "active") {
      console.log(`${email} already holds active platform access (${existing.role}); nothing to do.`);
      return;
    }
    console.log(`${apply ? "GRANTING" : "Would grant"} platform_superadmin to ${email} on ${target.target} — reason: ${reason}; by ${by}.`);
    if (!user.mfaEnabled) console.log("  Note: this account has no MFA; access is refused until MFA is enrolled wherever MFA is required (always in production).");
    if (!apply) return console.log("Dry run. Re-run with --apply to write.");
    await prisma.$transaction([
      prisma.platformUserAccess.upsert({
        where: { userId: user.id },
        create: { userId: user.id, role: "platform_superadmin", status: "active", reason, grantedBy: by },
        update: { role: "platform_superadmin", status: "active", reason, grantedBy: by, grantedAt: new Date(), revokedAt: null, revokedBy: null },
      }),
      prisma.platformAuditEvent.create({ data: auditRow("platform.access.granted", user, by) }),
    ]);
    console.log("Granted.");
    return;
  }

  if (!existing || existing.status !== "active") {
    console.log(`${email} holds no active platform access; nothing to do.`);
    return;
  }
  console.log(`${apply ? "REVOKING" : "Would revoke"} platform access of ${email} on ${target.target}; by ${by}.`);
  if (!apply) return console.log("Dry run. Re-run with --apply to write.");
  await prisma.$transaction([
    prisma.platformUserAccess.update({
      where: { userId: user.id },
      data: { status: "revoked", revokedAt: new Date(), revokedBy: by },
    }),
    prisma.platformAuditEvent.create({ data: auditRow("platform.access.revoked", user, by) }),
  ]);
  console.log("Revoked. The next request by this person is refused (access is re-read on every request).");
};

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
