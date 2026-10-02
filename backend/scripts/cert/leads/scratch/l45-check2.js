'use strict';
/** L45 independent check, part 2 (scratch): the cross-company question and the list shape. */
const { as } = require('../../lib/api');
const { ATTACKER, VICTIM } = require('../_fib-constants');

const line = (s) => console.log(s);
const findIds = (node, out = []) => {
  if (Array.isArray(node)) node.forEach((n) => findIds(n, out));
  else if (node && typeof node === 'object') {
    if (typeof node.id === 'string' && (node.subject !== undefined || node.question !== undefined)) out.push(node.id);
    else Object.values(node).forEach((n) => findIds(n, out));
  }
  return out;
};

(async () => {
  const P = ATTACKER.project;
  const pm = as(ATTACKER.pm, ATTACKER.orgId);
  const planner = as('planner@c028.octapm-cert.test', ATTACKER.orgId);
  const victimPm = as(VICTIM.pm, VICTIM.orgId);

  const vList = await victimPm.send('GET', `/projects/${VICTIM.project}/rfi`);
  line(`042 PM lists RFIs -> ${vList.status}, data keys=${JSON.stringify(Object.keys(vList.body?.data || {}))}`);
  let vId = findIds(vList.body?.data)[0];
  if (!vId) {
    const made = await victimPm.send('POST', `/projects/${VICTIM.project}/rfi`, { subject: 'L45 checker RFI (042)', question: 'q' });
    line(`042 PM creates an RFI -> ${made.status}`);
    vId = made.body?.data?.id;
  }
  line(`042 RFI id = ${vId}`);

  // 042 gets its own company rfi field + a value on that RFI, so there is something to leak
  let vField = (await victimPm.send('GET', '/company/custom-fields?recordType=rfi')).body?.data?.items?.find((f) => f.key === 'cert_l45_victim');
  if (!vField) {
    const made = await victimPm.send('POST', '/company/custom-fields', { recordType: 'rfi', type: 'text', label: 'Cert L45 victim', key: 'cert_l45_victim' });
    line(`042 PM POST company field -> ${made.status} ${made.body?.error?.code || ''}`);
  }
  const vSecret = `c042-secret-${Date.now()}`;
  const vPut = await victimPm.send('PUT', `/projects/${VICTIM.project}/custom-fields/values/rfi/${vId}`, { values: { cert_l45_victim: vSecret }, partial: true });
  line(`042 PM PUT own value {cert_l45_victim:${vSecret}} -> ${vPut.status} ${vPut.body?.error?.code || ''} ${vPut.body?.error?.message || ''}`);

  const xRead = await planner.send('GET', `/projects/${P}/custom-fields/values/rfi/${vId}`);
  line(`028 planner GET single values of the 042 RFI via P -> ${xRead.status} values=${JSON.stringify(xRead.body?.data?.values)}`);
  const xBulk = await planner.send('GET', `/projects/${P}/custom-fields/values?recordType=rfi&recordIds=${vId}`);
  line(`028 planner GET bulk values of the 042 RFI via P -> ${xBulk.status} items=${JSON.stringify(xBulk.body?.data?.items)}`);
  const xPm = await pm.send('GET', `/projects/${P}/custom-fields/values?recordType=rfi&recordIds=${vId}`);
  line(`028 PM (company admin) GET bulk values of the 042 RFI via P -> ${xPm.status} items=${JSON.stringify(xPm.body?.data?.items)}`);
  const xWrite = await planner.send('PUT', `/projects/${P}/custom-fields/values/rfi/${vId}`, { values: { cert_l45_probe: 'from-028' }, partial: true });
  line(`028 planner PUT {cert_l45_probe:'from-028'} on the 042 RFI via P -> ${xWrite.status}`);
  const xVictimKey = await planner.send('PUT', `/projects/${P}/custom-fields/values/rfi/${vId}`, { values: { cert_l45_victim: 'overwritten-by-028' }, partial: true });
  line(`028 planner PUT 042's own key cert_l45_victim on the 042 RFI via P -> ${xVictimKey.status} ${xVictimKey.body?.error?.code || ''}`);

  const after = await victimPm.send('GET', `/projects/${VICTIM.project}/custom-fields/values/rfi/${vId}`);
  const afterBulk = await victimPm.send('GET', `/projects/${VICTIM.project}/custom-fields/values?recordType=rfi&recordIds=${vId}`);
  line(`042 PM GET own values after -> ${after.status} values=${JSON.stringify(after.body?.data?.values)}; bulk items=${JSON.stringify(afterBulk.body?.data?.items)}`);
  const crossRead = JSON.stringify(xRead.body || '').includes(vSecret) || JSON.stringify(xBulk.body || '').includes(vSecret) || JSON.stringify(xPm.body || '').includes(vSecret);
  const crossWrite = after.body?.data?.values?.cert_l45_victim !== vSecret || JSON.stringify(afterBulk.body || '').includes('from-028');
  line(`cross-company read of 042's value by 028: ${crossRead}; cross-company change visible to 042: ${crossWrite}`);

  // tidy the 028-side junk row that points at a 042 record id
  const tidy = await planner.send('PUT', `/projects/${P}/custom-fields/values/rfi/${vId}`, { values: { cert_l45_probe: null }, partial: true });
  line(`tidy 028-side row -> ${tidy.status}`);
})().catch((e) => {
  console.error('ERROR', e.message);
  process.exitCode = 1;
});
