'use strict';

/**
 * The foreign-reference attack with the victims' state measured.
 *
 * In the full injection sweep every company is both an attacker (writing in
 * its own company) and a victim, so a whole-database fingerprint cannot tell a
 * victim's change from an attacker's own write. Here the sweep runs in two
 * halves: the odd-numbered companies attack (their victims are the
 * even-numbered ones), then the even-numbered attack the odd. Around each half
 * the database is fingerprinted, and the victims' companies must not change at
 * all (request-noise tables aside); the cross-company reference census is
 * taken by the sweep itself before and after.
 *
 *   node scripts/cert/isolation/inject-victim-state.js --tag=cert2b
 *
 * Exit 0 when no victim changed and no half stored a cross-company reference.
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '..', '.env') });

const fs = require('fs');
const { spawnSync } = require('child_process');
const guard = require('../lib/cert-env');
const fingerprint = require('./fingerprint');
const { buildPopulation } = require('../lib/spec');

const WORK = process.env.CERT_WORK_DIR || 'C:/Temp/octapm-cert';
const arg = (name, fallback = null) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1] ?? fallback;
const TAG = arg('tag', 'cert2');

const main = async () => {
  const { companies } = buildPopulation();
  const codes = companies.map((c) => c.code);
  const victimOf = (code) => companies[companies.findIndex((c) => c.code === code) + 1] ? companies[companies.findIndex((c) => c.code === code) + 1].code : companies[0].code;
  const halves = [
    { name: 'odd', attackers: codes.filter((c) => Number(c) % 2 === 1) },
    { name: 'even', attackers: codes.filter((c) => Number(c) % 2 === 0) },
  ];
  const db = await guard.connectCert();
  const snapshot = async () => {
    await db.query('begin transaction isolation level repeatable read read only');
    const print = await fingerprint.take(db);
    await db.query('rollback');
    return print;
  };

  const report = { tag: TAG, halves: [] };
  let bad = 0;
  for (const half of halves) {
    const victims = new Set(half.attackers.map(victimOf));
    const overlap = half.attackers.filter((c) => victims.has(c));
    if (overlap.length) throw new Error(`attackers and victims overlap in the ${half.name} half: ${overlap.join(',')}`);
    const name = `${TAG}-inject-${half.name}`;
    console.log(`[${new Date().toISOString()}] ${half.name} half: ${half.attackers.length} attackers, ${victims.size} victims`);
    const before = await snapshot();
    const run = spawnSync(process.execPath, [path.join(__dirname, 'inject.js'), `--name=${name}`, `--attackers=${half.attackers.join(',')}`], { cwd: path.join(__dirname, '..', '..', '..'), env: process.env, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
    fs.writeFileSync(path.join(WORK, 'logs', `${name}.log`), `${run.stdout || ''}${run.stderr || ''}`);
    const after = await snapshot();
    const changes = fingerprint.compare(before, after);
    const victimChanges = changes.filter((c) => !c.noise && victims.has(c.org));
    const attackerChanges = changes.filter((c) => !c.noise && !victims.has(c.org));
    const injected = JSON.parse(fs.readFileSync(path.join(WORK, 'results', 'isolation', `${name}.json`), 'utf8')).summary;
    const entry = {
      half: half.name,
      attackers: half.attackers.length,
      victims: victims.size,
      injectExit: run.status,
      attacks: injected.attacks,
      byVerdict: injected.byVerdict,
      newCrossCompanyReferences: injected.newCrossCompanyReferences,
      victimStateChanges: victimChanges.length,
      victimChanges: victimChanges.slice(0, 50),
      attackerOwnChanges: attackerChanges.length,
      attackerChanges: attackerChanges.slice(0, 50),
      noiseChanged: changes.filter((c) => c.noise).reduce((acc, c) => ({ ...acc, [c.table]: (acc[c.table] || 0) + 1 }), {}),
    };
    report.halves.push(entry);
    if (victimChanges.length || injected.newCrossCompanyReferences) bad += 1;
    console.log(`  attacks ${injected.attacks}: ${JSON.stringify(injected.byVerdict)}; new cross-company references ${injected.newCrossCompanyReferences}; victim companies changed: ${victimChanges.length} (company, table) pairs; attackers' own: ${attackerChanges.length}`);
    for (const c of victimChanges.slice(0, 20)) console.log(`    VICTIM CHANGED ${c.org} ${c.table} ${c.rowsBefore}→${c.rowsAfter}`);
  }
  await db.end();
  fs.writeFileSync(path.join(WORK, 'results', 'isolation', `${TAG}-inject-victim-state.json`), JSON.stringify(report, null, 1));
  process.exitCode = bad ? 2 : 0;
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
