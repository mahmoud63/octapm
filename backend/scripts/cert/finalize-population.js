'use strict';

/**
 * The last step of the certification population: the states that would have
 * stopped data from being loaded are applied once the data exists.
 *
 *   node scripts/cert/finalize-population.js              # report what would change
 *   node scripts/cert/finalize-population.js --apply
 *
 * Through the API, as each company's own administrator:
 *   - project stages: on hold, completed, archived;
 *   - people: one to three staff of every larger company deactivated; one or
 *     two invitations left pending; user C (ten companies) suspended in
 *     company 100 only.
 *
 * Then, directly in the certification database (there is no product route
 * that produces these without a payment provider), each company's billing
 * state: trial running or lapsed, active, past due, cancelled with the period
 * still running or over, expired — with a card on file and an invoice history
 * to match. The guard proves the database first.
 *
 * Idempotent: what is already in its final state is left alone.
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });

const fs = require('fs');
const guard = require('./lib/cert-env');
const { as, pool } = require('./lib/api');
const { buildPopulation, idFor, rngFor } = require('./lib/spec');

const APPLY = process.argv.includes('--apply');
const WORK = process.env.CERT_WORK_DIR || 'C:/Temp/octapm-cert';
process.env.CERT_CAPTURE_DIR = process.env.CERT_CAPTURE_DIR || path.join(WORK, 'corpus');
const DAY = 86_400_000;
const PRICE = { individual: { monthly: 49, annual: 39 * 12 }, business: { monthly: 499, annual: 399 * 12 }, enterprise: { annual: 24_000 } };

const readJson = (file, fallback) => (fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : fallback);

/** Who is deactivated and who is invited in a company: fixed by the company's number. */
const peoplePlan = (company) => {
  if (company.size === 'small') return { deactivate: [], invite: [] };
  const rng = rngFor(`final-people:${company.code}`);
  const staff = company.people.filter((p) => !p.persona && !p.isOwner);
  const deactivate = rng.shuffle(staff).slice(0, Math.min(staff.length, 1 + (company.n % 3)));
  const invite = Array.from({ length: 1 + (company.n % 2) }, (_, i) => ({
    email: `invited.${i + 1}@${company.domain}`,
    role: ['site_engineer', 'qs', 'procurement'][(company.n + i) % 3],
  }));
  return { deactivate, invite };
};

const finalizeThroughApi = async (company, projects, state) => {
  const admin = as(`pm@${company.domain}`);
  const mine = (state[company.code] = state[company.code] || { stages: {}, deactivated: [], invited: [] });
  const notes = [];

  // People first: the administrator must still be able to write.
  const plan = peoplePlan(company);
  for (const person of plan.deactivate) {
    if (mine.deactivated.includes(person.id)) continue;
    const res = await admin.send('PATCH', `/users/${person.id}/deactivate`, {});
    if (res.status === 200) mine.deactivated.push(person.id);
    else notes.push(`deactivate ${person.email}: ${res.status} ${res.body?.error?.code}`);
  }
  for (const invitation of plan.invite) {
    if (mine.invited.includes(invitation.email)) continue;
    const res = await admin.send('POST', '/users/invitations', invitation);
    if (res.status === 200 || res.status === 201) mine.invited.push(invitation.email);
    else notes.push(`invite ${invitation.email}: ${res.status} ${res.body?.error?.code}`);
  }

  // Project stages.
  for (const spec of company.projects) {
    const made = projects[company.code]?.[spec.key];
    if (!made?.id || mine.stages[spec.key] === spec.stage) continue;
    if (spec.stage === 'on_hold' || spec.stage === 'completed') {
      const res = await admin.send('PATCH', `/projects/${made.id}`, { status: spec.stage });
      if (res.status === 200) mine.stages[spec.key] = spec.stage;
      else notes.push(`${spec.key} -> ${spec.stage}: ${res.status} ${res.body?.error?.code}`);
    } else if (spec.stage === 'archived') {
      const res = await admin.send('DELETE', `/projects/${made.id}`);
      if (res.status === 200) mine.stages[spec.key] = spec.stage;
      else notes.push(`${spec.key} archive: ${res.status} ${res.body?.error?.code}`);
    } else {
      mine.stages[spec.key] = spec.stage;
    }
  }
  return notes;
};

/** The subscription row a billing state means, at `now`. */
const billingRow = (company, now) => {
  const s = company.subscription;
  const rng = rngFor(`billing-final:${company.code}`);
  const future = (days) => new Date(now.getTime() + days * DAY);
  const base = { cancelAtPeriodEnd: false, canceledAt: null, trialStartsAt: null, trialEndsAt: null, currentPeriodEnd: null, aiGenerationsUsed: s.aiGenerationsUsed };
  const periodDays = s.billingCycle === 'annual' ? rng.int(40, 330) : rng.int(3, 29);
  switch (s.state) {
    case 'trialing':
      return { ...base, status: 'trialing', trialStartsAt: future(-(7 - (company.n % 6) - 1)), trialEndsAt: future(1 + (company.n % 6)) };
    case 'trial_lapsed':
      return { ...base, status: 'trialing', trialStartsAt: future(-9), trialEndsAt: future(-2) };
    case 'active':
      return { ...base, status: 'active', currentPeriodEnd: future(periodDays) };
    case 'past_due':
      return { ...base, status: 'past_due', currentPeriodEnd: future(-rng.int(2, 9)) };
    case 'canceled_running':
      return { ...base, status: 'canceled', cancelAtPeriodEnd: true, canceledAt: future(-3), currentPeriodEnd: future(rng.int(5, 20)) };
    case 'canceled_lapsed':
      return { ...base, status: 'canceled', cancelAtPeriodEnd: true, canceledAt: future(-30), currentPeriodEnd: future(-rng.int(2, 6)) };
    case 'expired':
      return { ...base, status: 'expired', currentPeriodEnd: s.plan === 'trial' ? null : future(-rng.int(10, 40)), trialEndsAt: s.plan === 'trial' ? future(-12) : null };
    default:
      throw new Error(`company ${company.code}: unknown billing state ${s.state}`);
  }
};

const invoicesFor = (company, now) => {
  const s = company.subscription;
  if (s.plan === 'trial') return [];
  const amount = PRICE[s.plan]?.[s.billingCycle] ?? PRICE[s.plan]?.annual ?? 0;
  const label = `${s.plan[0].toUpperCase()}${s.plan.slice(1)} (${s.billingCycle})`;
  const count = s.billingCycle === 'annual' ? 1 + (company.n % 2) : 2 + (company.n % 5);
  const step = s.billingCycle === 'annual' ? 365 : 30;
  const rows = [];
  for (let i = 0; i < count; i += 1) {
    const at = new Date(now.getTime() - (i + 1) * step * DAY);
    rows.push({
      id: idFor(`invoice:${company.code}:${i}`),
      subscriptionId: s.id,
      description: label,
      amount,
      currency: 'USD',
      status: 'paid',
      periodLabel: at.toISOString().slice(0, 7),
      stripeInvoiceId: `in_cert${company.code}_${String(i + 1).padStart(2, '0')}`,
      createdAt: at,
    });
  }
  if (s.state === 'past_due') {
    rows.push({ id: idFor(`invoice:${company.code}:failed`), subscriptionId: s.id, description: label, amount, currency: 'USD', status: 'failed', periodLabel: null, stripeInvoiceId: `in_cert${company.code}_failed`, createdAt: new Date(now.getTime() - 4 * DAY) });
  }
  return rows;
};

const main = async () => {
  const population = buildPopulation();
  const { companies, multi } = population;
  const projects = readJson(path.join(WORK, 'state', 'projects.json'), {});
  const stateFile = path.join(WORK, 'state', 'finalize.json');
  const state = readJson(stateFile, {});
  const now = new Date();

  const stages = companies.flatMap((c) => c.projects.filter((p) => p.stage !== 'active' && p.stage !== 'planning'));
  const plans = companies.map(peoplePlan);
  console.log(`to apply: ${stages.length} project stages; ${plans.reduce((n, p) => n + p.deactivate.length, 0)} deactivations; ${plans.reduce((n, p) => n + p.invite.length, 0)} invitations; 100 billing states; user C suspended in company 100`);
  if (!APPLY) {
    console.log('\nreport only — nothing changed. Add --apply.');
    return;
  }

  // ── through the API ──────────────────────────────────────────────────────
  let done = 0;
  const noteLists = await pool(companies, 6, async (company) => {
    let notes;
    try {
      notes = await finalizeThroughApi(company, projects, state);
    } catch (error) {
      notes = [`ABORTED: ${error.message}`];
    }
    done += 1;
    if (done % 20 === 0) fs.writeFileSync(stateFile, JSON.stringify(state, null, 1));
    return notes.map((n) => `${company.code}: ${n}`);
  });
  // User C: suspended in company 100, and nowhere else.
  const userC = multi.find((m) => m.key === 'user.c');
  const c100 = companies.find((c) => c.code === '100');
  if (!state.userCSuspended) {
    const res = await as(`pm@${c100.domain}`).send('PATCH', `/users/${userC.id}/deactivate`, {});
    if (res.status === 200) state.userCSuspended = true;
    else noteLists.push([`100: suspend user C: ${res.status} ${res.body?.error?.code}`]);
  }
  fs.writeFileSync(stateFile, JSON.stringify(state, null, 1));
  const notes = noteLists.flat();
  console.log(`API part done; notes: ${notes.length}`);
  for (const note of notes.slice(0, 40)) console.log(`  ${note}`);

  // ── billing, in the certification database ───────────────────────────────
  const prisma = await guard.connectCertPrisma();
  try {
    for (const company of companies) {
      guard.assertCertOrganisation(company);
      const s = company.subscription;
      // The row is named by the company's own id and nothing else; a write that matched no row is an error.
      const updated = await prisma.subscription.updateMany({ where: { id: s.id, orgId: company.id }, data: billingRow(company, now) });
      if (updated.count !== 1) throw new Error(`company ${company.code}: ${updated.count} subscription rows matched`);
      if (!(s.plan === 'trial' && s.state === 'expired')) {
        await prisma.paymentMethod.createMany({
          data: [{ id: idFor(`card:${company.code}`), subscriptionId: s.id, stripePaymentMethodId: `pm_cert${company.code}`, brand: s.card.brand, last4: s.card.last4, expMonth: s.card.expMonth, expYear: s.card.expYear, isDefault: true }],
          skipDuplicates: true,
        });
      }
      const invoices = invoicesFor(company, now);
      if (invoices.length) await prisma.invoice.createMany({ data: invoices, skipDuplicates: true });
    }
    const byState = await prisma.subscription.groupBy({ by: ['plan', 'status'], _count: true });
    console.log(`billing states: ${byState.map((r) => `${r.plan}/${r.status} ${r._count}`).join(', ')}`);
    console.log(`cards ${await prisma.paymentMethod.count()}, invoices ${await prisma.invoice.count()}`);
  } finally {
    await prisma.$disconnect();
  }
  process.exitCode = notes.some((n) => n.includes('ABORTED')) ? 1 : 0;
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
