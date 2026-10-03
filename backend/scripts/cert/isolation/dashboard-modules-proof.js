'use strict';

/**
 * Certification N3 (round-2 review): the workspace dashboard states a
 * project's queues only from the modules the caller may read on that project,
 * as each module's own routes decide it, and a member's tasks under the task
 * list's own rule.
 *
 *   $env:CERT_INPROCESS = "1"; node scripts/cert/isolation/dashboard-modules-proof.js
 *
 * Who: SUB-Y, a subcontractor-party guest of project 072-01 (refused change
 * orders, risks, safety, NCRs, inspections and procurement there), and the
 * 072 project manager (reads everything). What is "the victim's": every row
 * of those modules' tables on the 072 projects, from the certification id
 * index — an id or ref of one in SUB-Y's dashboard is a leak.
 *
 * Exit 0 when every refusal and every allowed case holds; 2 when a refusal
 * fails (a leak); 3 when only an allowed case fails.
 */

const path = require('path');
const fs = require('fs');
const pv = require('../leads/lib/party-visibility');

const WORK = process.env.CERT_WORK_DIR || 'C:/Temp/octapm-cert';
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

/** Module → the route that refuses SUB-Y, and the tables whose rows it guards. */
const FAMILIES = [
  { module: 'change_order', route: 'change-orders', types: ['change_order'] },
  { module: 'risk', route: 'risks', types: ['risk'] },
  { module: 'safety', route: 'safety', types: ['safety_incident'] },
  { module: 'ncr', route: 'ncr', types: ['ncr_record'] },
  // Inspections are not here: a subcontractor party reads them (GET /itp answers it 200).
  { module: 'procurement', route: 'procurement', types: ['procurement_order', 'procurement_package', 'procurement_po_line', 'activity_material', 'long_lead_item'] },
];

const results = [];
const check = (kind, name, ok, detail = '') => {
  results.push({ kind, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  [${kind}] ${name}${detail ? `  — ${detail}` : ''}`);
};

const main = async () => {
  const s = await pv.setup({ log: () => {}, need: ['subY'] });
  const P = s.projectId;
  const { index } = JSON.parse(fs.readFileSync(path.join(WORK, 'state', 'id-index.json'), 'utf8'));
  const rowsOf = (types, onlyProject = null) => Object.entries(index)
    .filter(([, [code, type, project]]) => code === pv.CODE && types.includes(type) && (!onlyProject || project === onlyProject))
    .map(([id]) => id.toLowerCase());

  const dashboard = async (who) => {
    const res = await who.send('GET', '/projects/workspace-dashboard');
    if (res.status !== 200) throw new Error(`workspace-dashboard -> ${res.status} ${JSON.stringify(res.body).slice(0, 200)}`);
    return { text: String(res.text || JSON.stringify(res.body)).toLowerCase(), ids: new Set((String(res.text || '').match(UUID) || []).map((id) => id.toLowerCase())) };
  };
  const guest = await dashboard(s.subY);
  const manager = await dashboard(s.pm);

  for (const family of FAMILIES) {
    const refused = (await s.subY.send('GET', `/projects/${P}/${family.route}`)).status;
    check('precondition', `SUB-Y is refused ${family.module} on 072-01 (GET /${family.route})`, refused === 403 || refused === 404, `got ${refused}`);
    const onProject = rowsOf(family.types, P);
    const leaked = onProject.filter((id) => guest.ids.has(id));
    check('refused', `SUB-Y's dashboard names none of 072-01's ${family.types.join('/')} rows (${onProject.length} indexed)`, leaked.length === 0, leaked.length ? `leaked ${leaked.slice(0, 3).join(', ')}` : '');
    const anyOf072 = rowsOf(family.types);
    const shown = anyOf072.filter((id) => manager.ids.has(id));
    // A family with no open item anywhere has nothing to show: say so instead of passing silently.
    if (anyOf072.length) check('allowed', `the PM's dashboard still names ${family.types[0]} rows of 072's projects`, shown.length > 0, `${shown.length} named`);
    else console.log(`NOTE  no ${family.types.join('/')} rows indexed for 072 — nothing to show`);
  }

  // Tasks: the task list's own rule — a member without project-wide task visibility sees only their own.
  const tasks = rowsOf(['task'], P);
  const leakedTasks = tasks.filter((id) => guest.ids.has(id));
  check('refused', `SUB-Y's dashboard names none of the 072-01 tasks of other people (${tasks.length} indexed)`, leakedTasks.length === 0, leakedTasks.length ? `leaked ${leakedTasks.slice(0, 3).join(', ')}` : '');
  check('allowed', "the PM's dashboard still names tasks of 072's projects", rowsOf(['task']).some((id) => manager.ids.has(id)));

  // The guest keeps the project itself: the dashboard is narrowed, not emptied.
  check('allowed', "SUB-Y's dashboard still carries project 072-01", guest.ids.has(P.toLowerCase()));

  const failedRefusals = results.filter((r) => !r.ok && (r.kind === 'refused' || r.kind === 'precondition')).length;
  const failedAllowed = results.filter((r) => !r.ok && r.kind === 'allowed').length;
  console.log(`\n${results.filter((r) => r.ok).length}/${results.length} hold (refusals failing: ${failedRefusals}, allowed failing: ${failedAllowed})`);
  process.exitCode = failedRefusals ? 2 : failedAllowed ? 3 : 0;
};

pv.main(main);
