'use strict';

/**
 * WP-0: confirm, read only, the facts the third deep company (D3 = 006 Atlas
 * Infrastructure, plan §3.1) was chosen on, before anything is built there.
 *
 *   node scripts/cert/cert3/wp0-d3-confirm.js
 *
 * Exit 0 when every fact holds, 2 when one does not (the choice must be
 * revisited), 1 on a setup error. Results: C:\Temp\octapm-cert\results\cert3\wp0-d3-confirm.json
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '..', '.env') });
const fs = require('fs');
const guard = require('../lib/cert-env');
const { buildPopulation } = require('../lib/spec');

const RESULTS = 'C:/Temp/octapm-cert/results/cert3/wp0-d3-confirm.json';
const results = [];
const facts = {};
const check = (name, ok, detail = '') => {
  results.push({ name, ok: Boolean(ok), detail: String(detail).slice(0, 1500) });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `\n        ${detail}` : ''}`);
};

const main = async () => {
  const db = await guard.connectCert();
  const q = async (sql, params = []) => (await db.query(sql, params)).rows;
  try {
    const { companies } = buildPopulation();
    const D3 = companies.find((c) => c.code === '006');
    const org = (await q('select id, name, slug, status, "defaultCurrency", "defaultTimezone" from "Organisation" where slug like $1', ['cert-006-%']))[0];
    facts.org = org;
    check('006 exists: Atlas Infrastructure (CERT-006), active, AED, Asia/Dubai',
      org && org.name === 'Atlas Infrastructure (CERT-006)' && org.status === 'active' && org.defaultCurrency === 'AED' && org.defaultTimezone === 'Asia/Dubai', JSON.stringify(org));
    const sub = (await q('select plan, status, "billingCycle", seats, "trialEndsAt"::text as "trialEndsAt", "currentPeriodEnd"::text as "currentPeriodEnd", "cancelAtPeriodEnd", "canceledAt"::text as "canceledAt" from "Subscription" where "orgId" = $1', [org.id]));
    facts.subscription = sub;
    check('006 subscription: one row, business, active, not cancelling, no trial', sub.length === 1 && sub[0].plan === 'business' && sub[0].status === 'active' && !sub[0].cancelAtPeriodEnd && !sub[0].canceledAt && !sub[0].trialEndsAt, JSON.stringify(sub));
    const members = await q(`select u.email, m.role, m.status, m.kind, m."isAdmin", m."isOwner" from "OrganizationMembership" m join "User" u on u.id = m."userId" where m."orgId" = $1 order by u.email`, [org.id]);
    facts.members = members.map((m) => ({ ...m, email: m.email.replace(/^(.{3}).*@/, '$1…@') }));
    const active = members.filter((m) => m.status === 'active' && m.kind === 'member');
    const pm = members.find((m) => m.email === `pm@${D3.domain}`);
    check('006 people: 4 active members, none suspended or left; the PM is owner and admin; no finance member', active.length === 4 && members.length === 4 && pm?.isOwner && pm?.isAdmin && !members.some((m) => m.role === 'finance'),
      JSON.stringify(facts.members));
    const pending = (await q('select count(*)::int as n from "InvitationToken" where "orgId" = $1 and status = \'pending\'', [org.id]))[0].n;
    check('006 has no pending invitations', pending === 0, `pending ${pending}`);
    // The population's project codes live in the inventory state file, not in a column.
    const inventory = JSON.parse(fs.readFileSync('C:/Temp/octapm-cert/state/inventory/006.json', 'utf8')).projects;
    const projects = await q('select id, name, status, "archivedAt" is null as live from "Project" where "orgId" = $1 order by name', [org.id]);
    facts.projects = projects;
    const first = projects.find((p) => p.id === inventory['006-01']?.id);
    check('006 projects: 3 live (within the Business limit of 25), 006-01 among them', projects.filter((p) => p.live).length === 3 && first?.live, JSON.stringify(projects));
    const residue = (await q(`select count(*)::int as n from "User" u join "OrganizationMembership" m on m."userId" = u.id where m."orgId" = $1 and (u.email like 'did1%' or u.email like 'rt.%' or u.email like 'cert2-rt%')`, [org.id]))[0].n;
    check('006 carries no proof residue (D-ID-1, realtime or CERT-2 throwaway people)', residue === 0, `residue ${residue}`);
    const tz = await q(`select name, utc_offset::text as off, is_dst from pg_timezone_names where name in ('Africa/Cairo','Asia/Dubai','America/Chicago')`);
    const cairoJuly = (await q(`select to_char(timestamptz '2026-07-15 12:00:00+00' at time zone 'Africa/Cairo', 'HH24:MI') as t`))[0].t;
    const dubaiJuly = (await q(`select to_char(timestamptz '2026-07-15 12:00:00+00' at time zone 'Asia/Dubai', 'HH24:MI') as t`))[0].t;
    facts.timeZones = { now: tz, cairoJuly, dubaiJuly };
    check('PostgreSQL agrees with node: Cairo is UTC+3 in July 2026 (DST, so 087 is a DST company), Dubai UTC+4', cairoJuly === '15:00' && dubaiJuly === '16:00', JSON.stringify(facts.timeZones));
    const others = await q(`select o.slug, s.status, s."currentPeriodEnd"::text as "currentPeriodEnd" from "Organisation" o join "Subscription" s on s."orgId" = o.id where o.slug like 'cert-052-%' or o.slug like 'cert-087-%' or o.slug like 'cert-018-%' order by o.slug`);
    facts.others = others;
    check('052, 087 (deep) and 018 (006\'s outsider for 404 probes) have active subscriptions', others.length === 3 && others.every((o) => o.status === 'active'), JSON.stringify(others));
  } finally {
    await db.end();
  }
};

main()
  .catch((error) => {
    results.push({ name: 'setup', ok: false, detail: String(error.stack || error.message) });
    console.error(`SCRIPT ERROR: ${error.stack || error.message}`);
    process.exitCode = 1;
  })
  .finally(() => {
    const failed = results.filter((r) => !r.ok).length;
    fs.mkdirSync(path.dirname(RESULTS), { recursive: true });
    fs.writeFileSync(RESULTS, `${JSON.stringify({ at: new Date().toISOString(), facts, results }, null, 2)}\n`);
    console.log(`\nwp0 D3 confirm: ${results.length - failed} passed, ${failed} failed`);
    if (process.exitCode !== 1) process.exitCode = failed ? 2 : 0;
  });
