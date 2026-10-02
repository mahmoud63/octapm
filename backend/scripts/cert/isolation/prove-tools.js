'use strict';

/**
 * Proves the two instruments that say "nothing happened" can see something
 * happen: the state fingerprint and the cross-company reference scan.
 *
 *   node scripts/cert/isolation/prove-tools.js
 *
 * Everything is done inside one transaction on the certification database
 * and rolled back: a row of one company is changed, a row is added, a row of
 * one company is made to point at another company's row (by a real column
 * and by plain text in a description) — and each time the instrument must
 * report exactly that, and nothing else. Exit code 0 only if every case does.
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '..', '.env') });

const guard = require('../lib/cert-env');
const fingerprint = require('./fingerprint');
const crossLinks = require('./cross-links');

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};

const main = async () => {
  const db = await guard.connectCert();
  try {
    // Repeatable read: what other sessions commit meanwhile is not seen, so every difference is this proof's own.
    await db.query('begin transaction isolation level repeatable read');
    const rows = (
      await db.query(
        `select a.id::text as id, a."projectId"::text as project, p."orgId"::text as org, o.slug
           from "Activity" a join "Project" p on p.id = a."projectId" join "Organisation" o on o.id = p."orgId"
          order by o.slug, a.id limit 4000`
      )
    ).rows;
    const codeOf = (row) => /^cert-(\d{3})-/.exec(row.slug)[1];
    const first = rows[0];
    const other = rows.find((r) => r.org !== first.org);
    if (!first || !other) throw new Error('the certification database needs activities in two companies for this proof');

    // ── the fingerprint ────────────────────────────────────────────────────
    const before = await fingerprint.take(db);
    const same = fingerprint.compare(before, await fingerprint.take(db));
    check('two fingerprints of an unchanged database are equal', same.length === 0, `${same.length} differences`);

    await db.query('savepoint a');
    await db.query('update "Activity" set name = name || \' (changed)\' where id = $1', [first.id]);
    let diff = fingerprint.compare(before, await fingerprint.take(db));
    check(
      'one changed column in one row is reported for that company and table only',
      diff.length === 1 && diff[0].table === 'activity' && diff[0].org === codeOf(first) && diff[0].rowsBefore === diff[0].rowsAfter,
      JSON.stringify(diff.slice(0, 3))
    );
    await db.query('rollback to savepoint a');

    await db.query('savepoint b');
    await db.query(
      `insert into "Risk" (id, "projectId", "orgId", description, "updatedAt")
       select gen_random_uuid(), $1, $2, 'fingerprint proof', now()
        where exists (select 1 from information_schema.columns where table_name = 'Risk' and column_name = 'orgId')`,
      [other.project, other.org]
    ).catch(async () => {
      // The Risk table may not carry these exact columns; an inserted company row proves the same thing.
      await db.query('rollback to savepoint b');
      await db.query('savepoint b');
      await db.query(`insert into "Company" (id, "orgId", name, "updatedAt") values (gen_random_uuid(), $1, 'fingerprint proof', now())`, [other.org]);
    });
    diff = fingerprint.compare(before, await fingerprint.take(db)).filter((d) => !d.noise);
    check(
      'one added row is reported for that company only',
      diff.length >= 1 && diff.every((d) => d.org === codeOf(other)) && diff.some((d) => d.rowsAfter === d.rowsBefore + 1),
      JSON.stringify(diff.slice(0, 3))
    );
    await db.query('rollback to savepoint b');

    await db.query('savepoint c');
    await db.query('delete from "ActivityDependency" where id = (select id from "ActivityDependency" where "successorId" in (select id from "Activity" where "projectId" = $1) limit 1)', [first.project]);
    diff = fingerprint.compare(before, await fingerprint.take(db)).filter((d) => !d.noise);
    check('one deleted row is reported', diff.length === 1 && diff[0].table === 'activity_dependency' && diff[0].rowsAfter === diff[0].rowsBefore - 1, JSON.stringify(diff.slice(0, 3)));
    await db.query('rollback to savepoint c');

    // ── the cross-company reference scan ───────────────────────────────────
    const baseline = await crossLinks.scan(db);
    const key = (l) => `${l.table}|${l.id}|${l.target}`;
    const had = new Set(baseline.map(key));

    await db.query('savepoint d');
    // A soft reference: another company's activity id written into a text column.
    await db.query('update "Activity" set name = $2 where id = $1', [first.id, `see ${other.id}`]);
    let fresh = (await crossLinks.scan(db)).filter((l) => !had.has(key(l)));
    check(
      'another company\'s identifier in a plain text column is reported',
      fresh.length === 1 && fresh[0].table === 'activity' && fresh[0].id === first.id && fresh[0].target === other.id && fresh[0].targetCode === codeOf(other),
      JSON.stringify(fresh.slice(0, 2))
    );
    await db.query('rollback to savepoint d');

    await db.query('savepoint e');
    // A hard reference: a dependency whose predecessor belongs to another company (constraints lifted for the proof).
    await db.query('set constraints all deferred');
    const dependency = (await db.query('select id::text as id from "ActivityDependency" where "successorId" in (select id from "Activity" where "projectId" = $1) limit 1', [first.project])).rows[0];
    let hardOk = false;
    let hardDetail = 'no dependency row to use';
    if (dependency) {
      try {
        await db.query('alter table "ActivityDependency" disable trigger all');
        await db.query('update "ActivityDependency" set "predecessorId" = $2 where id = $1', [dependency.id, other.id]);
        fresh = (await crossLinks.scan(db)).filter((l) => !had.has(key(l)));
        hardOk = fresh.some((l) => l.table === 'activity_dependency' && l.id === dependency.id && l.target === other.id);
        hardDetail = JSON.stringify(fresh.slice(0, 2));
      } catch (error) {
        hardDetail = `could not stage the case: ${error.message.split('\n')[0]}`;
      }
    }
    check('a foreign key that points into another company is reported', hardOk, hardDetail);
    await db.query('rollback to savepoint e');

    await db.query('savepoint f');
    // A person who is not a member of the referring company.
    const stranger = (
      await db.query(
        `select u.id::text as id from "User" u
          where not exists (select 1 from "OrganizationMembership" m where m."userId" = u.id and m."orgId" = $1) limit 1`,
        [first.org]
      )
    ).rows[0];
    await db.query('update "Activity" set name = $2 where id = $1', [first.id, `owner ${stranger.id}`]);
    fresh = (await crossLinks.scan(db)).filter((l) => !had.has(key(l)));
    check('a reference to a person who is not a member of the company is reported', fresh.length === 1 && fresh[0].targetType === 'user' && fresh[0].target === stranger.id, JSON.stringify(fresh.slice(0, 2)));
    await db.query('rollback to savepoint f');

    await db.query('savepoint g');
    // A person who IS a member (a colleague) is not a cross-company link.
    const colleague = (await db.query('select "userId"::text as id from "OrganizationMembership" where "orgId" = $1 limit 1', [first.org])).rows[0];
    await db.query('update "Activity" set name = $2 where id = $1', [first.id, `owner ${colleague.id}`]);
    fresh = (await crossLinks.scan(db)).filter((l) => !had.has(key(l)));
    check('a reference to a colleague is not reported', fresh.length === 0, JSON.stringify(fresh.slice(0, 2)));
    await db.query('rollback to savepoint g');
  } finally {
    await db.query('rollback').catch(() => {});
    await db.end();
  }
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed} of ${results.length} cases behaved as expected; the transaction was rolled back`);
  process.exitCode = failed ? 1 : 0;
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
