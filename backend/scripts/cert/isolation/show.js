'use strict';

/**
 * Prints chosen results of an isolation run.
 *
 *   node scripts/cert/isolation/show.js <name> [--verdict=LEAK,WRITE_ACCEPTED] [--template=/search] [--attacker=outsider] [--limit=20] [--unbound]
 */

const fs = require('fs');
const path = require('path');

const WORK = process.env.CERT_WORK_DIR || 'C:/Temp/octapm-cert';
const name = process.argv[2];
const arg = (key, fallback = null) => process.argv.find((a) => a.startsWith(`--${key}=`))?.split('=')[1] ?? fallback;
const verdicts = arg('verdict')?.split(',') || null;
const template = arg('template');
const attacker = arg('attacker');
const limit = Number(arg('limit', 20));

const run = JSON.parse(fs.readFileSync(path.join(WORK, 'results', 'isolation', `${name}.json`), 'utf8'));
if (process.argv.includes('--unbound')) {
  for (const [route, info] of Object.entries(run.neverBound || {})) console.log(`${route}  companies ${info.companies}  tried ${info.tried}  last statuses ${JSON.stringify(info.statuses)}`);
  process.exit(0);
}
const chosen = run.results.filter(
  (r) => (!verdicts || verdicts.includes(r.verdict)) && (!template || r.template.includes(template)) && (!attacker || r.attacker === attacker)
);
console.log(`${chosen.length} result(s)`);
for (const r of chosen.slice(0, limit)) {
  console.log(`\n${r.verdict}  victim ${r.victim}  ${r.attacker}  ${r.method || 'GET'} ${r.route}\n  status ${r.status} ${r.code || ''}  evidence ${JSON.stringify(r.evidence || null)}\n  ${r.sample || ''}`);
}
