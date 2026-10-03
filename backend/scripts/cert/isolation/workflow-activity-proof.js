'use strict';

/**
 * Certification CERT-2: a workflow record's primary activityId.
 *
 * On correspondence, defects, ITPs and material tests (create and update) and
 * on an RFI update, the activityId of the body names one of this project's
 * activities. Another company's activity is refused exactly as an id that
 * exists nowhere (the same status and code, no 500), and nothing is stored;
 * the project's own activity is accepted and stored. Sent beside activity
 * links (which name the primary), it is checked all the same.
 *
 *   $env:DATABASE_URL = $null; $env:CERT_INPROCESS = "1"; node scripts/cert/isolation/workflow-activity-proof.js
 *
 * Company 072, project 072-01, as its PM. Exit 0 when every check holds.
 */

const crypto = require('crypto');
const guard = require('../lib/cert-env');
const pv = require('../leads/lib/party-visibility');

const STAMP = `CERT2-WFACT-${Date.now().toString(36)}`;
let failed = 0;
let passed = 0;
const check = (name, ok, detail = '') => {
  if (ok) passed += 1;
  else failed += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};
const said = (res) => `${res.status} ${res.body?.error?.code || ''}`.trim();

const TOOLS = [
  { name: 'correspondence', path: 'correspondence', table: 'Correspondence', body: (tag) => ({ direction: 'incoming', type: 'letter', subject: `${STAMP}-${tag}` }) },
  { name: 'defect', path: 'defects', table: 'DefectRecord', body: (tag) => ({ title: `${STAMP}-${tag}` }) },
  { name: 'itp', path: 'itp', table: 'ItpRecord', body: (tag) => ({ title: `${STAMP}-${tag}` }) },
  { name: 'material test', path: 'material-tests', table: 'MaterialTest', body: (tag) => ({ testType: `${STAMP}-${tag}` }) },
  { name: 'rfi', path: 'rfi', table: 'Rfi', body: (tag) => ({ subject: `${STAMP}-${tag}`, question: 'Founding level against the borehole log?', priority: 'normal' }), updateOnly: true },
];

const main = async () => {
  const s = await pv.setup({ log: () => {}, need: [] });
  const P = s.projectId;
  const db = await guard.connectCert();
  const q = async (sql, params) => (await db.query(sql, params)).rows;
  try {
    const [{ orgId }] = await q('select "orgId" from "Project" where id = $1', [P]);
    const own = (await q('select id from "Activity" where "projectId" = $1 order by "createdAt", id limit 2', [P])).map((r) => r.id);
    const [{ id: foreign, orgId: foreignOrg }] = await q('select a.id, p."orgId" from "Activity" a join "Project" p on p.id = a."projectId" where p."orgId" <> $1 order by a."createdAt", a.id limit 1', [orgId]);
    check('setup: two activities of the project', own.length === 2, own.join(', '));
    check("setup: the foreign activity is another company's", Boolean(foreign) && foreignOrg !== orgId, `${foreign} (${foreignOrg})`);
    const nowhere = () => crypto.randomUUID();
    const storedActivity = async (table, id) => (id ? (await q(`select "activityId" as v from "${table}" where id = $1`, [id]))[0]?.v ?? null : null);
    const stampedRows = async (table) => {
      const column = table === 'Correspondence' || table === 'Rfi' ? 'subject' : table === 'MaterialTest' ? '"testType"' : 'title';
      return (await q(`select count(*)::int as n from "${table}" where "projectId" = $1 and ${column} like $2`, [P, `${STAMP}-REFUSED%`]))[0].n;
    };

    for (const tool of TOOLS) {
      const base = `/projects/${P}/${tool.path}`;
      const variants = [
        ['alone', (id) => ({ activityId: id })],
        ['beside activity links', (id) => ({ activityId: id, activityLinks: [{ activityId: own[1], relationType: 'impacted' }] })],
      ];
      // create
      if (!tool.updateOnly) {
        for (const [label, extra] of variants) {
          const bad = await s.pm.send('POST', base, { ...tool.body('REFUSED'), ...extra(foreign) });
          const none = await s.pm.send('POST', base, { ...tool.body('REFUSED'), ...extra(nowhere()) });
          check(`${tool.name} create, activityId ${label}: another company's activity is refused (4xx)`, bad.status >= 400 && bad.status < 500, said(bad));
          check(`${tool.name} create, activityId ${label}: …exactly as an id that exists nowhere`, said(bad) === said(none), `${said(bad)} | ${said(none)}`);
        }
        check(`${tool.name} create: no refused record was stored`, (await stampedRows(tool.table)) === 0);
      }
      // an own record to update
      const made = await s.pm.send('POST', base, { ...tool.body('OWN'), activityId: own[0] });
      const id = made.body?.data?.id;
      check(`${tool.name}: the project's own activity is accepted on create`, made.status === 201 || made.status === 200, said(made));
      check(`${tool.name}: …and stored`, (await storedActivity(tool.table, id)) === own[0]);
      if (!id) continue;
      // update
      for (const [label, extra] of variants) {
        const bad = await s.pm.send('PATCH', `${base}/${id}`, extra(foreign));
        const none = await s.pm.send('PATCH', `${base}/${id}`, extra(nowhere()));
        check(`${tool.name} update, activityId ${label}: another company's activity is refused (4xx)`, bad.status >= 400 && bad.status < 500, said(bad));
        check(`${tool.name} update, activityId ${label}: …exactly as an id that exists nowhere`, said(bad) === said(none), `${said(bad)} | ${said(none)}`);
        check(`${tool.name} update, activityId ${label}: the record still names its own activity`, (await storedActivity(tool.table, id)) === own[0]);
      }
      const ok = await s.pm.send('PATCH', `${base}/${id}`, { activityId: own[1] });
      check(`${tool.name}: the project's other activity is accepted on update`, ok.status === 200, said(ok));
      check(`${tool.name}: …and stored`, (await storedActivity(tool.table, id)) === own[1]);
    }
  } finally {
    await db.end();
  }
  console.log(`\nworkflow activity proof: ${passed} passed, ${failed} failed of ${passed + failed}`);
  process.exitCode = failed ? 2 : 0;
};

pv.main(main);
