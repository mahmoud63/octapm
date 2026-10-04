'use strict';

/**
 * The live proof of CERT-2 round 3 "activity-link existence oracles and the
 * remaining route shapes".
 *
 *   CERT_INPROCESS=1 node scripts/cert/isolation/oracles-shapes-3-proof.js [attacker=073] [victim=074]
 *   CERT_INPROCESS=1 node scripts/cert/isolation/oracles-shapes-3-proof.js 073 074 --only="rfi|submittal" --no-fingerprint
 *
 * PART A — the activity a workflow record names. A record's row carries its
 * primary activity (the first activity link, or the body's activityId), and
 * the row was written before syncWorkflowReferences checked the links:
 * another company's activity passed the row's foreign key and was then
 * refused 400 by the links' check, while an activity that exists nowhere
 * failed the foreign key first — a 500 (P2003). The answer told whether an
 * id is another company's activity. For each record type (RFI, submittal,
 * correspondence, defect, ITP, material test, drawing, NCR, safety incident,
 * transmittal, punch item, risk), on create and on update, and for each place
 * an activity is named (activityId, activityIds[], activityLinks[].activityId)
 * the case sends the request naming company VICTIM's activity and one that
 * exists nowhere, then (the GATE) the same request naming the company's own
 * activity. Checks per case:
 *   ACCEPTING  the gate answers 2xx and the own activity is on the record (its
 *              row or its links) — the record accepts this request;
 *   REFUSED    the victim's activity is refused with a 4xx (counted only when
 *              gated), and for the ten workflow types with 400
 *              WORKFLOW_ACTIVITY_NOT_FOUND;
 *   ALIKE      the nowhere activity is answered exactly alike (status, code,
 *              message);
 *   NO 5XX     neither answers a 5xx;
 *   NOTHING    a create stored no record (by this case's title) and drew no
 *              reference number (the type's ReferenceCounter row did not
 *              move); an update left the record's row and activity links as
 *              they were; no row or link of the attacker's project names the
 *              victim's activity.
 *
 * PART B — the shapes reviewer's fields (and the workflow activity fields):
 * each identifier field sent as ["<id>"], [["<id>"]], {"id":"<id>"} for
 * <id> = own, the victim's and a nowhere id, and as 12345, true,
 * {"not":"x"}; then the gate (the own id as a plain string). As in
 * shape-ids-proof.js: the gate is accepted and stored, no shape answers a
 * 5xx, every shape is refused (gated), each id-carrying shape is answered
 * alike for own / victim's / nowhere, nothing is stored by the shaped
 * requests, no answer carries the victim's id. A bid package's sections[]
 * (section names, not identifiers) take [["x"]], [{"not":"x"}], [12345],
 * [true], [null]; its gate is the "(no section)" key [""] — which answered
 * 500 before.
 *
 * Whole run: the attacker company's data does not change in any table while
 * the refused requests are sent (fingerprint before and after that phase;
 * every gate comes after it); the victim company's data does not change at
 * all; no answer carries the victim's ids, people's addresses, company name or
 * canaries; no answer is a 5xx.
 *
 * Exit code 0 when every check holds, 2 otherwise. Re-runnable: every record
 * is fresh and carries this run's stamp.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { as } = require('../lib/api');
const guard = require('../lib/cert-env');
const fingerprint = require('./fingerprint');

const GROUP = 'oracles-shapes-3';
const positional = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const ATTACKER = positional[0] || '073';
const VICTIM = positional[1] || '074';
const ONLY = process.argv.find((a) => a.startsWith('--only='))?.slice(7) || null;
const FINGERPRINT = !process.argv.includes('--no-fingerprint');
const WORK = process.env.CERT_WORK_DIR || 'C:/Temp/octapm-cert';
const STAMP = `OS3-${ATTACKER}-${crypto.randomBytes(3).toString('hex')}`.toUpperCase();
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
  const A = standard(inventory(ATTACKER));
  const V = standard(inventory(VICTIM));
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

  // ── the ids the cases draw on ─────────────────────────────────────────────
  const own = {
    site: await userId('site', ATTACKER),
    activity: first(A.refs.activities),
    boqOpen: await val('select b.id from "BoqItem" b where b."projectId" = $1 and b."isActive" and b."supersededAt" is null and b.qty - coalesce((select sum(a.quantity) from "ActivityBoqAllocation" a where a."boqItemId" = b.id), 0) > 1 order by b."sortOrder", b.code limit 1', [A.id]),
    location: await val('select id from "Location" where "projectId" = $1 and "archivedAt" is null order by "sortOrder", id limit 1', [A.id]),
    location2: await val('select id from "Location" where "projectId" = $1 and "archivedAt" is null order by "sortOrder", id offset 1 limit 1', [A.id]),
    formTemplate: await val('select id from "FormTemplate" where "orgId" = $1 and status = \'active\' and type = \'inspection\' and ("projectId" is null or "projectId" = $2) order by "createdAt" limit 1', [attackerOrg, A.id]),
    procPackage: await val('select id from "ProcurementPackage" where "projectId" = $1 and status = \'planning\' order by "createdAt" limit 1', [A.id]),
  };
  const foreign = {
    activity: first(V.refs.activities),
    boq: await val('select id from "BoqItem" where "projectId" = $1 and "isActive" and "supersededAt" is null limit 1', [V.id]),
    costCode: await val('select id from "CostCode" where "orgId" = $1 order by code limit 1', [victimOrg]),
    location: await val('select l.id from "Location" l join "Project" p on p.id = l."projectId" where p."orgId" = $1 limit 1', [victimOrg]),
    procPackage: await val('select s.id from "ProcurementPackage" s join "Project" p on p.id = s."projectId" where p."orgId" = $1 limit 1', [victimOrg]),
    // No company of the population has a drawing sheet (they come only from
    // the drawing-set pipeline); the victim's "sheet" is then an id the
    // victim owns of another kind — a shape is refused before any lookup.
    sheet: (await val('select s.id from "Sheet" s join "Project" p on p.id = s."projectId" where p."orgId" = $1 limit 1', [victimOrg])) || (await val('select l.id from "Location" l join "Project" p on p.id = l."projectId" where p."orgId" = $1 limit 1', [victimOrg])),
  };
  for (const [key, id] of Object.entries(own)) check(`setup: company ${ATTACKER}'s ${key} is known`, Boolean(id), JSON.stringify(id));
  for (const [key, id] of Object.entries(foreign)) check(`setup: company ${VICTIM}'s ${key} is known`, Boolean(id));
  check(`setup: the victim's activity belongs to company ${VICTIM}'s project`, (await val('select p."orgId" from "Activity" a join "Project" p on p.id = a."projectId" where a.id = $1', [foreign.activity])) === victimOrg);
  const foreignIds = Object.values(foreign).filter(Boolean);

  const freshPackage = async (tag) => (await must('procurement', 'POST', `${AP}/procurement/packages`, { packageNumber: `PP-${stamp}-${tag}`, title: `${STAMP} ${tag} package`, status: 'planning' }, `procurement package ${tag}`)).id;
  const freshActivity = async (tag) => (await must('planner', 'POST', `${AP}/activities`, { name: `${STAMP} ${tag}`, duration: 3, engineerIds: [own.site] }, `activity ${tag}`)).id;
  const count = (sql, args) => async () => String(await val(sql, args));
  const rowState = (sql, args) => async () => JSON.stringify(await q(sql, args));

  // ── PART A: the activity a workflow record names ─────────────────────────
  const TYPES = [
    { key: 'rfi', role: 'site', route: '/rfi', table: 'Rfi', counter: 'Rfi|RFI', titleCol: 'subject', recordType: 'rfi', workflow: true, base: (t) => ({ subject: t, question: `${t}?`, priority: 'normal', status: 'open' }) },
    { key: 'submittal', role: 'site', route: '/submittals', table: 'Submittal', counter: 'Submittal|SUB', titleCol: 'title', recordType: 'submittal', workflow: true, base: (t) => ({ title: t }) },
    { key: 'correspondence', role: 'pm', route: '/correspondence', table: 'Correspondence', counter: 'Correspondence|COR', titleCol: 'subject', recordType: 'correspondence', workflow: true, base: (t) => ({ direction: 'outgoing', type: 'letter', subject: t, status: 'open' }) },
    { key: 'defect', role: 'quality', route: '/defects', table: 'DefectRecord', counter: 'DefectRecord|DEF', titleCol: 'title', recordType: 'defect', workflow: true, base: (t) => ({ title: t }) },
    { key: 'itp', role: 'quality', route: '/itp', table: 'ItpRecord', counter: 'ItpRecord|ITP', titleCol: 'title', recordType: 'itp', workflow: true, base: (t) => ({ title: t }) },
    { key: 'material-test', role: 'quality', route: '/material-tests', table: 'MaterialTest', counter: 'MaterialTest|MTEST', titleCol: 'testType', recordType: 'material_test', workflow: true, base: (t) => ({ testType: t }) },
    { key: 'drawing', role: 'pm', route: '/drawings', table: 'DrawingRecord', counter: 'DrawingRecord|DWG', titleCol: 'title', recordType: 'drawing', workflow: true, base: (t) => ({ drawingNumber: t, title: t }) },
    { key: 'ncr', role: 'quality', route: '/ncr', table: 'NcrRecord', counter: 'NcrRecord|NCR', titleCol: 'description', recordType: 'ncr', workflow: true, base: (t) => ({ description: t, severity: 'minor' }) },
    { key: 'safety', role: 'site', route: '/safety', table: 'SafetyIncident', counter: 'SafetyIncident|SAF', titleCol: 'title', recordType: 'safety_incident', workflow: true, base: (t) => ({ incidentType: 'near_miss', title: t }) },
    { key: 'transmittal', role: 'pm', route: '/transmittals', table: 'Transmittal', counter: 'Transmittal|TRM', titleCol: 'subject', recordType: 'transmittal', workflow: true, noRowActivity: true, base: (t) => ({ subject: t, sender: 'Site office', recipient: 'Engineer' }) },
    { key: 'punch', role: 'quality', route: '/punch', table: 'PunchItem', counter: null, titleCol: 'title', recordType: 'punch_item', workflow: false, base: (t) => ({ title: t }) },
    { key: 'risk', role: 'pm', route: '/risks', table: 'Risk', counter: 'Risk|RSK', titleCol: 'description', recordType: null, workflow: false, noRowActivity: true, base: (t) => ({ description: t }) },
  ];
  const FIELDS = [
    ['activityId', (id) => ({ activityId: id })],
    ['activityIds[]', (id) => ({ activityIds: [id] })],
    ['activityLinks[].activityId', (id) => ({ activityLinks: [{ activityId: id }] })],
  ];
  const linksOf = (type, recordId) => (type.recordType
    ? q('select "activityId", "relationType" from "WorkflowActivityLink" where "projectId" = $1 and "recordType" = $2 and "recordId" = $3 order by "activityId", "relationType"', [A.id, type.recordType, recordId])
    : q('select "activityId", "relationType" from "RiskActivityLink" where "projectId" = $1 and "riskId" = $2 order by "activityId", "relationType"', [A.id, recordId]));
  const rowOf = (type, recordId) => q(`select ${type.noRowActivity ? '' : '"activityId", '}"updatedAt"::text from "${type.table}" where id = $1`, [recordId]);
  const namesOwn = async (type, recordId, ownActivity) => {
    const row = type.noRowActivity ? null : await val(`select "activityId" from "${type.table}" where id = $1`, [recordId]);
    const links = await linksOf(type, recordId);
    return row === ownActivity || links.some((l) => l.activityId === ownActivity);
  };
  const counterOf = (type) => (type.counter ? val('select next from "ReferenceCounter" where scope = $1', [`projectId:${A.id}|${type.counter}`]) : Promise.resolve(null));

  const oracleCases = [];
  for (const type of TYPES) {
    for (const [field, wrap] of FIELDS) {
      for (const op of ['create', 'update']) {
        const name = `${op === 'create' ? 'POST' : 'PATCH'} ${type.key} ${field}`;
        if (ONLY && !new RegExp(ONLY).test(name)) continue;
        oracleCases.push({ name, type, field, wrap, op });
      }
    }
  }

  // ── PART B: the shapes reviewer's fields ──────────────────────────────────
  const cases = [];
  const add = (name, setup) => {
    if (!ONLY || new RegExp(ONLY).test(name)) cases.push({ name, setup });
  };
  add('POST forms sheetId', async () => {
    const title = `${STAMP} F-SHEET`;
    return {
      role: 'site', method: 'POST', route: `${AP}/forms`, own: nowhere(), foreign: foreign.sheet,
      body: (v) => ({ templateId: own.formTemplate, title, sheetId: v }),
      // No sheet exists in company ATTACKER: the gate sends no sheet at all.
      gateBody: () => ({ templateId: own.formTemplate, title, sheetId: null }),
      state: count('select count(*)::int n from "FormInstance" where "projectId" = $1 and title = $2', [A.id, title]),
      stored: async () => Number(await val('select count(*)::int n from "FormInstance" where "projectId" = $1 and title = $2', [A.id, title])) > 0,
    };
  });
  add('PATCH forms/{id} sheetId', async () => {
    const form = await must('site', 'POST', `${AP}/forms`, { templateId: own.formTemplate, title: `${STAMP} F-SHEET-P` }, 'form');
    const state = rowState('select "sheetId", title, "updatedAt"::text from "FormInstance" where id = $1', [form.id]);
    const title = `${STAMP} F-SHEET-P2`;
    return {
      role: 'site', method: 'PATCH', route: `${AP}/forms/${form.id}`, own: nowhere(), foreign: foreign.sheet,
      body: (v) => ({ title, sheetId: v }),
      gateBody: () => ({ title, sheetId: null }),
      state,
      stored: async () => (await state()).includes(title),
    };
  });
  add('POST activities/{a}/materials procurementPackageId', async () => {
    const activity = await freshActivity('MAT');
    const name = `${STAMP} MAT`;
    // A material on a package raises the package's lead-time alert, and a
    // package that already has one answers 409 (own state): a fresh package.
    const pkgId = await freshPackage('MAT');
    return {
      role: 'planner', method: 'POST', route: `${AP}/activities/${activity}/materials`, own: pkgId, foreign: foreign.procPackage,
      body: (v) => ({ name, unit: 'BAG', qty: 1, requiredTiming: 'activity_start', leadWeeks: 1, bufferDays: 1, procurementPackageId: v }),
      state: count('select count(*)::int n from "ActivityMaterial" where "activityId" = $1', [activity]),
      stored: async () => Number(await val('select count(*)::int n from "ActivityMaterial" where "activityId" = $1 and "procurementPackageId" = $2', [activity, pkgId])) > 0,
    };
  });
  add('PATCH activities/{a}/materials/{m} procurementPackageId', async () => {
    const activity = await freshActivity('MATP');
    const material = await must('planner', 'POST', `${AP}/activities/${activity}/materials`, { name: `${STAMP} MATP`, unit: 'BAG', qty: 1, requiredTiming: 'activity_start', leadWeeks: 1, bufferDays: 1 }, 'material');
    const pkgId = await freshPackage('MATP');
    const state = rowState('select "procurementPackageId", "updatedAt"::text from "ActivityMaterial" where id = $1', [material.id]);
    return {
      role: 'planner', method: 'PATCH', route: `${AP}/activities/${activity}/materials/${material.id}`, own: pkgId, foreign: foreign.procPackage,
      body: (v) => ({ procurementPackageId: v }), state,
      stored: async () => (await state()).includes(pkgId),
    };
  });
  add('PUT budget/cost-codes removeCostCodeIds[]', async () => {
    // A fresh code of the company's library, selected into the project: the
    // gate removes it (no budget line uses it).
    const code = await must('pm', 'POST', '/company/cost-codes', { code: `X${stamp.slice(-6)}`, name: `${STAMP} code`, category: 'other', status: 'active' }, 'cost code');
    await must('cost', 'PUT', `${AP}/budget/cost-codes`, { costCodeIds: [code.id] }, 'select the cost code');
    const state = rowState('select "costCodeId", status, "updatedAt"::text from "ProjectCostCode" where "projectId" = $1 order by "costCodeId"', [A.id]);
    return {
      role: 'cost', method: 'PUT', route: `${AP}/budget/cost-codes`, own: code.id, foreign: foreign.costCode,
      body: (v) => ({ removeCostCodeIds: [v] }), state,
      stored: async () => (await val('select status from "ProjectCostCode" where "projectId" = $1 and "costCodeId" = $2', [A.id, code.id])) === 'archived',
    };
  });
  add('POST activity-boq-allocations locationId', async () => {
    const activity = await freshActivity('AL-LOC');
    return {
      role: 'planner', method: 'POST', route: `${AP}/activity-boq-allocations`, own: own.location, foreign: foreign.location,
      body: (v) => ({ boqItemId: own.boqOpen, activityId: activity, quantity: 0.001, amount: 0.01, source: 'manual', locationId: v }),
      state: count('select count(*)::int n from "ActivityBoqAllocation" where "activityId" = $1', [activity]),
      stored: async () => Number(await val('select count(*)::int n from "ActivityBoqAllocation" where "activityId" = $1 and "locationId" = $2', [activity, own.location])) > 0,
    };
  });
  add('PATCH activity-boq-allocations/{id} locationId', async () => {
    const activity = await freshActivity('ALP-LOC');
    const created = await must('planner', 'POST', `${AP}/activity-boq-allocations`, { boqItemId: own.boqOpen, activityId: activity, quantity: 0.001, amount: 0.01, source: 'manual' }, 'allocation');
    const id = created?.id || created?.allocation?.id;
    const state = rowState('select "locationId", "updatedAt"::text from "ActivityBoqAllocation" where id = $1', [id]);
    return {
      role: 'planner', method: 'PATCH', route: `${AP}/activity-boq-allocations/${id}`, own: own.location2, foreign: foreign.location,
      body: (v) => ({ locationId: v }), state,
      stored: async () => (await state()).includes(own.location2),
    };
  });
  for (const field of ['boqItemId', 'activityId', 'locationId']) {
    add(`POST activity-boq-allocations/bulk allocations[].${field}`, async () => {
      const activity = await freshActivity(`ALB-${field}`);
      const ownId = { boqItemId: own.boqOpen, activityId: activity, locationId: own.location }[field];
      return {
        role: 'planner', method: 'POST', route: `${AP}/activity-boq-allocations/bulk`, own: ownId, foreign: { boqItemId: foreign.boq, activityId: foreign.activity, locationId: foreign.location }[field],
        body: (v) => ({ allocations: [{ boqItemId: own.boqOpen, activityId: activity, quantity: 0.001, amount: 0.01, locationId: own.location, [field]: v }] }),
        state: count('select count(*)::int n from "ActivityBoqAllocation" where "projectId" = $1', [A.id]),
        stored: async () => Number(await val('select count(*)::int n from "ActivityBoqAllocation" where "activityId" = $1 and "boqItemId" = $2 and "locationId" = $3', [activity, own.boqOpen, own.location])) > 0,
      };
    });
  }
  // The workflow records' own activity fields, as shapes.
  for (const [name, role, route, base, field, wrap] of [
    ['shape: POST rfi activityIds[]', 'site', '/rfi', (t) => ({ subject: t, question: `${t}?`, priority: 'normal', status: 'open' }), 'activityIds', (v) => ({ activityIds: [v] })],
    ['shape: POST correspondence activityLinks[].activityId', 'pm', '/correspondence', (t) => ({ direction: 'outgoing', type: 'letter', subject: t, status: 'open' }), 'activityLinks', (v) => ({ activityLinks: [{ activityId: v }] })],
    ['shape: POST ncr activityId', 'quality', '/ncr', (t) => ({ description: t, severity: 'minor' }), 'activityId', (v) => ({ activityId: v })],
  ]) {
    add(name, async () => {
      const title = `${STAMP} WS ${field}`;
      const table = { '/rfi': ['Rfi', 'subject'], '/correspondence': ['Correspondence', 'subject'], '/ncr': ['NcrRecord', 'description'] }[route];
      return {
        role, method: 'POST', route: `${AP}${route}`, own: own.activity, foreign: foreign.activity,
        body: (v) => ({ ...base(title), ...wrap(v) }),
        state: count(`select count(*)::int n from "${table[0]}" where "projectId" = $1 and "${table[1]}" = $2`, [A.id, title]),
        stored: async () => Number(await val(`select count(*)::int n from "${table[0]}" where "projectId" = $1 and "${table[1]}" = $2 and "activityId" = $3`, [A.id, title, own.activity])) > 0,
      };
    });
  }
  add('shape: PATCH submittals/{id} activityId', async () => {
    const submittal = await must('site', 'POST', `${AP}/submittals`, { title: `${STAMP} WS-SUB` }, 'submittal');
    const state = rowState('select "activityId", "updatedAt"::text from "Submittal" where id = $1', [submittal.id]);
    return {
      role: 'site', method: 'PATCH', route: `${AP}/submittals/${submittal.id}`, own: own.activity, foreign: foreign.activity,
      body: (v) => ({ activityId: v }), state,
      stored: async () => (await state()).includes(own.activity),
    };
  });
  const sectionsCase = !ONLY || new RegExp(ONLY).test('POST bids/{pkg}/lines/from-boq sections[]');

  // ── setup ─────────────────────────────────────────────────────────────────
  console.log(`\ncases: ${oracleCases.length} activity-link, ${cases.length} shape${sectionsCase ? ', bid sections' : ''}; attacker project ${A.id}, victim project ${V.id}\n`);
  for (const c of oracleCases) {
    currentCase = c.name;
    c.title = `${STAMP} ${c.type.key} ${c.field} ${c.op}`;
    try {
      if (c.op === 'update') {
        c.recordId = (await must(c.type.role, 'POST', `${AP}${c.type.route}`, c.type.base(`${c.title} record`), `${c.type.key} record`)).id;
        if (!c.recordId) throw new Error('no id in the created record');
      }
      c.ownActivity = c.type.key === 'risk' ? own.activity : await freshActivity(`${c.type.key}-${c.field}-${c.op}`.slice(0, 60));
    } catch (error) {
      c.setupError = error.message;
      check(`${c.name}: setup`, false, error.message.slice(0, 400));
    }
  }
  for (const c of cases) {
    currentCase = c.name;
    try {
      c.ctx = await c.setup();
    } catch (error) {
      c.setupError = error.message;
      check(`${c.name}: setup`, false, error.message.slice(0, 400));
    }
  }
  let pkg = null;
  if (sectionsCase) {
    currentCase = 'POST bids/{pkg}/lines/from-boq sections[]';
    try {
      pkg = await must('pm', 'POST', `${AP}/bids`, { title: `${STAMP} sections`, dueAt: future(21) }, 'draft bid package');
    } catch (error) {
      check('bid sections: setup', false, error.message.slice(0, 400));
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

  // Phase 2: every refused request, before any gate.
  const countersBefore = new Map();
  for (const type of TYPES) countersBefore.set(type.key, await counterOf(type));
  for (const c of oracleCases.filter((x) => !x.setupError)) {
    const send = actor(c.type.role);
    const method = c.op === 'create' ? 'POST' : 'PATCH';
    const route = c.op === 'create' ? `${AP}${c.type.route}` : `${AP}${c.type.route}/${c.recordId}`;
    const body = (id) => (c.op === 'create' ? { ...c.type.base(c.title), ...c.wrap(id) } : c.wrap(id));
    c.send = () => send(method, route, body(c.ownActivity));
    c.before = c.op === 'update' ? JSON.stringify([await rowOf(c.type, c.recordId), await linksOf(c.type, c.recordId)]) : null;
    c.foreignRes = await send(method, route, body(foreign.activity));
    c.nowhereRes = await send(method, route, body(nowhere()));
    c.after = c.op === 'update'
      ? JSON.stringify([await rowOf(c.type, c.recordId), await linksOf(c.type, c.recordId)])
      : String(await val(`select count(*)::int n from "${c.type.table}" where "projectId" = $1 and "${c.type.titleCol}" = $2`, [A.id, c.title]));
  }
  const countersAfter = new Map();
  for (const type of TYPES) countersAfter.set(type.key, await counterOf(type));
  for (const c of cases.filter((x) => x.ctx)) {
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
  const sections = { all: [] };
  if (pkg) {
    const linesOf = count('select count(*)::int n from "BidPackageLine" where "packageId" = $1', [pkg.id]);
    sections.linesOf = linesOf;
    sections.before = await linesOf();
    for (const [label, value] of [['[["x"]]', [['x']]], ['[{"not":"x"}]', [{ not: 'x' }]], ['[12345]', [12345]], ['[true]', [true]], ['[null]', [null]], ['[["<victim id>"]]', [[foreign.activity]]]]) {
      sections.all.push({ label, res: await actor('procurement')('POST', `${AP}/bids/${pkg.id}/lines/from-boq`, { sections: value }) });
    }
    sections.after = await linesOf();
  }
  const shapedEnd = FINGERPRINT ? await snapshot() : null;

  // Phase 3: the gates — the company's own activity / id as a plain string.
  for (const c of oracleCases.filter((x) => !x.setupError)) {
    c.gate = await c.send();
    if (ok2xx(c.gate)) {
      const recordId = c.op === 'update' ? c.recordId : c.gate.body?.data?.id;
      c.storedOwn = recordId ? await namesOwn(c.type, recordId, c.ownActivity).catch(() => false) : false;
    } else c.storedOwn = false;
  }
  for (const c of cases.filter((x) => x.ctx)) {
    c.gate = await actor(c.ctx.role)(c.ctx.method, c.ctx.route, c.ctx.gateBody ? c.ctx.gateBody() : c.ctx.body(c.ctx.own));
    c.storedOwn = ok2xx(c.gate) ? await c.ctx.stored().catch(() => false) : false;
  }
  if (pkg) {
    sections.gate = await actor('procurement')('POST', `${AP}/bids/${pkg.id}/lines/from-boq`, { sections: [''] });
    sections.storedOwn = ok2xx(sections.gate) && Number(await sections.linesOf()) > Number(sections.before);
  }

  // ── judging ───────────────────────────────────────────────────────────────
  for (const c of oracleCases.filter((x) => !x.setupError)) {
    currentCase = c.name;
    const gated = ok2xx(c.gate) && c.storedOwn;
    check(`${c.name}: the company's own activity is accepted (2xx) and named by the record — the record accepts this request`, gated, `${said(c.gate)} stored=${c.storedOwn} ${(c.gate.text || '').slice(0, 200)}`);
    check(`${c.name}: company ${VICTIM}'s activity is refused with a 4xx, on a record that accepts the own one`, gated && is4xx(c.foreignRes), `${gated ? '' : 'NOT GATED; '}${said(c.foreignRes)}`);
    if (c.type.workflow) check(`${c.name}: the refusal is 400 WORKFLOW_ACTIVITY_NOT_FOUND`, c.foreignRes.status === 400 && c.foreignRes.body?.error?.code === 'WORKFLOW_ACTIVITY_NOT_FOUND', said(c.foreignRes));
    check(`${c.name}: an activity that exists nowhere is answered exactly as company ${VICTIM}'s (status, code, message)`, said(c.foreignRes) === said(c.nowhereRes), `victim's ${said(c.foreignRes)} | nowhere ${said(c.nowhereRes)}`);
    check(`${c.name}: neither answers a 5xx`, c.foreignRes.status < 500 && c.nowhereRes.status < 500, `victim's ${said(c.foreignRes)} | nowhere ${said(c.nowhereRes)}`);
    if (c.op === 'create') check(`${c.name}: the refused requests stored no record`, c.after === '0', `records with this case's title: ${c.after}`);
    else check(`${c.name}: the refused requests left the record's row and activity links as they were`, c.before === c.after, `${String(c.before).slice(0, 300)} -> ${String(c.after).slice(0, 300)}`);
    check(`${c.name}: no answer carries company ${VICTIM}'s activity id`, ![c.foreignRes, c.nowhereRes].some((r) => (r.text || '').includes(foreign.activity)));
  }
  for (const type of TYPES) {
    if (!type.counter || !oracleCases.some((c) => c.type === type && c.op === 'create' && !c.setupError)) continue;
    currentCase = `${type.key} reference numbers`;
    check(`${type.key}: the refused creates drew no reference number (ReferenceCounter ${type.counter} unmoved)`, String(countersBefore.get(type.key)) === String(countersAfter.get(type.key)), `${countersBefore.get(type.key)} -> ${countersAfter.get(type.key)}`);
  }
  if (oracleCases.length) {
    currentCase = 'activity links';
    const named = await q(`select 'WorkflowActivityLink' t, count(*)::int n from "WorkflowActivityLink" where "projectId" = $1 and "activityId" = $2
      union all select 'RiskActivityLink', count(*)::int from "RiskActivityLink" where "projectId" = $1 and "activityId" = $2
      ${TYPES.filter((t) => !t.noRowActivity).map((t) => `union all select '${t.table}', count(*)::int from "${t.table}" where "projectId" = $1 and "activityId" = $2`).join('\n      ')}`, [A.id, foreign.activity]);
    const naming = named.filter((r) => r.n > 0);
    check(`no record or activity link of company ${ATTACKER}'s project names company ${VICTIM}'s activity`, naming.length === 0, naming.map((r) => `${r.t}: ${r.n}`).join(', '));
  }

  for (const c of cases.filter((x) => x.ctx)) {
    currentCase = c.name;
    const gated = ok2xx(c.gate) && c.storedOwn;
    check(`${c.name}: the ${c.ctx.gateBody ? 'same request without the field' : "company's own id as a plain string"} is accepted (2xx) and stored — the record accepts this request`, gated, `${said(c.gate)} stored=${c.storedOwn} ${(c.gate.text || '').slice(0, 200)}`);
    const errors = c.all.filter((a) => a.res.status >= 500);
    check(`${c.name}: no wrongly shaped value answers a 5xx`, errors.length === 0, errors.map((a) => `${a.label} -> ${said(a.res)}`).join(' | ').slice(0, 600));
    const notRefused = c.all.filter((a) => !is4xx(a.res));
    check(`${c.name}: every wrongly shaped value is refused with a 4xx, on a record that accepts the request`, gated && notRefused.length === 0, `${gated ? '' : 'NOT GATED; '}${notRefused.map((a) => `${a.label} -> ${said(a.res)}`).join(' | ').slice(0, 600)}`);
    for (const [label] of ID_SHAPES) {
      const s = c.byShape[label];
      check(`${c.name}: ${label} wrapping the own id, company ${VICTIM}'s id and a nowhere id is answered alike`, said(s.own) === said(s.foreign) && said(s.foreign) === said(s.nowhere), `own ${said(s.own)} | foreign ${said(s.foreign)} | nowhere ${said(s.nowhere)}`);
    }
    check(`${c.name}: nothing stored by the shaped requests`, c.before === c.after && !String(c.before).startsWith('ERR'), `${String(c.before).slice(0, 200)} -> ${String(c.after).slice(0, 200)}`);
    check(`${c.name}: no answer carries company ${VICTIM}'s id`, !c.all.some((a) => (a.res.text || '').includes(c.ctx.foreign)), c.all.filter((a) => (a.res.text || '').includes(c.ctx.foreign)).map((a) => a.label).join(', '));
  }
  if (pkg) {
    currentCase = 'POST bids/{pkg}/lines/from-boq sections[]';
    const gated = ok2xx(sections.gate) && sections.storedOwn;
    check('bid sections: the "(no section)" key [""] is accepted (2xx) and adds the unsectioned BOQ lines (it answered 500)', gated, `${said(sections.gate)} lines ${sections.before} -> ${await sections.linesOf()}`);
    const errors = sections.all.filter((a) => a.res.status >= 500);
    check('bid sections: no element in another shape answers a 5xx', errors.length === 0, errors.map((a) => `${a.label} -> ${said(a.res)}`).join(' | '));
    const notRefused = sections.all.filter((a) => !(a.res.status === 400 && a.res.body?.error?.code === 'VALIDATION_ERROR'));
    check('bid sections: every element in another shape is refused 400 VALIDATION_ERROR, on a package that accepts sections', gated && notRefused.length === 0, `${gated ? '' : 'NOT GATED; '}${notRefused.map((a) => `${a.label} -> ${said(a.res)}`).join(' | ')}`);
    check('bid sections: the refused requests added no line', sections.before === sections.after, `${sections.before} -> ${sections.after}`);
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
    check(`company ${ATTACKER}'s data did not change in any table while the refused requests were sent`, shapedMoved.length === 0, shapedMoved.slice(0, 10).map((c) => `${c.table} ${c.rowsBefore}->${c.rowsAfter}`).join(', '));
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
