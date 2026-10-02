'use strict';

/**
 * L36 — a stock return is not bounded by what was issued.
 *
 * The rules: a material issue is actual cost at the weighted average; a
 * return gives back cost that an issue charged. A return of stock that was
 * never issued gives back cost that was never charged: it must be refused.
 *
 * The lead: POST /inventory/stock/return needs only a project (or an
 * activity). It adds stock at the current average and posts a NEGATIVE entry
 * to the cost ledger, so stock value appears from nothing and project cost
 * goes below zero.
 *
 * A new project in company 041; 100 units received at 10.00 (1,000.00 of
 * stock, bought once):
 *   1. return 50 naming the project and a cost code, nothing ever issued
 *        paper: refused; stock 100 / 1,000.00; project cost 0.00
 *   2. return 50 naming an activity that has no cost at all
 *        paper: refused with a 4xx (the lead expects a 500 from a DB CHECK)
 *   3. issue 10 to an activity (100.00), then return 30 from it
 *        paper: refused (only 10 are out); activity cost stays 100.00
 *   4. control: return 4 of the 10 issued — accepted, activity cost 60.00
 *
 * Exit code 0 = the returns of 1-3 are refused with a 4xx and nothing moved;
 * 2 = any of them was accepted, or answered 500.
 */

const { call, must, who, personOf, newProject, projectCostCodes, section, say, dayOffset, eq, listOf, verdict, run } = require('./_finance-lib');

const LEAD = 'L36';
const COMPANY = '041';
const money = (value) => (value === null || value === undefined ? String(value) : Number(value).toFixed(2));

run(LEAD, async () => {
  const pm = who(COMPANY, 'pm');
  const cost = who(COMPANY, 'cost');
  const store = who(COMPANY, 'warehouse');
  const site = who(COMPANY, 'site');
  const tag = `L36-${Date.now().toString(36).toUpperCase()}`;

  section('0. a project of its own: a material budget line, two activities, a store with 100 units at 10.00');
  const { id: projectId, P } = await newProject(COMPANY, 'L36 return without issue', { team: ['cost', 'warehouse', 'site'] });
  const codes = await projectCostCodes(COMPANY, P);
  const costCodeId = codes['02-100'] || Object.values(codes)[0];
  await must(pm, 'POST', `${P}/budget/lines`, { costCodeId, costType: 'material', description: 'L36 material', originalBudget: 50000, status: 'active' }, { show: (d) => ({ id: d.id, costType: d.costType, actual: d.actual }) });
  const activity = {};
  for (const key of ['NEVER', 'ISSUED']) {
    const row = await must(pm, 'POST', `${P}/activities`, { name: `L36 activity ${key}`, activityCode: `L36-${key}`, duration: 10, startDate: dayOffset(-30), endDate: dayOffset(-10), engineerIds: [personOf(COMPANY, 'site').id] }, { show: (d) => ({ id: d.id, activityCode: d.activityCode }) });
    activity[key] = row.id;
  }
  const warehouse = await must(store, 'POST', '/inventory/warehouses', { code: tag, name: `${tag} store`, kind: 'site', projectId }, { show: (d) => ({ id: d.id, code: d.code }) });
  const item = await must(store, 'POST', '/inventory/items', { sku: tag, name: `${tag} blocks`, unit: 'pc', category: 'material', projectId }, { show: (d) => ({ id: d.id, sku: d.sku }) });
  await must(store, 'POST', '/inventory/stock/receive', { itemId: item.id, warehouseId: warehouse.id, quantity: 100, unitCost: 10, reference: `${tag} delivery` }, { show: (d) => ({ movements: (d.movements || [d]).map((m) => ({ type: m.type, quantity: m.quantity, unitCost: m.unitCost, value: m.value })) }) });

  // ── what is read after every step ────────────────────────────────────────
  const state = async (label) => {
    const stock = await must(store, 'GET', `/inventory/items/${item.id}`, undefined, { quiet: true });
    const recon = await must(cost, 'GET', `${P}/cost/reconciliation`, undefined, { quiet: true });
    const register = await must(cost, 'GET', `${P}/budget/lines`, undefined, { quiet: true });
    const summary = await must(cost, 'GET', `${P}/cost/summary`, undefined, { quiet: true });
    const onHand = Number(stock.onHand ?? 0);
    const average = Number(stock.averageCost ?? 0);
    const snapshot = {
      onHand,
      average,
      stockValue: Math.round(onHand * average * 100) / 100,
      ledger: Number(recon.ledger?.total ?? 0),
      bySource: recon.ledger?.bySource ?? {},
      lineActual: Number(register.summary?.totals?.actual ?? 0),
      activityActual: Number(summary.totals?.actual ?? 0),
      balanced: recon.balanced,
    };
    say(`   ${label}: on hand ${onHand} @ ${money(average)} = stock value ${money(snapshot.stockValue)}; ledger ${money(snapshot.ledger)} ${JSON.stringify(snapshot.bySource)}; budget line actual ${money(snapshot.lineActual)}; cost summary actual ${money(snapshot.activityActual)}; reconciliation balanced: ${snapshot.balanced}`);
    return snapshot;
  };
  const showMove = (d) => ({ movements: (d.movements || []).map((m) => ({ type: m.type, quantity: m.quantity, unitCost: m.unitCost, value: m.value, balanceAfter: m.balanceAfter })) });
  const outcomes = [];
  const judge = (name, res, before, after) => {
    const refused = res.status >= 400 && res.status < 500;
    const unmoved = eq(before.stockValue, after.stockValue) && eq(before.ledger, after.ledger) && before.onHand === after.onHand;
    const ok = refused && unmoved;
    outcomes.push({ name, status: res.status, code: res.error?.code ?? null, ok, before, after });
    say(`   ${ok ? 'ok      ' : 'WRONG   '} ${name}: answered ${res.status}${res.error?.code ? ` ${res.error.code}` : ''}; stock value ${money(before.stockValue)} -> ${money(after.stockValue)}; ledger ${money(before.ledger)} -> ${money(after.ledger)}`);
    return ok;
  };

  const s0 = await state('start');

  // ── 1 ────────────────────────────────────────────────────────────────────
  section('1. THE CASE — return 50 to the store naming the project and a cost code; nothing was ever issued');
  const r1 = await call(store, 'POST', '/inventory/stock/return', { itemId: item.id, warehouseId: warehouse.id, quantity: 50, projectId, costCodeId, reference: `${tag} return of nothing` }, { show: showMove });
  const s1 = await state('after');
  judge('return of 50 with no issue (project + cost code)', r1, s0, s1);

  // ── 2 ────────────────────────────────────────────────────────────────────
  section('2. return 50 naming an activity that has no cost');
  const r2 = await call(store, 'POST', '/inventory/stock/return', { itemId: item.id, warehouseId: warehouse.id, quantity: 50, activityId: activity.NEVER, costCodeId, reference: `${tag} return to a clean activity` }, { show: showMove, max: 900 });
  const s2 = await state('after');
  judge('return of 50 with no issue (activity with no cost)', r2, s1, s2);

  // ── 3 ────────────────────────────────────────────────────────────────────
  section('3. issue 10 to an activity (cost 10 x average), then return 30 from it');
  const issued = await must(store, 'POST', '/inventory/stock/issue', { itemId: item.id, warehouseId: warehouse.id, quantity: 10, projectId, activityId: activity.ISSUED, costCodeId, reference: `${tag} issue` }, { show: showMove });
  const issueValue = Number(issued.movements?.[0]?.value ?? 0);
  const s3a = await state('after the issue');
  const r3 = await call(store, 'POST', '/inventory/stock/return', { itemId: item.id, warehouseId: warehouse.id, quantity: 30, activityId: activity.ISSUED, costCodeId, reference: `${tag} return of three times the issue` }, { show: showMove, max: 900 });
  const s3 = await state('after');
  judge('return of 30 where 10 were issued', r3, s3a, s3);

  // ── 4 ────────────────────────────────────────────────────────────────────
  section('4. control — return 4 of the 10 issued');
  const r4 = await call(store, 'POST', '/inventory/stock/return', { itemId: item.id, warehouseId: warehouse.id, quantity: 4, activityId: activity.ISSUED, costCodeId, reference: `${tag} genuine return` }, { show: showMove });
  const s4 = await state('after');
  const controlOk = r4.ok && eq(s4.ledger - s3.ledger, -4 * s3.average);
  say(`   ${controlOk ? 'ok      ' : 'note    '} a genuine return answered ${r4.status}; the ledger moved by ${money(s4.ledger - s3.ledger)} (4 x the average ${money(s3.average)} = ${money(-4 * s3.average)} expected)`);

  // ── who may do it ────────────────────────────────────────────────────────
  section('5. who can post a return: the same request as a site engineer (quantity 1, nothing of theirs issued)');
  const r5 = await call(site, 'POST', '/inventory/stock/return', { itemId: item.id, warehouseId: warehouse.id, quantity: 1, projectId, costCodeId, reference: `${tag} site engineer` }, { show: showMove });
  say(`   a site engineer's return answered ${r5.status}${r5.error?.code ? ` ${r5.error.code}` : ''}`);
  const s5 = await state('end');

  // ── result ───────────────────────────────────────────────────────────────
  section('result');
  say('   bought once: 100 @ 10.00 = 1,000.00. Genuinely issued and kept on the job at the end: 6 units.');
  say(`   stock at the end: ${s5.onHand} @ ${money(s5.average)} = ${money(s5.stockValue)}; project cost on the ledger: ${money(s5.ledger)}; budget line actual ${money(s5.lineActual)}`);
  say(`   stock value + project cost = ${money(s5.stockValue + s5.ledger)} (it can only be 1,000.00: nothing else was bought)`);
  for (const row of outcomes) say(`   ${row.ok ? 'ok   ' : 'WRONG'} ${row.name}: ${row.status}${row.code ? ` ${row.code}` : ''}`);
  void issueValue;
  void listOf;

  const wrong = outcomes.filter((row) => !row.ok);
  if (!wrong.length) {
    return verdict(LEAD, 'NOT_REPRODUCED', 'every return of stock that was never issued was refused with a 4xx and neither the stock nor the ledger moved.');
  }
  const first = outcomes[0];
  const accepted = wrong.filter((row) => row.status >= 200 && row.status < 300).length;
  const crashed = wrong.filter((row) => row.status >= 500).length;
  return verdict(
    LEAD,
    accepted ? 'CONFIRMED' : 'PARTLY_CONFIRMED',
    `${accepted} of ${outcomes.length} returns of never-issued stock were accepted${crashed ? ` and ${crashed} answered 500` : ''}: with nothing issued, a return of 50 answered ${first.status}, stock value went ${money(first.before.stockValue)} -> ${money(first.after.stockValue)} and the project ledger ${money(first.before.ledger)} -> ${money(first.after.ledger)} (budget line actual ${money(first.after.lineActual)}), with the reconciliation balanced: ${first.after.balanced}.`
  );
});
