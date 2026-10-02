'use strict';

/**
 * L34 — official actual cost (AC) to a cutoff is all-or-nothing per activity.
 *
 * The lead: the EV engine takes a cost record's WHOLE current actual when the
 * record's actualThroughDate is on or before the cutoff, and nothing when it
 * is after. So one posting dated after the cutoff removes the activity's whole
 * cost from AC — including cost incurred before the cutoff.
 *
 * The paper answer: AC to a cutoff = the sum of the cost-ledger entries dated
 * on or before it. The script reads that sum from the product's own ledger
 * (GET /cost/reconciliation/explain) and compares every read model with it.
 *
 * A new project in company 041, two activities, each 50% complete (approved):
 *   A — budget 10,000.00, cost on both sides of the cutoff (the case);
 *   B — budget  4,000.00, cost before the cutoff only (the control).
 *
 *   1. A 6,000.00 dated T-22, B 2,000.00 dated T-20      AC to T-2 = 8,000.00
 *   2. A   500.00 dated T-1 (after the cutoff T-2)        AC to T-2 = 8,000.00 still; AC to T = 8,500.00
 *   3. A    10.00 dated T+30 (an invoice dated ahead)     AC to T   = 8,500.00 still
 *      EV 7,000.00, so CPI = 0.8235 (below the 0.9 alert) and EAC = 17,000.00
 *      — every read model is read here
 *   4. the invoice dated ahead is voided, then POST /cost/reconciliation/recompute
 *                                                         AC to T   = 8,500.00
 *   5. a reporting period with cutoff T-2 is created and locked
 *                                                         stored AC = 8,000.00
 *
 * Exit code 0 = AC to the cutoff equals the ledger's sum to the cutoff at
 * every step; 2 = it does not.
 */

const { call, must, who, personOf, newProject, projectCostCodes, section, say, dayOffset, today, eq, listOf, verdict, run } = require('./_finance-lib');

const LEAD = 'L34';
const COMPANY = '041';
const money = (value) => (value === null || value === undefined ? String(value) : Number(value).toFixed(2));

const T = today();
const D_A1 = dayOffset(-22);
const D_B1 = dayOffset(-20);
const CUTOFF = dayOffset(-2);
const D_A2 = dayOffset(-1);
const D_FUTURE = dayOffset(30);

run(LEAD, async () => {
  const pm = who(COMPANY, 'pm');
  const cost = who(COMPANY, 'cost');
  const finance = who(COMPANY, 'finance');
  const site = who(COMPANY, 'site');

  section('0. a project of its own: two activities, a bill, approved allocations and approved progress');
  const { id: projectId, P } = await newProject(COMPANY, 'L34 AC cutoff', { team: ['cost', 'finance', 'site', 'planner', 'qs'] });
  const codes = await projectCostCodes(COMPANY, P);
  const costCodeId = codes['09-100'] || Object.values(codes)[0];
  const line = await must(pm, 'POST', `${P}/budget/lines`, { costCodeId, costType: 'indirect', description: 'L34 preliminaries', originalBudget: 50000, status: 'active' }, { show: (d) => ({ id: d.id, costType: d.costType, originalBudget: d.originalBudget }) });

  const activity = {};
  for (const [key, name, budgetQty] of [['A', 'L34 activity A (cost on both sides of the cutoff)', 100], ['B', 'L34 activity B (cost before the cutoff only)', 40]]) {
    const row = await must(pm, 'POST', `${P}/activities`, { name, activityCode: `L34-${key}`, duration: 20, startDate: dayOffset(-60), endDate: dayOffset(-30), engineerIds: [personOf(COMPANY, 'site').id] }, { show: (d) => ({ id: d.id, activityCode: d.activityCode }) });
    activity[key] = row.id;
    const boq = await must(pm, 'POST', `${P}/boq/items`, { code: `L34-B-${key}`, description: `Work for ${key}`, quantity: budgetQty, unit: 'm3', rate: 100 }, { quiet: true });
    const boqItemId = boq.id ?? boq.item?.id;
    const allocation = await must(pm, 'POST', `${P}/activity-boq-allocations`, { boqItemId, activityId: row.id, quantity: budgetQty, amount: budgetQty * 100, source: 'manual' }, { quiet: true });
    const allocationId = allocation.id ?? allocation.allocation?.id;
    await must(pm, 'POST', `${P}/activity-boq-allocations/${allocationId}/submit`, {}, { quiet: true });
    await must(pm, 'POST', `${P}/activity-boq-allocations/${allocationId}/approve`, {}, { quiet: true });
    const claim = await must(site, 'POST', `${P}/activities/${row.id}/progress`, { pctComplete: 50, progressMethod: 'percent', status: 'submitted', source: 'manual' }, { quiet: true });
    await must(pm, 'POST', `${P}/activities/${row.id}/progress-submissions/${claim.submission.id}/approve`, {}, { quiet: true });
    say(`   ${key}: budget ${money(budgetQty * 100)} (approved allocation), 50% approved progress`);
  }

  // ── helpers ──────────────────────────────────────────────────────────────
  const directCost = async (key, amount, costDate, label) => {
    const created = await must(
      cost,
      'POST',
      `${P}/direct-costs`,
      { type: 'expense', description: label, vendorName: 'L34 payee', costDate, lines: [{ description: label, costCodeId, budgetLineId: line.id, activityId: activity[key], costType: 'indirect', quantity: 1, unit: 'ls', unitCost: amount, amount }] },
      { show: (d) => ({ id: d.id, ref: d.ref, status: d.status, costDate: d.costDate, total: d.total }) }
    );
    await must(cost, 'POST', `${P}/direct-costs/${created.id}/submit`, {}, { quiet: true });
    await must(finance, 'POST', `${P}/direct-costs/${created.id}/approve`, {}, { show: (d) => ({ status: d.status, posted: (d.lines || []).map((l) => l.postedAmount) }) });
    return created;
  };

  /** The paper answer, from the product's own ledger: Σ entries dated on or before the cutoff. */
  const ledgerTo = async (cutoff, { quiet = true } = {}) => {
    let total = 0;
    const perActivity = {};
    for (const [key, id] of Object.entries(activity)) {
      const data = await must(cost, 'GET', `${P}/cost/reconciliation/explain?activityId=${id}&limit=500`, undefined, { quiet: true });
      const entries = listOf(data, 'entries');
      const upTo = entries.filter((e) => String(e.incurredOn).slice(0, 10) <= cutoff);
      perActivity[key] = Math.round(upTo.reduce((sum, e) => sum + Number(e.amount), 0) * 100) / 100;
      total += perActivity[key];
      if (!quiet) say(`   ledger of ${key} (GET /cost/reconciliation/explain): ${entries.map((e) => `${String(e.incurredOn).slice(0, 10)} ${money(e.amount)}`).join(' | ') || '(none)'}`);
    }
    return { total: Math.round(total * 100) / 100, perActivity };
  };

  const evAt = async (query, label) => {
    const report = await must(cost, 'GET', `${P}/reports/ev${query}`, undefined, {
      show: (d) => ({
        ac: d.ac,
        ev: d.ev,
        cpi: d.cpi,
        eac: d.eac,
        totalBudget: d.totalBudget,
        cpiAlert: d.alerts?.cpiAlert,
        cutoff: d.reporting?.cutoffLocalDate,
        isSnapshot: d.reporting?.isSnapshot,
        byActivity: (d.activityBreakdown || []).map((r) => `${r.activityId}: ac ${money(r.ac)} (${r.actualCostSource}${r.officialActualThroughDate ? `, through ${String(r.officialActualThroughDate).slice(0, 10)}` : ''})`),
      }),
      max: 900,
    });
    return { label, ac: report.ac, ev: report.ev, cpi: report.cpi, eac: report.eac, bac: report.totalBudget, cpiAlert: report.alerts?.cpiAlert, report };
  };

  const checks = [];
  const check = (name, expected, actual) => {
    const ok = eq(expected, actual);
    checks.push({ name, expected, actual, ok });
    say(`   ${ok ? 'ok      ' : 'WRONG   '} ${name}: paper ${money(expected)}, product ${money(actual)}`);
    return ok;
  };

  // ── 1 ────────────────────────────────────────────────────────────────────
  section(`1. cost before the cutoff: A 6,000.00 dated ${D_A1}, B 2,000.00 dated ${D_B1}`);
  await directCost('A', 6000, D_A1, 'L34 A first invoice');
  await directCost('B', 2000, D_B1, 'L34 B invoice');
  const paper1 = await ledgerTo(CUTOFF, { quiet: false });
  const ev1 = await evAt(`?cutoffDate=${CUTOFF}`, 'step 1');
  check(`AC to ${CUTOFF} before any later posting`, paper1.total, ev1.ac);

  // ── 2 ────────────────────────────────────────────────────────────────────
  section(`2. THE CASE — a second cost on A, 500.00 dated ${D_A2}, after the cutoff ${CUTOFF}`);
  await directCost('A', 500, D_A2, 'L34 A second invoice');
  const paper2 = await ledgerTo(CUTOFF, { quiet: false });
  say(`   paper AC to ${CUTOFF}: A ${money(paper2.perActivity.A)} + B ${money(paper2.perActivity.B)} = ${money(paper2.total)}`);
  const ev2 = await evAt(`?cutoffDate=${CUTOFF}`, 'step 2');
  const minimal = check(`AC to ${CUTOFF} after a posting dated ${D_A2}`, paper2.total, ev2.ac);
  const paper2T = await ledgerTo(T);
  const ev2T = await evAt(`?cutoffDate=${T}`, 'step 2, today');
  check(`AC to ${T} (every posting is on or before it)`, paper2T.total, ev2T.ac);

  // ── 3 ────────────────────────────────────────────────────────────────────
  section(`3. a cost on A dated ahead: 10.00 dated ${D_FUTURE} — and every read model, read today`);
  const future = await directCost('A', 10, D_FUTURE, 'L34 A invoice dated ahead');
  const paper3 = await ledgerTo(T, { quiet: false });
  const ledgerAll = await ledgerTo('9999-12-31');
  say(`   paper AC to ${T}: ${money(paper3.total)} (all cost recognised so far, whatever its date: ${money(ledgerAll.total)})`);

  const ev3 = await evAt(`?cutoffDate=${T}`, 'step 3, cutoffDate=today');
  const future3 = check(`EV report ?cutoffDate=${T}: AC`, paper3.total, ev3.ac);
  const paperCpi = paper3.total ? Math.round((ev3.ev / paper3.total) * 10000) / 10000 : null;
  const paperEac = ev3.ev ? Math.round(((ev3.bac * paper3.total) / ev3.ev) * 100) / 100 : null;
  say(`   paper:   CPI = EV ${money(ev3.ev)} / AC ${money(paper3.total)} = ${paperCpi} (${paperCpi !== null && paperCpi < 0.9 ? 'below 0.9: the CPI alert is due' : 'no alert'}); EAC = BAC ${money(ev3.bac)} / CPI = ${money(paperEac)}`);
  say(`   product: CPI ${ev3.cpi}, cpiAlert ${ev3.cpiAlert}, EAC ${money(ev3.eac)} — against ${money(ledgerAll.total)} already spent`);

  const evDefault = await evAt('', 'step 3, default report');
  check('EV report (default period): AC', paper3.total, evDefault.ac);

  const readModels = [];
  const model = (name, value, expected, kind) => {
    const ok = eq(expected, value);
    readModels.push({ name, value, expected, ok, kind });
    say(`   ${ok ? 'ok      ' : 'WRONG   '} ${name}: ${money(value)} (paper ${money(expected)}; ${kind})`);
  };
  model('GET /reports/ev (default) ac', evDefault.ac, paper3.total, 'AC to date');
  model(`GET /reports/ev?cutoffDate=${T} ac`, ev3.ac, paper3.total, 'AC to date');

  const health = await call(cost, 'GET', `${P}/health`, undefined, { quiet: true });
  if (health.ok) {
    const dimension = (health.data.dimensions || []).find((row) => row.key === 'cost') || {};
    say(`→ ${cost.email}  GET ${P}/health\n← 200  overallScore ${health.data.overallScore}; cost dimension: ${JSON.stringify({ score: dimension.score, cpi: dimension.detail?.cpi, ac: dimension.detail?.ac, eac: dimension.detail?.eac, scoreBasis: dimension.detail?.scoreBasis }).slice(0, 400)}`);
    model('GET /health (project dashboard) cost dimension ac', dimension.detail?.ac, paper3.total, 'AC to date');
  } else say(`   GET /health -> ${health.status} ${health.error?.code}`);

  const forecast = await call(pm, 'GET', `${P}/forecast`, undefined, { quiet: true });
  if (forecast.ok) {
    const c = forecast.data.cost || {};
    say(`→ ${pm.email}  GET ${P}/forecast\n← 200  cost: ${JSON.stringify({ actual: c.actual, bac: c.bac, eac: c.eac, cpi: c.cpi, bottomUp: c.bottomUp, projected: c.projected, overrun: c.overrun }).slice(0, 500)}`);
    model('GET /forecast cost.actual (the official AC)', c.actual, paper3.total, 'AC to date');
  } else say(`   GET /forecast -> ${forecast.status} ${forecast.error?.code}`);

  const workspace = await call(pm, 'GET', '/projects/workspace-dashboard', undefined, { quiet: true });
  if (workspace.ok) {
    const row = listOf(workspace.data, 'projectHealth').find((r) => r.id === projectId) || null;
    say(`→ ${pm.email}  GET /projects/workspace-dashboard\n← 200  this project's row: ${JSON.stringify(row && { overallScore: row.overallScore, costScore: row.dimensions?.cost, cpi: row.cpi, ev: row.ev, ac: row.ac, eac: row.eac, bac: row.bac })}`);
    if (row) model('GET /projects/workspace-dashboard project ac', row.ac, paper3.total, 'AC to date');
    else say(`   (the workspace dashboard lists only the six projects most at risk — ${listOf(workspace.data, 'projectHealth').length} rows here — and with a cost score of 100 this project is not among them; it reads the same EV report)`);
  } else say(`   GET /projects/workspace-dashboard -> ${workspace.status} ${workspace.error?.code}`);

  const summary = await must(cost, 'GET', `${P}/cost/summary`, undefined, { show: (d) => ({ totals: d.totals }) });
  model('GET /cost/summary totals.actual', summary.totals?.actual, ledgerAll.total, 'all recognised cost, no cutoff');
  const register = await must(cost, 'GET', `${P}/budget/lines`, undefined, { show: (d) => ({ totals: d.summary?.totals }) });
  model('GET /budget/lines summary.totals.actual', register.summary?.totals?.actual, ledgerAll.total, 'all recognised cost, no cutoff');
  const recon = await must(cost, 'GET', `${P}/cost/reconciliation`, undefined, {
    show: (d) => ({ balanced: d.balanced, ledgerTotal: d.ledger?.total, activityRecorded: d.activity?.recordedTotal, activityDerived: d.activity?.derivedTotal, activityVariances: d.activity?.variances }),
    max: 900,
  });
  model('GET /cost/reconciliation ledger.total', recon.ledger?.total, ledgerAll.total, 'all recognised cost, no cutoff');
  model('GET /cost/reconciliation activity.recordedTotal', recon.activity?.recordedTotal, ledgerAll.total, 'all recognised cost, no cutoff');
  say(`   reconciliation says balanced: ${recon.balanced} — it has no figure "to a cutoff", so it does not see the AC gap`);
  const records = listOf(await must(cost, 'GET', `${P}/cost`, undefined, { quiet: true }), 'rows', 'records');
  const recordA = records.find((r) => r.activityId === activity.A);
  say(`   cost records (GET /cost): ${records.map((r) => `${r.activity?.activityCode ?? r.activityCode ?? r.activityId}: actual ${money(r.actual)}, actualThroughDate ${String(r.actualThroughDate?.value ?? r.actualThroughDate).slice(0, 10)}`).join(' | ')}`);

  // ── 4 ────────────────────────────────────────────────────────────────────
  section('4. the invoice dated ahead is voided; then the recompute instrument is run');
  await must(finance, 'POST', `${P}/direct-costs/${future.id}/void`, { reason: 'L34: dated ahead by mistake' }, { show: (d) => ({ status: d.status }) });
  const paper4 = await ledgerTo(T, { quiet: false });
  const ev4 = await evAt(`?cutoffDate=${T}`, 'step 4, after the void');
  const afterVoid = check(`AC to ${T} after the invoice dated ahead was voided`, paper4.total, ev4.ac);
  const recompute = await call(pm, 'POST', `${P}/cost/reconciliation/recompute`, {}, { max: 500 });
  const ev4b = await evAt(`?cutoffDate=${T}`, 'step 4, after recompute');
  const afterRecompute = check(`AC to ${T} after POST /cost/reconciliation/recompute (${recompute.status})`, paper4.total, ev4b.ac);

  // The only way back the product offers: a cost editor types the record's through-date by hand.
  let typedRepair = null;
  if (recordA && !afterRecompute) {
    say('   the one way back: typing the cost record\'s actualThroughDate by hand (PATCH /cost/:id)');
    const typed = await call(cost, 'PATCH', `${P}/cost/${recordA.id}`, { actualThroughDate: D_A2 }, { show: (d) => ({ actual: d.actual, actualThroughDate: d.actualThroughDate }) });
    const ev4c = await evAt(`?cutoffDate=${T}`, 'step 4, after the typed date');
    typedRepair = typed.ok && eq(paper4.total, ev4c.ac);
    say(`   ${typedRepair ? 'AC to today is right again' : 'AC to today is still wrong'} after the typed date (not counted as a check: it is a manual repair, and the cutoff ${CUTOFF} stays wrong)`);
  }

  // ── 5 ────────────────────────────────────────────────────────────────────
  section(`5. a reporting period with cutoff ${CUTOFF}, locked now (the month-end sequence)`);
  const paper5 = await ledgerTo(CUTOFF);
  const period = await must(pm, 'POST', `${P}/reports/periods`, { code: `L34-${CUTOFF}`, label: `L34 period to ${CUTOFF}`, periodStart: dayOffset(-32), periodEnd: CUTOFF, cutoffDate: CUTOFF }, { show: (d) => ({ id: d.id, code: d.code, status: d.status, cutoffDate: d.cutoffDate }) });
  const showLock = (d) => ({ ac: d.ac, ev: d.ev, cpi: d.cpi, eac: d.eac, isSnapshot: d.reporting?.isSnapshot, status: d.reporting?.period?.status });
  let locked = await call(pm, 'POST', `${P}/reports/periods/${period.id}/lock`, {}, { show: showLock, max: 260 });
  if (!locked.ok) {
    // The readiness gate (no cost loading on this small project) is not what is being tested: the PM overrides it, as the product allows.
    locked = await call(pm, 'POST', `${P}/reports/periods/${period.id}/lock`, { overrideReason: 'L34 certification reproduction: the readiness gate is not what is being tested' }, { show: showLock });
  }
  let lockedOk = null;
  if (locked.ok) {
    lockedOk = check(`AC stored by the lock of the period to ${CUTOFF}`, paper5.total, locked.data.ac);
    const again = await evAt(`?periodId=${period.id}`, 'step 5, the locked period read back');
    check('AC of the locked period, read back', paper5.total, again.ac);
    const nowDefault = await evAt('', 'step 5, the default report after the lock');
    say(`   the default report is now ${nowDefault.report.reporting?.isSnapshot ? 'the locked snapshot' : 'a live calculation'} with AC ${money(nowDefault.ac)}; the product has no unlock`);
    const health2 = await call(cost, 'GET', `${P}/health`, undefined, { quiet: true });
    const dimension2 = (health2.data?.dimensions || []).find((row) => row.key === 'cost') || {};
    say(`   GET /health after the lock: cost dimension ac ${money(dimension2.detail?.ac)}, cutoff ${String(dimension2.cutoffDate).slice(0, 10)} (the locked snapshot)`);
    model('GET /health after the lock (the locked period) ac', dimension2.detail?.ac, paper5.total, `AC to ${CUTOFF}`);
    const workspace2 = await call(pm, 'GET', '/projects/workspace-dashboard', undefined, { quiet: true });
    const row2 = listOf(workspace2.data, 'projectHealth').find((r) => r.id === projectId) || null;
    say(`→ ${pm.email}  GET /projects/workspace-dashboard\n← ${workspace2.status}  this project's row: ${JSON.stringify(row2 && { overallScore: row2.overallScore, costScore: row2.dimensions?.cost, cpi: row2.cpi, ev: row2.ev, ac: row2.ac, eac: row2.eac, bac: row2.bac })}`);
    if (row2) model('GET /projects/workspace-dashboard after the lock: project ac', row2.ac, paper5.total, `AC to ${CUTOFF}`);
  } else say('   the period could not be locked; the stored figure was not observed');

  // ── 6 ────────────────────────────────────────────────────────────────────
  section('6. one person, no approval: a site engineer issues one unit of stock to B, dated 2099-01-01');
  const store = who(COMPANY, 'warehouse');
  const tag = `L34-${Date.now().toString(36).toUpperCase()}`;
  const warehouse = await must(store, 'POST', '/inventory/warehouses', { code: tag, name: `${tag} store`, kind: 'site', projectId }, { show: (d) => ({ id: d.id, code: d.code }) });
  const item = await must(store, 'POST', '/inventory/items', { sku: tag, name: `${tag} sundries`, unit: 'pc', category: 'material', projectId }, { show: (d) => ({ id: d.id, sku: d.sku }) });
  await must(store, 'POST', '/inventory/stock/receive', { itemId: item.id, warehouseId: warehouse.id, quantity: 10, unitCost: 1 }, { show: (d) => ({ movements: (d.movements || [d]).length }) });
  const before6 = await evAt(`?cutoffDate=${T}`, 'step 6, before the issue');
  const paper6before = await ledgerTo(T);
  const issue = await call(site, 'POST', '/inventory/stock/issue', { itemId: item.id, warehouseId: warehouse.id, quantity: 1, projectId, activityId: activity.B, costCodeId, occurredAt: '2099-01-01T12:00:00.000Z', reference: `${tag} dated ahead` }, {
    show: (d) => ({ costPosted: d.costPosted, movements: (d.movements || []).map((m) => ({ type: m.type, quantity: m.quantity, value: m.value, occurredAt: m.occurredAt })) }),
  });
  let siteEngineerPath = null;
  if (issue.ok) {
    const paper6 = await ledgerTo(T, { quiet: false });
    const ev6 = await evAt(`?cutoffDate=${T}`, 'step 6, after the issue');
    siteEngineerPath = !check(`AC to ${T} after a site engineer's 1.00 issue to B dated 2099`, paper6.total, ev6.ac);
    say(`   before the issue the EV report gave AC ${money(before6.ac)} (ledger ${money(paper6before.total)}); B's ${money(paper6.perActivity.B)} is now ${siteEngineerPath ? 'gone from AC until 2099' : 'still counted'}`);
  } else say(`   the issue dated ahead was refused (${issue.status} ${issue.error?.code}); this path is closed`);

  // ── result ───────────────────────────────────────────────────────────────
  section('result');
  for (const row of checks) say(`   ${row.ok ? 'ok   ' : 'WRONG'} ${row.name}: paper ${money(row.expected)}, product ${money(row.actual)}`);
  say('   read models, read today, with one posting dated ahead on activity A:');
  for (const row of readModels) say(`     ${row.ok ? 'ok   ' : 'WRONG'} ${row.name}: ${money(row.value)} vs paper ${money(row.expected)} [${row.kind}]`);

  const wrong = checks.filter((row) => !row.ok);
  if (!wrong.length) {
    return verdict(LEAD, 'NOT_REPRODUCED', `AC to the cutoff equalled the ledger's sum to the cutoff at every step (${checks.length} comparisons).`);
  }
  const affected = readModels.filter((row) => row.ok === false).map((row) => row.name.replace(/^GET /, '')).join('; ');
  return verdict(
    LEAD,
    'CONFIRMED',
    `with 6,000.00 on activity A before the cutoff, one later-dated posting made the EV report give AC ${money(ev2.ac)} to ${CUTOFF} where the ledger gives ${money(paper2.total)}` +
      `${minimal ? '' : ' (the whole of A is dropped)'}; a posting dated ahead does the same to today's AC (${money(ev3.ac)} vs ${money(paper3.total)}${future3 ? '' : `, CPI ${ev3.cpi} vs ${paperCpi}, EAC ${money(ev3.eac)} vs ${money(paperEac)}`})` +
      `; voiding it ${afterVoid ? 'restores' : 'does not restore'} AC, recompute ${afterRecompute ? 'restores' : 'does not restore'} it` +
      `${typedRepair === null ? '' : typedRepair ? ' (only a hand-typed actualThroughDate does)' : ' (nor does a hand-typed actualThroughDate)'}` +
      `${lockedOk === false ? `; the locked period stored AC ${money(locked.data.ac)} instead of ${money(paper5.total)}` : ''}` +
      `${siteEngineerPath ? '; a site engineer alone removes an activity\'s cost from AC with one stock issue dated ahead' : ''}. Affected: ${affected || 'EV report'}.`
  );
});
