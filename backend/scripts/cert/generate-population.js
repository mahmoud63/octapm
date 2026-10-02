'use strict';

/**
 * Layer 1 of the certification population: the hundred companies, their
 * subscriptions, their people and memberships, and the people who belong to
 * several companies.
 *
 *   node scripts/cert/generate-population.js            # report what exists and what would be made
 *   node scripts/cert/generate-population.js --apply    # create what is missing
 *
 * It writes to the certification database only (lib/cert-env.js): the address
 * comes from CERT_DATABASE_URL, never from DATABASE_URL, and the marker must
 * match. Every id is derived from the row's name, so a second --apply finds
 * every row present and creates nothing.
 *
 * Projects and everything inside them are made afterwards through the API, as
 * the companies' own people (load-projects.js and the lifecycle drivers), so
 * that the product's own rules write them.
 *
 * While its data is being loaded every company can write: trial companies are
 * in a running trial, paying companies are active. The billing state each
 * company is meant to end in (past due, cancelled, expired…) is applied last,
 * by finalize-billing.js.
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });

const fs = require('fs');
const bcrypt = require('bcryptjs');
const guard = require('./lib/cert-env');
const { buildPopulation, summarise } = require('./lib/spec');

const APPLY = process.argv.includes('--apply');
const OUT = process.env.CERT_WORK_DIR || 'C:/Temp/octapm-cert';
const DAY = 86_400_000;

const chunks = (list, size = 500) => {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
};

const main = async () => {
  const password = process.env.CERT_PASSWORD;
  if (APPLY && (typeof password !== 'string' || password.length < 12)) {
    throw new Error('CERT_PASSWORD is not set (at least 12 characters): the one password every certification person signs in with.');
  }

  const prisma = await guard.connectCertPrisma();
  try {
    const population = buildPopulation();
    const { companies, multi } = population;
    for (const company of companies) guard.assertCertOrganisation(company);

    const orgIds = companies.map((c) => c.id);
    const everyone = [...companies.flatMap((c) => c.people), ...multi];
    const count = async () => ({
      organisations: await prisma.organisation.count({ where: { id: { in: orgIds } } }),
      subscriptions: await prisma.subscription.count({ where: { orgId: { in: orgIds } } }),
      users: await prisma.user.count({ where: { id: { in: everyone.map((p) => p.id) } } }),
      memberships: await prisma.organizationMembership.count({ where: { orgId: { in: orgIds } } }),
      organisationsInDatabase: await prisma.organisation.count(),
      usersInDatabase: await prisma.user.count(),
    });
    const expected = summarise(population);
    const before = await count();
    console.log('expected', JSON.stringify({ organisations: expected.companies, users: expected.people + expected.peopleInSeveralCompanies, memberships: expected.memberships }));
    console.log('before  ', JSON.stringify(before));
    if (!APPLY) {
      console.log('\nreport only — nothing written. Add --apply to create what is missing.');
      return;
    }

    // The application's own services (workspace defaults) read DATABASE_URL.
    // The guard has proven the certification database; point them at it and
    // nowhere else, before any of them is loaded.
    process.env.DATABASE_URL = guard.certDatabaseUrl();
    // eslint-disable-next-line global-require
    const organisationService = require('../../src/services/organisation.service');

    const now = new Date();
    const passwordHash = await bcrypt.hash(password, 12);

    await prisma.organisation.createMany({
      data: companies.map((c) => ({
        id: c.id,
        name: c.name,
        slug: c.slug,
        kind: 'company',
        plan: 'standard',
        status: 'active',
        defaultCurrency: c.currency,
        defaultTimezone: c.timezone,
      })),
      skipDuplicates: true,
    });

    // Loading state: every company may write. finalize-billing.js sets the real one.
    await prisma.subscription.createMany({
      data: companies.map((c) => {
        const s = c.subscription;
        const trial = s.plan === 'trial';
        return {
          id: s.id,
          orgId: c.id,
          plan: s.plan,
          status: trial ? 'trialing' : 'active',
          billingCycle: s.billingCycle,
          seats: s.seats,
          trialStartsAt: trial ? now : null,
          trialEndsAt: trial ? new Date(now.getTime() + 30 * DAY) : null,
          currentPeriodEnd: trial ? null : new Date(now.getTime() + 30 * DAY),
          stripeCustomerId: s.stripeCustomerId,
          stripeSubscriptionId: s.stripeSubscriptionId,
          // Reminders marked as sent, so that no scheduler ever mails a certification address.
          reminderDay5SentAt: now,
          reminderDay7SentAt: now,
        };
      }),
      skipDuplicates: true,
    });

    // People. One hash for everyone: the password is a certification secret, not a person's.
    const userRows = [
      ...companies.flatMap((c) =>
        c.people.map((p) => ({ id: p.id, orgId: c.id, name: p.name, email: p.email, passwordHash, role: p.role, isCompanyAdmin: p.isAdmin, status: 'active' }))
      ),
      ...multi.map((m) => ({
        id: m.id,
        orgId: m.homeOrgId,
        name: m.name,
        email: m.email,
        passwordHash,
        role: m.homeRole,
        isCompanyAdmin: m.memberships[0].isAdmin,
        status: 'active',
      })),
    ];
    for (const batch of chunks(userRows)) await prisma.user.createMany({ data: batch, skipDuplicates: true });

    const membershipRows = [
      ...companies.flatMap((c) =>
        c.people.map((p) => ({ id: p.membershipId, orgId: c.id, userId: p.id, role: p.role, kind: 'member', isAdmin: p.isAdmin, isOwner: p.isOwner, status: 'active', joinedAt: now }))
      ),
      ...multi.flatMap((m) =>
        m.memberships.map((ms) => ({ id: ms.id, orgId: ms.orgId, userId: m.id, role: ms.role, kind: 'member', isAdmin: ms.isAdmin, isOwner: false, status: 'active', joinedAt: now }))
      ),
    ];
    for (const batch of chunks(membershipRows)) await prisma.organizationMembership.createMany({ data: batch, skipDuplicates: true });

    // The owner created the workspace.
    for (const company of companies) {
      const owner = company.people.find((p) => p.isOwner);
      await prisma.organisation.updateMany({ where: { id: company.id, createdByUserId: null }, data: { createdByUserId: owner.id } });
    }

    // What the product gives every workspace: system permission templates and units.
    let provisioned = 0;
    for (const company of companies) {
      await organisationService.provisionWorkspaceDefaults({ orgId: company.id });
      provisioned += 1;
      if (provisioned % 20 === 0) console.log(`  workspace defaults: ${provisioned}/${companies.length}`);
    }

    const after = await count();
    console.log('after   ', JSON.stringify(after));

    fs.mkdirSync(OUT, { recursive: true });
    fs.writeFileSync(path.join(OUT, 'population.json'), JSON.stringify(population, null, 1));
    fs.writeFileSync(path.join(OUT, 'population-summary.json'), JSON.stringify(expected, null, 1));

    const complete =
      after.organisations === expected.companies &&
      after.subscriptions === expected.companies &&
      after.users === expected.people + expected.peopleInSeveralCompanies &&
      after.memberships === expected.memberships;
    console.log(complete ? '\nlayer 1 complete' : '\nlayer 1 INCOMPLETE — counts differ from the specification');
    process.exitCode = complete ? 0 : 1;
  } finally {
    await prisma.$disconnect();
  }
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
