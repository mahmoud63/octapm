'use strict';

/**
 * The live proof of the CERT-2 daily-log state-gap pairs: an entry of a daily
 * log may name only its own project's activity, BOQ item and allocation, and
 * its own organisation's company.
 *
 *   CERT_INPROCESS=1 node scripts/cert/isolation/daily-logs-state-proof.js [attacker=058] [victim=059]
 *
 * The pairs (C:/Temp/octapm-cert/scratch/gap-pairs.json):
 *   POST /projects/{projectId}/daily-logs/{date}/entries/{section}   activityId   = activity
 *   POST /projects/{projectId}/daily-logs/{date}/entries/{section}   companyId    = company
 *   POST /projects/{projectId}/daily-logs/{date}/entries/{section}   boqItemId    = boq_item
 *   POST /projects/{projectId}/daily-logs/{date}/entries/{section}   allocationId = activity_boq_allocation
 * The CERT-2 injection sweep re-sent each company's own entry requests with one
 * of these ids replaced by another company's, but every one of them went to a
 * day the company had already APPROVED, so it was refused 409
 * DAILY_LOG_APPROVED (or 402 on billing) before the identifier was looked at.
 * Whether these fields refuse another company's id was never judged.
 *
 * Here every request goes to a day of the attacker's own project that has no
 * log yet (a fresh, unique date each run: the first request opens it), on
 * every section that takes the field:
 *   activityId    manpower, equipment, deliveries, delays, notes, quantities
 *   companyId     manpower, equipment, deliveries
 *   boqItemId     quantities
 *   allocationId  quantities
 * For each (section, field):
 *   ALLOWED  the attacker company's own id is accepted (201) and stored;
 *   REFUSED  the victim company's id is refused with a 4xx (never a 5xx), and
 *            nothing is stored (no row carries the request's key, no row of the
 *            attacker company names the victim's id);
 *   NOWHERE  an id that exists nowhere gets exactly the same answer: the same
 *            status, code and message, and the same body once the request id is
 *            set aside and the id that was sent is read as its counterpart (an
 *            error may echo the id it was given, as the sweep's judge allows).
 * The edit route (PATCH .../entries/{section}/{entryId}) carries the same
 * fields and is proven the same way on the ALLOWED row, which must keep its
 * own id. Beside the pairs, the same route's partyId, locationId and
 * equipmentId are proven when both companies have one.
 *
 * No answer may be a 500 or carry the victim's ids (other than the one the
 * request itself sent), names, addresses or canaries; the victim company's
 * data must not change in any table (fingerprint before/after, company 059's
 * rows only — other companies are being attacked by other groups meanwhile).
 *
 * Exit code 0 when every check holds, 2 otherwise.
 */

const crypto = require('crypto');
const { as } = require('../lib/api');
const { buildPopulation } = require('../lib/spec');
const guard = require('../lib/cert-env');
const fingerprint = require('./fingerprint');

const ATTACKER = process.argv[2] || '058';
const VICTIM = process.argv[3] || '059';
const GROUP = 'daily-logs';
const STAMP = `DLS-${ATTACKER}-${crypto.randomBytes(3).toString('hex')}`.toUpperCase();
const INPROCESS = process.env.CERT_INPROCESS === '1';
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

const results = [];
const answers = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok: Boolean(ok) });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `\n        ${detail}` : ''}`);
};
const said = (res) => `${res.status} ${res.body?.error?.code || ''} ${res.body?.error?.message || ''}`.trim();
const ok2xx = (res) => res.status >= 200 && res.status < 300;
const nowhere = () => crypto.randomUUID();
/** The answer's body with the request id set aside and the sent id read as a placeholder. */
const shape = (res, sentId) => {
  const body = res.body && typeof res.body === 'object' ? JSON.parse(JSON.stringify(res.body)) : res.text;
  if (body?.error) delete body.error.requestId;
  return `${res.status} ${JSON.stringify(body)}`.split(sentId).join('<sent>');
};

const MODEL = {
  manpower: 'DailyLogManpower',
  equipment: 'DailyLogEquipment',
  deliveries: 'DailyLogDelivery',
  delays: 'DailyLogDelay',
  notes: 'DailyLogNote',
  quantities: 'DailyLogQuantity',
};

const main = async () => {
  console.log(`${GROUP} state proof — attacker ${ATTACKER}, victim ${VICTIM}, stamp ${STAMP}${INPROCESS ? ', in process (the working tree\'s code)' : ' — NOT in process: this asks a running API, which does not run the working tree\'s code'}\n`);
  const { companies } = buildPopulation();
  const attacker = companies.find((c) => c.code === ATTACKER);
  const victim = companies.find((c) => c.code === VICTIM);
  if (!attacker || !victim) throw new Error(`unknown company ${ATTACKER} or ${VICTIM}`);

  const db = await guard.connectCert();
  const q = async (sql, params = []) => (await db.query(sql, params)).rows;
  const one = async (sql, params = []) => (await q(sql, params))[0]?.id || null;
  const orgOf = async (code) => (await q('select id, name from "Organisation" where slug like $1', [`cert-${code}-%`]))[0] || null;
  const attackerOrg = await orgOf(ATTACKER);
  const victimOrg = await orgOf(VICTIM);
  if (!attackerOrg || !victimOrg) throw new Error('both companies must exist in the certification database');

  // ── the attacker's own project and ids ─────────────────────────────────────
  // An approved, active allocation of an active BOQ item to an active activity:
  // what a quantities row may name.
  const alloc = (await q(`
    select x.id as allocation, x."activityId" as activity, x."boqItemId" as item, x."projectId" as project
      from "ActivityBoqAllocation" x
      join "Project" p on p.id = x."projectId"
      join "Activity" a on a.id = x."activityId"
      join "BoqItem" b on b.id = x."boqItemId"
     where p."orgId" = $1 and x.status = 'approved' and x."isActive" and a."isActive" and b."isActive"
       and (select count(*) from "ActivityBoqAllocation" y where y."activityId" = x."activityId" and y."boqItemId" = x."boqItemId" and y.status = 'approved' and y."isActive") = 1
     order by p."createdAt", x."createdAt" limit 1`, [attackerOrg.id]))[0];
  if (!alloc) throw new Error(`company ${ATTACKER} has no approved allocation to record a quantity against`);
  const projectId = alloc.project;
  const P = `/projects/${projectId}`;
  const own = {
    activity: alloc.activity,
    boqItem: alloc.item,
    allocation: alloc.allocation,
    company: await one(`select c.id from "ProjectParty" pp join "Company" c on c.id = pp."companyId" where pp."projectId" = $1 and c."orgId" = $2 order by pp."createdAt" limit 1`, [projectId, attackerOrg.id])
      || await one('select id from "Company" where "orgId" = $1 order by "createdAt" limit 1', [attackerOrg.id]),
    party: await one('select id from "ProjectParty" where "projectId" = $1 order by "createdAt" limit 1', [projectId]),
    location: await one('select id from "Location" where "projectId" = $1 order by "createdAt" limit 1', [projectId]),
    equipment: await one('select id from "Equipment" where "projectId" = $1 order by "createdAt" limit 1', [projectId]),
  };
  const foreign = {
    activity: await one(`select a.id from "Activity" a join "Project" p on p.id = a."projectId" where p."orgId" = $1 and a."isActive" order by a."createdAt" limit 1`, [victimOrg.id]),
    company: await one(`select id from "Company" where "orgId" = $1 order by "createdAt" limit 1`, [victimOrg.id]),
    boqItem: await one(`select b.id from "BoqItem" b join "Project" p on p.id = b."projectId" where p."orgId" = $1 and b."isActive" order by b."createdAt" limit 1`, [victimOrg.id]),
    allocation: await one(`select x.id from "ActivityBoqAllocation" x join "Project" p on p.id = x."projectId" where p."orgId" = $1 and x.status = 'approved' and x."isActive" order by x."createdAt" limit 1`, [victimOrg.id]),
    party: await one(`select pp.id from "ProjectParty" pp join "Project" p on p.id = pp."projectId" where p."orgId" = $1 order by pp."createdAt" limit 1`, [victimOrg.id]),
    location: await one(`select l.id from "Location" l join "Project" p on p.id = l."projectId" where p."orgId" = $1 order by l."createdAt" limit 1`, [victimOrg.id]),
    equipment: await one(`select e.id from "Equipment" e join "Project" p on p.id = e."projectId" where p."orgId" = $1 order by e."createdAt" limit 1`, [victimOrg.id]),
  };
  const OWNER = {
    activity: 'select p."orgId" as id from "Activity" t join "Project" p on p.id = t."projectId" where t.id = $1',
    company: 'select t."orgId" as id from "Company" t where t.id = $1',
    boqItem: 'select p."orgId" as id from "BoqItem" t join "Project" p on p.id = t."projectId" where t.id = $1',
    allocation: 'select p."orgId" as id from "ActivityBoqAllocation" t join "Project" p on p.id = t."projectId" where t.id = $1',
    party: 'select p."orgId" as id from "ProjectParty" t join "Project" p on p.id = t."projectId" where t.id = $1',
    location: 'select p."orgId" as id from "Location" t join "Project" p on p.id = t."projectId" where t.id = $1',
    equipment: 'select p."orgId" as id from "Equipment" t join "Project" p on p.id = t."projectId" where t.id = $1',
  };
  const ownProject = await one('select id from "Project" where id = $1 and "orgId" = $2', [projectId, attackerOrg.id]);
  check(`setup: project ${projectId} is company ${ATTACKER}'s own`, ownProject === projectId);
  for (const kind of ['activity', 'company', 'boqItem', 'allocation']) {
    check(`setup: the own ${kind} ${own[kind]} is company ${ATTACKER}'s`, own[kind] && (await one(OWNER[kind], [own[kind]])) === attackerOrg.id);
    check(`setup: the foreign ${kind} ${foreign[kind]} is company ${VICTIM}'s (read from the database)`, foreign[kind] && (await one(OWNER[kind], [foreign[kind]])) === victimOrg.id);
  }
  const beside = ['party', 'location', 'equipment'].filter((kind) => own[kind] && foreign[kind]);
  for (const kind of beside) {
    check(`setup (beside the pairs): the own ${kind} is company ${ATTACKER}'s and the foreign one company ${VICTIM}'s`,
      (await one(OWNER[kind], [own[kind]])) === attackerOrg.id && (await one(OWNER[kind], [foreign[kind]])) === victimOrg.id, `${own[kind]} / ${foreign[kind]}`);
  }
  for (const kind of ['party', 'location', 'equipment'].filter((k) => !beside.includes(k))) console.log(`      (beside the pairs: no ${kind} on one side; not proven here)`);

  // ── the victim's identifiers and names: what no answer may carry ──────────
  const victimIdRows = await q(`
    select a.id from "Activity" a join "Project" p on p.id = a."projectId" where p."orgId" = $1
    union all select id from "Company" where "orgId" = $1
    union all select b.id from "BoqItem" b join "Project" p on p.id = b."projectId" where p."orgId" = $1
    union all select x.id from "ActivityBoqAllocation" x join "Project" p on p.id = x."projectId" where p."orgId" = $1
    union all select l.id from "Location" l join "Project" p on p.id = l."projectId" where p."orgId" = $1
    union all select e.id from "Equipment" e join "Project" p on p.id = e."projectId" where p."orgId" = $1
    union all select pp.id from "ProjectParty" pp join "Project" p on p.id = pp."projectId" where p."orgId" = $1
    union all select id from "Project" where "orgId" = $1
    union all select m."userId" from "OrganizationMembership" m where m."orgId" = $1
      and not exists (select 1 from "OrganizationMembership" o where o."userId" = m."userId" and o."orgId" = $2)`, [victimOrg.id, attackerOrg.id]);
  const victimIds = new Set(victimIdRows.map((r) => r.id.toLowerCase()));
  const traces = [`CANARY-${VICTIM}-[A-Za-z0-9]`, `@c${VICTIM}\\.octapm-cert\\.test`, `\\(CERT-${VICTIM}\\)`];
  const distinctNames = [
    ...(await q('select name from "Company" where id = $1 and name not in (select name from "Company" where "orgId" = $2)', [foreign.company, attackerOrg.id])),
    ...(await q('select name from "Activity" where id = $1 and name not in (select a.name from "Activity" a join "Project" p on p.id = a."projectId" where p."orgId" = $2)', [foreign.activity, attackerOrg.id])),
    ...(await q('select description as name from "BoqItem" where id = $1 and description not in (select b.description from "BoqItem" b join "Project" p on p.id = b."projectId" where p."orgId" = $2)', [foreign.boqItem, attackerOrg.id])),
  ];
  for (const { name } of distinctNames) if (name && name.length > 6) traces.push(name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const victimTraces = new RegExp(traces.join('|'));

  // ── the open state: a day of the attacker's own project with no log yet ────
  let DATE = null;
  for (let i = 0; i < 50 && !DATE; i += 1) {
    const candidate = new Date(Date.UTC(2025, 0, 1) + crypto.randomInt(0, 365) * 86_400_000).toISOString().slice(0, 10);
    const taken = await q('select 1 from "DailyLog" where "projectId" = $1 and date = $2::date', [projectId, candidate]);
    if (!taken.length) DATE = candidate;
  }
  check(`setup: ${DATE} has no daily log on the project yet (a fresh day: the first request opens it)`, Boolean(DATE));
  if (!ownProject || !DATE || !['activity', 'company', 'boqItem', 'allocation'].every((k) => own[k] && foreign[k])) throw new Error('setup incomplete');
  const approvedDay = (await q(`select to_char(date, 'YYYY-MM-DD') as d from "DailyLog" where "projectId" = $1 and status = 'approved' order by date desc limit 1`, [projectId]))[0]?.d || null;

  const pm = as(`pm@${attacker.domain}`);
  const send = async (method, route, body) => {
    const res = await pm.send(method, route, body);
    answers.push({ route: `${method} ${route}`, status: res.status, text: res.text || '', sent: JSON.stringify(body || {}).toLowerCase() });
    return res;
  };
  const entries = (section, date = DATE) => `${P}/daily-logs/${date}/entries/${section}`;

  // The naming census: rows of the attacker company's daily logs that name one of the foreign ids.
  const FOREIGN_IDS = Object.values(foreign).filter(Boolean);
  const naming = async () => {
    const counts = {};
    for (const table of Object.values(MODEL)) {
      counts[table] = (await q(`select count(*)::int as n from "${table}" t where t."orgId" = $1 and (${FOREIGN_IDS.map((_, i) => `to_jsonb(t)::text like '%' || $${i + 2} || '%'`).join(' or ')})`, [attackerOrg.id, ...FOREIGN_IDS]))[0].n;
    }
    return counts;
  };
  const start = (await q(`select to_char((now() at time zone 'UTC') - interval '1 second', 'YYYY-MM-DD HH24:MI:SS.MS') as s`))[0].s;

  const snapshot = async () => {
    await db.query('begin transaction isolation level repeatable read read only');
    const taken = await fingerprint.take(db);
    await db.query('rollback');
    return taken;
  };
  const before = await snapshot();
  const namingBefore = await naming();

  // ── the sweep's state, reproduced: an approved day refuses on its own state ─
  if (approvedDay) {
    const sweep = await send('POST', entries('manpower', approvedDay), { trade: `${STAMP} sweep`, workers: 1, companyId: foreign.company, activityId: foreign.activity, clientRequestId: `${STAMP}-SWEEP` });
    check(`the sweep's state: on the approved day ${approvedDay} the request is refused 409 DAILY_LOG_APPROVED before any id is judged`, said(sweep).startsWith('409 DAILY_LOG_APPROVED'), said(sweep));
  }

  // ── the cases ──────────────────────────────────────────────────────────────
  const BASE = {
    manpower: (tag) => ({ trade: 'Steel fixer', workers: 3, hours: 8, notes: tag }),
    equipment: (tag) => ({ name: 'Excavator 20t', count: 1, hoursOperated: 6, notes: tag }),
    deliveries: (tag) => ({ description: 'Rebar bundles', quantity: 2, unit: 't', notes: tag }),
    delays: (tag) => ({ type: 'access', description: `Gate blocked ${tag}`, hoursLost: 1 }),
    notes: (tag) => ({ kind: 'general', text: `Site note ${tag}` }),
    quantities: (tag) => ({ activityId: own.activity, boqItemId: own.boqItem, quantity: 1.5, notes: tag }),
  };
  const CASES = [
    ...['manpower', 'equipment', 'deliveries', 'delays', 'notes', 'quantities'].map((section) => ({ section, field: 'activityId', kind: 'activity', pair: true })),
    ...['manpower', 'equipment', 'deliveries'].map((section) => ({ section, field: 'companyId', kind: 'company', pair: true })),
    { section: 'quantities', field: 'boqItemId', kind: 'boqItem', pair: true },
    { section: 'quantities', field: 'allocationId', kind: 'allocation', pair: true },
    ...(beside.includes('party') ? [{ section: 'manpower', field: 'partyId', kind: 'party', pair: false }] : []),
    ...(beside.includes('location') ? [{ section: 'notes', field: 'locationId', kind: 'location', pair: false }] : []),
    ...(beside.includes('equipment') ? [{ section: 'equipment', field: 'equipmentId', kind: 'equipment', pair: false }] : []),
  ];

  const rowByKey = async (section, key) => (await q(`select * from "${MODEL[section]}" where "projectId" = $1 and "clientRequestId" = $2`, [projectId, key]))[0] || null;
  let logChecked = false;
  const summary = [];
  for (const { section, field, kind, pair } of CASES) {
    const label = `${pair ? '' : '(beside the pairs) '}POST entries/${section} ${field}`;
    const key = (tag) => `${STAMP}-${tag}-${section}-${field}`;
    const body = (tag, id) => ({ ...BASE[section](key(tag)), [field]: id, clientRequestId: key(tag) });

    // ALLOWED — the company's own id, on the open day.
    const ok = await send('POST', entries(section), body('ALLOWED', own[kind]));
    const ownRow = await rowByKey(section, key('ALLOWED'));
    check(`${label}: the company's own ${kind} is accepted (201) and stored`, ok.status === 201 && ownRow?.[field] === own[kind], `${said(ok)}; stored ${field} = ${ownRow?.[field] ?? 'nothing'}`);
    if (!logChecked) {
      const log = (await q('select status from "DailyLog" where "projectId" = $1 and date = $2::date', [projectId, DATE]))[0];
      check(`the open state: the first accepted request opened ${DATE} (status open)`, log?.status === 'open', `status ${log?.status}`);
      logChecked = true;
    }

    // REFUSED — the victim company's id, on the same open day.
    const bad = await send('POST', entries(section), body('REFUSED', foreign[kind]));
    const badRow = await rowByKey(section, key('REFUSED'));
    // NOWHERE — an id that exists nowhere.
    const noneId = nowhere();
    const none = await send('POST', entries(section), body('NOWHERE', noneId));
    const noneRow = await rowByKey(section, key('NOWHERE'));
    check(`${label}: company ${VICTIM}'s ${kind} is refused with a 4xx (not a 5xx)`, bad.status >= 400 && bad.status < 500, said(bad));
    check(`${label}: …exactly as an id that exists nowhere (status, code, message)`, said(bad) === said(none), `${said(bad)} | ${said(none)}`);
    check(`${label}: …and the same body (request id aside, the sent id read as its counterpart)`, shape(bad, foreign[kind]) === shape(none, noneId), `${shape(bad, foreign[kind]).slice(0, 220)}\n        ${shape(none, noneId).slice(0, 220)}`);
    check(`${label}: …nothing stored`, !badRow && !noneRow,
      badRow ? `STORED: ${MODEL[section]} ${badRow.id} (company ${ATTACKER}) .${field} = ${badRow[field]} (company ${VICTIM}'s ${kind})` : noneRow ? `STORED: ${MODEL[section]} ${noneRow.id} .${field} = ${noneRow[field]} (exists nowhere)` : '');
    summary.push({ section, field, pair, allowed: said(ok), foreign: said(bad), nowhere: said(none), stored: Boolean(badRow) });

    // The edit route, same field, on the ALLOWED row: refused alike, the row keeps its own.
    if (ownRow) {
      const patch = (id) => send('PATCH', `${entries(section)}/${ownRow.id}`, { [field]: id });
      const editBad = await patch(foreign[kind]);
      const editNoneId = nowhere();
      const editNone = await patch(editNoneId);
      const after = (await q(`select * from "${MODEL[section]}" where id = $1`, [ownRow.id]))[0];
      const refused = editBad.status >= 400 && editBad.status < 500 && shape(editBad, foreign[kind]) === shape(editNone, editNoneId);
      // An entry's party is fixed when it is recorded: the edit route does not read partyId at all.
      const ignored = field === 'partyId' && ok2xx(editBad) && ok2xx(editNone);
      check(`${label} (PATCH): company ${VICTIM}'s ${kind} is ${field === 'partyId' ? 'refused or ignored' : 'refused'} exactly as an id that exists nowhere, and the row keeps its own`,
        (refused || ignored) && said(editBad) === said(editNone) && after?.[field] === own[kind],
        `${said(editBad)} | ${said(editNone)}; row ${field} = ${after?.[field]}`);
    }
  }

  // ── nothing stored, nothing written ────────────────────────────────────────
  const namingAfter = await naming();
  check(`no row of company ${ATTACKER}'s daily logs names company ${VICTIM}'s ids that did not before`, JSON.stringify(namingBefore) === JSON.stringify(namingAfter), `${JSON.stringify(namingBefore)} -> ${JSON.stringify(namingAfter)}`);
  const stamped = [];
  for (const [section, table] of Object.entries(MODEL)) {
    const n = (await q(`select count(*)::int as n from "${table}" where "clientRequestId" like $1 or "clientRequestId" like $2 or "clientRequestId" = $3`, [`${STAMP}-REFUSED-%`, `${STAMP}-NOWHERE-%`, `${STAMP}-SWEEP`]))[0].n;
    if (n) stamped.push(`${section} ${n}`);
  }
  check('no refused request left a row (by its key)', stamped.length === 0, stamped.join(', '));
  const side = [];
  for (const table of ['AuditEvent', 'Notification', 'OutboundEvent']) {
    const rows = await q(`select to_jsonb(t)::text as body from "${table}" t where "orgId" = $1 and "createdAt" >= $2::timestamp`, [attackerOrg.id, start]).catch(() => []);
    for (const row of rows) if (FOREIGN_IDS.some((id) => row.body.includes(id))) side.push(`${table} names a foreign id`);
  }
  check(`no audit row, notification or outbound event of company ${ATTACKER} names company ${VICTIM}'s ids`, side.length === 0, side.slice(0, 5).join('; '));

  // ── nothing returned, nothing of the victim's moved ───────────────────────
  const leaked = [];
  for (const a of answers) {
    const disclosed = [...new Set((a.text.match(UUID) || []).map((id) => id.toLowerCase()).filter((id) => victimIds.has(id) && !a.sent.includes(id)))];
    const named = a.text.match(victimTraces);
    if (disclosed.length || named) leaked.push(`${a.status} ${a.route} -> ${disclosed[0] || named[0]}`);
  }
  check(`no answer to company ${ATTACKER} carries company ${VICTIM}'s ids (other than the one the request sent), names, addresses or canaries`, leaked.length === 0, leaked.slice(0, 6).join('\n        '));
  const errors = answers.filter((a) => a.status >= 500);
  check('no answer is a server error', errors.length === 0, errors.slice(0, 5).map((a) => `${a.status} ${a.route}`).join(', '));
  const after = await snapshot();
  const moved = fingerprint.compare(before, after).filter((c) => !c.noise && c.org === VICTIM);
  check(`company ${VICTIM}'s data did not change (every table, fingerprint before/after)`, moved.length === 0, moved.slice(0, 8).map((c) => `${c.table} ${c.rowsBefore}->${c.rowsAfter}`).join(', '));
  await db.end();

  console.log('\nanswers (own | foreign | nowhere):');
  for (const s of summary) console.log(`  ${s.pair ? 'pair  ' : 'beside'} ${s.section.padEnd(10)} ${s.field.padEnd(12)} ${s.allowed} | ${s.foreign}${s.stored ? ' (STORED)' : ''} | ${s.nowhere}`);
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${GROUP} state proof: ${results.length - failed.length} passed, ${failed.length} failed of ${results.length}`);
  process.exitCode = failed.length ? 2 : 0;
  setTimeout(() => process.exit(process.exitCode), 300);
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
