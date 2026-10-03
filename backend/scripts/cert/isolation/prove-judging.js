'use strict';

/**
 * Proves the rules the sweeps use to read an answer (judging.js) see what they
 * must and nothing else. No database, no API.
 *
 *   node scripts/cert/isolation/prove-judging.js
 *
 * Exit code 0 only if every case passes.
 */

const { canaryDisclosed, controlRoute, sameAnswer } = require('./judging');

const results = [];
const check = (name, ok) => {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
};

const VICTIM_PROJECT = '7b4e716d-cb60-4d99-95ba-0501f3bf74f4';
const searchRoute = `/search?q=CANARY-022-P01-92fef754&projectId=${VICTIM_PROJECT}&limit=50`;

// ── canary text ─────────────────────────────────────────────────────────────
check('a search that only echoes its own query is not a disclosure',
  !canaryDisclosed('{"data":{"query":"CANARY-022-P01-92fef754","items":[]}}', searchRoute, '022'));
check('a record whose title extends the searched canary IS a disclosure',
  canaryDisclosed('{"data":{"items":[{"title":"CANARY-022-P01-92fef754-RFI-3 Slab"}]}}', searchRoute, '022'));
check('another canary of the victim that was not sent IS a disclosure',
  canaryDisclosed('{"name":"CANARY-022-ORG-1a2b3c"}', '/projects', '022'));
check("the attacker's own company's canary is not the victim's",
  !canaryDisclosed('{"name":"CANARY-023-ORG-1a2b3c"}', '/projects', '022'));
check('an echo of a URL-encoded query is still an echo',
  !canaryDisclosed('{"query":"CANARY-022-P01-92fef754"}', '/search?q=CANARY%2D022%2DP01%2D92fef754', '022'));

// ── the random-id control ───────────────────────────────────────────────────
const control = controlRoute(`/projects/${VICTIM_PROJECT}/rfi/${VICTIM_PROJECT}`, [VICTIM_PROJECT]);
const [[from, to]] = control.swaps;
check('the control replaces every occurrence of the victim id with one fresh id',
  from === VICTIM_PROJECT && to !== VICTIM_PROJECT && /^[0-9a-f-]{36}$/.test(to) && control.route === `/projects/${to}/rfi/${to}`);

const original = { status: 200, text: `{"generatedAt":"2026-10-03T01:52:18.749Z","filters":{"projectId":"${from}"},"headline":{"totalValue":45332.97}}` };
check('same answer once a timestamp and the echoed id are set aside → filtered',
  sameAnswer(original, { status: 200, text: `{"generatedAt":"2026-10-03T01:52:19.002Z","filters":{"projectId":"${to}"},"headline":{"totalValue":45332.97}}` }, control.swaps));
check('a different figure is a different answer',
  !sameAnswer(original, { status: 200, text: `{"generatedAt":"2026-10-03T01:52:19.002Z","filters":{"projectId":"${to}"},"headline":{"totalValue":0}}` }, control.swaps));
// Erasing the ids instead of mapping them would make these two equal.
check('the victim id and its counterpart must sit in the same place, not merely both be removed',
  !sameAnswer({ status: 200, text: `{"a":"${from}","b":""}` }, { status: 200, text: `{"a":"","b":"${to}"}` }, control.swaps));
// Identical bodies (counterpart for counterpart), different status.
check('a different status is a different answer',
  !sameAnswer(original, { status: 404, text: original.text.split(from).join(to) }, control.swaps));
// A body with no id at all: any stand-in for the missing control would look the same.
check('no control answer is never "the same"',
  !sameAnswer({ status: 200, text: '{"items":[]}' }, null, control.swaps));

const failed = results.filter((ok) => !ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
