'use strict';

/**
 * The foundation of a project: the company directory and cost codes (once per
 * company), then this project's activities, bill of quantities, allocations
 * and budget. Everything later hangs on an activity id, so this runs first.
 *
 * Sizes vary by project: a light project has a handful of activities and bill
 * rows, a standard one anything up to several dozen.
 */

const COST_CODES = [
  ['01-100', 'Site works', 'labour'],
  ['02-100', 'Concrete', 'material'],
  ['02-200', 'Reinforcement', 'material'],
  ['03-100', 'Blockwork', 'subcontract'],
  ['04-100', 'MEP first fix', 'subcontract'],
  ['05-100', 'Finishes', 'subcontract'],
  ['09-100', 'Preliminaries', 'other'],
];
const BUDGET_TYPE = { labour: 'labour', material: 'material', subcontract: 'subcontract', other: 'indirect' };

const DIRECTORY = [
  ['client', 'Property Group'],
  ['consultant', 'Consulting Engineers'],
  ['subcontractor', 'Concrete Works'],
  ['supplier', 'Steel & Cement Supply'],
];

const WBS = ['1 Substructure', '2 Superstructure', '3 Architectural & MEP', '4 External works'];
const WORKS = [
  ['Site clearance', 0, 'civil'], ['Bulk excavation', 0, 'civil'], ['Blinding concrete', 0, 'structural'], ['Foundation concrete', 0, 'structural'],
  ['Backfill and compaction', 0, 'civil'], ['Columns', 1, 'structural'], ['Beams', 1, 'structural'], ['Slab', 1, 'structural'],
  ['Shear walls', 1, 'structural'], ['MEP first fix', 2, 'mechanical'], ['Blockwork walls', 2, 'structural'], ['Internal plastering', 2, 'finishing'],
  ['Painting and decoration', 2, 'finishing'], ['Floor finishes', 2, 'finishing'], ['Ceilings', 2, 'finishing'], ['Joinery', 2, 'finishing'],
  ['Kerbs and paving', 3, 'civil'], ['Drainage', 3, 'civil'], ['Landscaping', 3, 'civil'], ['External lighting', 3, 'electrical'],
];
const BILL = [
  ['Bulk excavation to reduced level', 'm3', [800, 9000], [8, 22]],
  ['Foundation concrete C35', 'm3', [120, 1800], [110, 190]],
  ['High tensile reinforcement', 'ton', [10, 220], [900, 1500]],
  ['Blockwork walls 200mm', 'm2', [400, 6000], [30, 60]],
  ['Internal plaster two coats', 'm2', [500, 9000], [12, 26]],
  ['Formwork to columns', 'm2', [200, 3000], [25, 55]],
  ['Slab concrete C40', 'm3', [100, 2400], [120, 210]],
  ['Emulsion paint three coats', 'm2', [600, 12000], [4, 11]],
  ['Ceramic floor tiles', 'm2', [300, 5000], [28, 70]],
  ['Waterproofing membrane', 'm2', [200, 4000], [15, 40]],
];

const listOf = (data) => (Array.isArray(data) ? data : data?.items || data?.activities || data?.boqItems || []);

const run = async (ctx) => {
  const pm = ctx.who('pm');
  const planner = ctx.who('planner');
  const qs = ctx.who('qs');
  const cost = ctx.who('cost');
  const { P, rng, company } = ctx;

  // ── once per company: the directory and the cost-code master ─────────────
  ctx.companyRefs.directory = ctx.companyRefs.directory || {};
  for (const [kind, label] of DIRECTORY) {
    if (ctx.companyRefs.directory[kind]) continue;
    const created = await pm.POST('/companies', {
      name: `${company.canary} ${label}`,
      type: 'external',
      email: `${kind}@parties.c${company.code}.octapm-cert.test`,
      phone: '+1 555 0100',
      address: '1 Industrial Way',
      status: 'active',
    });
    ctx.companyRefs.directory[kind] = created.id;
    ctx.record('company', created.id, { scope: 'company' });
  }
  ctx.companyRefs.costCodes = ctx.companyRefs.costCodes || {};
  if (Object.keys(ctx.companyRefs.costCodes).length < COST_CODES.length) {
    const library = await pm.GET('/company/cost-codes?includeArchived=false');
    const existing = new Map(listOf(library).map((c) => [c.code, c]));
    for (const [code, name, category] of COST_CODES) {
      const row = existing.get(code) || (await pm.POST('/company/cost-codes', { code, name, category, status: 'active' }));
      ctx.companyRefs.costCodes[code] = row.id;
    }
    for (const id of Object.values(ctx.companyRefs.costCodes)) ctx.record('cost_code', id, { scope: 'company' });
  }
  await pm.PUT(`${P}/budget/cost-codes`, { costCodeIds: Object.values(ctx.companyRefs.costCodes) });

  // ── activities: a chain with a few branches ──────────────────────────────
  const already = listOf(await planner.GET(`${P}/activities`));
  ctx.refs.activities = Object.fromEntries(already.map((a) => [a.activityCode, a.id]));
  const wanted = ctx.count(5, 28);
  const codes = [];
  for (let i = 0; i < wanted; i += 1) {
    const [name, branch, category] = WORKS[i % WORKS.length];
    const level = Math.floor(i / WORKS.length) + 1;
    const code = `A${String(100 + i * 10)}`;
    codes.push(code);
    if (ctx.refs.activities[code]) continue;
    const payload = {
      name: level > 1 ? `${name} level ${level}` : name,
      activityCode: code,
      wbsCode: WBS[branch],
      category,
      duration: rng.int(3, 20),
      isMilestone: false,
      sortOrder: i,
      engineerIds: [ctx.userId('site')],
    };
    // Mostly a chain; every fifth activity hangs off an earlier one instead, so some carry float.
    if (i > 0) {
      const pred = i % 5 === 0 && i > 2 ? codes[i - 3] : codes[i - 1];
      payload.dependencies = [{ predecessorId: ctx.refs.activities[pred], relationshipType: 'FS', lagDays: i % 7 === 0 ? 2 : 0 }];
    }
    const created = await planner.POST(`${P}/activities`, payload);
    ctx.refs.activities[code] = created.id;
    ctx.record('activity', created.id);
  }

  // ── the bill ─────────────────────────────────────────────────────────────
  const bill = listOf(await qs.GET(`${P}/boq`));
  ctx.refs.boq = Object.fromEntries(bill.map((b) => [b.code, b.id]));
  ctx.refs.boqRows = ctx.refs.boqRows || {};
  const rows = ctx.count(4, 36);
  for (let i = 0; i < rows; i += 1) {
    const [description, unit, [qLow, qHigh], [rLow, rHigh]] = BILL[i % BILL.length];
    const code = `B-${String(i + 1).padStart(3, '0')}`;
    if (ctx.refs.boq[code]) continue;
    const quantity = rng.int(qLow, qHigh);
    const rate = rng.int(rLow, rHigh);
    const created = await qs.POST(`${P}/boq/items`, { code, description: `${description} — ${ctx.canary('boq')}`, quantity, unit, rate });
    const id = created.id ?? created.item?.id;
    ctx.refs.boq[code] = id;
    ctx.refs.boqRows[code] = { quantity, rate, unit };
    ctx.record('boq_item', id);
  }

  // ── allocations: most rows whole to one activity, some split, one in ten left out ──
  ctx.refs.allocations = ctx.refs.allocations || {};
  const activityCodes = Object.keys(ctx.refs.activities);
  const billCodes = Object.keys(ctx.refs.boqRows);
  for (const [i, code] of billCodes.entries()) {
    if (ctx.refs.allocations[code] || i % 10 === 9) continue;
    const row = ctx.refs.boqRows[code];
    const first = activityCodes[i % activityCodes.length];
    const split = i % 4 === 3 && activityCodes.length > 1;
    const parts = split
      ? [[first, Math.floor(row.quantity * 0.4)], [activityCodes[(i + 1) % activityCodes.length], row.quantity - Math.floor(row.quantity * 0.4)]]
      : [[first, row.quantity]];
    ctx.refs.allocations[code] = [];
    for (const [activityCode, quantity] of parts) {
      const allocation = await ctx.attempt(`allocation ${code}/${activityCode}`, () =>
        planner.POST(`${P}/activity-boq-allocations`, {
          boqItemId: ctx.refs.boq[code],
          activityId: ctx.refs.activities[activityCode],
          quantity,
          amount: quantity * row.rate,
          source: 'manual',
        })
      );
      const id = allocation?.id ?? allocation?.allocation?.id;
      if (!id) continue;
      ctx.refs.allocations[code].push({ id, activityCode, quantity });
      ctx.record('activity_boq_allocation', id);
    }
  }

  // ── the budget: one line per cost code ───────────────────────────────────
  const lines = listOf(await cost.GET(`${P}/budget/lines`));
  ctx.refs.budgetLines = {};
  for (const line of lines) {
    const code = Object.entries(ctx.companyRefs.costCodes).find(([, id]) => id === line.costCodeId)?.[0];
    if (code) ctx.refs.budgetLines[code] = line.id;
  }
  for (const [code, name, category] of COST_CODES) {
    if (ctx.refs.budgetLines[code]) continue;
    const line = await cost.POST(`${P}/budget/lines`, {
      costCodeId: ctx.companyRefs.costCodes[code],
      costType: BUDGET_TYPE[category],
      description: `${name} — ${ctx.canary('budget')}`,
      originalBudget: rng.int(40, 900) * 1000,
      status: 'active',
    });
    ctx.refs.budgetLines[code] = line.id;
    ctx.record('budget_line', line.id);
  }
};

module.exports = { name: 'foundation', depths: ['standard', 'light'], run };
