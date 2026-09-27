#!/usr/bin/env node
/**
 * The persona the mobile workspace-switching suite needs (ENT-5,
 * mobile/e2e/cert-workspace-switch.spec.ts): one identity that is a member
 * of two throwaway organisations, with two projects in each that the person
 * is assigned to (two, so Home offers a choice rather than entering the only
 * one), and a password the browser can sign in with.
 *
 * Both organisations are `LiveTest <uuid>` organisations from the live-test
 * kit, so nothing here can reach the demo organisation, the E2E organisation
 * or the certified Phase 21 project, and `drop` refuses any other name.
 *
 *   node scripts/e2e/workspace-switch-fixture.js create           # JSON on stdout
 *   node scripts/e2e/workspace-switch-fixture.js drop <orgB> <orgA>
 *
 * Drop the organisation that holds only a membership row for the person
 * (B) before the one that holds their User row (A). Like the E2E reset, it
 * runs only against a database on this machine unless ALLOW_DATA_SCRIPT
 * names another.
 */
const crypto = require("crypto");
const path = require("path");
const bcrypt = require("bcryptjs");

require("../../src/utils/data-script-guard").exitUnlessDataScriptAllowed("e2e:workspace-switch-fixture");

const [command, ...orgIds] = process.argv.slice(2);
if (!(command === "create" && orgIds.length === 0) && !(command === "drop" && orgIds.length > 0)) {
  process.stderr.write("usage: node scripts/e2e/workspace-switch-fixture.js create | drop <orgId>...\n");
  process.exit(2);
}

const { prisma } = require(path.join("..", "..", "src", "config", "db"));
const { createLiveOrg, createLiveUser, dropLiveOrg } = require(path.join("..", "..", "src", "__live__", "helpers"));
const membershipService = require(path.join("..", "..", "src", "services", "membership.service"));
const { allocateSlug } = require(path.join("..", "..", "src", "utils", "workspace-slug"));

const create = async () => {
  const password = `Switch-${crypto.randomBytes(9).toString("base64url")}!7b`;
  const a = await createLiveOrg(prisma);
  const b = await createLiveOrg(prisma);
  for (const live of [a, b]) {
    const slug = await allocateSlug(prisma, live.org.name);
    live.org = await prisma.organisation.update({ where: { id: live.org.id }, data: { slug } });
  }
  // The person's home is A (their User row); a membership makes them a member
  // of B too. A project manager in both, so both workspaces list their project.
  const person = await createLiveUser(prisma, {
    orgId: a.org.id,
    name: "Live Switcher",
    email: `live-switch-${crypto.randomUUID()}@octapm-live.test`,
    role: "pm",
    isCompanyAdmin: true,
    passwordHash: await bcrypt.hash(password, 4),
  });
  const membershipB = (await membershipService.ensureMembership({ tx: prisma, orgId: b.org.id, userId: person.id, role: "pm", isAdmin: true })).membership;
  const workspace = async (live, membership, label) => {
    const project = await prisma.project.create({ data: { orgId: live.org.id, name: `LiveTest switch ${label}` } });
    const second = await prisma.project.create({ data: { orgId: live.org.id, name: `LiveTest switch ${label}2` } });
    for (const { id } of [project, second]) {
      await prisma.projectAssignment.create({ data: { projectId: id, orgId: live.org.id, userId: person.id, role: "pm" } });
    }
    return { orgId: live.org.id, slug: live.org.slug, name: live.org.name, membershipId: membership.id, projectId: project.id, projectName: project.name };
  };
  const out = {
    email: person.email,
    password,
    userId: person.id,
    a: await workspace(a, person.membership, "A"),
    b: await workspace(b, membershipB, "B"),
  };
  process.stdout.write(`${JSON.stringify(out)}\n`);
};

const drop = async () => {
  for (const orgId of orgIds) {
    await dropLiveOrg(prisma, orgId);
    process.stdout.write(`${orgId}: dropped\n`);
  }
};

(command === "create" ? create() : drop())
  .catch((error) => {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
