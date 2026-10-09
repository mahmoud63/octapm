'use strict';

/**
 * Certification CERT-2 (cross-company users, brief §5): a person who belongs
 * to two companies is a colleague in each.
 *
 * A person whose home workspace is company A and who is also a member of
 * company V can be put on V's project team, with the role they hold in V;
 * a person of A only is refused exactly as an id that exists nowhere; a member
 * V has deactivated is refused as not active.
 *
 *   $env:DATABASE_URL = $null; $env:CERT_INPROCESS = "1"; node scripts/cert/isolation/team-membership-proof.js [A=030] [V=031]
 *
 * Exit 0 when every check holds.
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '..', '.env') });

const crypto = require('crypto');
const fs = require('fs');
const api = require('../lib/api');
const invitations = require('../lib/invitations');
const { reportSuperseded, superseded } = require('../lib/superseded');
const { buildPopulation } = require('../lib/spec');
const guard = require('../lib/cert-env');

const A_CODE = process.argv[2] || '030';
const V_CODE = process.argv[3] || '031';
const STATE_DIR = process.env.CERT_STATE_DIR || 'C:/Temp/octapm-cert/state';
const STAMP = crypto.randomBytes(3).toString('hex');
let passed = 0;
let failed = 0;
const check = (name, ok, detail = '') => {
  if (ok) passed += 1;
  else failed += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};
const said = (res) => `${res.status} ${res.body?.error?.code || ''}`.trim();

const main = async () => {
  const { companies } = buildPopulation();
  const A = companies.find((c) => c.code === A_CODE);
  const V = companies.find((c) => c.code === V_CODE);
  const aPm = api.as(`pm@${A.domain}`);
  const vPm = api.as(`pm@${V.domain}`);
  const pV = JSON.parse(fs.readFileSync(path.join(STATE_DIR, 'inventory', `${V.code}.json`), 'utf8')).projects[`${V.code}-01`].id;
  const password = process.env.CERT_PASSWORD;
  const db = await guard.connectCert();

  // X: home A (site engineer), also a member of V (quantity surveyor). Y: A only.
  const xEmail = `team.both.${STAMP}@${A.domain}`;
  const yEmail = `team.home.${STAMP}@${A.domain}`;
  // Both made in A the one way D-ID-1 allows: A invites the new e-mail, which accepts with its own name and password.
  const madeX = await invitations.createByInvitation({ inviter: aPm, email: xEmail, role: 'site_engineer', name: `Team both ${STAMP}`, password, db });
  const madeY = await invitations.createByInvitation({ inviter: aPm, email: yEmail, role: 'site_engineer', name: `Team home ${STAMP}`, password, db });
  const madeSaid = (made) => `invite ${made.invited ? said(made.invited) : '-'} accept ${made.accepted ? said(made.accepted) : '-'}`;
  // X joins V the one way the product allows (L38): V invites, X accepts with their own session.
  const inV = await invitations.joinByInvitation({ inviter: vPm, email: xEmail, role: 'qs', via: 'users', name: `Team both ${STAMP}`, db });
  const xId = madeX.userId;
  const yId = madeY.userId;
  const [membership] = (await db.query('select m.role, m.status from "OrganizationMembership" m join "Organisation" o on o.id = m."orgId" where m."userId" = $1 and o.slug like $2', [xId, `cert-${V.code}-%`])).rows;
  superseded('setup: V\'s POST /users for an existing identity answers 202', `every add answers 201 with the invitation; answered ${inV.invited ? said(inV.invited) : '-'}`);
  check('setup: X is a member of A (home) and of V as a quantity surveyor (invited, accepted); Y belongs to A only', Boolean(xId) && Boolean(yId) && inV.invited?.status < 300 && inV.accepted?.status === 200 && membership?.role === 'qs' && membership?.status === 'active', `X ${madeSaid(madeX)} | Y ${madeSaid(madeY)} | invite ${inV.invited ? said(inV.invited) : '-'} accept ${inV.accepted ? said(inV.accepted) : '-'} | V membership ${JSON.stringify(membership)}`);

  const add = (userId) => vPm.send('POST', `/projects/${pV}/team`, { userId });
  const x = await add(xId);
  check("V's PM puts X, a member of V whose home is A, on V's project team", [200, 201].includes(x.status), said(x));
  const [assignment] = (await db.query('select role from "ProjectAssignment" where "projectId" = $1 and "userId" = $2', [pV, xId])).rows;
  check('…with the role X holds in V (qs), not the home role (site_engineer)', assignment?.role === 'qs', `assignment role ${assignment?.role}; answer orgRole ${x.body?.data?.orgRole}`);

  const y = await add(yId);
  const nowhere = await add(crypto.randomUUID());
  check("a person of A only is refused on V's project (404 USER_NOT_IN_ORGANISATION)", said(y) === '404 USER_NOT_IN_ORGANISATION', said(y));
  check('…exactly as an id that exists nowhere', said(y) === said(nowhere) && JSON.stringify(y.body?.error?.message) === JSON.stringify(nowhere.body?.error?.message), `${said(y)} | ${said(nowhere)}`);
  const [yAssigned] = (await db.query('select count(*)::int as n from "ProjectAssignment" where "projectId" = $1 and "userId" = $2', [pV, yId])).rows;
  check('…and nothing is stored', yAssigned.n === 0, `${yAssigned.n} assignment(s)`);

  // Mentions in V's project follow the same membership.
  const task = await vPm.send('POST', `/projects/${pV}/tasks`, { title: `Team membership ${STAMP}` });
  const mention = (userId) => vPm.send('POST', `/projects/${pV}/comments`, { recordType: 'task', recordId: task.body?.data?.id, body: `mention ${STAMP}`, mentionUserIds: [userId] });
  const mx = await mention(xId);
  check("V's PM mentions X on V's project", task.status === 201 && [200, 201].includes(mx.status), `${said(task)} | ${said(mx)}`);
  const my = await mention(yId);
  const mn = await mention(crypto.randomUUID());
  check('a person of A only cannot be mentioned in V (400 COMMENT_MENTION_INVALID), as an id that exists nowhere', said(my) === '400 COMMENT_MENTION_INVALID' && said(my) === said(mn), `${said(my)} | ${said(mn)}`);

  // V deactivates X; A does not.
  const off = await vPm.send('PATCH', `/users/${xId}/deactivate`, {});
  await vPm.send('DELETE', `/projects/${pV}/team/${xId}`);
  const again = await add(xId);
  check('a member V has deactivated cannot be put on V\'s project (409 USER_NOT_ACTIVE)', [200, 201].includes(off.status) && said(again) === '409 USER_NOT_ACTIVE', `deactivate ${said(off)}; add ${said(again)}`);
  const [homeStanding] = (await db.query('select m.status from "OrganizationMembership" m join "Organisation" o on o.id = m."orgId" where m."userId" = $1 and o.slug like $2', [xId, `cert-${A.code}-%`])).rows;
  check('…while X stays active in A', homeStanding?.status === 'active', JSON.stringify(homeStanding));
  const mOff = await mention(xId);
  check('…and cannot be mentioned in V any more (400 COMMENT_MENTION_INVALID)', said(mOff) === '400 COMMENT_MENTION_INVALID', said(mOff));

  await db.end();
  const replaced = reportSuperseded('team membership proof');
  console.log(`\nteam membership proof: ${passed} passed, ${failed} failed of ${passed + failed}${replaced.length ? `; ${replaced.length} superseded by D-ID-1 (not counted)` : ''}`);
  process.exitCode = failed ? 2 : 0;
};

main().catch((error) => {
  console.error(`SCRIPT ERROR: ${error.stack || error.message}`);
  process.exitCode = 1;
});
