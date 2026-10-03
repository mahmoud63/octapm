'use strict';

/**
 * Proves that Layer 1 of the certification population is reproducible: run
 * the generator on an empty database twice and the two results must be the
 * same, row for row.
 *
 *   node scripts/cert/layer1-fingerprint.js take <name>      # writes <work>/state-fingerprints/layer1-<name>.json
 *   node scripts/cert/layer1-fingerprint.js compare <a> <b>  # exit 0 when identical, 2 when not
 *
 * The fingerprint covers what the generator decides — every company (id,
 * name, slug), person (id, home company, name, e-mail, role, status),
 * membership (company, person, role, status, admin) and subscription
 * (company, plan, cycle, status, seats, provider customer) — and nothing the
 * run cannot decide the same way twice (timestamps, password hashes).
 *
 * Read-only: one connection, one read-only transaction, through the
 * certification guard (CERT_DATABASE_URL and the marker, never DATABASE_URL).
 * The fingerprints are kept outside state/, which a regeneration moves aside.
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });

const fs = require('fs');
const crypto = require('crypto');
const guard = require('./lib/cert-env');

const WORK = process.env.CERT_WORK_DIR || 'C:/Temp/octapm-cert';
const DIR = path.join(WORK, 'state-fingerprints');

const PARTS = {
  organisations: `SELECT id, name, slug FROM "Organisation" ORDER BY id`,
  users: `SELECT id, "orgId", name, email, role, status FROM "User" ORDER BY id`,
  memberships: `SELECT "orgId", "userId", role, status, "isAdmin" FROM "OrganizationMembership" ORDER BY "orgId", "userId"`,
  subscriptions: `SELECT "orgId", plan, "billingCycle", status, seats, "stripeCustomerId" FROM "Subscription" ORDER BY "orgId"`,
};

const sha = (value) => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');

const take = async (name) => {
  const client = await guard.connectCert();
  const result = { name, takenAt: new Date().toISOString(), parts: {} };
  try {
    await client.query('BEGIN TRANSACTION READ ONLY');
    for (const [part, sql] of Object.entries(PARTS)) {
      const { rows } = await client.query(sql);
      result.parts[part] = { rows: rows.length, sha256: sha(rows) };
    }
    await client.query('COMMIT');
  } finally {
    await client.end();
  }
  fs.mkdirSync(DIR, { recursive: true });
  const file = path.join(DIR, `layer1-${name}.json`);
  fs.writeFileSync(file, JSON.stringify(result, null, 1));
  for (const [part, value] of Object.entries(result.parts)) console.log(`${part.padEnd(14)} ${String(value.rows).padStart(5)} rows  ${value.sha256}`);
  console.log(`written ${file}`);
};

const compare = (a, b) => {
  const read = (name) => JSON.parse(fs.readFileSync(path.join(DIR, `layer1-${name}.json`), 'utf8'));
  const [left, right] = [read(a), read(b)];
  let same = true;
  for (const part of Object.keys(PARTS)) {
    const [l, r] = [left.parts[part], right.parts[part]];
    const equal = l && r && l.rows === r.rows && l.sha256 === r.sha256;
    same = same && equal;
    console.log(`${part.padEnd(14)} ${equal ? 'identical' : 'DIFFERENT'}  ${l?.rows ?? '-'} / ${r?.rows ?? '-'} rows`);
  }
  console.log(same ? `IDENTICAL: ${a} and ${b}` : `DIFFERENT: ${a} and ${b}`);
  process.exit(same ? 0 : 2);
};

const [command, first, second] = process.argv.slice(2);
if (command === 'take' && first) {
  take(first).catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
} else if (command === 'compare' && first && second) {
  compare(first, second);
} else {
  console.error('usage: layer1-fingerprint.js take <name> | compare <a> <b>');
  process.exit(64);
}
