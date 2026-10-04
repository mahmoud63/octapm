'use strict';

/**
 * The live proof of CERT-2 "wrongly shaped identifiers": an identifier field
 * sent as an array, a nested array, an object, a number or a boolean must be
 * refused (4xx) — never a 5xx — exactly alike whether it wraps the caller's
 * own identifier, another company's or one that exists nowhere, and must
 * store nothing.
 *
 *   CERT_INPROCESS=1 node scripts/cert/isolation/shape-ids-proof.js [attacker=044] [victim=045]
 *   CERT_INPROCESS=1 node scripts/cert/isolation/shape-ids-proof.js 044 045 --only="forms|workflows" --no-fingerprint
 *
 * express-validator's standard validators (isUUID …) accept an array element
 * by element, so `engineerIds: [["<id>"]]` or `recordId: ["<id>"]` passed the
 * route and reached Prisma, which threw (500); where a reference check
 * skipped a non-string value instead, the value was later coerced with
 * String() — `["<id>"]` becomes "<id>" — and another company's identifier
 * was stored unchecked (a purchase-order line's cost code; a progress
 * claim's evidence photo).
 *
 * Each case builds its own fresh record(s) through the API (this run's stamp),
 * then sends, as the attacker company's own person, the request with ONE
 * field replaced by each shape:
 *   ["<id>"]  [["<id>"]]  {"id":"<id>"}   for <id> = own, victim's, nowhere
 *   12345     true        {"not":"x"}
 * and finally the same request with the company's own identifier as a plain
 * string (the GATE). Checks per case:
 *   ACCEPTING  the gate answers 2xx (and its own id is stored) — the record
 *              was in an accepting state, so a refusal is the field's;
 *   NO 5XX     no shaped value answers a 5xx;
 *   REFUSED    every shaped value answers a 4xx (only counted when gated);
 *   ALIKE      each id-carrying shape answers own, victim's and nowhere
 *              identically (status, code, message);
 *   NOTHING    the rows the request writes are unchanged after the shaped
 *              requests, and no answer carries the victim's id.
 * Whole run: the attacker company's data does not change in any table while
 * the shaped requests are sent (fingerprint before and after that phase, the
 * gates come after it); the victim company's data does not change at all; no
 * answer carries the victim's ids, people's addresses, company name or
 * canaries; no answer is a 5xx. --no-fingerprint skips the two fingerprints
 * (for a mutation run of a single case).
 *
 * Exit code 0 when every check holds, 2 otherwise. Re-runnable: every record
 * is fresh and carries this run's stamp; the idempotent writes (a PUT of the
 * same set, a team member already on the project) answer 2xx again.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { as } = require('../lib/api');
const guard = require('../lib/cert-env');
const fingerprint = require('./fingerprint');

const GROUP = 'shape-ids';
const positional = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const ATTACKER = positional[0] || '044';
const VICTIM = positional[1] || '045';
const ONLY = process.argv.find((a) => a.startsWith('--only='))?.slice(7) || null;
const FINGERPRINT = !process.argv.includes('--no-fingerprint');
const WORK = process.env.CERT_WORK_DIR || 'C:/Temp/octapm-cert';
const STAMP = `SHP-${ATTACKER}-${crypto.randomBytes(3).toString('hex')}`.toUpperCase();
const stamp = STAMP.toLowerCase();
const INPROCESS = process.env.CERT_INPROCESS === '1';

const results = [];
const answers = [];
let currentCase = 'setup';
const check = (name, ok, detail = '') => {
  results.push({ case: currentCase, name, ok: Boolean(ok) });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail && !ok ? `\n        ${detail}` : ''}`);
};
const firstLine = (text) => String(text || '').split(/\r?\n/).map((l) => l.trim()).find(Boolean) || '';
const said = (res) => `${res.status} ${res.body?.error?.code || ''} ${firstLine(res.body?.error?.message).slice(0, 120)}`.trim();
const ok2xx = (res) => res.status >= 200 && res.status < 300;
const is4xx = (res) => res.status >= 400 && res.status < 500;
const nowhere = () => crypto.randomUUID();
const today = () => new Date().toISOString().slice(0, 10);
const future = (days) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
const first = (map) => Object.values(map || {})[0] || null;

const ID_SHAPES = [
  ['["id"]', (id) => [id]],
  ['[["id"]]', (id) => [[id]]],
  ['{"id":id}', (id) => ({ id })],
];
const FIXED_SHAPES = [
  ['12345', 12345],
  ['true', true],
  ['{"not":"x"}', { not: 'x' }],
];

// In process, the local e-mail transport writes each message to the console:
// kept (and out of the output) so it can be searched for the victim's traces.
const emails = [];
const print = console.log.bind(console);
console.log = (...args) => {
  const text = args.map(String).join(' ');
  if (text.startsWith('[email:local]')) {
    emails.push(text);
    return;
  }
  print(...args);
};

const main = async () => {
  console.log(`${GROUP} proof — attacker ${ATTACKER}, victim ${VICTIM}, stamp ${STAMP}${INPROCESS ? ', in process (the working tree\'s code)' : ' — NOT in process: a running API does not run the working tree\'s code'}${ONLY ? `, only /${ONLY}/` : ''}${FINGERPRINT ? '' : ', no fingerprint'}\n`);
  const inventory = (code) => JSON.parse(fs.readFileSync(path.join(WORK, 'state', 'inventory', `${code}.json`), 'utf8'));
  const standard = (inv) => Object.values(inv.projects).find((p) => p.depth === 'standard' && p.refs?.activities && p.refs?.boq && p.refs?.budgetLines);
  const atkInv = inventory(ATTACKER);
  const vicInv = inventory(VICTIM);
  const A = standard(atkInv);
  const V = standard(vicInv);
  const AP = `/projects/${A.id}`;

  const db = await guard.connectCert();
  const q = async (sql, args = []) => (await db.query(sql, args)).rows;
  const one = async (sql, args = []) => (await q(sql, args))[0] || null;
  const val = async (sql, args = []) => {
    const row = await one(sql, args);
    return row ? Object.values(row)[0] : null;
  };
  const orgOf = async (code) => val('select id from "Organisation" where slug like $1', [`cert-${code}-%`]);
  const attackerOrg = await orgOf(ATTACKER);
  const victimOrg = await orgOf(VICTIM);
  const userId = async (role, code) => val('select id from "User" where email = $1', [`${role}@c${code}.octapm-cert.test`]);

  const sessions = {};
  const actor = (role) => {
    if (!sessions[role]) {
      const session = as(`${role}@c${ATTACKER}.octapm-cert.test`);
      sessions[role] = async (method, route, body) => {
        const res = await session.send(method, route, body);
        answers.push({ route: `${role} ${method} ${route}`, status: res.status, text: res.text || '' });
        return res;
      };
    }
    return sessions[role];
  };
  const must = async (role, method, route, body, what) => {
    const res = await actor(role)(method, route, body);
    if (!ok2xx(res)) throw new Error(`setup ${what}: ${said(res)} ${(res.text || '').slice(0, 300)}`);
    return res.body?.data;
  };

  // ── the ids every case draws on: the attacker's own and the victim's ──────
  const own = {
    site: await userId('site', ATTACKER),
    pm: await userId('pm', ATTACKER),
    planner: await userId('planner', ATTACKER),
    quality: await userId('quality', ATTACKER),
    activity: first(A.refs.activities),
    boq: await val('select id from "BoqItem" where "projectId" = $1 and "isActive" and "supersededAt" is null order by "sortOrder", code limit 1', [A.id]),
    // A BOQ item with quantity left to allocate (each run allocates 0.003 of it).
    boqOpen: await val('select b.id from "BoqItem" b where b."projectId" = $1 and b."isActive" and b."supersededAt" is null and b.qty - coalesce((select sum(a.quantity) from "ActivityBoqAllocation" a where a."boqItemId" = b.id), 0) > 1 order by b."sortOrder", b.code limit 1', [A.id]),
    boqOpen2: await val('select b.id from "BoqItem" b where b."projectId" = $1 and b."isActive" and b."supersededAt" is null and b.qty - coalesce((select sum(a.quantity) from "ActivityBoqAllocation" a where a."boqItemId" = b.id), 0) > 1 order by b."sortOrder", b.code offset 1 limit 1', [A.id]),
    costCodes: (await q('select id from "CostCode" where "orgId" = $1 order by code', [attackerOrg])).map((r) => r.id),
    budgetLine: first(A.refs.budgetLines),
    location: await val('select id from "Location" where "projectId" = $1 and "archivedAt" is null order by "sortOrder" limit 1', [A.id]),
    formTemplate: await val('select id from "FormTemplate" where "orgId" = $1 and status = \'active\' and type = \'inspection\' and ("projectId" is null or "projectId" = $2) order by "createdAt" limit 1', [attackerOrg, A.id]),
    wfTemplate: await val('select id from "WorkflowTemplate" where "orgId" = $1 and tool = \'correspondence\' and status = \'active\' and ("projectId" is null or "projectId" = $2) order by "createdAt" limit 1', [attackerOrg, A.id]),
    supplier: await val('select id from "ProcurementSupplier" where "projectId" = $1 and status = \'approved\' and "companyId" is not null order by "createdAt" limit 1', [A.id]),
    procPackage: await val('select id from "ProcurementPackage" where "projectId" = $1 and status = \'planning\' order by "createdAt" limit 1', [A.id]),
    commitment: await val('select id from "Commitment" where "projectId" = $1 order by "createdAt" limit 1', [A.id]),
    material: await one('select id, "activityId" from "ActivityMaterial" where "projectId" = $1 order by "createdAt" limit 1', [A.id]),
    poLine: await val('select id from "ProcurementPoLine" where "projectId" = $1 order by "createdAt" limit 1', [A.id]),
    document: await val('select id from "ProjectDocument" where "projectId" = $1 order by "createdAt" limit 1', [A.id]),
    period: await val('select id from "ReportingPeriod" where "projectId" = $1 and status = \'open\' order by "periodStart" desc limit 1', [A.id]),
    fieldset: await val('select id from "CustomFieldset" where "orgId" = $1 and "recordType" = \'task\' order by "createdAt" limit 1', [attackerOrg]),
    subTemplate: await one('select id, "projectId" from "SubmittalWorkflowTemplate" where "orgId" = $1 order by "createdAt" limit 1', [attackerOrg]),
  };
  if (!own.period) own.period = await val('select id from "ReportingPeriod" where "projectId" = $1 order by "periodStart" desc limit 1', [A.id]);
  const foreign = {
    user: await userId('site', VICTIM),
    activity: first(V.refs.activities),
    boq: await val('select id from "BoqItem" where "projectId" = $1 and "isActive" and "supersededAt" is null limit 1', [V.id]),
    costCode: await val('select id from "CostCode" where "orgId" = $1 order by code limit 1', [victimOrg]),
    budgetLine: first(V.refs.budgetLines),
    location: await val('select l.id from "Location" l join "Project" p on p.id = l."projectId" where p."orgId" = $1 limit 1', [victimOrg]),
    company: await val('select id from "Company" where "orgId" = $1 order by "createdAt" limit 1', [victimOrg]),
    wfTemplate: await val('select id from "WorkflowTemplate" where "orgId" = $1 and tool = \'correspondence\' limit 1', [victimOrg]),
    correspondence: await val('select c.id from "Correspondence" c join "Project" p on p.id = c."projectId" where p."orgId" = $1 limit 1', [victimOrg]),
    supplier: await val('select s.id from "ProcurementSupplier" s join "Project" p on p.id = s."projectId" where p."orgId" = $1 limit 1', [victimOrg]),
    procPackage: await val('select s.id from "ProcurementPackage" s join "Project" p on p.id = s."projectId" where p."orgId" = $1 limit 1', [victimOrg]),
    commitment: await val('select s.id from "Commitment" s join "Project" p on p.id = s."projectId" where p."orgId" = $1 limit 1', [victimOrg]),
    material: await val('select s.id from "ActivityMaterial" s join "Project" p on p.id = s."projectId" where p."orgId" = $1 limit 1', [victimOrg]),
    poLine: await val('select s.id from "ProcurementPoLine" s join "Project" p on p.id = s."projectId" where p."orgId" = $1 limit 1', [victimOrg]),
    document: await val('select s.id from "ProjectDocument" s join "Project" p on p.id = s."projectId" where p."orgId" = $1 limit 1', [victimOrg]),
    period: await val('select s.id from "ReportingPeriod" s join "Project" p on p.id = s."projectId" where p."orgId" = $1 limit 1', [victimOrg]),
    fieldset: await val('select id from "CustomFieldset" where "orgId" = $1 limit 1', [victimOrg]),
    subTemplate: await val('select id from "SubmittalWorkflowTemplate" where "orgId" = $1 limit 1', [victimOrg]),
    submittal: await val('select s.id from "Submittal" s join "Project" p on p.id = s."projectId" where p."orgId" = $1 limit 1', [victimOrg]),
    comment: await val('select id from "Comment" where "orgId" = $1 limit 1', [victimOrg]),
    project: V.id,
  };
  for (const [key, id] of Object.entries(own)) check(`setup: company ${ATTACKER}'s ${key} is known`, Array.isArray(id) ? id.length > 1 : Boolean(id), JSON.stringify(id));
  for (const [key, id] of Object.entries(foreign)) check(`setup: company ${VICTIM}'s ${key} is known`, Boolean(id));
  const foreignIds = Object.values(foreign).filter(Boolean);

  // ── fresh records shared by several cases ────────────────────────────────
  const freshActivity = async (tag, engineer = own.site) => (await must('planner', 'POST', `${AP}/activities`, { name: `Shape ${STAMP} ${tag}`, duration: 3, engineerIds: [engineer] }, `activity ${tag}`)).id;
  const freshCompany = async (tag) => (await must('pm', 'POST', '/companies', { name: `Shape ${STAMP} ${tag}`, type: 'external', email: `${tag.toLowerCase()}.${stamp}@parties.c${ATTACKER}.octapm-cert.test`, status: 'active' }, `company ${tag}`)).id;
  const freshCorrespondence = async (tag) => (await must('pm', 'POST', `${AP}/correspondence`, { direction: 'outgoing', type: 'letter', subject: `Shape ${STAMP} ${tag}`, date: today(), status: 'open' }, `correspondence ${tag}`)).id;
  const freshChangeOrder = async (tag) => (await must('qs', 'POST', `${AP}/change-orders`, { description: `Shape ${STAMP} ${tag}`, value: 10 }, `change order ${tag}`)).id;
  const freshRfi = async (tag) => (await must('site', 'POST', `${AP}/rfi`, { subject: `Shape ${STAMP} ${tag}`, question: `Shape ${STAMP} ${tag}?`, priority: 'normal', status: 'open' }, `rfi ${tag}`)).id;
  const freshSubmittal = async (tag) => (await must('site', 'POST', `${AP}/submittals`, { title: `Shape ${STAMP} ${tag}` }, `submittal ${tag}`)).id;
  const count = (sql, args) => async () => String(await val(sql, args));
  const rowState = (sql, args) => async () => JSON.stringify(await q(sql, args));

  // ── the cases ─────────────────────────────────────────────────────────────
  const cases = [];
  const add = (name, setup) => cases.push({ name, setup });

  // Task 1: activities, workflows, bids from the BOQ, forms.
  add('POST activities engineerIds[]', async () => {
    const name = `Shape ${STAMP} E1`;
    return {
      role: 'planner', method: 'POST', route: `${AP}/activities`, own: own.site, foreign: foreign.user,
      body: (v) => ({ name, duration: 2, engineerIds: [v] }),
      state: count('select count(*)::int n from "Activity" where "projectId" = $1 and name = $2', [A.id, name]),
      stored: async () => Number(await val('select count(*)::int n from "ActivityAssignment" aa join "Activity" a on a.id = aa."activityId" where a."projectId" = $1 and a.name = $2 and aa."userId" = $3', [A.id, name, own.site])) > 0,
    };
  });
  add('PATCH activities/{id} engineerIds[]', async () => {
    const id = await freshActivity('E2');
    return {
      role: 'planner', method: 'PATCH', route: `${AP}/activities/${id}`, own: own.pm, foreign: foreign.user,
      body: (v) => ({ engineerIds: [v] }),
      state: rowState('select "userId" from "ActivityAssignment" where "activityId" = $1 order by "userId"', [id]),
      stored: async () => (await rowState('select "userId" from "ActivityAssignment" where "activityId" = $1 order by "userId"', [id])()) === JSON.stringify([{ userId: own.pm }]),
    };
  });
  add('POST activities/bulk-progress updates[].activityId', async () => {
    const id = await freshActivity('BP');
    const notes = `Shape ${STAMP} BP`;
    return {
      role: 'site', method: 'POST', route: `${AP}/activities/bulk-progress`, own: id, foreign: foreign.activity,
      body: (v) => ({ updates: [{ activityId: v, pctComplete: 5, progressMethod: 'percent', status: 'submitted', notes }] }),
      state: count('select count(*)::int n from "ProgressSubmission" where "projectId" = $1 and notes = $2', [A.id, notes]),
      stored: async () => Number(await val('select count(*)::int n from "ProgressSubmission" where "activityId" = $1 and notes = $2', [id, notes])) > 0,
    };
  });
  add('POST workflows/instances templateId', async () => {
    const recordId = await freshCorrespondence('WF1');
    return {
      role: 'pm', method: 'POST', route: `${AP}/workflows/instances`, own: own.wfTemplate, foreign: foreign.wfTemplate,
      body: (v) => ({ tool: 'correspondence', recordId, templateId: v }),
      state: count('select count(*)::int n from "WorkflowInstance" where "recordId" = $1', [recordId]),
      stored: async () => Number(await val('select count(*)::int n from "WorkflowInstance" where "recordId" = $1 and "templateId" = $2', [recordId, own.wfTemplate])) > 0,
    };
  });
  add('POST workflows/instances recordId', async () => {
    const recordId = await freshCorrespondence('WF2');
    return {
      role: 'pm', method: 'POST', route: `${AP}/workflows/instances`, own: recordId, foreign: foreign.correspondence,
      body: (v) => ({ tool: 'correspondence', recordId: v, templateId: own.wfTemplate }),
      state: count('select count(*)::int n from "WorkflowInstance" where "projectId" = $1', [A.id]),
      stored: async () => Number(await val('select count(*)::int n from "WorkflowInstance" where "recordId" = $1', [recordId])) > 0,
    };
  });
  add('POST bids/{pkg}/lines/from-boq boqItemIds[]', async () => {
    const pkg = await must('pm', 'POST', `${AP}/bids`, { title: `Shape ${STAMP} draft`, dueAt: future(21) }, 'draft bid package');
    return {
      role: 'procurement', method: 'POST', route: `${AP}/bids/${pkg.id}/lines/from-boq`, own: own.boq, foreign: foreign.boq,
      body: (v) => ({ boqItemIds: [v] }),
      state: count('select count(*)::int n from "BidPackageLine" where "packageId" = $1', [pkg.id]),
      stored: async () => Number(await val('select count(*)::int n from "BidPackageLine" where "packageId" = $1 and "boqItemId" = $2', [pkg.id, own.boq])) > 0,
    };
  });
  for (const [field, ownKey, foreignKey] of [['activityId', 'activity', 'activity'], ['locationId', 'location', 'location'], ['assigneeCompanyId', null, 'company']]) {
    add(`POST forms ${field}`, async () => {
      const title = `Shape ${STAMP} F-${field}`;
      const ownId = ownKey ? own[ownKey] : await freshCompany(`F-${field}`);
      return {
        role: 'site', method: 'POST', route: `${AP}/forms`, own: ownId, foreign: foreign[foreignKey],
        body: (v) => ({ templateId: own.formTemplate, title, [field]: v }),
        state: count('select count(*)::int n from "FormInstance" where "projectId" = $1 and title = $2', [A.id, title]),
        stored: async () => Number(await val(`select count(*)::int n from "FormInstance" where "projectId" = $1 and title = $2 and "${field}" = $3`, [A.id, title, ownId])) > 0,
      };
    });
  }

  // The shape sweep's 5xx in this group's area (and the two values it found stored).
  add('PUT budget/cost-codes costCodeIds[]', async () => {
    const [ownCode, ...rest] = own.costCodes;
    const state = rowState('select "costCodeId" from "ProjectCostCode" where "projectId" = $1 order by "costCodeId"', [A.id]);
    return {
      role: 'pm', method: 'PUT', route: `${AP}/budget/cost-codes`, own: ownCode, foreign: foreign.costCode,
      body: (v) => ({ costCodeIds: [v, ...rest] }), state,
      stored: async () => (await state()).includes(ownCode),
    };
  });
  add('PUT budget/change-orders/{id}/line lineId', async () => {
    const co = await freshChangeOrder('BCL');
    const state = rowState('select "budgetLineId" from "ChangeOrder" where id = $1', [co]);
    return {
      role: 'cost', method: 'PUT', route: `${AP}/budget/change-orders/${co}/line`, own: own.budgetLine, foreign: foreign.budgetLine,
      body: (v) => ({ lineId: v }), state,
      stored: async () => (await state()).includes(own.budgetLine),
    };
  });
  for (const field of ['boqItemId', 'activityId']) {
    add(`POST activity-boq-allocations ${field}`, async () => {
      const activity = await freshActivity(`AL-${field}`);
      return {
        role: 'planner', method: 'POST', route: `${AP}/activity-boq-allocations`, own: field === 'boqItemId' ? own.boqOpen : activity, foreign: field === 'boqItemId' ? foreign.boq : foreign.activity,
        body: (v) => ({ boqItemId: own.boqOpen, activityId: activity, quantity: 0.001, amount: 0.01, source: 'manual', [field]: v }),
        state: count('select count(*)::int n from "ActivityBoqAllocation" where "projectId" = $1', [A.id]),
        stored: async () => Number(await val('select count(*)::int n from "ActivityBoqAllocation" where "activityId" = $1 and "boqItemId" = $2', [activity, own.boqOpen])) > 0,
      };
    });
    add(`PATCH activity-boq-allocations/{id} ${field}`, async () => {
      const activity = await freshActivity(`ALP-${field}`);
      const created = await must('planner', 'POST', `${AP}/activity-boq-allocations`, { boqItemId: own.boqOpen, activityId: activity, quantity: 0.001, amount: 0.01, source: 'manual' }, 'allocation');
      const id = created?.id || created?.allocation?.id;
      // The own value the gate moves the allocation to: another open BOQ item, or another fresh activity.
      const ownId = field === 'boqItemId' ? own.boqOpen2 : await freshActivity(`ALP2-${field}`);
      const state = rowState('select "boqItemId", "activityId", "updatedAt"::text from "ActivityBoqAllocation" where id = $1', [id]);
      return {
        role: 'planner', method: 'PATCH', route: `${AP}/activity-boq-allocations/${id}`, own: ownId, foreign: field === 'boqItemId' ? foreign.boq : foreign.activity,
        body: (v) => ({ [field]: v }), state,
        stored: async () => (await state()).includes(ownId),
      };
    });
  }
  add('POST parties companyId', async () => {
    const company = await freshCompany('PTY');
    return {
      role: 'pm', method: 'POST', route: `${AP}/parties`, own: company, foreign: foreign.company,
      body: (v) => ({ contactName: `Shape ${STAMP}`, contactEmail: `party.${stamp}@parties.c${ATTACKER}.octapm-cert.test`, role: 'subcontractor', companyId: v, accessLevel: 'read_only' }),
      state: count('select count(*)::int n from "ProjectParty" where "projectId" = $1', [A.id]),
      stored: async () => Number(await val('select count(*)::int n from "ProjectParty" where "projectId" = $1 and "companyId" = $2', [A.id, company])) > 0,
    };
  });
  add('POST parties/{id}/members userId', async () => {
    const company = await freshCompany('PTM');
    const party = await must('pm', 'POST', `${AP}/parties`, { contactName: `Shape ${STAMP}`, contactEmail: `member.${stamp}@parties.c${ATTACKER}.octapm-cert.test`, role: 'subcontractor', companyId: company, accessLevel: 'read_only' }, 'party');
    const partyId = party?.id || party?.party?.id;
    return {
      role: 'pm', method: 'POST', route: `${AP}/parties/${partyId}/members`, own: own.quality, foreign: foreign.user,
      body: (v) => ({ userId: v, role: 'member' }),
      state: count('select count(*)::int n from "ProjectPartyMember" where "projectPartyId" = $1', [partyId]),
      stored: async () => Number(await val('select count(*)::int n from "ProjectPartyMember" where "projectPartyId" = $1 and "userId" = $2', [partyId, own.quality])) > 0,
    };
  });
  add('POST locations/reorder orderedIds[]', async () => {
    const group = await one('select "parentId", array_agg(id::text order by "sortOrder", id) ids from "Location" where "projectId" = $1 and "parentId" is not null and "archivedAt" is null group by "parentId" having count(*) > 1 limit 1', [A.id]);
    const [ownId, ...rest] = group.ids;
    const state = rowState('select id, "sortOrder" from "Location" where "parentId" = $1 order by id', [group.parentId]);
    return {
      role: 'planner', method: 'POST', route: `${AP}/locations/reorder`, own: ownId, foreign: foreign.location,
      body: (v) => ({ parentId: group.parentId, orderedIds: [v, ...rest] }), state,
      stored: async () => true,
    };
  });
  for (const field of ['activityId', 'reportingPeriodId']) {
    add(`POST reports/cost-loading ${field}`, async () => {
      const activity = await freshActivity(`CL-${field}`);
      const notes = `Shape ${STAMP} CL-${field}`;
      return {
        role: 'cost', method: 'POST', route: `${AP}/reports/cost-loading`, own: field === 'activityId' ? activity : own.period, foreign: field === 'activityId' ? foreign.activity : foreign.period,
        body: (v) => ({ activityId: activity, reportingPeriodId: own.period, plannedDate: today(), plannedValue: 1, source: 'manual', baselineVersion: 'BL0', notes, [field]: v }),
        state: count('select count(*)::int n from "ActivityCostLoading" where "projectId" = $1', [A.id]),
        stored: async () => Number(await val('select count(*)::int n from "ActivityCostLoading" where "activityId" = $1', [activity])) > 0,
      };
    });
    add(`PATCH reports/cost-loading/{id} ${field}`, async () => {
      const activity = await freshActivity(`CLP-${field}`);
      const created = await must('cost', 'POST', `${AP}/reports/cost-loading`, { activityId: activity, reportingPeriodId: own.period, plannedDate: today(), plannedValue: 1, source: 'manual', baselineVersion: 'BL0', notes: `Shape ${STAMP} CLP` }, 'cost loading');
      const id = created?.id || created?.loading?.id;
      const other = await freshActivity(`CLP2-${field}`);
      const ownId = field === 'activityId' ? other : own.period;
      const state = rowState('select "activityId", "reportingPeriodId", "updatedAt"::text from "ActivityCostLoading" where id = $1', [id]);
      return {
        role: 'cost', method: 'PATCH', route: `${AP}/reports/cost-loading/${id}`, own: ownId, foreign: field === 'activityId' ? foreign.activity : foreign.period,
        body: (v) => ({ [field]: v }), state,
        stored: async () => (await state()).includes(ownId),
      };
    });
  }
  add('POST procurement/suppliers companyId', async () => {
    const company = await freshCompany('SUP');
    return {
      role: 'procurement', method: 'POST', route: `${AP}/procurement/suppliers`, own: company, foreign: foreign.company,
      body: (v) => ({ companyId: v, code: `S-${stamp}`, contactName: `Shape ${STAMP}`, status: 'approved' }),
      state: count('select count(*)::int n from "ProcurementSupplier" where "projectId" = $1', [A.id]),
      stored: async () => Number(await val('select count(*)::int n from "ProcurementSupplier" where "projectId" = $1 and "companyId" = $2', [A.id, company])) > 0,
    };
  });
  for (const [field, ownKey, foreignKey] of [['activityId', 'activity', 'activity'], ['supplierId', 'supplier', 'supplier']]) {
    add(`POST procurement/packages ${field}`, async () => {
      const title = `Shape ${STAMP} PP-${field}`;
      return {
        role: 'procurement', method: 'POST', route: `${AP}/procurement/packages`, own: own[ownKey], foreign: foreign[foreignKey],
        body: (v) => ({ packageNumber: `PP-${stamp}-${field}`, title, status: 'planning', [field]: v }),
        state: count('select count(*)::int n from "ProcurementPackage" where "projectId" = $1', [A.id]),
        stored: async () => Number(await val(`select count(*)::int n from "ProcurementPackage" where "projectId" = $1 and title = $2 and "${field}" = $3`, [A.id, title, own[ownKey]])) > 0,
      };
    });
  }
  for (const [field, ownKey, foreignKey] of [['activityId', 'activity', 'activity'], ['procurementPackageId', 'procPackage', 'procPackage']]) {
    add(`POST long-lead ${field}`, async () => {
      const item = `Shape ${STAMP} LL-${field}`;
      return {
        role: 'procurement', method: 'POST', route: `${AP}/long-lead`, own: own[ownKey], foreign: foreign[foreignKey],
        // A package-linked item takes its status from the package, so none is sent for it.
        body: (v) => ({ item, leadWeeks: 4, requiredTiming: 'activity_start', criticality: 'high', ...(field === 'procurementPackageId' ? { activityId: own.activity } : { status: 'not_ordered', warehouseStatus: 'not_received' }), [field]: v }),
        state: count('select count(*)::int n from "LongLeadItem" where "projectId" = $1', [A.id]),
        stored: async () => Number(await val(`select count(*)::int n from "LongLeadItem" where "projectId" = $1 and item = $2 and "${field}" = $3`, [A.id, item, own[ownKey]])) > 0,
      };
    });
    add(`PATCH long-lead/{id} ${field}`, async () => {
      const created = await must('procurement', 'POST', `${AP}/long-lead`, { item: `Shape ${STAMP} LLP-${field}`, activityId: own.activity, leadWeeks: 4, requiredTiming: 'activity_start', criticality: 'high', status: 'not_ordered', warehouseStatus: 'not_received' }, 'long-lead item');
      const state = rowState(`select "${field}", "updatedAt"::text from "LongLeadItem" where id = $1`, [created.id]);
      return {
        role: 'procurement', method: 'PATCH', route: `${AP}/long-lead/${created.id}`, own: own[ownKey], foreign: foreign[foreignKey],
        body: (v) => ({ [field]: v }), state,
        stored: async () => (await state()).includes(own[ownKey]),
      };
    });
  }
  const orderBody = (item, overrides = {}, lineOverrides = {}) => ({ item, supplierId: own.supplier, status: 'planned', currency: 'EGP', requiredBy: future(40), lines: [{ activityId: own.activity, description: `${item} line`, unit: 'nr', orderedQty: 1, unitCost: 1, ...lineOverrides }], ...overrides });
  // eslint-disable-next-line prefer-const
  for (let [field, ownId, foreignId, where] of [
    ['supplierId', own.supplier, foreign.supplier, 'top'],
    ['packageId', own.procPackage, foreign.procPackage, 'top'],
    ['commitmentId', own.commitment, foreign.commitment, 'top'],
    ['activityId', own.activity, foreign.activity, 'top'],
    ['activityId', own.activity, foreign.activity, 'line'],
    ['activityMaterialId', own.material?.id, foreign.material, 'line'],
    ['costCodeId', own.costCodes[0], foreign.costCode, 'line'],
  ]) {
    add(`POST procurement/purchase-orders ${where === 'line' ? 'lines[].' : ''}${field}`, async () => {
      const item = `Shape ${STAMP} PO-${field}`;
      const lineBase = field === 'activityMaterialId' ? { activityId: own.material.activityId } : {};
      // An order on a package raises the package's lead-time alert; a package
      // that already has one answers 409 (own state), so the order gets a fresh one.
      if (field === 'packageId') {
        const fresh = await must('procurement', 'POST', `${AP}/procurement/packages`, { packageNumber: `PP-${stamp}-PO`, title: `Shape ${STAMP} PO package`, status: 'planning' }, 'procurement package');
        ownId = fresh.id;
      }
      return {
        role: 'procurement', method: 'POST', route: `${AP}/procurement/purchase-orders`, own: ownId, foreign: foreignId,
        body: (v) => (where === 'line' ? orderBody(item, {}, { ...lineBase, [field]: v }) : orderBody(item, { [field]: v })),
        state: count('select count(*)::int n from "ProcurementOrder" where "projectId" = $1', [A.id]),
        stored: async () => Number(await val(where === 'line'
          ? `select count(*)::int n from "ProcurementPoLine" l join "ProcurementOrder" o on o.id = l."orderId" where o."projectId" = $1 and o.item = $2 and l."${field}" = $3`
          : `select count(*)::int n from "ProcurementOrder" where "projectId" = $1 and item = $2 and "${field}" = $3`, [A.id, item, ownId])) > 0,
      };
    });
  }
  add('POST direct-costs lines[].poLineId', async () => {
    const description = `Shape ${STAMP} DC`;
    return {
      role: 'cost', method: 'POST', route: `${AP}/direct-costs`, own: own.poLine, foreign: foreign.poLine,
      body: (v) => ({ type: 'invoice', description, costDate: today(), invoiceNumber: `INV-${stamp}`, lines: [{ description: `${description} line`, poLineId: v, amount: 1 }] }),
      state: count('select count(*)::int n from "DirectCost" where "projectId" = $1', [A.id]),
      stored: async () => Number(await val('select count(*)::int n from "DirectCostLine" l join "DirectCost" d on d.id = l."directCostId" where d."projectId" = $1 and d.description = $2 and l."poLineId" = $3', [A.id, description, own.poLine])) > 0,
    };
  });
  add('POST activities/{id}/materials supplierId', async () => {
    const activity = await freshActivity('MAT');
    const name = `Shape ${STAMP} MAT`;
    return {
      role: 'planner', method: 'POST', route: `${AP}/activities/${activity}/materials`, own: own.supplier, foreign: foreign.supplier,
      body: (v) => ({ name, code: `M-${stamp}`, unit: 'BAG', qty: 5, requiredTiming: 'activity_start', leadWeeks: 1, bufferDays: 1, supplierId: v }),
      state: count('select count(*)::int n from "ActivityMaterial" where "activityId" = $1', [activity]),
      stored: async () => Number(await val('select count(*)::int n from "ActivityMaterial" where "activityId" = $1 and "supplierId" = $2', [activity, own.supplier])) > 0,
    };
  });
  add('PATCH activities/{id}/materials/{id} supplierId', async () => {
    const activity = await freshActivity('MATP');
    const material = await must('planner', 'POST', `${AP}/activities/${activity}/materials`, { name: `Shape ${STAMP} MATP`, code: `MP-${stamp}`, unit: 'BAG', qty: 5, requiredTiming: 'activity_start', leadWeeks: 1, bufferDays: 1 }, 'material');
    const state = rowState('select "supplierId", "updatedAt"::text from "ActivityMaterial" where id = $1', [material.id]);
    return {
      role: 'planner', method: 'PATCH', route: `${AP}/activities/${activity}/materials/${material.id}`, own: own.supplier, foreign: foreign.supplier,
      body: (v) => ({ supplierId: v }), state,
      stored: async () => (await state()).includes(own.supplier),
    };
  });
  for (const [field, wrap] of [['activityId', (v) => ({ activityId: v })], ['affectedActivityIds[]', (v) => ({ affectedActivityIds: [v] })], ['activityLinks[].activityId', (v) => ({ activityLinks: [{ activityId: v, relationType: 'impacted', scheduleImpactDays: 1 }] })]]) {
    add(`POST change-orders ${field}`, async () => {
      const description = `Shape ${STAMP} CO-${field}`;
      return {
        role: 'qs', method: 'POST', route: `${AP}/change-orders`, own: own.activity, foreign: foreign.activity,
        body: (v) => ({ description, value: 10, ...wrap(v) }),
        state: count('select count(*)::int n from "ChangeOrder" where "projectId" = $1', [A.id]),
        stored: async () => Number(await val('select count(*)::int n from "ChangeOrder" where "projectId" = $1 and description = $2', [A.id, description])) > 0,
      };
    });
    add(`PATCH change-orders/{id} ${field}`, async () => {
      const co = await freshChangeOrder(`COP-${field}`);
      const state = rowState('select "activityId", "updatedAt"::text from "ChangeOrder" where id = $1', [co]);
      return {
        role: 'qs', method: 'PATCH', route: `${AP}/change-orders/${co}`, own: own.activity, foreign: foreign.activity,
        body: (v) => wrap(v), state,
        stored: async () => true,
      };
    });
  }
  // Photo evidence: a key in another shape was skipped by the check and stored as given.
  const photo = (v) => ({ photos: [{ key: v, name: `shape-${stamp}.png`, type: 'photo' }], notes: `Shape ${STAMP}` });
  add('POST activities/{id}/progress evidence.photos[].key', async () => {
    const activity = await freshActivity('PG');
    return {
      role: 'site', method: 'POST', route: `${AP}/activities/${activity}/progress`, own: own.document, foreign: foreign.document,
      body: (v) => ({ pctComplete: 7, progressMethod: 'percent', status: 'submitted', source: 'manual', evidence: photo(v), notes: `Shape ${STAMP} PG` }),
      state: count('select count(*)::int n from "ProgressSubmission" where "activityId" = $1', [activity]),
      stored: async () => Number(await val('select count(*)::int n from "ProgressSubmission" where "activityId" = $1 and "evidenceJson"::text like $2', [activity, `%${own.document}%`])) > 0,
    };
  });
  add('POST activities/bulk-progress updates[].evidence.photos[].key', async () => {
    const activity = await freshActivity('BPG');
    return {
      role: 'site', method: 'POST', route: `${AP}/activities/bulk-progress`, own: own.document, foreign: foreign.document,
      body: (v) => ({ updates: [{ activityId: activity, pctComplete: 6, progressMethod: 'percent', status: 'submitted', evidence: photo(v), notes: `Shape ${STAMP} BPG` }] }),
      state: count('select count(*)::int n from "ProgressSubmission" where "activityId" = $1', [activity]),
      stored: async () => Number(await val('select count(*)::int n from "ProgressSubmission" where "activityId" = $1 and "evidenceJson"::text like $2', [activity, `%${own.document}%`])) > 0,
    };
  });
  const reportDate = (n) => new Date(Date.UTC(2024, 0, 1) + (parseInt(stamp.slice(-4), 16) % 600 + n) * 86_400_000).toISOString().slice(0, 10);
  add('POST daily-reports progress.evidence.photos[].key', async () => {
    const activity = await freshActivity('DRP');
    const date = reportDate(0);
    return {
      role: 'site', method: 'POST', route: `${AP}/daily-reports`, own: own.document, foreign: foreign.document,
      body: (v) => ({ activityId: activity, date, shift: 'day', notes: `Shape ${STAMP} DRP`, status: 'submitted', progress: { method: 'percent', pctComplete: 4, evidence: photo(v), notes: `Shape ${STAMP} DRP` } }),
      state: count('select count(*)::int n from "DailyReport" where "projectId" = $1', [A.id]),
      stored: async () => Number(await val('select count(*)::int n from "ProgressSubmission" where "activityId" = $1 and "evidenceJson"::text like $2', [activity, `%${own.document}%`])) > 0,
    };
  });
  add('POST daily-reports activityId', async () => {
    const activity = await freshActivity('DRA');
    const date = reportDate(1);
    return {
      role: 'site', method: 'POST', route: `${AP}/daily-reports`, own: activity, foreign: foreign.activity,
      body: (v) => ({ activityId: v, date, shift: 'day', notes: `Shape ${STAMP} DRA`, status: 'submitted' }),
      state: count('select count(*)::int n from "DailyReport" where "projectId" = $1', [A.id]),
      stored: async () => Number(await val('select count(*)::int n from "DailyReport" where "activityId" = $1', [activity])) > 0,
    };
  });
  add('PATCH daily-reports/{id} activityId', async () => {
    const activity = await freshActivity('DRU');
    // Only a draft report can be edited.
    const report = await must('site', 'POST', `${AP}/daily-reports`, { activityId: activity, date: reportDate(2), shift: 'day', notes: `Shape ${STAMP} DRU`, status: 'draft' }, 'daily report');
    const id = report?.id || report?.report?.id;
    const other = await freshActivity('DRU2');
    const state = rowState('select "activityId", "updatedAt"::text from "DailyReport" where id = $1', [id]);
    return {
      role: 'site', method: 'PATCH', route: `${AP}/daily-reports/${id}`, own: other, foreign: foreign.activity,
      body: (v) => ({ activityId: v }), state,
      stored: async () => (await state()).includes(other),
    };
  });
  for (const [field, wrap, ownId] of [['managerUserId', (v) => ({ managerUserId: v }), own.pm], ['assigneeUserIds[]', (v) => ({ assigneeUserIds: [v] }), own.site], ['distributionUserIds[]', (v) => ({ distributionUserIds: [v] }), own.planner], ['locationId', (v) => ({ locationId: v }), own.location]]) {
    add(`POST rfi ${field}`, async () => {
      const subject = `Shape ${STAMP} RFI-${field}`;
      return {
        role: 'site', method: 'POST', route: `${AP}/rfi`, own: ownId, foreign: field === 'locationId' ? foreign.location : foreign.user,
        body: (v) => ({ subject, question: `${subject}?`, priority: 'normal', status: 'open', ...wrap(v) }),
        state: count('select count(*)::int n from "Rfi" where "projectId" = $1', [A.id]),
        stored: async () => Number(await val('select count(*)::int n from "Rfi" where "projectId" = $1 and subject = $2', [A.id, subject])) > 0,
      };
    });
    if (field === 'locationId') continue;
    add(`PUT rfi/{id}/people ${field}`, async () => {
      const rfi = await freshRfi(`RP-${field}`);
      const state = async () => JSON.stringify([await q('select "managerUserId", "updatedAt"::text from "Rfi" where id = $1', [rfi]), await q('select "userId", role from "RfiAssignee" where "rfiId" = $1 order by "userId", role', [rfi])]);
      return {
        role: 'pm', method: 'PUT', route: `${AP}/rfi/${rfi}/people`, own: ownId, foreign: foreign.user,
        body: (v) => wrap(v), state,
        stored: async () => (await state()).includes(ownId),
      };
    });
  }
  add('POST submittals workflowTemplateId', async () => {
    const project = own.subTemplate.projectId || A.id;
    const title = `Shape ${STAMP} SUB-WT`;
    return {
      role: 'site', method: 'POST', route: `/projects/${project}/submittals`, own: own.subTemplate.id, foreign: foreign.subTemplate,
      body: (v) => ({ title, workflowTemplateId: v }),
      state: count('select count(*)::int n from "Submittal" where "projectId" = $1', [project]),
      stored: async () => Number(await val('select count(*)::int n from "Submittal" where "projectId" = $1 and title = $2', [project, title])) > 0,
    };
  });
  add('POST submittals/packages submittalIds[]', async () => {
    const submittal = await freshSubmittal('SP');
    const name = `Shape ${STAMP} SP`;
    return {
      role: 'site', method: 'POST', route: `${AP}/submittals/packages`, own: submittal, foreign: foreign.submittal,
      body: (v) => ({ name, submittalIds: [v] }),
      state: count('select count(*)::int n from "SubmittalPackage" where "projectId" = $1', [A.id]),
      stored: async () => Number(await val('select count(*)::int n from "Submittal" s join "SubmittalPackage" p on p.id = s."packageId" where s.id = $1 and p.name = $2', [submittal, name])) > 0,
    };
  });
  add('POST submittals/packages/{id}/items submittalIds[]', async () => {
    const pkg = await must('site', 'POST', `${AP}/submittals/packages`, { name: `Shape ${STAMP} SPI` }, 'submittal package');
    const submittal = await freshSubmittal('SPI');
    return {
      role: 'site', method: 'POST', route: `${AP}/submittals/packages/${pkg.id}/items`, own: submittal, foreign: foreign.submittal,
      body: (v) => ({ submittalIds: [v] }),
      state: count('select count(*)::int n from "Submittal" where "packageId" = $1', [pkg.id]),
      stored: async () => Number(await val('select count(*)::int n from "Submittal" where id = $1 and "packageId" = $2', [submittal, pkg.id])) > 0,
    };
  });
  add('POST conversations memberUserIds[]', async () => {
    const title = `Shape ${STAMP} CV`;
    return {
      role: 'pm', method: 'POST', route: '/conversations', own: own.site, foreign: foreign.user,
      body: (v) => ({ kind: 'group', title, memberUserIds: [v] }),
      state: count('select count(*)::int n from "Conversation" where "orgId" = $1', [attackerOrg]),
      stored: async () => Number(await val('select count(*)::int n from "Conversation" c join "ConversationMember" m on m."conversationId" = c.id where c."orgId" = $1 and c.title = $2 and m."userId" = $3', [attackerOrg, title, own.site])) > 0,
    };
  });
  add('POST conversations/{id}/members userIds[]', async () => {
    const conversation = await must('pm', 'POST', '/conversations', { kind: 'group', title: `Shape ${STAMP} CVM`, memberUserIds: [own.site] }, 'conversation');
    const id = conversation?.id || conversation?.conversation?.id;
    return {
      role: 'pm', method: 'POST', route: `/conversations/${id}/members`, own: own.planner, foreign: foreign.user,
      body: (v) => ({ userIds: [v] }),
      state: count('select count(*)::int n from "ConversationMember" where "conversationId" = $1', [id]),
      stored: async () => Number(await val('select count(*)::int n from "ConversationMember" where "conversationId" = $1 and "userId" = $2', [id, own.planner])) > 0,
    };
  });
  add('POST comments parentId', async () => {
    const parent = await must('pm', 'POST', `${AP}/comments`, { recordType: 'activity', recordId: own.activity, body: `Shape ${STAMP} parent` }, 'parent comment');
    const parentId = parent?.id || parent?.comment?.id;
    const body = `Shape ${STAMP} reply`;
    return {
      role: 'pm', method: 'POST', route: `${AP}/comments`, own: parentId, foreign: foreign.comment,
      body: (v) => ({ recordType: 'activity', recordId: own.activity, body, parentId: v }),
      state: count('select count(*)::int n from "Comment" where "projectId" = $1', [A.id]),
      stored: async () => Number(await val('select count(*)::int n from "Comment" where "parentId" = $1 and body = $2', [parentId, body])) > 0,
    };
  });
  add('PUT custom-fields/assignments fieldsetId', async () => {
    const state = rowState('select "recordType", "fieldsetId" from "ProjectFieldset" where "projectId" = $1 order by "recordType"', [A.id]);
    return {
      role: 'pm', method: 'PUT', route: `${AP}/custom-fields/assignments`, own: own.fieldset, foreign: foreign.fieldset,
      body: (v) => ({ recordType: 'task', fieldsetId: v }), state,
      stored: async () => (await state()).includes(own.fieldset),
    };
  });
  add('POST notifications/scan-due projectId', async () => ({
    role: 'pm', method: 'POST', route: '/notifications/scan-due', own: A.id, foreign: foreign.project,
    body: (v) => ({ projectId: v, horizonDays: 7 }),
    state: count('select count(*)::int n from "Notification" where "orgId" = $1', [attackerOrg]),
    stored: async () => true,
  }));
  add('POST team userId', async () => ({
    role: 'pm', method: 'POST', route: `${AP}/team`, own: own.site, foreign: foreign.user,
    body: (v) => ({ userId: v }),
    state: count('select count(*)::int n from "ProjectUserPermission" where "projectId" = $1', [A.id]),
    stored: async () => true,
  }));

  // ── run ───────────────────────────────────────────────────────────────────
  const selected = cases.filter((c) => !ONLY || new RegExp(ONLY).test(c.name));
  console.log(`\ncases: ${selected.length} of ${cases.length}; attacker project ${A.id}, victim project ${V.id}\n`);
  for (const c of selected) {
    currentCase = c.name;
    try {
      c.ctx = await c.setup();
    } catch (error) {
      c.setupError = error.message;
      check(`${c.name}: setup`, false, error.message.slice(0, 400));
    }
  }
  const snapshot = async () => {
    await db.query('begin transaction isolation level repeatable read read only');
    const printOf = await fingerprint.take(db);
    await db.query('rollback');
    return printOf;
  };
  currentCase = 'whole run';
  const runStart = FINGERPRINT ? await snapshot() : null;

  // Phase 2: every shaped request of every case, before any gate.
  for (const c of selected.filter((x) => x.ctx)) {
    const { ctx } = c;
    const send = actor(ctx.role);
    c.nowhere = nowhere();
    c.before = await ctx.state().catch((e) => `ERR ${e.message}`);
    c.byShape = {};
    c.all = [];
    for (const [label, make] of ID_SHAPES) {
      c.byShape[label] = {};
      for (const [who, id] of [['own', ctx.own], ['foreign', ctx.foreign], ['nowhere', c.nowhere]]) {
        const res = await send(ctx.method, ctx.route, ctx.body(make(id)));
        c.byShape[label][who] = res;
        c.all.push({ label: `${label} ${who}`, res });
      }
    }
    for (const [label, value] of FIXED_SHAPES) c.all.push({ label, res: await send(ctx.method, ctx.route, ctx.body(value)) });
    c.after = await ctx.state().catch((e) => `ERR ${e.message}`);
  }
  const shapedEnd = FINGERPRINT ? await snapshot() : null;

  // Phase 3: the gates — the company's own id as a plain string.
  for (const c of selected.filter((x) => x.ctx)) {
    c.gate = await actor(c.ctx.role)(c.ctx.method, c.ctx.route, c.ctx.body(c.ctx.own));
    c.storedOwn = ok2xx(c.gate) ? await c.ctx.stored().catch(() => false) : false;
  }

  for (const c of selected.filter((x) => x.ctx)) {
    currentCase = c.name;
    const gated = ok2xx(c.gate) && c.storedOwn;
    check(`${c.name}: the company's own id as a plain string is accepted (2xx) and stored — the record accepts this request`, gated, `${said(c.gate)} stored=${c.storedOwn} ${(c.gate.text || '').slice(0, 200)}`);
    const errors = c.all.filter((a) => a.res.status >= 500);
    check(`${c.name}: no wrongly shaped value answers a 5xx`, errors.length === 0, errors.map((a) => `${a.label} -> ${said(a.res)}`).join(' | ').slice(0, 600));
    const notRefused = c.all.filter((a) => !is4xx(a.res));
    check(`${c.name}: every wrongly shaped value is refused with a 4xx, on a record that accepts the own id`, gated && notRefused.length === 0, `${gated ? '' : 'NOT GATED; '}${notRefused.map((a) => `${a.label} -> ${said(a.res)}`).join(' | ').slice(0, 600)}`);
    for (const [label] of ID_SHAPES) {
      const s = c.byShape[label];
      check(`${c.name}: ${label} wrapping the own id, company ${VICTIM}'s id and a nowhere id is answered alike`, said(s.own) === said(s.foreign) && said(s.foreign) === said(s.nowhere), `own ${said(s.own)} | foreign ${said(s.foreign)} | nowhere ${said(s.nowhere)}`);
    }
    check(`${c.name}: nothing stored by the shaped requests`, c.before === c.after && !String(c.before).startsWith('ERR'), `${String(c.before).slice(0, 200)} -> ${String(c.after).slice(0, 200)}`);
    check(`${c.name}: no answer carries company ${VICTIM}'s id`, !c.all.some((a) => (a.res.text || '').includes(c.ctx.foreign)), c.all.filter((a) => (a.res.text || '').includes(c.ctx.foreign)).map((a) => a.label).join(', '));
  }

  // ── whole run ─────────────────────────────────────────────────────────────
  currentCase = 'whole run';
  const victimTraces = new RegExp([`CANARY-${VICTIM}-[A-Za-z0-9]`, `@c${VICTIM}\\.octapm-cert\\.test`, `\\(CERT-${VICTIM}\\)`, victimOrg, ...foreignIds].join('|'));
  const leaked = answers.filter((a) => victimTraces.test(a.text));
  check(`no answer to company ${ATTACKER} carries company ${VICTIM}'s ids, names, addresses or canaries`, leaked.length === 0, leaked.slice(0, 6).map((a) => `${a.status} ${a.route} -> ${(a.text.match(victimTraces) || [])[0]}`).join('\n        '));
  const mailed = emails.filter((text) => victimTraces.test(text));
  check(`no e-mail carries company ${VICTIM}'s traces (${emails.length} e-mails sent)`, mailed.length === 0, mailed.slice(0, 3).map((t) => t.slice(0, 200)).join('\n        '));
  const errors = answers.filter((a) => a.status >= 500);
  check('no answer is a server error', errors.length === 0, errors.slice(0, 8).map((a) => `${a.status} ${a.route} ${firstLine(a.text).slice(0, 160)}`).join('\n        '));
  if (FINGERPRINT) {
    const runEnd = await snapshot();
    const shapedMoved = fingerprint.compare(runStart, shapedEnd).filter((c) => !c.noise && c.org === ATTACKER);
    check(`company ${ATTACKER}'s data did not change in any table while the shaped requests were sent`, shapedMoved.length === 0, shapedMoved.slice(0, 10).map((c) => `${c.table} ${c.rowsBefore}->${c.rowsAfter}`).join(', '));
    const victimMoved = fingerprint.compare(runStart, runEnd).filter((c) => !c.noise && c.org === VICTIM);
    check(`company ${VICTIM}'s data did not change (every table, whole run)`, victimMoved.length === 0, victimMoved.slice(0, 8).map((c) => `${c.table} ${c.rowsBefore}->${c.rowsAfter}`).join(', '));
  }
  await db.end();

  const byCase = new Map();
  for (const r of results) {
    const entry = byCase.get(r.case) || { passed: 0, failed: 0 };
    entry[r.ok ? 'passed' : 'failed'] += 1;
    byCase.set(r.case, entry);
  }
  console.log('\nper case:');
  for (const [name, entry] of byCase) console.log(`  ${entry.failed ? 'FAIL' : 'ok  '}  ${name}: ${entry.passed} passed, ${entry.failed} failed`);
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${GROUP} proof: ${results.length - failed.length} passed, ${failed.length} failed of ${results.length}`);
  process.exitCode = failed.length ? 2 : 0;
  setTimeout(() => process.exit(process.exitCode), 300);
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
