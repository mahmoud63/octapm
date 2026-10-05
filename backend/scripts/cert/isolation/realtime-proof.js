'use strict';

/**
 * Certification CERT-2: realtime (socket.io) isolation on the certified
 * population.
 *
 * For each pair of companies (attacker A = company n, victim V = company n+1):
 *   - A's PM, connected in A, asks to join V's project room: refused, with the
 *     same answer as for a project that exists nowhere;
 *   - a person who belongs to both companies (and to V's project team),
 *     connected in workspace A, asks the same: refused the same way;
 *   - V's PM changes a record in V's project and mentions that person in a
 *     comment: V's own sockets receive both events (the control — without it
 *     a silent attacker socket proves nothing), and no socket connected in A
 *     receives anything of V's company or project.
 * Once: a socket with no token, and one with a forged token, is refused.
 *
 *   node scripts/cert/isolation/realtime-proof.js [--pairs=5] [--from=010]
 *
 * Needs the certification API (CERT_API_BASE, default http://localhost:5190):
 * sockets need a listening server, so this proof does not run in process.
 * It leaves its stamped people, tasks and comments in the companies it used.
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '..', '.env') });

const crypto = require('crypto');
const fs = require('fs');
const { io: connectSocket } = require('socket.io-client');
const api = require('../lib/api');
const invitations = require('../lib/invitations');
const { buildPopulation } = require('../lib/spec');

if (process.env.CERT_INPROCESS === '1') throw new Error('realtime-proof needs the certification API: unset CERT_INPROCESS');
const STATE_DIR = process.env.CERT_STATE_DIR || 'C:/Temp/octapm-cert/state';
const arg = (name, fallback = null) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1] ?? fallback;
const PAIRS = Number(arg('pairs', 5));
const FROM = arg('from', '010');
const STAMP = `CERT2-RT-${crypto.randomBytes(3).toString('hex')}`;
const WINDOW_MS = 3_000;

let passed = 0;
let failed = 0;
const check = (name, ok, detail = '') => {
  if (ok) passed += 1;
  else failed += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};
const said = (res) => `${res.status} ${res.body?.error?.code || ''}`.trim();
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const projectOf = (code) => JSON.parse(fs.readFileSync(path.join(STATE_DIR, 'inventory', `${code}.json`), 'utf8')).projects[`${code}-01`];

/** A connected socket, greeted; or the connect error's code. */
const connect = (token) =>
  new Promise((resolve) => {
    const socket = connectSocket(api.BASE, { transports: ['websocket'], reconnection: false, ...(token === undefined ? {} : { auth: { token } }) });
    const timer = setTimeout(() => { socket.close(); resolve({ error: 'TIMEOUT' }); }, 10_000);
    socket.once('realtime.ready', (ready) => { clearTimeout(timer); resolve({ socket, ready }); });
    socket.once('connect_error', (error) => { clearTimeout(timer); socket.close(); resolve({ error: error?.data?.code || error?.message || 'connect_error' }); });
  });
const join = (socket, projectId) =>
  new Promise((resolve) => {
    const timer = setTimeout(() => resolve({ ok: false, code: 'NO_ACK' }), 8_000);
    socket.emit('project:join', { projectId }, (ack) => { clearTimeout(timer); resolve(ack || {}); });
  });
const record = (socket) => {
  const events = [];
  socket.on('domain.event', (event) => events.push(event));
  return events;
};
const ackSaid = (ack) => `${ack.ok ? 'ok' : 'refused'} ${ack.code || ''}`.trim();

const main = async () => {
  const { companies } = buildPopulation();
  const start = companies.findIndex((c) => c.code === FROM);
  if (start < 0) throw new Error(`no company ${FROM}`);
  const password = process.env.CERT_PASSWORD;

  // ── once: no token, a forged token ─────────────────────────────────────
  const anonymous = await connect(undefined);
  check('a socket with no token is refused (AUTH_REQUIRED)', anonymous.error === 'AUTH_REQUIRED', anonymous.error || 'connected');
  const forged = await connect(`${crypto.randomBytes(16).toString('hex')}.${crypto.randomBytes(16).toString('hex')}.x`);
  check('a socket with a forged token is refused (INVALID_TOKEN)', forged.error === 'INVALID_TOKEN', forged.error || 'connected');

  for (let i = 0; i < PAIRS; i += 1) {
    const A = companies[(start + i) % companies.length];
    const V = companies[(start + i + 1) % companies.length];
    const tag = `${A.code}->${V.code}`;
    const aPm = api.as(`pm@${A.domain}`);
    const vPm = api.as(`pm@${V.domain}`);
    const pV = projectOf(V.code);
    const aOrg = (await api.signIn(`pm@${A.domain}`)).orgId;
    const vOrg = (await api.signIn(`pm@${V.domain}`)).orgId;

    // A person of both companies, on V's project team. They join V the one way
    // the product allows (L38): V invites the e-mail, they accept with their own session.
    const email = `rt.shared.${STAMP.toLowerCase()}.${i}@${A.domain}`;
    const madeA = await aPm.send('POST', '/users', { name: `${STAMP} shared ${i}`, email, password, role: 'site_engineer' });
    const joined = await invitations.joinByInvitation({ inviter: vPm, email, role: 'qs', via: 'users', name: `${STAMP} shared ${i}`, homeOrgId: aOrg });
    const xId = madeA.body?.data?.id || (await api.signIn(email, aOrg)).user?.id;
    const onTeam = await vPm.send('POST', `/projects/${pV.id}/team`, { userId: xId });
    check(`${tag} setup: a person of both companies (invited into V, accepted), on V's project team`, madeA.status === 201 && joined.invited?.status === 202 && joined.accepted?.status === 200 && [200, 201].includes(onTeam.status), `${said(madeA)} | invite ${joined.invited ? said(joined.invited) : '-'} accept ${joined.accepted ? said(joined.accepted) : '-'} | ${said(onTeam)}`);

    // ── workspace switching ──────────────────────────────────────────────
    const aToken = await api.tokenFor(`pm@${A.domain}`, aOrg);
    const xToken = await api.tokenFor(email, aOrg);
    const body = (res) => JSON.stringify(res.body?.data ?? null);
    const sw = await api.raw('POST', `/auth/workspaces/${vOrg}/session`, { token: aToken });
    const swNowhere = await api.raw('POST', `/auth/workspaces/${crypto.randomUUID()}/session`, { token: aToken });
    check(`${tag} A's PM cannot open a session in V`, sw.status >= 400 && sw.status < 500 && !sw.body?.data?.tokens, said(sw));
    check(`${tag} …answered as a company that exists nowhere`, said(sw) === said(swNowhere), `${said(sw)} | ${said(swNowhere)}`);
    const rs = await api.raw('GET', `/auth/workspaces/resolve?projectId=${pV.id}`, { token: aToken });
    const rsNowhere = await api.raw('GET', `/auth/workspaces/resolve?projectId=${crypto.randomUUID()}`, { token: aToken });
    check(`${tag} resolving V's project with A's session names nothing of V`, !rs.text?.includes(vOrg) && !rs.text?.includes(V.domain), said(rs));
    check(`${tag} …answered as a project that exists nowhere`, said(rs) === said(rsNowhere) && body(rs) === body(rsNowhere), `${said(rs)} ${body(rs).slice(0, 120)} | ${said(rsNowhere)} ${body(rsNowhere).slice(0, 120)}`);
    const xr = await api.raw('GET', `/auth/workspaces/resolve?projectId=${pV.id}`, { token: xToken });
    check(`${tag} control: the shared person, signed in to A, resolves V's project to V`, xr.status === 200 && xr.text?.includes(vOrg), said(xr));
    const xs = await api.raw('POST', `/auth/workspaces/${vOrg}/session`, { token: xToken });
    check(`${tag} control: the shared person switches to V`, xs.status === 200 && Boolean(xs.body?.data?.tokens?.accessToken || xs.body?.data?.accessToken || xs.body?.data?.user), said(xs));

    const sA = await connect(await api.tokenFor(`pm@${A.domain}`, aOrg));
    const sXA = await connect(await api.tokenFor(email, aOrg));
    const sXV = await connect(await api.tokenFor(email, vOrg));
    const sV = await connect(await api.tokenFor(`pm@${V.domain}`, vOrg));
    const sockets = { sA, sXA, sXV, sV };
    const notConnected = Object.entries(sockets).filter(([, s]) => !s.socket).map(([k, s]) => `${k}: ${s.error}`);
    check(`${tag} setup: four sockets connected`, !notConnected.length, notConnected.join(', '));
    if (notConnected.length) { Object.values(sockets).forEach((s) => s.socket?.close()); continue; }
    check(`${tag} setup: each socket is greeted in its own workspace`, sA.ready.orgId === aOrg && sXA.ready.orgId === aOrg && sXV.ready.orgId === vOrg && sV.ready.orgId === vOrg);

    // ── joining the other company's project room ─────────────────────────
    const nowhere = crypto.randomUUID();
    const aJoin = await join(sA.socket, pV.id);
    const aNowhere = await join(sA.socket, nowhere);
    check(`${tag} A's PM cannot join V's project room`, aJoin.ok === false, ackSaid(aJoin));
    check(`${tag} …answered as a project that exists nowhere`, ackSaid(aJoin) === ackSaid(aNowhere), `${ackSaid(aJoin)} | ${ackSaid(aNowhere)}`);
    const xJoin = await join(sXA.socket, pV.id);
    check(`${tag} the shared person, connected in A, cannot join V's project room`, xJoin.ok === false, ackSaid(xJoin));
    check(`${tag} …answered as a project that exists nowhere`, ackSaid(xJoin) === ackSaid(await join(sXA.socket, nowhere)));
    const vJoin = await join(sV.socket, pV.id);
    check(`${tag} control: V's PM joins V's project room`, vJoin.ok === true, ackSaid(vJoin));

    const pA = projectOf(A.code);
    const aOwnJoin = await join(sA.socket, pA.id);
    check(`${tag} control: A's PM joins A's project room`, aOwnJoin.ok === true, ackSaid(aOwnJoin));

    // ── both companies act at the same time ──────────────────────────────
    const seen = { sA: record(sA.socket), sXA: record(sXA.socket), sXV: record(sXV.socket), sV: record(sV.socket) };
    const actV = async () => {
      const task = await vPm.send('POST', `/projects/${pV.id}/tasks`, { title: `${STAMP} task ${i}` });
      const taskId = task.body?.data?.id;
      const comment = taskId ? await vPm.send('POST', `/projects/${pV.id}/comments`, { recordType: 'task', recordId: taskId, body: `${STAMP} please look`, mentionUserIds: [xId] }) : { status: 0 };
      return { task, taskId, comment };
    };
    const [{ task, taskId, comment }, aTask] = await Promise.all([actV(), aPm.send('POST', `/projects/${pA.id}/tasks`, { title: `${STAMP} own task ${i}` })]);
    check(`${tag} setup: V's PM creates a task and mentions the shared person; A's PM creates a task at the same time`, task.status === 201 && [200, 201].includes(comment.status) && aTask.status === 201, `${said(task)} | ${said(comment)} | ${said(aTask)}`);
    await sleep(WINDOW_MS);

    const ofV = (e) => e.orgId === vOrg || e.projectId === pV.id || (taskId && e.entityId === taskId);
    const ofA = (e) => e.orgId === aOrg || e.projectId === pA.id || e.entityId === aTask.body?.data?.id;
    check(`${tag} control: V's PM's socket received V's project events`, seen.sV.some((e) => e.projectId === pV.id), `${seen.sV.length} event(s)`);
    check(`${tag} control: the shared person's socket in V received the mention`, seen.sXV.some((e) => e.type === 'notification.created' && e.orgId === vOrg), `${seen.sXV.map((e) => e.type).join(',') || 'none'}`);
    check(`${tag} control: A's PM's socket received A's project events`, seen.sA.some((e) => e.projectId === pA.id), `${seen.sA.length} event(s)`);
    check(`${tag} A's PM's socket received nothing of V`, !seen.sA.some(ofV), `${seen.sA.filter(ofV).length} of ${seen.sA.length}`);
    check(`${tag} the shared person's socket in A received nothing of V (not the mention either)`, !seen.sXA.some(ofV), `${seen.sXA.filter(ofV).map((e) => e.type).join(',') || 'none'} of ${seen.sXA.length}`);
    check(`${tag} V's sockets (its PM, and the shared person connected in V) received nothing of A`, ![...seen.sV, ...seen.sXV].some(ofA), [...seen.sV, ...seen.sXV].filter(ofA).map((e) => `${e.type} ${e.orgId}`).join(', '));
    const foreign = [...seen.sA.map((e) => [aOrg, e]), ...seen.sXA.map((e) => [aOrg, e]), ...seen.sV.map((e) => [vOrg, e]), ...seen.sXV.map((e) => [vOrg, e])].filter(([org, e]) => e.orgId && e.orgId !== org);
    check(`${tag} no socket received an event of a company other than the one it is connected in`, !foreign.length, foreign.map(([, e]) => `${e.type} ${e.orgId}`).join(', '));

    Object.values(sockets).forEach((s) => s.socket.close());
  }

  console.log(`\nrealtime proof: ${passed} passed, ${failed} failed of ${passed + failed}`);
  process.exitCode = failed ? 2 : 0;
};

main().catch((error) => {
  console.error(`SCRIPT ERROR: ${error.stack || error.message}`);
  process.exitCode = 1;
});
