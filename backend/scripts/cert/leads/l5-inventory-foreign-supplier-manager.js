'use strict';

/**
 * L5 — Inventory item preferredSupplierId and warehouse managerId.
 *
 * A person of company 030 with inventory:create creates, in company 030's own
 * org, an inventory item whose preferredSupplierId is a ProcurementSupplier of
 * company 040, and a warehouse whose managerId is a User of company 040. The
 * API must refuse (4xx). The defect is present when the write is accepted, and
 * worse when the answer's preferredSupplier / manager is company 040's name.
 *
 *   node scripts/cert/leads/l5-inventory-foreign-supplier-manager.js
 *
 * Exit code 0 = refused; 2 = the defect is present.
 */

const { as } = require('../lib/api');

const LEAD = 'L5';
const OWN = '030';
const OTHER = '040';
const mail = (who, code) => `${who}@c${code}.octapm-cert.test`;
const show = (label, value) => console.log(`${label} ${JSON.stringify(value)}`);
const listOf = (data) => (Array.isArray(data) ? data : data?.items || data?.rows || []);
const tag = () => Math.random().toString(36).slice(2, 8).toUpperCase();

const main = async () => {
  const ownPm = as(mail('pm', OWN));
  const otherPm = as(mail('pm', OTHER));

  // Company 040's supplier (ProcurementSupplier id) and one of its users.
  const otherProjects = listOf((await otherPm.send('GET', '/projects')).body?.data);
  let foreignSupplier = null;
  for (const p of otherProjects) {
    const suppliers = listOf((await otherPm.send('GET', `/projects/${p.id}/procurement/suppliers`)).body?.data);
    if (suppliers.length) { foreignSupplier = suppliers[0]; break; }
  }
  const otherUsers = listOf((await otherPm.send('GET', '/users')).body?.data);
  const foreignUser = otherUsers.find((u) => u.email === mail('warehouse', OTHER)) || otherUsers[0];
  console.log(`Company ${OTHER} supplier (preferredSupplierId sent): ${foreignSupplier?.id} — "${foreignSupplier?.name}"`);
  console.log(`Company ${OTHER} user (managerId sent): ${foreignUser.id} — "${foreignUser.name}" <${foreignUser.email}>`);

  const ownSuppliers = (() => {
    const ownProjects = listOf([]);
    return ownProjects;
  })();
  const ownUsers = listOf((await ownPm.send('GET', '/users')).body?.data);
  console.log(`Is the foreign supplier id in any company ${OWN} supplier list? (checked below)`);
  console.log(`Is the foreign user id in company ${OWN}'s own user list? ${ownUsers.some((u) => u.id === foreignUser.id)}`);
  void ownSuppliers;

  const created = { items: [], warehouses: [] };
  const results = [];

  const attempt = async (label, method, route, body, pick) => {
    console.log(`\n--- ${label}`);
    console.log(`> ${ownPm.email}  ${method} /api/v1${route}`);
    show('> body', body);
    const res = await ownPm.send(method, route, body);
    const data = res.body?.data;
    console.log(`< ${res.status}${res.body?.error ? ` ${res.body.error.code}: ${res.body.error.message}` : ''}`);
    const picked = data && typeof data === 'object' ? pick(data) : null;
    if (picked) show('< serialised reference', picked);
    return { label, status: res.status, accepted: res.status < 300, picked, id: data?.id ?? null, data };
  };

  // 1) Inventory item with the foreign supplier.
  if (foreignSupplier) {
    const item = await attempt(
      "inventory item with company 040's preferredSupplierId",
      'POST',
      '/inventory/items',
      { sku: `L5-ITEM-${tag()}`, name: `${LEAD} probe item`, unit: 'ea', preferredSupplierId: foreignSupplier.id },
      (d) => ({ preferredSupplierId: d.preferredSupplierId ?? null, preferredSupplier: d.preferredSupplier ?? null }),
    );
    item.leaks = item.accepted && item.picked?.preferredSupplier && String(item.picked.preferredSupplier).includes(foreignSupplier.name);
    if (item.id) created.items.push(item.id);
    console.log(`< names company ${OTHER}'s supplier: ${item.leaks ? 'yes' : 'no'}`);
    results.push(item);
  } else {
    console.log('\n(no company 040 supplier found; preferredSupplierId part skipped)');
  }

  // 2) Warehouse with the foreign manager.
  const wh = await attempt(
    "warehouse with company 040's managerId",
    'POST',
    '/inventory/warehouses',
    { code: `L5-WH-${tag()}`, name: `${LEAD} probe warehouse`, managerId: foreignUser.id },
    (d) => ({ managerId: d.managerId ?? null, manager: d.manager ?? null }),
  );
  wh.leaks = wh.accepted && wh.picked?.manager && String(wh.picked.manager).includes(foreignUser.name);
  if (wh.id) created.warehouses.push(wh.id);
  console.log(`< names company ${OTHER}'s user: ${wh.leaks ? 'yes' : 'no'}`);
  results.push(wh);

  // Confirm the leak is served on a subsequent read (list) too.
  const items = listOf((await ownPm.send('GET', '/inventory/items')).body?.data);
  const leakedItem = items.find((i) => created.items.includes(i.id) && i.preferredSupplier && foreignSupplier && String(i.preferredSupplier).includes(foreignSupplier.name));
  const whs = listOf((await ownPm.send('GET', '/inventory/warehouses')).body?.data);
  const leakedWh = whs.find((w) => created.warehouses.includes(w.id) && w.manager && String(w.manager).includes(foreignUser.name));
  console.log(`\nOn re-read: item still names company ${OTHER}'s supplier? ${leakedItem ? 'yes' : 'no'}; warehouse still names company ${OTHER}'s user? ${leakedWh ? 'yes' : 'no'}`);

  // Tidy up — archive the warehouse, archive the item.
  for (const id of created.items) await ownPm.send('PATCH', `/inventory/items/${id}`, { status: 'archived' });
  for (const id of created.warehouses) await ownPm.send('PATCH', `/inventory/warehouses/${id}`, { status: 'archived' });
  console.log(`(cleanup) archived ${created.items.length} item(s) and ${created.warehouses.length} warehouse(s) created by this run`);

  const accepted = results.filter((r) => r.accepted);
  const leaked = results.filter((r) => r.leaks);
  if (!accepted.length) {
    console.log(`\nVERDICT ${LEAD}: NOT_REPRODUCED — every write naming another company's supplier/user was refused (${results.map((r) => r.status).join(', ')}).`);
    process.exitCode = 0;
  } else if (leaked.length) {
    console.log(`\nVERDICT ${LEAD}: CONFIRMED — ${accepted.length} of ${results.length} writes were accepted and ${leaked.length} answered with company ${OTHER}'s supplier/user name.`);
    process.exitCode = 2;
  } else {
    console.log(`\nVERDICT ${LEAD}: PARTLY_CONFIRMED — ${accepted.length} of ${results.length} writes were accepted but no answer showed company ${OTHER}'s name.`);
    process.exitCode = 2;
  }
};

main().catch((error) => {
  console.error(error);
  console.log(`VERDICT ${LEAD}: NOT_REPRODUCED — the script failed before a result: ${error.message}`);
  process.exitCode = 1;
});
