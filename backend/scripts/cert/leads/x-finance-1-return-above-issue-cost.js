'use strict';

/**
 * X-FINANCE-1 (found while reproducing L36) — a genuine return gives back more cost
 * than the issue charged, because a return is valued at the CURRENT average,
 * not at what the issue cost.
 *
 * A new project in company 041, one stocked item, one activity:
 *   receive 10 @ 10.00                         stock 10 / 100.00
 *   issue 10 to the activity                   activity cost 100.00, stock 0
 *   receive 10 @ 14.00                         stock 10 / 140.00 (average 14.00)
 *   return 5 from the activity                 paper: gives back 5 x 10.00 = 50.00
 *                                                     activity cost 50.00 (5 units still on the job, charged at 10.00)
 *                                                     stock 15 / 190.00
 *   return the other 5                         paper: gives back 50.00; activity cost 0.00; stock 20 / 240.00
 *
 * Bought in all: 100.00 + 140.00 = 240.00. Stock value + project cost must
 * stay 240.00 — and the activity's cost can never be below zero.
 *
 * Exit code 0 = both returns are accepted and the activity's cost is 50.00,
 * then 0.00; 2 = a return gives back more than was charged, or answers 500.
 */

const { call, must, who, personOf, newProject, projectCostCodes, section, say, dayOffset, eq, listOf, verdict, run } = require('./_finance-lib');

const LEAD = 'X-FINANCE-1';
const COMPANY = '041';
const money = (value) => (value === null || value === undefined ? String(value) : Number(value).toFixed(2));

run(LEAD, async () => {
  const pm = who(COMPANY, 'pm');
  const cost = who(COMPANY, 'cost');
  const store = who(COMPANY, 'warehouse');
  const tag = `X1-${Date.now().toString(36).toUpperCase()}`;

  section('0. a project of its own: a material budget line, one activity, a store');
  const { id: projectId, P } = await newProject(COMPANY, 'X1 return above issue cost', { team: ['cost', 'warehouse', 'site'] });
  const codes = await projectCostCodes(COMPANY, P);
  const costCodeId = codes['02-100'] || Object.values(codes)[0];
  await must(pm, 'POST', `${P}/budget/lines`, { costCodeId, costType: 'material', description: 'X1 material', originalBudget: 50000, status: 'active' }, { quiet: true });
  const activity = await must(pm, 'POST', `${P}/activities`, { name: 'X1 activity', activityCode: 'X1-A', duration: 10, startDate: dayOffset(-30), endDate: dayOffset(-10), engineerIds: [personOf(COMPANY, 'site').id] }, { show: (d) => ({ id: d.id, activityCode: d.activityCode }) });
  const warehouse = await must(store, 'POST', '/inventory/warehouses', { code: tag, name: `${tag} store`, kind: 'site', projectId }, { quiet: true });
  const item = await must(store, 'POST', '/inventory/items', { sku: tag, name: `${tag} blocks`, unit: 'pc', category: 'material', projectId }, { quiet: true });

  const showMove = (d) => ({ movements: (d.movements || [d]).map((m) => ({ type: m.type, quantity: m.quantity, unitCost: m.unitCost, value: m.value, balanceAfter: m.balanceAfter })) });
  const state = async (label) => {
    const stock = await must(store, 'GET', `/inventory/items/${item.id}`, undefined, { quiet: true });
    const explain = await must(cost, 'GET', `${P}/cost/reconciliation/explain?activityId=${activity.id}&limit=500`, undefined, { quiet: true });
    const entries = listOf(explain, 'entries');
    const activityCost = Math.round(entries.reduce((sum, e) => sum + Number(e.amount), 0) * 100) / 100;
    const onHand = Number(stock.onHand ?? 0);
    const average = Number(stock.averageCost ?? 0);
    const stockValue = Math.round(onHand * average * 100) / 100;
    say(`   ${label}: stock ${onHand} @ ${money(average)} = ${money(stockValue)}; activity cost ${money(activityCost)}; stock value + activity cost = ${money(stockValue + activityCost)}`);
    return { onHand, average, stockValue, activityCost };
  };
  const base = { itemId: item.id, warehouseId: warehouse.id };

  section('1. receive 10 @ 10.00, issue all 10 to the activity, receive 10 @ 14.00');
  await must(store, 'POST', '/inventory/stock/receive', { ...base, quantity: 10, unitCost: 10 }, { show: showMove });
  await must(store, 'POST', '/inventory/stock/issue', { ...base, quantity: 10, projectId, activityId: activity.id, costCodeId }, { show: showMove });
  await must(store, 'POST', '/inventory/stock/receive', { ...base, quantity: 10, unitCost: 14 }, { show: showMove });
  const s1 = await state('before any return');

  section('2. return 5 of the 10 issued');
  const r1 = await call(store, 'POST', '/inventory/stock/return', { ...base, quantity: 5, activityId: activity.id, costCodeId, reference: `${tag} half back` }, { show: showMove });
  const s2 = await state('after');
  const halfRight = r1.ok && eq(s2.activityCost, 50);
  say(`   ${halfRight ? 'ok      ' : 'WRONG   '} paper: activity cost 50.00 (5 units on the job, charged at 10.00); product: ${money(s2.activityCost)} — the return gave back ${money(s1.activityCost - s2.activityCost)} for 5 units that were charged 50.00`);

  section('3. return the other 5 — everything that was issued has now come back');
  const r2 = await call(store, 'POST', '/inventory/stock/return', { ...base, quantity: 5, activityId: activity.id, costCodeId, reference: `${tag} the rest back` }, { show: showMove, max: 600 });
  const s3 = await state('after');
  const fullRight = r2.ok && eq(s3.activityCost, 0);
  say(`   ${fullRight ? 'ok      ' : 'WRONG   '} paper: accepted, activity cost 0.00, stock 20; product: answered ${r2.status}${r2.error?.code ? ` ${r2.error.code}` : ''}, activity cost ${money(s3.activityCost)}, stock ${s3.onHand}`);

  section('result');
  say('   bought: 10 @ 10.00 + 10 @ 14.00 = 240.00; everything issued was returned, so project cost is 0.00 and stock is 20 units / 240.00');
  say(`   product: stock ${s3.onHand} / ${money(s3.stockValue)}; activity cost ${money(s3.activityCost)}; second return ${r2.status}`);

  if (halfRight && fullRight) return verdict(LEAD, 'NOT_REPRODUCED', 'both returns gave back exactly what the issue had charged.');
  return verdict(
    LEAD,
    'CONFIRMED',
    `a return is valued at the current average (14.00), not at what the issue charged (10.00): returning 5 of 10 issued gave back ${money(s1.activityCost - s2.activityCost)} instead of 50.00 (activity cost ${money(s2.activityCost)}, paper 50.00), and returning the rest answered ${r2.status}${r2.error?.code ? ` ${r2.error.code}` : ''} leaving activity cost ${money(s3.activityCost)} and ${20 - s3.onHand} unit(s) that cannot be booked back.`
  );
});
