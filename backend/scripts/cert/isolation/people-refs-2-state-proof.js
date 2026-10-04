'use strict';

/**
 * The CERT-2 proof of the people and party references of timesheets and of the
 * daily log's distribution (group people-refs-2):
 *
 *   POST  /projects/{projectId}/timesheets/crews                 partyId      (project_party)
 *   PATCH /projects/{projectId}/timesheets/crews/{crewId}        partyId
 *   POST  /projects/{projectId}/timesheets/workers               userId       (user)   companyId (company)
 *   PATCH /projects/{projectId}/timesheets/workers/{workerId}    userId                companyId
 *   POST  /projects/{projectId}/timesheets/workers/import        rows[].userId          rows[].companyId   (create and update rows)
 *   POST  /projects/{projectId}/timesheets                       companyId
 *   POST  /projects/{projectId}/daily-logs/{date}/distribute     userIds[]    (user)
 *
 *   CERT_INPROCESS=1 node scripts/cert/isolation/people-refs-2-state-proof.js [attacker=056] [victim=057]
 *
 * What each did before the fix (reproduced in process, 056 -> 057):
 *   crews partyId: another company's ProjectParty and an id that exists nowhere
 *     were both stored on Crew.partyId (201 on POST, 200 on PATCH; the column
 *     has no foreign key) and copied onto the crew's timesheets (Timesheet.partyId).
 *   workers userId: another company's person was stored on Worker.userId (201,
 *     200 on PATCH) while a person who exists nowhere answered 500 P2003 with the
 *     database's text — an existence oracle. The import stored another company's
 *     person too, and for one who exists nowhere returned the database's text
 *     (constraint, file and line) in the row's error.
 *   workers companyId (beside the pairs): the import and the edit stored another
 *     company's company on the worker, and the worker list then served that
 *     company's name; the import answered one that exists nowhere with the
 *     database's text.
 *   timesheets companyId (beside the pairs): another company's company, and one
 *     that exists nowhere, were stored on Timesheet.companyId (no foreign key).
 *   daily-log distribute userIds[]: another company's person was stored in
 *     DailyLog.distributionJson and served back in every answer of that day;
 *     [["<id>"]] passed the route's isUUID (it checks an array element by
 *     element) and was stored as a nested list.
 *
 * For every door, on a record of the attacker company in a state where the
 * request is legitimately accepted:
 *   ALLOWED  the attacker's own id of that kind is accepted (2xx) and stored
 *            (read back from the database);
 *   REFUSED  the victim company's id (proven the victim's from the database) is
 *            refused — a 4xx, or for an import row the row is reported not
 *            imported — and nothing is stored; every REFUSED check holds only
 *            when the same record took the own-id request (2xx) — the gate —
 *            so a refusal for any other reason never stands in for it;
 *   NOWHERE  an id that exists nowhere gets exactly the same answer (status,
 *            code, message, the whole body once the request id is set aside);
 *   SHAPE    a value that is not an identifier — [<victim id>], {id: <victim
 *            id>}, 12345 — is refused as invalid input (400 VALIDATION_ERROR, at
 *            the route, before any lookup), never a 5xx, storing nothing.
 * No answer may be a 5xx or carry the victim's ids, names, addresses or
 * canaries; nobody of the victim company is notified; no row of the attacker
 * company names a victim id afterwards; the victim company's data does not
 * change in any table (state fingerprint restricted to its rows).
 *
 * Re-runnable: every record is new, every name and request key carries a fresh
 * stamp, the daily-log day is one the project has not logged yet.
 * Exit code 0 when every check holds, 2 otherwise.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { as } = require('../lib/api');
const { buildPopulation } = require('../lib/spec');
const guard = require('../lib/cert-env');
const fingerprint = require('./fingerprint');

const ATTACKER = process.argv[2] || '056';
const VICTIM = process.argv[3] || '057';
const GROUP = 'people-refs-2';
const WORK = process.env.CERT_WORK_DIR || 'C:/Temp/octapm-cert';
const STAMP = `PR2-${ATTACKER}-${crypto.randomBytes(3).toString('hex')}`.toUpperCase();
const INPROCESS = process.env.CERT_INPROCESS === '1';
const results = [];
const answers = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok: Boolean(ok) });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `\n        ${detail}` : ''}`);
};
const said = (res) => `${res.status} ${res.body?.error?.code || ''} ${res.body?.error?.message || ''}`.trim();
const ok2xx = (res) => res.status >= 200 && res.status < 300;
const is4xx = (res) => res.status >= 400 && res.status < 500;
/** A value that is not an identifier is invalid input, refused at the door before any lookup. */
const invalidInput = (res) => res.status === 400 && res.body?.error?.code === 'VALIDATION_ERROR';
const nowhere = () => crypto.randomUUID();
/** The whole answer, with the request id set aside. */
const shape = (res) => {
  const body = res.body && typeof res.body === 'object' ? JSON.parse(JSON.stringify(res.body)) : res.text;
  if (body?.error) delete body.error.requestId;
  return `${res.status} ${JSON.stringify(body)}`;
};
const gateNote = (gate) => (ok2xx(gate) ? '' : ` [NOT GATED: the own-id request on the same record answered ${said(gate)}]`);

// The product's local e-mail transport writes to the console in process; keep it out of the proof's output.
const print = console.log.bind(console);
console.log = (...args) => {
  const text = args.map(String).join(' ');
  if (text.startsWith('[email:local]')) return;
  print(...args);
};

const main = async () => {
  console.log(`${GROUP} state proof — attacker ${ATTACKER}, victim ${VICTIM}, stamp ${STAMP}${INPROCESS ? ', in process (the working tree\'s code)' : ' — NOT in process: this asks a running API, which does not prove the working tree'}\n`);
  const startedAt = new Date();
  const { companies } = buildPopulation();
  const attacker = companies.find((c) => c.code === ATTACKER);
  const victim = companies.find((c) => c.code === VICTIM);
  if (!attacker || !victim) throw new Error(`unknown company ${ATTACKER} or ${VICTIM}`);
  const inventory = JSON.parse(fs.readFileSync(path.join(WORK, 'state', 'inventory', `${ATTACKER}.json`), 'utf8'));
  const projects = Object.values(inventory.projects);
  const A = projects.find((p) => p.depth === 'standard' && p.refs?.parties && Object.keys(p.refs.parties).length >= 2);
  const B = projects.find((p) => p.id !== A?.id && p.refs?.parties && Object.keys(p.refs.parties).length);
  if (!A) throw new Error(`company ${ATTACKER} needs a standard project with parties`);
  const AP = `/projects/${A.id}`;

  const db = await guard.connectCert();
  const q = async (sql, params = []) => (await db.query(sql, params)).rows;
  const one = async (sql, params = []) => (await q(sql, params))[0] || null;
  const orgOf = async (code) => (await one(`select id::text as id from "Organisation" where slug like $1`, [`cert-${code}-%`]))?.id;
  const attackerOrg = await orgOf(ATTACKER);
  const victimOrg = await orgOf(VICTIM);
  if (!attackerOrg || !victimOrg) throw new Error('both companies must exist in the certification database');

  const pm = as(`pm@${attacker.domain}`);
  const ask = async (method, route, body) => {
    const res = await pm.send(method, route, body);
    answers.push({ route: `${method} ${route}`, status: res.status, text: res.text || '' });
    return res;
  };

  // ── the ids, each proven by its owner ─────────────────────────────────────
  const partyOwner = async (id) => one(`select pp."projectId"::text as project, p."orgId"::text as org from "ProjectParty" pp join "Project" p on p.id = pp."projectId" where pp.id = $1`, [id]);
  const ownParties = (await q(`select id::text as id from "ProjectParty" where "projectId" = $1 order by (status = 'active') desc, "createdAt"`, [A.id])).map((r) => r.id);
  const [ownParty, ownParty2] = ownParties;
  const otherProjectParty = B ? (await one(`select id::text as id from "ProjectParty" where "projectId" = $1 order by "createdAt" limit 1`, [B.id]))?.id : null;
  const foreignParty = (await one(`select pp.id::text as id from "ProjectParty" pp join "Project" p on p.id = pp."projectId" where p."orgId" = $1 order by pp."createdAt" limit 1`, [victimOrg]))?.id;
  const userByEmail = async (email) => (await one(`select id::text as id from "User" where email = $1`, [email]))?.id;
  const memberOf = async (userId, orgId) => (await one(`select status from "OrganizationMembership" where "userId" = $1 and "orgId" = $2`, [userId, orgId]))?.status || null;
  const ownUser = await userByEmail(`site@${attacker.domain}`);
  const ownUser2 = await userByEmail(`planner@${attacker.domain}`);
  // A member of the attacker's company whose home workspace is another: a person is a colleague by membership.
  const crossHome = (await one(`select u.id::text as id, u.email from "User" u join "OrganizationMembership" m on m."userId" = u.id where m."orgId" = $1 and m.status = 'active' and u."orgId" <> $1 and not exists (select 1 from "OrganizationMembership" v where v."userId" = u.id and v."orgId" = $2) order by u.email limit 1`, [attackerOrg, victimOrg])) || null;
  const foreignUser = await userByEmail(`pm@${victim.domain}`);
  const ownCompany = (await one(`select id::text as id from "Company" where "orgId" = $1 order by "createdAt" limit 1`, [attackerOrg]))?.id;
  const ownCompany2 = (await one(`select id::text as id from "Company" where "orgId" = $1 order by "createdAt" offset 1 limit 1`, [attackerOrg]))?.id;
  const foreign = await one(`select id::text as id, name from "Company" where "orgId" = $1 order by "createdAt" limit 1`, [victimOrg]);
  const foreignCompany = foreign?.id;

  const own1 = await partyOwner(ownParty);
  const own2 = ownParty2 ? await partyOwner(ownParty2) : null;
  check(`setup: parties ${ownParty} and ${ownParty2} are parties of company ${ATTACKER}'s project ${A.id}`, own1?.project === A.id && own1?.org === attackerOrg && own2?.project === A.id && own2?.org === attackerOrg, `${JSON.stringify(own1)} ${JSON.stringify(own2)}`);
  const otherOwn = otherProjectParty ? await partyOwner(otherProjectParty) : null;
  if (otherOwn) check(`setup: party ${otherProjectParty} is a party of company ${ATTACKER}'s OTHER project ${B.id}`, otherOwn.project === B.id && otherOwn.org === attackerOrg, JSON.stringify(otherOwn));
  const forParty = foreignParty ? await partyOwner(foreignParty) : null;
  check(`setup: party ${foreignParty} is company ${VICTIM}'s (a party of its project ${forParty?.project})`, forParty?.org === victimOrg, JSON.stringify(forParty));
  check(`setup: ${ownUser} (site@) and ${ownUser2} (planner@) are active members of company ${ATTACKER}`, (await memberOf(ownUser, attackerOrg)) === 'active' && (await memberOf(ownUser2, attackerOrg)) === 'active');
  check(`setup: ${foreignUser} (pm@ of ${VICTIM}) is an active member of company ${VICTIM} and not a member of company ${ATTACKER}`, (await memberOf(foreignUser, victimOrg)) === 'active' && (await memberOf(foreignUser, attackerOrg)) === null);
  if (crossHome) console.log(`      cross-home member of ${ATTACKER}: ${crossHome.email} ${crossHome.id} (home workspace elsewhere, not a member of ${VICTIM})`);
  const companyOrg = async (id) => (await one(`select "orgId"::text as org from "Company" where id = $1`, [id]))?.org;
  check(`setup: companies ${ownCompany} and ${ownCompany2} are company ${ATTACKER}'s directory`, (await companyOrg(ownCompany)) === attackerOrg && (await companyOrg(ownCompany2)) === attackerOrg);
  check(`setup: company ${foreignCompany} is company ${VICTIM}'s directory`, (await companyOrg(foreignCompany)) === victimOrg);
  if (!ownParty || !ownParty2 || !foreignParty || !ownUser || !ownUser2 || !foreignUser || !ownCompany || !ownCompany2 || !foreignCompany) throw new Error('setup incomplete');

  // ── what no answer may carry ──────────────────────────────────────────────
  const victimIds = [foreignParty, foreignUser, foreignCompany];
  const traces = [`CANARY-${VICTIM}-[A-Za-z0-9]`, `@c${VICTIM}\\.octapm-cert\\.test`, `\\(CERT-${VICTIM}\\)`, ...victimIds];
  const distinctNames = await q(`select c.name from "Company" c where c.id in ($1, (select "companyId" from "ProjectParty" where id = $2)) and c.name not in (select name from "Company" where "orgId" = $3)`, [foreignCompany, foreignParty, attackerOrg]);
  for (const { name } of distinctNames) if (name && name.length > 6) traces.push(name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const victimTraces = new RegExp(traces.join('|'));
  const traced = (res) => victimTraces.test(res.text || '');

  // Rows of the attacker's company that name one of the victim's ids, in the tables these routes write.
  const NAMING = {
    Crew: `select count(*)::int as n from "Crew" t where t."orgId" = $1`,
    Timesheet: `select count(*)::int as n from "Timesheet" t where t."orgId" = $1`,
    Worker: `select count(*)::int as n from "Worker" t where t."orgId" = $1`,
    DailyLog: `select count(*)::int as n from "DailyLog" t where t."orgId" = $1`,
    ProjectDocument: `select count(*)::int as n from "ProjectDocument" t where t."orgId" = $1`,
    Notification: `select count(*)::int as n from "Notification" t where t."orgId" = $1`,
  };
  const naming = async () => {
    const counts = {};
    for (const [table, sql] of Object.entries(NAMING)) {
      counts[table] = (await q(`${sql} and (${victimIds.map((_, i) => `to_jsonb(t)::text like '%' || $${i + 2} || '%'`).join(' or ')})`, [attackerOrg, ...victimIds]))[0].n;
    }
    return counts;
  };
  const snapshot = async () => {
    await db.query('begin transaction isolation level repeatable read read only');
    const taken = await fingerprint.take(db);
    await db.query('rollback');
    return taken;
  };
  const before = await snapshot();
  const namingBefore = await naming();

  const SHAPES = [['[victim id]', (id) => [id]], ['{id: victim id}', (id) => ({ id })], ['12345', () => 12345]];

  // ══ 1. crews: partyId ═════════════════════════════════════════════════════
  console.log('\n── 1. crews: partyId (POST, PATCH; copied onto the crew\'s timesheets) ──');
  {
    const crewByName = async (name) => one(`select id::text as id, "partyId"::text as party from "Crew" where "projectId" = $1 and name = $2`, [A.id, name]);
    const create = (name, partyId) => ask('POST', `${AP}/timesheets/crews`, { name, partyId, status: 'active' });

    // ALLOWED: a crew name used nowhere is the open state.
    const ownName = `PR2 crew own ${STAMP}`;
    check('open state: the crew name is used nowhere on the project', !(await crewByName(ownName)));
    const ok = await create(ownName, ownParty);
    const ownRow = await crewByName(ownName);
    check(`ALLOWED: the project's own party ${ownParty} is accepted (201) and stored on the crew`, ok.status === 201 && ownRow?.party === ownParty, `${said(ok)}; stored ${ownRow?.party ?? 'nothing'}`);
    const tsDate = new Date(Date.UTC(2023, 0, 1) + crypto.randomInt(0, 365) * 86_400_000).toISOString().slice(0, 10);
    const sheet = ownRow ? await ask('POST', `${AP}/timesheets`, { date: tsDate, crewId: ownRow.id, clientRequestId: `${STAMP}-crew-sheet` }) : { status: 0 };
    const sheetRow = sheet.body?.data?.id ? await one(`select "partyId"::text as party from "Timesheet" where id = $1`, [sheet.body.data.id]) : null;
    check('ALLOWED: the crew\'s timesheet is booked to the crew\'s own party', sheet.status === 201 && sheetRow?.party === ownParty, `${said(sheet)}; Timesheet.partyId ${sheetRow?.party ?? 'nothing'}`);

    // REFUSED / NOWHERE / SHAPE on create — each on a fresh name, then the same name with the own party (the gate).
    const refusedCreate = async (label, partyId) => {
      const name = `PR2 crew ${label} ${STAMP}`;
      const res = await create(name, partyId);
      const stored = await crewByName(name);
      const gate = await create(name, ownParty);
      const gated = await crewByName(name);
      return { res, stored, gate: ok2xx(gate) && gated?.party === ownParty ? gate : { ...gate, status: gate.status === 201 ? 0 : gate.status } };
    };
    const bad = await refusedCreate('foreign', foreignParty);
    const none = await refusedCreate('nowhere', nowhere());
    check(`REFUSED (POST): company ${VICTIM}'s party is refused with a 4xx and no crew is stored${gateNote(bad.gate)}`, ok2xx(bad.gate) && is4xx(bad.res) && !bad.stored, `${said(bad.res)}${bad.stored ? `; STORED Crew ${bad.stored.id} partyId ${bad.stored.party}` : ''}`);
    check(`NOWHERE (POST): …exactly as a party that exists nowhere (the whole answer)${gateNote(none.gate)}`, ok2xx(none.gate) && shape(bad.res) === shape(none.res) && is4xx(none.res) && !none.stored, `${shape(bad.res)} | ${shape(none.res)}`);
    check('REFUSED (POST): …and the answer carries nothing of the victim', !traced(bad.res), (bad.res.text || '').slice(0, 200));
    if (otherProjectParty) {
      const other = await refusedCreate('other project', otherProjectParty);
      check(`REFUSED (POST): a party of company ${ATTACKER}'s OTHER project is refused the same way (not on this project)${gateNote(other.gate)}`, ok2xx(other.gate) && shape(other.res) === shape(none.res) && !other.stored, shape(other.res));
    }
    for (const [label, make] of SHAPES) {
      const res = await refusedCreate(`shape ${label}`, make(foreignParty));
      check(`SHAPE (POST): partyId ${label} is refused as invalid input (400 VALIDATION_ERROR; no 5xx) and stores nothing${gateNote(res.gate)}`, ok2xx(res.gate) && invalidInput(res.res) && !res.stored, said(res.res));
    }

    // PATCH on the own crew: refused ones change nothing; the own second party is then accepted (the gate).
    if (ownRow) {
      const patch = (partyId) => ask('PATCH', `${AP}/timesheets/crews/${ownRow.id}`, { partyId });
      const pBad = await patch(foreignParty);
      const afterBad = await crewByName(ownName);
      const pNone = await patch(nowhere());
      const pOther = otherProjectParty ? await patch(otherProjectParty) : null;
      const pShapes = [];
      for (const [label, make] of SHAPES) pShapes.push([label, await patch(make(foreignParty))]);
      const kept = await crewByName(ownName);
      const pGate = await patch(ownParty2);
      const moved = await crewByName(ownName);
      const gate = ok2xx(pGate) && moved?.party === ownParty2 ? pGate : { ...pGate, status: 0 };
      check(`ALLOWED (PATCH): the project's other own party ${ownParty2} is accepted (200) and stored`, ok2xx(gate), `${said(pGate)}; stored ${moved?.party}`);
      check(`REFUSED (PATCH): company ${VICTIM}'s party is refused with a 4xx and the crew keeps its own party${gateNote(gate)}`, ok2xx(gate) && is4xx(pBad) && afterBad?.party === ownParty, `${said(pBad)}; partyId now ${afterBad?.party}`);
      check(`NOWHERE (PATCH): …exactly as a party that exists nowhere (the whole answer)${gateNote(gate)}`, ok2xx(gate) && shape(pBad) === shape(pNone), `${shape(pBad)} | ${shape(pNone)}`);
      if (pOther) check(`REFUSED (PATCH): a party of the company's OTHER project likewise${gateNote(gate)}`, ok2xx(gate) && shape(pOther) === shape(pNone), shape(pOther));
      for (const [label, res] of pShapes) check(`SHAPE (PATCH): partyId ${label} is refused as invalid input (400 VALIDATION_ERROR; no 5xx)${gateNote(gate)}`, ok2xx(gate) && invalidInput(res), said(res));
      check('REFUSED (PATCH): …after every refusal the crew still names its own party only', kept?.party === ownParty, `partyId ${kept?.party}`);
    }
  }

  // ══ 2. workers: userId (and companyId) ════════════════════════════════════
  console.log('\n── 2. workers: userId, companyId (POST, PATCH, import) ──');
  {
    const workerByName = async (name) => one(`select id::text as id, "userId"::text as "user", "companyId"::text as company from "Worker" where "orgId" = $1 and name = $2`, [attackerOrg, name]);
    const create = (name, extra) => ask('POST', `${AP}/timesheets/workers`, { name, trade: 'Steel fixer', ...extra });

    // ALLOWED
    const ownName = `PR2 worker own ${STAMP}`;
    const ok = await create(ownName, { userId: ownUser, employeeNumber: `${STAMP}-E1` });
    const ownRow = await workerByName(ownName);
    check(`ALLOWED (POST): the company's own member ${ownUser} is accepted (201) and stored on the worker`, ok.status === 201 && ownRow?.user === ownUser, `${said(ok)}; stored ${ownRow?.user ?? 'nothing'}`);
    if (crossHome) {
      const guestName = `PR2 worker member ${STAMP}`;
      const okGuest = await create(guestName, { userId: crossHome.id });
      check('ALLOWED (POST): a member whose home workspace is another company is accepted too (membership, not home)', okGuest.status === 201 && (await workerByName(guestName))?.user === crossHome.id, said(okGuest));
    }

    // REFUSED / NOWHERE / SHAPE on create — each on a fresh name, then the same name with the own value (the gate).
    const refusedCreate = async (label, field, value, ownValue) => {
      const name = `PR2 worker ${label} ${STAMP}`;
      const res = await create(name, { [field]: value });
      const stored = await workerByName(name);
      const gate = await create(name, { [field]: ownValue });
      const gated = await workerByName(name);
      const key = field === 'userId' ? 'user' : 'company';
      return { res, stored, gate: ok2xx(gate) && gated?.[key] === ownValue ? gate : { ...gate, status: 0 } };
    };
    for (const [field, foreignId, ownValue, kind] of [['userId', foreignUser, ownUser, 'person'], ['companyId', foreignCompany, ownCompany, 'company']]) {
      const bad = await refusedCreate(`${field} foreign`, field, foreignId, ownValue);
      const none = await refusedCreate(`${field} nowhere`, field, nowhere(), ownValue);
      check(`REFUSED (POST ${field}): company ${VICTIM}'s ${kind} is refused with a 4xx and no worker is stored${gateNote(bad.gate)}`, ok2xx(bad.gate) && is4xx(bad.res) && !bad.stored, `${said(bad.res)}${bad.stored ? `; STORED Worker ${bad.stored.id} ${JSON.stringify(bad.stored)}` : ''}`);
      check(`NOWHERE (POST ${field}): …exactly as a ${kind} that exists nowhere (the whole answer; no 5xx)${gateNote(none.gate)}`, ok2xx(none.gate) && shape(bad.res) === shape(none.res) && is4xx(none.res) && !none.stored, `${shape(bad.res)} | ${shape(none.res).slice(0, 300)}`);
      check(`REFUSED (POST ${field}): …and the answer carries nothing of the victim`, !traced(bad.res), (bad.res.text || '').slice(0, 200));
      for (const [label, make] of SHAPES) {
        const res = await refusedCreate(`${field} shape ${label}`, field, make(foreignId), ownValue);
        check(`SHAPE (POST ${field}): ${label} is refused as invalid input (400 VALIDATION_ERROR; no 5xx) and stores nothing${gateNote(res.gate)}`, ok2xx(res.gate) && invalidInput(res.res) && !res.stored, said(res.res));
      }
    }

    // PATCH on the own worker: refused ones change nothing; the own value is then accepted (the gate).
    if (ownRow) {
      const patch = (body) => ask('PATCH', `${AP}/timesheets/workers/${ownRow.id}`, body);
      for (const [field, foreignId, ownValue, key, kind] of [['userId', foreignUser, ownUser2, 'user', 'person'], ['companyId', foreignCompany, ownCompany2, 'company', 'company']]) {
        const was = await workerByName(ownName);
        const pBad = await patch({ [field]: foreignId });
        const pNone = await patch({ [field]: nowhere() });
        const pShapes = [];
        for (const [label, make] of SHAPES) pShapes.push([label, await patch({ [field]: make(foreignId) })]);
        const kept = await workerByName(ownName);
        const pGate = await patch({ [field]: ownValue });
        const moved = await workerByName(ownName);
        const gate = ok2xx(pGate) && moved?.[key] === ownValue ? pGate : { ...pGate, status: 0 };
        check(`ALLOWED (PATCH ${field}): the company's own ${kind} ${ownValue} is accepted (200) and stored`, ok2xx(gate), `${said(pGate)}; stored ${moved?.[key]}`);
        check(`REFUSED (PATCH ${field}): company ${VICTIM}'s ${kind} is refused with a 4xx and the worker is unchanged${gateNote(gate)}`, ok2xx(gate) && is4xx(pBad) && JSON.stringify(kept) === JSON.stringify(was), `${said(pBad)}; worker ${JSON.stringify(kept)}`);
        check(`NOWHERE (PATCH ${field}): …exactly as a ${kind} that exists nowhere (the whole answer; no 5xx)${gateNote(gate)}`, ok2xx(gate) && shape(pBad) === shape(pNone), `${shape(pBad)} | ${shape(pNone).slice(0, 300)}`);
        for (const [label, res] of pShapes) check(`SHAPE (PATCH ${field}): ${label} is refused as invalid input (400 VALIDATION_ERROR; no 5xx)${gateNote(gate)}`, ok2xx(gate) && invalidInput(res), said(res));
      }
    }

    // Import: a refused row is reported not imported (the import answers 200 with the row's error) and nothing is stored.
    const importRows = (rows) => ask('POST', `${AP}/timesheets/workers/import`, { rows });
    const refusedImport = async (label, row, ownRowValue, key) => {
      const name = `PR2 import ${label} ${STAMP}`;
      const res = await importRows([{ name, ...row }]);
      const stored = await workerByName(name);
      const gate = await importRows([{ name, ...ownRowValue }]);
      const gated = await workerByName(name);
      return { res, stored, gate: ok2xx(gate) && gate.body?.data?.created === 1 && gated?.[key] === Object.values(ownRowValue)[0] ? gate : { ...gate, status: 0 } };
    };
    const rowRefused = (res) => res.status === 200 && res.body?.data?.created === 0 && res.body?.data?.updated === 0 && res.body?.data?.errors?.length === 1;
    for (const [field, foreignId, ownValue, key, kind] of [['userId', foreignUser, ownUser, 'user', 'person'], ['companyId', foreignCompany, ownCompany, 'company', 'company']]) {
      const bad = await refusedImport(`${field} foreign`, { [field]: foreignId }, { [field]: ownValue }, key);
      const none = await refusedImport(`${field} nowhere`, { [field]: nowhere() }, { [field]: ownValue }, key);
      check(`ALLOWED (import ${field}): a row with the company's own ${kind} is imported (created 1) and stored`, ok2xx(bad.gate) && ok2xx(none.gate), `${said(bad.gate)} / ${said(none.gate)}`);
      check(`REFUSED (import ${field}): a row naming company ${VICTIM}'s ${kind} is not imported and nothing is stored${gateNote(bad.gate)}`, ok2xx(bad.gate) && rowRefused(bad.res) && !bad.stored, `${shape(bad.res)}${bad.stored ? `; STORED Worker ${JSON.stringify(bad.stored)}` : ''}`);
      check(`NOWHERE (import ${field}): …exactly as a row naming a ${kind} that exists nowhere (the whole answer; no database text)${gateNote(none.gate)}`, ok2xx(none.gate) && shape(bad.res) === shape(none.res) && !none.stored && !/prisma|constraint|invocation|\.js:\d/i.test(none.res.text || ''), `${shape(bad.res)} | ${shape(none.res).slice(0, 300)}`);
      check(`REFUSED (import ${field}): …and the answer carries nothing of the victim`, !traced(bad.res), (bad.res.text || '').slice(0, 200));
      for (const [label, make] of SHAPES) {
        const res = await refusedImport(`${field} shape ${label}`, { [field]: make(foreignId) }, { [field]: ownValue }, key);
        check(`SHAPE (import ${field}): ${label} is refused as invalid input (400 VALIDATION_ERROR; no 5xx) and stores nothing${gateNote(res.gate)}`, ok2xx(res.gate) && invalidInput(res.res) && !res.stored, said(res.res));
      }
    }
    // A row the database itself refuses (a rate beyond the column) is reported in the product's words: the
    // database's text (constraint, file, line) is what told an id that exists nowhere from another company's.
    {
      const name = `PR2 import overflow ${STAMP}`;
      const res = await importRows([{ name, hourlyRate: 1e20 }]);
      const stored = await workerByName(name);
      const gate = await importRows([{ name, hourlyRate: 25 }]);
      check(`import: a row the database refuses is reported not imported, in the product's words — no database text${gateNote(gate)}`, ok2xx(gate) && gate.body?.data?.created === 1 && rowRefused(res) && !stored && !/prisma|constraint|invocation|overflow|\.js:\d/i.test(res.text || ''), shape(res).slice(0, 300));
    }
    // The import's update rows: matched on the own worker's employee number.
    if (ownRow) {
      const matched = async () => workerByName(ownName);
      const was = await matched();
      const uBad = await importRows([{ name: ownName, employeeNumber: `${STAMP}-E1`, trade: 'Steel fixer', userId: foreignUser, companyId: was?.company || undefined }]);
      const uNone = await importRows([{ name: ownName, employeeNumber: `${STAMP}-E1`, trade: 'Steel fixer', userId: nowhere(), companyId: was?.company || undefined }]);
      const kept = await matched();
      const uGate = await importRows([{ name: ownName, employeeNumber: `${STAMP}-E1`, trade: 'Steel fixer', userId: ownUser, companyId: was?.company || undefined }]);
      const moved = await matched();
      const gate = ok2xx(uGate) && uGate.body?.data?.updated === 1 && moved?.user === ownUser ? uGate : { ...uGate, status: 0 };
      check(`ALLOWED (import, update row): the matched worker takes the company's own member ${ownUser} (updated 1)`, ok2xx(gate), `${shape(uGate)}; stored ${moved?.user}`);
      check(`REFUSED (import, update row): company ${VICTIM}'s person is not written to the matched worker${gateNote(gate)}`, ok2xx(gate) && rowRefused(uBad) && JSON.stringify(kept) === JSON.stringify(was), `${shape(uBad)}; worker ${JSON.stringify(kept)}`);
      check(`NOWHERE (import, update row): …exactly as a person who exists nowhere${gateNote(gate)}`, ok2xx(gate) && shape(uBad) === shape(uNone), `${shape(uBad)} | ${shape(uNone).slice(0, 300)}`);
    }
    // What the company reads back: its workers of this run name no company or person of the victim.
    const list = await ask('GET', `${AP}/timesheets/workers?q=${encodeURIComponent(STAMP)}`);
    const listed = list.body?.data?.items || [];
    check(`read-back: the workers of this run (${listed.length}) name only the company's own people and companies, nothing of company ${VICTIM}`, list.status === 200 && listed.length > 0 && !traced(list) && listed.every((w) => !victimIds.includes(w.userId) && !victimIds.includes(w.companyId)), traced(list) ? `answer carries ${(list.text.match(victimTraces) || [])[0]}` : `${listed.length} workers`);
  }

  // ══ 3. timesheets: companyId ══════════════════════════════════════════════
  console.log('\n── 3. timesheets: companyId (POST) ──');
  {
    const date = new Date(Date.UTC(2023, 0, 1) + crypto.randomInt(0, 365) * 86_400_000).toISOString().slice(0, 10);
    const sheetBy = async (key) => one(`select id::text as id, "companyId"::text as company from "Timesheet" where "projectId" = $1 and "clientRequestId" = $2`, [A.id, key]);
    const create = (key, companyId) => ask('POST', `${AP}/timesheets`, { date, companyId, clientRequestId: key, notes: `People proof ${STAMP}` });
    const refused = async (label, companyId) => {
      const key = `${STAMP}-ts-${label}`;
      const res = await create(key, companyId);
      const stored = await sheetBy(key);
      const gateKey = `${key}-own`;
      const gate = await create(gateKey, ownCompany);
      const gated = await sheetBy(gateKey);
      return { res, stored, gate: ok2xx(gate) && gated?.company === ownCompany ? gate : { ...gate, status: 0 } };
    };
    const bad = await refused('foreign', foreignCompany);
    const none = await refused('nowhere', nowhere());
    check('ALLOWED: a timesheet booked to the company\'s own company is accepted (201) and stored', ok2xx(bad.gate) && ok2xx(none.gate), `${said(bad.gate)} / ${said(none.gate)}`);
    check(`REFUSED: a timesheet booked to company ${VICTIM}'s company is refused with a 4xx and none is stored${gateNote(bad.gate)}`, ok2xx(bad.gate) && is4xx(bad.res) && !bad.stored, `${said(bad.res)}${bad.stored ? `; STORED Timesheet ${bad.stored.id} companyId ${bad.stored.company}` : ''}`);
    check(`NOWHERE: …exactly as a company that exists nowhere (the whole answer)${gateNote(none.gate)}`, ok2xx(none.gate) && shape(bad.res) === shape(none.res) && !none.stored, `${shape(bad.res)} | ${shape(none.res)}`);
    check('REFUSED: …and the answer carries nothing of the victim', !traced(bad.res), (bad.res.text || '').slice(0, 200));
    for (const [label, make] of SHAPES) {
      const res = await refused(`shape-${label.replace(/[^a-z0-9]+/gi, '')}`, make(foreignCompany));
      check(`SHAPE: companyId ${label} is refused as invalid input (400 VALIDATION_ERROR; no 5xx) and stores nothing${gateNote(res.gate)}`, ok2xx(res.gate) && invalidInput(res.res) && !res.stored, said(res.res));
    }
  }

  // ══ 4. daily log: distribute userIds[] ════════════════════════════════════
  console.log('\n── 4. daily log: distribute userIds[] ──');
  {
    let DATE = null;
    for (let i = 0; i < 60 && !DATE; i += 1) {
      const candidate = new Date(Date.UTC(2023, 0, 1) + crypto.randomInt(0, 365) * 86_400_000).toISOString().slice(0, 10);
      if (!(await q('select 1 from "DailyLog" where "projectId" = $1 and date = $2::date', [A.id, candidate])).length) DATE = candidate;
    }
    check(`open state: ${DATE} has no daily log on the project yet`, Boolean(DATE));
    const note = await ask('POST', `${AP}/daily-logs/${DATE}/entries/notes`, { kind: 'general', text: `People proof ${STAMP}` });
    const log = await one(`select id::text as id from "DailyLog" where "projectId" = $1 and date = $2::date`, [A.id, DATE]);
    check(`open state: the day is opened with a note (201), so it has something to send`, note.status === 201 && log, said(note));
    const state = async () => one(`select l."distributionJson" as distribution, l."distributedAt" as at, l."pdfDocumentId"::text as pdf,
        (select count(*)::int from "ProjectDocument" d where d."linkedEntityType" = 'daily_log' and d."linkedEntityId" = l.id) as documents,
        (select count(*)::int from "Notification" n where n."entityType" = 'daily_log' and n."entityId" = l.id) as notifications
      from "DailyLog" l where l.id = $1`, [log?.id]);
    const distribute = (userIds) => ask('POST', `${AP}/daily-logs/${DATE}/distribute`, { roles: [], emails: [], userIds, note: `People proof ${STAMP}` });
    const opened = await state();
    check('open state: the day has not been distributed (no distribution, no PDF)', opened && opened.distribution === null && opened.at === null && opened.pdf === null, JSON.stringify(opened));

    const dBad = await distribute([foreignUser]);
    const dNone = await distribute([nowhere()]);
    const dMixed = await distribute([ownUser, foreignUser]);
    const dShapes = [];
    for (const [label, make] of SHAPES) dShapes.push([label, await distribute([make(foreignUser)])]);
    const afterRefusals = await state();
    const dGate = await distribute(crossHome ? [ownUser, crossHome.id] : [ownUser]);
    const accepted = await state();
    const wanted = crossHome ? [ownUser, crossHome.id] : [ownUser];
    const gate = ok2xx(dGate) && JSON.stringify(accepted?.distribution?.userIds) === JSON.stringify(wanted) ? dGate : { ...dGate, status: 0 };
    check(`ALLOWED: the day is distributed to the company's own members by name (200), stored on the day, filed once and they are told`, ok2xx(gate) && accepted?.documents === opened.documents + 1 && accepted?.notifications > opened.notifications,`${said(dGate)}; stored ${JSON.stringify(accepted?.distribution?.userIds)}; documents ${accepted?.documents}; notifications ${accepted?.notifications}`);
    check(`REFUSED: company ${VICTIM}'s person is refused with a 4xx${gateNote(gate)}`, ok2xx(gate) && is4xx(dBad), said(dBad));
    check(`NOWHERE: …exactly as a person who exists nowhere (the whole answer)${gateNote(gate)}`, ok2xx(gate) && shape(dBad) === shape(dNone), `${shape(dBad)} | ${shape(dNone)}`);
    check(`REFUSED: …and with an own member beside them, the same (nothing is sent to anyone)${gateNote(gate)}`, ok2xx(gate) && shape(dMixed) === shape(dNone), shape(dMixed));
    for (const [label, res] of dShapes) check(`SHAPE: userIds [${label}] is refused as invalid input (400 VALIDATION_ERROR; no 5xx)${gateNote(gate)}`, ok2xx(gate) && invalidInput(res), said(res));
    check(`REFUSED: …nothing stored or sent before the own distribution: no distribution on the day, no PDF filed, nobody notified${gateNote(gate)}`, ok2xx(gate) && afterRefusals && JSON.stringify(afterRefusals) === JSON.stringify(opened), `${JSON.stringify(afterRefusals)} (opened ${JSON.stringify(opened)})`);
    check('REFUSED: …and no refusal carries anything of the victim', ![dBad, dMixed, ...dShapes.map(([, r]) => r)].some(traced));

    // Once distributed, a refused one leaves the stored distribution as it was.
    const dAgain = await distribute([foreignUser]);
    const afterAgain = await state();
    check(`REFUSED (again, on the distributed day): company ${VICTIM}'s person is refused as nowhere and the stored distribution, the filed PDF and the notices are unchanged${gateNote(gate)}`, ok2xx(gate) && shape(dAgain) === shape(dNone) && JSON.stringify(afterAgain) === JSON.stringify(accepted), `${said(dAgain)}; ${JSON.stringify(afterAgain?.distribution?.userIds)}; documents ${afterAgain?.documents}`);
    const day = await ask('GET', `${AP}/daily-logs/${DATE}`);
    check(`read-back: the day's answer names the own members only, nothing of company ${VICTIM}`, day.status === 200 && JSON.stringify(day.body?.data?.distribution?.userIds) === JSON.stringify(wanted) && !traced(day), `${said(day)}; ${JSON.stringify(day.body?.data?.distribution?.userIds)}`);
  }

  // ── after ────────────────────────────────────────────────────────────────
  console.log('\n── after ──');
  const namingAfter = await naming();
  const grew = Object.keys(NAMING).filter((t) => namingAfter[t] !== namingBefore[t]);
  check(`no row of company ${ATTACKER} names company ${VICTIM}'s ids that did not before`, grew.length === 0, grew.map((t) => `${t} ${namingBefore[t]}->${namingAfter[t]}`).join(', '));
  // Prisma keeps "createdAt" as UTC in a column without a zone, and this session's zone is not UTC:
  // the start is compared as UTC. A notice of this run is one in the attacker's company or by its people.
  const told = (await one(`select count(*)::int as n from "Notification" n where n."recipientUserId" = $1 and n."createdAt" >= ($2::timestamptz at time zone 'UTC')
      and (n."orgId" = $3 or n."actorId" in (select "userId" from "OrganizationMembership" where "orgId" = $3))`, [foreignUser, startedAt.toISOString(), attackerOrg])).n;
  check(`nobody of company ${VICTIM} was notified by company ${ATTACKER}'s requests`, told === 0, `${told} notices to ${foreignUser}`);
  const leaked = answers.filter((a) => victimTraces.test(a.text));
  check(`no answer to company ${ATTACKER} carries company ${VICTIM}'s ids, names, addresses or canaries`, leaked.length === 0, leaked.slice(0, 6).map((a) => `${a.status} ${a.route} -> ${(a.text.match(victimTraces) || [])[0]}`).join('\n        '));
  const errors = answers.filter((a) => a.status >= 500);
  check(`no answer is a server error (${answers.length} answers)`, errors.length === 0, errors.slice(0, 5).map((a) => `${a.status} ${a.route} ${(a.text || '').slice(0, 160)}`).join('\n        '));
  const after = await snapshot();
  const moved = fingerprint.compare(before, after).filter((c) => !c.noise && c.org === VICTIM);
  check(`company ${VICTIM}'s data did not change (every table)`, moved.length === 0, moved.slice(0, 8).map((c) => `${c.table} ${c.rowsBefore}->${c.rowsAfter}`).join(', '));
  await db.end();

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${GROUP} proof: ${results.length - failed.length} passed, ${failed.length} failed of ${results.length}`);
  process.exitCode = failed.length ? 2 : 0;
  setTimeout(() => process.exit(process.exitCode), 300);
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
