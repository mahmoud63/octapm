#!/usr/bin/env node
/**
 * Sole-owner recovery, for support operators only (owner decision D-ID-1 Q13;
 * procedure: docs/operations/OWNER_RECOVERY_RUNBOOK.md). Makes an existing,
 * active member of a workspace its owner when the only owner can no longer
 * sign in. No password, e-mail, factor or session is touched or printed.
 *
 *   npm run ops:recover-owner -- request --org <workspace id> --user <person id> \
 *       --ticket <support ticket> --reason "<why, as verified>" --operator <email> --totp <code>
 *   npm run ops:recover-owner -- approve --request <request id> --operator <other email> --totp <code>
 *
 * Operators are OctaPM identities listed in RECOVERY_OPERATOR_EMAILS, with
 * two-factor on; --totp is a current code from the operator's authenticator
 * app and works once. In production a second operator must approve; outside
 * production `request --single-operator` lets the same operator approve.
 * Requests expire after 24 hours. Every step is written to the audit trail.
 */
require("dotenv").config({ path: require("path").resolve(__dirname, "..", "..", ".env") });

const USAGE = `Usage:
  npm run ops:recover-owner -- request --org <id> --user <id> --ticket <ref> --reason "<text>" --operator <email> --totp <code> [--single-operator]
  npm run ops:recover-owner -- approve --request <id> --operator <email> --totp <code>
`;

const parseArgs = (argv) => {
  const [command, ...rest] = argv;
  const options = { command };
  for (let index = 0; index < rest.length; index += 1) {
    const item = rest[index];
    if (item === "--single-operator") options.singleOperator = true;
    else if (item.startsWith("--")) {
      options[item.slice(2)] = rest[index + 1];
      index += 1;
    }
  }
  return options;
};

const run = async (argv = process.argv.slice(2)) => {
  const options = parseArgs(argv);
  const service = require("../services/owner-recovery.service");
  if (options.command === "request") {
    const result = await service.requestRecovery({
      orgId: options.org,
      userId: options.user,
      ticket: options.ticket,
      reason: options.reason,
      operatorEmail: options.operator,
      totp: options.totp,
      singleOperator: Boolean(options.singleOperator),
    });
    console.log(`Recovery request ${result.requestId} recorded for workspace ${result.orgId}, person ${result.userId}.`);
    console.log(`It expires at ${result.expiresAt.toISOString()} and needs approval by ${options.singleOperator ? "an operator" : "a second operator"}.`);
    return result;
  }
  if (options.command === "approve") {
    const result = await service.approveRecovery({ requestId: options.request, operatorEmail: options.operator, totp: options.totp });
    console.log(`Recovery ${result.requestId} carried out: person ${result.userId} is now owner and administrator of workspace ${result.orgId}.`);
    return result;
  }
  process.stdout.write(USAGE);
  process.exitCode = 1;
  return null;
};

if (require.main === module) {
  run()
    .catch((error) => {
      console.error(`${error?.code || "RECOVERY_FAILED"}: ${error?.message || "failed"}`);
      process.exitCode = 1;
    })
    .finally(async () => {
      await require("../config/db").prisma.$disconnect().catch(() => {});
    });
}

module.exports = { run, parseArgs };
