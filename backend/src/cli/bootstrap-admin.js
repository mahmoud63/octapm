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
 * (WEB_APP_URL/reset-password?token=…) that sets a real one; it expires after
 * PASSWORD_RESET_TOKEN_MINUTES (60 by default) and works once.
 *
 * Flags:
 *   --print-link  print the link to stdout instead of emailing it (before
 *                 email delivery is live). In ECS stdout lands in CloudWatch;
 *                 the link is single-use, short-lived and audited.
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
    console.log(`Set-password link (single use, expires ${expiresAt}):`);
    console.log(result.setPasswordUrl);
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
