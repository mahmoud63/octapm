'use strict';

/**
 * What the record drivers have done, read from the per-company inventories.
 *
 *   node scripts/cert/inventory-report.js                 # every driver: runs ok / failed, failures by kind, record types
 *   node scripts/cert/inventory-report.js --driver=quality-field --notes
 *   node scripts/cert/inventory-report.js --only=022,001
 */

const fs = require('fs');
const path = require('path');

const WORK = process.env.CERT_WORK_DIR || 'C:/Temp/octapm-cert';
const DIR = path.join(WORK, 'state', 'inventory');
const arg = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1] || null;
const ONLY = arg('only')?.split(',') || null;
const DRIVER = arg('driver');
const NOTES = process.argv.includes('--notes');

const drivers = {};
const types = {};
const normal = (text) => String(text).replace(/[0-9a-f]{8}-[0-9a-f-]{27}/g, '<id>').replace(/CANARY-[A-Z0-9-]+/g, '<canary>').replace(/\d{4}-\d{2}-\d{2}/g, '<date>').slice(0, 220);

for (const file of fs.readdirSync(DIR).filter((f) => f.endsWith('.json'))) {
  const code = file.replace('.json', '');
  if (ONLY && !ONLY.includes(code)) continue;
  const state = JSON.parse(fs.readFileSync(path.join(DIR, file), 'utf8'));
  for (const [type, ids] of Object.entries(state.company?.records || {})) {
    const t = (types[type] = types[type] || { rows: 0, companies: new Set() });
    t.rows += ids.length;
    t.companies.add(code);
  }
  for (const [key, project] of Object.entries(state.projects || {})) {
    for (const [name, run] of Object.entries(project.drivers || {})) {
      if (DRIVER && name !== DRIVER) continue;
      const d = (drivers[name] = drivers[name] || { ok: 0, failed: 0, errors: {}, notes: {}, ms: 0, companies: new Set() });
      if (run.ok) {
        d.ok += 1;
        d.ms += run.ms || 0;
        d.companies.add(code);
      } else {
        d.failed += 1;
        const kind = normal(run.error || 'unknown');
        (d.errors[kind] = d.errors[kind] || []).push(key);
      }
      for (const note of run.notes || []) {
        const kind = normal(note);
        (d.notes[kind] = d.notes[kind] || []).push(key);
      }
    }
    for (const [type, ids] of Object.entries(project.records || {})) {
      const t = (types[type] = types[type] || { rows: 0, companies: new Set() });
      t.rows += ids.length;
      t.companies.add(code);
    }
  }
}

for (const [name, d] of Object.entries(drivers)) {
  console.log(`${name}: ${d.ok} ok in ${d.companies.size} companies, ${d.failed} failed${d.ok ? `, ${Math.round(d.ms / d.ok / 100) / 10}s each` : ''}`);
  for (const [kind, keys] of Object.entries(d.errors).sort((a, b) => b[1].length - a[1].length).slice(0, 12)) console.log(`    FAILED ${keys.length}× ${kind}   e.g. ${keys.slice(0, 3).join(', ')}`);
  if (NOTES) for (const [kind, keys] of Object.entries(d.notes).sort((a, b) => b[1].length - a[1].length).slice(0, 40)) console.log(`    note ${keys.length}× ${kind}`);
  else if (Object.keys(d.notes).length) console.log(`    notes: ${Object.keys(d.notes).length} kinds, ${Object.values(d.notes).reduce((n, k) => n + k.length, 0)} in all`);
}
if (!DRIVER) {
  const list = Object.entries(types).sort((a, b) => b[1].companies.size - a[1].companies.size);
  console.log(`\nrecord types recorded by drivers: ${list.length}`);
  console.log(list.map(([type, t]) => `${type} ${t.rows}/${t.companies.size}`).join(', '));
}
