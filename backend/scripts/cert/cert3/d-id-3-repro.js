'use strict';

/**
 * D-ID-3 reproduction (CERT-3 plan §4 WP-0 "Identity leftovers"; register
 * docs/certification/OCTAPM_LAUNCH_BLOCKERS.md: "D-ID-3 (P3, CERT-3)
 * POST /projects/:id/parties/:partyId/members takes a caller-supplied
 * acceptedAt for the workspace's own members."). It reproduces and records;
 * it fixes nothing.
 *
 *   node C:\Temp\octapm-cert\run-locked.js scripts/cert/cert3/d-id-3-repro.js [A=052]
 *
 * In process (CERT_INPROCESS=1), on the certification database, through the
 * lock runner only, under the CERT-3 harness (cert3/lib/harness.js): exit 0
 * when no caller-supplied date is kept, 2 when one is (the defect as reported
 * is present), 1 on a setup error. Results:
 * C:\Temp\octapm-cert\results\cert3\d-id-3-repro.json.
 *
 * THE PATH AT HEAD 886c9f1 (read with git show)
 *  - routes/project-parties.js POST /:partyId/members: requirePermission
 *    project_parties submit + transition party.member.add (pm, planning_eng);
 *    validators param partyId UUID, body userId UUID, body role optional
 *    string <= 80. Nothing validates, strips or refuses acceptedAt or
 *    invitedAt, and the whole req.body goes to the service as `payload`.
 *  - services/company-party.service.js addProjectPartyMember:
 *    assertAccessExpansionAllowed (the D-ID-1 switch), then one transaction
 *    addProjectPartyMemberWithTx({ ..., invitedAt: payload.invitedAt ? new
 *    Date(payload.invitedAt) : null, acceptedAt: payload.acceptedAt ? new
 *    Date(payload.acceptedAt) : null }).
 *  - addProjectPartyMemberWithTx: the party row FOR UPDATE; assertProjectParty
 *    (an active party of the project, in the org); membershipService
 *    .findUserInOrg — a PRESENT membership (active or suspended) or a legacy
 *    home row without one, i.e. "the workspace's own members", suspended ones
 *    included, nobody from outside; ensureMembership(kind guest, joinedAt:
 *    acceptedAt || new Date()) — which writes a membership only for a person
 *    with none (a legacy home member, written as a GUEST with joinedAt = the
 *    caller's acceptedAt) and leaves any other alone; companyMembership
 *    upsert; projectPartyMember upsert: create { invitedAt, acceptedAt },
 *    update { acceptedAt } — a re-add rewrites the acceptance time, and to
 *    null when the field is absent.
 *  - The only other writer is the acceptance of a party invitation
 *    (acceptProjectPartyInvitation): invitedAt = the invitation's createdAt,
 *    acceptedAt = new Date(). The only reader is sanitizeMember, served by
 *    GET /projects/:id/parties to every project_parties reader (all nine
 *    roles). git grep at HEAD finds no other use of ProjectPartyMember
 *    acceptedAt.
 *  - The contract publishes the fields: openapi/spec.js
 *    ProjectPartyMemberMutation { userId, role, invitedAt, acceptedAt }.
 *  - An invalid date reaches Prisma as an Invalid Date; error-handler.js maps
 *    "Provided Date object is invalid" to 400 VALIDATION_ERROR (backstop).
 *
 * Throwaway people of A, of a fresh stamp, made through the product
 * (invitation, then acceptance), unless marked "fixture":
 *   M1 M2 M3 M6  active members (qs), added directly by A's PM
 *   M4 M5        party guests: invited to the party, accepted (the server
 *                stamped their acceptance)
 *   M7           an active member, then deactivated by A (suspended)
 *   LG           a legacy home member (fixture: its A membership row deleted)
 *
 * Fixtures (SQL, throwaway only): LG's A row deleted. Cleanup (finally, best
 * effort): the party removed through the product (it ends every place), the
 * run's pending invitations revoked; LG: if the product wrote no A row back,
 * a suspended member row is restored (as the D-ID-1 proofs restore theirs);
 * if it wrote one, LG is suspended through the product (the row it wrote
 * stays as evidence of what the add did). M7 stays suspended.
 */

const crypto = require('crypto');
const harness = require('./lib/harness');

harness.prepareInProcess();

const api = require('../lib/api');
const invitations = require('../lib/invitations');

invitations.captureMail({ quiet: true });

const NAME = 'd-id-3-repro';
const A_CODE = process.argv[2] || '052';

// The caller's dates: each distinct, so a stored value names the request that wrote it.
const PAST = '2020-01-02T03:04:05.000Z';
const PAST_INVITED = '2019-12-31T23:59:59.000Z';
const FUTURE = '2099-01-01T00:00:00.000Z';
const AS_NUMBER = 86_400_000; // a number: new Date(86400000)
const AS_NUMBER_STORED = '1970-01-02T00:00:00.000Z';
const OVERWRITE = '2001-01-01T00:00:00.000Z';
const LEGACY_AT = '2018-05-05T05:05:05.000Z';
const SUSPENDED_AT = '2017-07-07T07:07:07.000Z';
const NOT_A_DATE = 'not-a-date';

const RULES = {
  R1: {
    status: 'proposed',
    statement: "A party place's acceptedAt and invitedAt are the server's record of an invitation the person accepted (acceptedAt = when they accepted, invitedAt = when the invitation was made). A direct add by the workspace is not an acceptance: it never takes either date from the caller (it writes null, as the product does today when the field is absent, or the server's time), and neither does the membership row it may write (joinedAt).",
    sources: [
      'company-party.service acceptProjectPartyInvitation (HEAD): the only writer that means an acceptance (acceptedAt = new Date(), invitedAt = invitation.createdAt)',
      'owner decision L38 (journal 2026-10-05) and docs/architecture/OCTAPM_MEMBERSHIP_AND_RBAC.md §5.1: acceptance is the person\'s own act, with their own session; the link is claimed atomically',
      'CERT-3 plan §2.1 ID-c (precedent): a field the server owns that a caller supplies is refused, not stored (400 USER_PASSWORD_NOT_ACCEPTED)',
      'register D-ID-3',
    ],
    open: 'Owner/adjudication: refuse the fields (400) or ignore them; the OpenAPI ProjectPartyMemberMutation documents invitedAt and acceptedAt as inputs, so either way the published contract changes (mobile team).',
  },
  R2: {
    status: 'proposed',
    statement: 'A direct add never rewrites or erases an acceptance the person made: a re-add of someone who accepted a party invitation keeps their acceptedAt.',
    sources: [
      'follows from R1; company-party.service addProjectPartyMemberWithTx upsert update { acceptedAt } (HEAD) is what rewrites it',
      'register D-ID-3',
    ],
  },
};

const PLAN = [
  ['setup', 'setup: A\'s PM makes a party (subcontractor) on A\'s project 01; M1, M2, M3, M6, M7 and LG join A by invitation and acceptance as active members (qs); M4 and M5 are invited to the party and accept (guests, external_party), each with a party place the server stamped (acceptedAt within the run, invitedAt = their invitation\'s createdAt); A deactivates M7 (suspended); fixture: LG\'s A row deleted (homed in A, active, no row); none of M1, M2, M3, M6, M7, LG has a place yet', { setup: true }],
  ['read', 'after the adds, GET /projects/:id/parties (the read surface, open to every project_parties reader) answers 200 and lists the party', { setup: true }],
  ['D3.control', 'a direct add without dates (M3): 201; the place is active and neither date is a caller\'s: acceptedAt and invitedAt null, or the server\'s time of the request', { guard: true }],
  ['D3.invalid', `acceptedAt "${NOT_A_DATE}" (M2): never a 5xx — 400 VALIDATION_ERROR with no place and no company seat written, or 201 with the value ignored`, { guard: true }],
  ['D3.past', `a direct add of an active member (M1) with acceptedAt ${PAST}: the place does not carry that date (stored row, and GET /projects/:id/parties)`, { defect: 'D-ID-3', rule: 'R1' }],
  ['D3.invitedAt', `the same add with invitedAt ${PAST_INVITED}: the place does not carry that date (stored row, and GET /projects/:id/parties)`, { defect: 'D-ID-3', rule: 'R1' }],
  ['D3.future', `M2 with acceptedAt ${FUTURE}: not kept (stored row, and the list)`, { defect: 'D-ID-3', rule: 'R1' }],
  ['D3.number', `M6 with acceptedAt ${AS_NUMBER} (a number; the route validates nothing): not kept as ${AS_NUMBER_STORED}`, { defect: 'D-ID-3', rule: 'R1' }],
  ['D3.overwrite', `M4 accepted the party invitation at T0; a direct re-add with acceptedAt ${OVERWRITE} leaves acceptedAt at T0`, { defect: 'D-ID-3', rule: 'R2' }],
  ['D3.erase', 'M5 accepted at T0; a direct re-add with no acceptedAt leaves acceptedAt at T0 (not erased to null)', { defect: 'D-ID-3', rule: 'R2' }],
  ['D3.legacy', `a legacy home member (LG, no A row) added with acceptedAt ${LEGACY_AT}: neither the membership row the add writes (joinedAt) nor the place carries that date`, { defect: 'D-ID-3', rule: 'R1' }],
  ['D3.suspended', `the suspended member M7 added with acceptedAt ${SUSPENDED_AT}: the date is not kept (the add refused, or the place written without it)`, { defect: 'D-ID-3', rule: 'R1' }],
  ['G.fingerprint', 'no company other than A changed during the run', { guard: true }],
];

const h = harness.createHarness({
  name: NAME,
  plan: PLAN,
  rules: RULES,
  mailPrefix: 'did3',
  meta: {
    defect: 'D-ID-3',
    register: 'docs/certification/OCTAPM_LAUNCH_BLOCKERS.md (D-ID-3, P3, CERT-3)',
    writtenAgainst: 'HEAD 886c9f1 (cert/full-saas-certification)',
    a: A_CODE,
    route: 'POST /api/v1/projects/:projectId/parties/:partyId/members (routes/project-parties.js)',
    service: 'company-party.service addProjectPartyMember -> addProjectPartyMemberWithTx',
    contract: 'openapi/spec.js ProjectPartyMemberMutation documents invitedAt and acceptedAt as inputs',
    callerDates: { PAST, PAST_INVITED, FUTURE, AS_NUMBER, AS_NUMBER_STORED, OVERWRITE, LEGACY_AT, SUSPENDED_AT, NOT_A_DATE },
  },
});

// What the cleanup needs, filled in as the run makes it.
const ctx = { db: null, aPm: null, projectA: null, orgA: null, partyId: null, legacy: null };

const main = async () => {
  const [A] = h.companies(A_CODE);
  const db = await h.connect();
  ctx.db = db;
  const { one } = h.sql(db);
  const orgA = await h.orgOf(db, A_CODE);
  ctx.orgA = orgA;
  const projectA = h.projectId(A_CODE);
  ctx.projectA = projectA;
  const aPm = api.as(`pm@${A.domain}`);
  ctx.aPm = aPm;
  console.log(`${NAME}: A ${A_CODE} (${orgA.id}); project ${projectA}\n`);
  const printBefore = await h.fingerprint.take(db);

  const iso = h.sqlIso;
  const place = (userId) => one(
    `select id, status, role, ${iso('"acceptedAt"')} as "acceptedAt", ${iso('"invitedAt"')} as "invitedAt" from "ProjectPartyMember" where "projectPartyId" = $1 and "userId" = $2`,
    [ctx.partyId, userId],
  );
  const membership = (userId) => one(
    `select id, kind, role, status, "isAdmin", "isOwner", ${iso('"joinedAt"')} as "joinedAt" from "OrganizationMembership" where "orgId" = $1 and "userId" = $2`,
    [orgA.id, userId],
  );
  const companySeats = async (userId) => (await one(
    'select count(*)::int as n from "CompanyMembership" cm join "ProjectParty" pp on pp."companyId" = cm."companyId" where pp.id = $1 and cm."userId" = $2',
    [ctx.partyId, userId],
  )).n;
  const userRow = (id) => one('select "orgId", status from "User" where id = $1', [id]);
  const invitationCreatedAt = async (id) => (id ? (await one(`select ${iso('"createdAt"')} as "createdAt" from "InvitationToken" where id = $1`, [id]))?.createdAt || null : null);
  const within = (text, from, to) => typeof text === 'string' && Date.parse(text) >= from - 1000 && Date.parse(text) <= to + 1000;
  const showPlace = (row) => (row ? `${row.status}, acceptedAt ${row.acceptedAt}, invitedAt ${row.invitedAt}` : 'no place');

  // ── setup ──
  const party = h.keep('A makes the party', await aPm.send('POST', `/projects/${projectA}/parties`, { role: 'subcontractor', companyName: `DID3 Party ${h.STAMP}` }));
  ctx.partyId = party.status === 201 ? party.body?.data?.id || null : null;
  const notes = [`party ${h.said(party)}`];
  const person = async (label, offer = {}) => {
    const p = { label, email: h.mail(label, A.domain), name: `DID3 ${label.toUpperCase()} ${h.STAMP}` };
    const made = await invitations.createByInvitation({ inviter: aPm, email: p.email, role: 'qs', name: p.name, db, ...offer });
    h.keep(`${label}: invited`, made.invited);
    h.keep(`${label}: accepts`, made.accepted);
    p.id = made.userId;
    p.invitationId = made.invited?.status === 201 ? made.invited.body?.data?.id || null : null;
    notes.push(`${label} ${h.said(made.invited)} -> ${h.said(made.accepted)}`);
    return p;
  };
  const people = {};
  if (ctx.partyId) {
    for (const label of ['m1', 'm2', 'm3', 'm6', 'm7', 'lg']) people[label] = await person(label);
    for (const label of ['m4', 'm5']) people[label] = await person(label, { projectId: projectA, projectPartyId: ctx.partyId });
  }
  const { m1: M1, m2: M2, m3: M3, m4: M4, m5: M5, m6: M6, m7: M7, lg: LG } = people;
  const everyone = Object.values(people);
  const allMade = everyone.length === 8 && everyone.every((p) => Boolean(p.id));
  const standing = {};
  if (allMade) {
    for (const p of everyone) standing[p.label] = await membership(p.id);
    for (const p of [M4, M5]) {
      p.place0 = await place(p.id);
      p.invitedAt0 = await invitationCreatedAt(p.invitationId);
    }
  }
  const suspend = allMade ? h.keep('A deactivates M7', await aPm.send('PATCH', `/users/${M7.id}/deactivate`, {})) : null;
  const m7Row = allMade ? await membership(M7.id) : null;
  // Fixture: LG becomes a legacy home member (homed in A, no A row).
  const removed = allMade ? await db.query('delete from "OrganizationMembership" where "orgId" = $1 and "userId" = $2', [orgA.id, LG.id]) : { rowCount: 0 };
  ctx.legacy = allMade ? { id: LG.id, rowDeleted: removed.rowCount === 1 } : null;
  const lgUser = allMade ? await userRow(LG.id) : null;
  const lgRow = allMade ? await membership(LG.id) : null;
  const noPlaces = allMade ? (await Promise.all([M1, M2, M3, M6, M7, LG].map((p) => place(p.id)))).every((row) => row === null) : false;
  const memberQs = (row) => row?.status === 'active' && row.kind === 'member' && row.role === 'qs' && row.isAdmin === false && row.isOwner === false;
  const guestPlace = (p) => standing[p.label]?.status === 'active' && standing[p.label].kind === 'guest' && standing[p.label].role === 'external_party'
    && p.place0?.status === 'active' && within(p.place0.acceptedAt, h.RUN_START.getTime(), Date.now()) && Boolean(p.invitedAt0) && p.place0.invitedAt === p.invitedAt0;
  const setupOk = h.is(party, '201') && Boolean(ctx.partyId) && allMade
    && ['m1', 'm2', 'm3', 'm6', 'm7', 'lg'].every((label) => memberQs(standing[label]))
    && guestPlace(M4) && guestPlace(M5)
    && h.is(suspend, '200') && m7Row?.status === 'suspended'
    && removed.rowCount === 1 && lgRow === null && lgUser?.orgId === orgA.id && lgUser.status === 'active'
    && noPlaces;
  h.check('setup', setupOk, `${notes.join('; ')}; memberships ${JSON.stringify(standing)}; M4 place ${showPlace(M4?.place0)} (invitation createdAt ${M4?.invitedAt0}); M5 place ${showPlace(M5?.place0)} (invitation createdAt ${M5?.invitedAt0}); M7 deactivated ${h.said(suspend)} -> ${m7Row?.status}; LG fixture rows ${removed.rowCount}, row now ${lgRow ? 'present' : 'none'}, user ${lgUser?.status} home A ${lgUser?.orgId === orgA.id}; no places yet ${noPlaces}`);
  if (!setupOk) throw new Error('setup incomplete');

  // ── the adds, each by A's PM ──
  const add = async (label, userId, extra) => {
    const from = Date.now();
    const res = h.keep(label, await h.settle(aPm.send('POST', `/projects/${projectA}/parties/${ctx.partyId}/members`, { userId, ...extra })));
    return { res, from, to: Date.now() };
  };
  const listed = async () => {
    const res = h.keep('the party list', await aPm.send('GET', `/projects/${projectA}/parties`));
    const p = (Array.isArray(res.body?.data?.items) ? res.body.data.items : []).find((x) => x.id === ctx.partyId) || null;
    return { res, partyListed: Boolean(p), members: (p?.members || []).length, member: (userId) => p?.members?.find((m) => m.userId === userId) || null };
  };
  const results = {};

  // D3.control: no dates at all.
  const c = await add('M3 added without dates', M3.id, {});
  results.m3 = { answer: h.said(c.res), place: await place(M3.id) };
  const serverOrNull = (value) => value === null || within(value, c.from, c.to);
  h.check('D3.control', h.is(c.res, '201') && results.m3.place?.status === 'active' && serverOrNull(results.m3.place.acceptedAt) && serverOrNull(results.m3.place.invitedAt),
    `${results.m3.answer}; ${showPlace(results.m3.place)}`);

  // D3.invalid: a value that is not a date (M2, before its own dated add).
  const bad = await add('M2 added with an invalid date', M2.id, { acceptedAt: NOT_A_DATE });
  results.m2invalid = { answer: h.said(bad.res), place: await place(M2.id), seats: await companySeats(M2.id) };
  const refusedClean = h.is(bad.res, '400 VALIDATION_ERROR') && results.m2invalid.place === null && results.m2invalid.seats === 0;
  const ignored = h.is(bad.res, '201') && results.m2invalid.place !== null && (results.m2invalid.place.acceptedAt === null || within(results.m2invalid.place.acceptedAt, bad.from, bad.to));
  h.check('D3.invalid', refusedClean || ignored, `${results.m2invalid.answer}; ${showPlace(results.m2invalid.place)}; company seats ${results.m2invalid.seats}`);

  // D3.past and D3.invitedAt: both dates from the caller (M1).
  const past = await add('M1 added with past dates', M1.id, { acceptedAt: PAST, invitedAt: PAST_INVITED });
  results.m1 = { answer: h.said(past.res), place: await place(M1.id) };

  // D3.future (M2), D3.number (M6).
  const future = await add('M2 added with a future acceptedAt', M2.id, { acceptedAt: FUTURE });
  results.m2 = { answer: h.said(future.res), place: await place(M2.id) };
  const number = await add('M6 added with a numeric acceptedAt', M6.id, { acceptedAt: AS_NUMBER });
  results.m6 = { answer: h.said(number.res), place: await place(M6.id) };

  // D3.overwrite (M4) and D3.erase (M5): re-adds of people who accepted.
  const over = await add('M4 re-added with an acceptedAt', M4.id, { acceptedAt: OVERWRITE });
  results.m4 = { answer: h.said(over.res), before: M4.place0, place: await place(M4.id) };
  const erase = await add('M5 re-added without dates', M5.id, {});
  results.m5 = { answer: h.said(erase.res), before: M5.place0, place: await place(M5.id) };

  // D3.legacy (LG) and D3.suspended (M7).
  const legacy = await add('LG (legacy home member) added with an acceptedAt', LG.id, { acceptedAt: LEGACY_AT });
  results.lg = { answer: h.said(legacy.res), place: await place(LG.id), membership: await membership(LG.id) };
  const susp = await add('M7 (suspended) added with an acceptedAt', M7.id, { acceptedAt: SUSPENDED_AT });
  results.m7 = { answer: h.said(susp.res), place: await place(M7.id), membership: await membership(M7.id) };

  // What every project_parties reader is served.
  const list = await listed();
  const servedAccepted = (p) => list.member(p.id)?.acceptedAt ?? null;
  const servedInvited = (p) => list.member(p.id)?.invitedAt ?? null;
  for (const [label, p] of [['m1', M1], ['m2', M2], ['m3', M3], ['m4', M4], ['m5', M5], ['m6', M6], ['m7', M7], ['lg', LG]]) {
    results[label].served = { list: h.said(list.res), acceptedAt: servedAccepted(p), invitedAt: servedInvited(p) };
  }
  h.observe('adds', results);
  const listOk = h.is(list.res, '200') && list.partyListed;
  h.check('read', listOk, `party list ${h.said(list.res)}; party listed ${list.partyListed}; active places listed ${list.members}`);
  if (!listOk) throw new Error('the party list cannot be read: the served values are unknown');

  h.check('D3.past', results.m1.place?.acceptedAt !== PAST && servedAccepted(M1) !== PAST,
    `${results.m1.answer}; stored ${showPlace(results.m1.place)}; served acceptedAt ${servedAccepted(M1)}; caller ${PAST}`);
  h.check('D3.invitedAt', results.m1.place?.invitedAt !== PAST_INVITED && servedInvited(M1) !== PAST_INVITED,
    `${results.m1.answer}; stored invitedAt ${results.m1.place?.invitedAt ?? 'no place'}; served invitedAt ${servedInvited(M1)}; caller ${PAST_INVITED}`);
  h.check('D3.future', results.m2.place?.acceptedAt !== FUTURE && servedAccepted(M2) !== FUTURE,
    `${results.m2.answer}; stored ${showPlace(results.m2.place)}; served acceptedAt ${servedAccepted(M2)}; caller ${FUTURE}`);
  h.check('D3.number', results.m6.place?.acceptedAt !== AS_NUMBER_STORED && servedAccepted(M6) !== AS_NUMBER_STORED,
    `${results.m6.answer}; stored ${showPlace(results.m6.place)}; served acceptedAt ${servedAccepted(M6)}; caller ${AS_NUMBER} (= ${AS_NUMBER_STORED})`);
  h.check('D3.overwrite', Boolean(M4.place0?.acceptedAt) && results.m4.place?.acceptedAt === M4.place0.acceptedAt,
    `${results.m4.answer}; T0 ${M4.place0?.acceptedAt}; now ${showPlace(results.m4.place)}; served acceptedAt ${servedAccepted(M4)}; caller ${OVERWRITE}`);
  h.check('D3.erase', Boolean(M5.place0?.acceptedAt) && results.m5.place?.acceptedAt === M5.place0.acceptedAt,
    `${results.m5.answer}; T0 ${M5.place0?.acceptedAt}; now ${showPlace(results.m5.place)}; served acceptedAt ${servedAccepted(M5)}`);
  const lgm = results.lg.membership;
  h.check('D3.legacy', (lgm === null || lgm.joinedAt !== LEGACY_AT) && results.lg.place?.acceptedAt !== LEGACY_AT,
    `${results.lg.answer}; membership written ${lgm ? `${lgm.kind}/${lgm.role}/${lgm.status}, joinedAt ${lgm.joinedAt}` : 'none'}; place ${showPlace(results.lg.place)}; caller ${LEGACY_AT}`);
  h.check('D3.suspended', results.m7.place?.acceptedAt !== SUSPENDED_AT,
    `${results.m7.answer}; membership ${results.m7.membership?.status}; place ${showPlace(results.m7.place)}; caller ${SUSPENDED_AT}`);

  // Seen in passing (leads, not evidence).
  if (lgm && lgm.kind === 'guest') {
    h.lead('A party add turned a legacy home member (homed in A, no membership row) into a GUEST of their own home workspace (ensureMembership kind guest, role external_party)', { membership: lgm });
  }
  if (h.is(susp.res, '201') && results.m7.place?.status === 'active') {
    h.lead('A suspended member (whose identity the suspension closed) is given an active party place: the direct party add checks no standing, while the team add refuses 409 USER_NOT_ACTIVE; Activate would then bring the place back', { answer: results.m7.answer, place: results.m7.place, membership: results.m7.membership?.status });
  }

  const changes = h.fingerprint.changes(printBefore, await h.fingerprint.take(db), { exclude: [A_CODE] });
  h.check('G.fingerprint', changes.length === 0, changes.length ? changes.map((ch) => `${ch.table}:${ch.org} ${ch.rowsBefore}->${ch.rowsAfter}`).join(', ') : 'no change outside A');
};

const cleanup = async () => {
  const notes = [];
  const { db, aPm, projectA, orgA } = ctx;
  if (!db) return notes;
  if (ctx.partyId && aPm) {
    try { notes.push(`party removed ${h.said(h.keep('cleanup: remove the party', await aPm.send('DELETE', `/projects/${projectA}/parties/${ctx.partyId}`)))}`); } catch (error) { notes.push(`party: ${error.message}`); }
  }
  try { notes.push(`pending invitations of the run revoked: ${await h.revokeRunInvitations(db)}`); } catch (error) { notes.push(`invitations: ${error.message}`); }
  if (ctx.legacy?.rowDeleted && orgA) {
    try {
      const row = (await db.query('select status, kind from "OrganizationMembership" where "orgId" = $1 and "userId" = $2', [orgA.id, ctx.legacy.id])).rows[0] || null;
      if (!row) {
        // As the D-ID-1 proofs restore a legacy fixture: a suspended member row.
        await db.query(
          `insert into "OrganizationMembership" (id, "orgId", "userId", role, kind, "isAdmin", "isOwner", status, "createdAt", "updatedAt")
           values ($1, $2, $3, 'qs', 'member', false, false, 'suspended', ${h.NOW_UTC}, ${h.NOW_UTC})`,
          [crypto.randomUUID(), orgA.id, ctx.legacy.id],
        );
        notes.push('LG fixture: A row restored as a suspended member');
      } else if (row.status === 'active' && aPm) {
        notes.push(`LG: the add wrote an A row (${row.kind}); suspended through the product ${h.said(h.keep('cleanup: deactivate LG', await aPm.send('PATCH', `/users/${ctx.legacy.id}/deactivate`, {})))}`);
      } else {
        notes.push(`LG: A row ${row.kind}/${row.status} left as the product wrote it`);
      }
    } catch (error) { notes.push(`LG fixture: ${error.message}`); }
  }
  notes.push('M7 stays suspended (throwaway)');
  return notes;
};

h.run({ main, cleanup });
