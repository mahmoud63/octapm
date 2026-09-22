#!/usr/bin/env node
/**
 * Creates the first organisation and its company administrator in an empty
 * database, and hands out a single-use link to set the password.
 *
 *   BOOTSTRAP_ORG_NAME="Acme Construction" \
 *   BOOTSTRAP_ADMIN_NAME="Jane Doe" \
 *   BOOTSTRAP_ADMIN_EMAIL=jane@acme.example \
 *   npm run admin:bootstrap -- --print-link
 *
 * On ECS it runs once as a one-off task from the API task definition, with the
 * three BOOTSTRAP_* values as environment overrides and the command
 * ["npm","run","admin:bootstrap","--","--print-link"].
 *
 * There is no password anywhere: not in the environment, not in argv, not in
 * this file. The administrator gets an unusable random password and a link
 * (WEB_APP_URL/reset-password?token=…) that sets a real one; it works once
 * and expires after BOOTSTRAP_LINK_MINUTES.
 *
 * Environment:
 *   BOOTSTRAP_LINK_MINUTES  lifetime of the set-password link, a whole number
 *                 from 5 to 60 (default 30). Deliberately separate from
 *                 PASSWORD_RESET_TOKEN_MINUTES, which governs ordinary resets.
 *                 A value outside 5..60 is refused (exit 1,
 *                 BOOTSTRAP_LINK_MINUTES_INVALID) before anything is written,
 *                 rather than silently clamped.
 *
 * Flags:
 *   --print-link  print the link to stdout instead of emailing it (before
 *                 email delivery is live). On ECS stdout lands in the task's
 *                 CloudWatch log group, and anyone who can read that group can
 *                 set the administrator's password until the link is used or
 *                 expires. Use a log group with restricted readers and short
 *                 retention, or prefer the email path. The output states the
 *                 expiry time so the operator knows how long the link lives.
 *   --help        print usage and exit.
 *   --reissue     issue a fresh link for BOOTSTRAP_ADMIN_EMAIL when the first
 *                 expired, allowed only before that administrator's first
 *                 sign-in.
 *
 * It refuses (exit 1, BOOTSTRAP_NOT_EMPTY) unless the database holds no
 * organisations and no users; an advisory lock makes two concurrent runs
 * safe. It is deliberately not behind the data-script guard: it is meant to
 * run in production, and the empty-database check is its safety.
 */
require("dotenv").config({ path: require("path").resolve(__dirname, "..", "..", ".env") });

const args = new Set(process.argv.slice(2));
const printLink = args.has("--print-link");
const reissue = args.has("--reissue");

const HELP = `Usage: npm run admin:bootstrap -- [--print-link] [--reissue]

Creates the first organisation and company administrator in an empty database
from BOOTSTRAP_ORG_NAME, BOOTSTRAP_ADMIN_NAME and BOOTSTRAP_ADMIN_EMAIL, and
issues a single-use set-password link.

  BOOTSTRAP_LINK_MINUTES  link lifetime in minutes, 5 to 60 (default 30);
                          anything else is refused.
  --print-link  print the link instead of emailing it. On ECS this output goes
                to CloudWatch: anyone who can read the log group can use the
                link until it expires. Use a log group with restricted readers
                and short retention, or prefer email delivery.
  --reissue     replace an unused link, only before the first sign-in.
`;

if (args.has("--help") || args.has("-h")) {
  process.stdout.write(HELP);
  process.exit(0);
}

const run = async () => {
  const authService = require("../services/auth.service");
  const identity = {
    orgName: process.env.BOOTSTRAP_ORG_NAME,
    name: process.env.BOOTSTRAP_ADMIN_NAME,
    email: process.env.BOOTSTRAP_ADMIN_EMAIL,
  };

  const result = reissue
    ? await authService.reissueBootstrapLink({ email: identity.email })
    : await authService.bootstrapFirstAdministrator(identity);

  if (result.organisation) {
    console.log(`Created organisation "${result.organisation.name}" (${result.organisation.id})`);
  }
  console.log(`Company administrator: ${result.user.email} (${result.user.id})`);

  const expiresAt = new Date(result.expiresAt).toISOString();
  if (printLink) {
    // This stdout is a CloudWatch log on ECS: the link is a live credential
    // for the only administrator until it is used or expires, so say so where
    // the operator reads it.
    console.log(`Set-password link (single use, valid ${result.linkMinutes} minutes, expires ${expiresAt}):`);
    console.log(result.setPasswordUrl);
    console.log(
      "WARNING: this link is now in this task's logs (CloudWatch on ECS). Anyone who can read them can set the administrator's password until it is used or expires. " +
        "Use a log group with restricted readers and short retention, or prefer delivery by email (run without --print-link).",
    );
    return;
  }

  const { sendEmail, templates } = require("../services/email.service");
  try {
    await sendEmail({
      to: result.user.email,
      ...templates.passwordReset({ name: result.user.name, resetUrl: result.setPasswordUrl, expiresAt: result.expiresAt }),
      metadata: { orgId: result.user.orgId, userId: result.user.id, type: "bootstrap_admin" },
    });
    console.log(`Set-password link emailed to ${result.user.email} (expires ${expiresAt}).`);
  } catch (error) {
    // The organisation exists now; only the delivery failed. A reissue with
    // --print-link recovers without reopening the empty-database door.
    console.error(`The link could not be emailed (${error?.code || error?.message}). Run again with --reissue --print-link.`);
    process.exitCode = 1;
  }
};

run()
  .catch((error) => {
    const code = error?.code || "BOOTSTRAP_FAILED";
    console.error(`${code}: ${error?.message || error}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await require("../config/db").prisma.$disconnect().catch(() => {});
  });
