'use strict';
/**
 * L45 independent check, part 4 (scratch): would the proposed {id, projectId}
 * check be enough? Same project P, an RFI that is NOT routed to the guest's
 * party: the RFI's own update route applies the party rule; do the
 * custom-field values routes?
 */
const api = require('../../lib/api');
const { ATTACKER } = require('../_fib-constants');

const P = ATTACKER.project;
const SUBJECT = 'L45 internal RFI not routed to party X (cert leads)';
const line = (s) => console.log(s);

(async () => {
  const pm = api.as(ATTACKER.pm, ATTACKER.orgId);
  const guest = api.as('l45-subx@guests.c028.octapm-cert.test');

  const mine = await pm.send('GET', `/projects/${P}/rfi?limit=100`);
  let rfi = (mine.body?.data?.rows || []).find((r) => r.subject === SUBJECT);
  if (!rfi) {
    const made = await pm.send('POST', `/projects/${P}/rfi`, { subject: SUBJECT, question: 'internal only' });
    line(`PM creates an internal RFI in P -> ${made.status}`);
    rfi = made.body?.data;
  }
  line(`RFI ${rfi.ref} ${rfi.id} ownerPartyId=${rfi.ownerPartyId} reviewerPartyId=${rfi.reviewerPartyId} approverPartyId=${rfi.approverPartyId}`);
  const secret = `internal-value-${Date.now()}`;
  const put = await pm.send('PUT', `/projects/${P}/custom-fields/values/rfi/${rfi.id}`, { values: { cert_l45_probe: secret }, partial: true });
  line(`PM PUT value {cert_l45_probe:${secret}} -> ${put.status}`);

  const list = await guest.send('GET', `/projects/${P}/rfi?limit=100`);
  const rows = list.body?.data?.rows || [];
  line(`guest lists RFIs of P -> ${list.status}, ${rows.length} row(s), contains the internal RFI: ${rows.some((r) => r.id === rfi.id)}`);
  const patch = await guest.send('PATCH', `/projects/${P}/rfi/${rfi.id}`, { subject: SUBJECT });
  line(`control: guest PATCH /projects/P/rfi/<id> -> ${patch.status} ${patch.body?.error?.code || ''}`);

  const read = await guest.send('GET', `/projects/${P}/custom-fields/values/rfi/${rfi.id}`);
  line(`guest GET values of the internal RFI -> ${read.status} values=${JSON.stringify(read.body?.data?.values)}`);
  const stamp = `guest-wrote-${Date.now()}`;
  const write = await guest.send('PUT', `/projects/${P}/custom-fields/values/rfi/${rfi.id}`, { values: { cert_l45_probe: stamp }, partial: true });
  const back = await pm.send('GET', `/projects/${P}/custom-fields/values/rfi/${rfi.id}`);
  line(`guest PUT values of the internal RFI -> ${write.status}; PM reads back cert_l45_probe=${JSON.stringify(back.body?.data?.values?.cert_l45_probe)}`);
  line('');
  line(`party rule applied by the RFI update route: ${patch.status === 403 || patch.status === 404}; applied by the custom-field values routes: ${!(read.status === 200 && back.body?.data?.values?.cert_l45_probe === stamp)}`);
})().catch((e) => {
  console.error('ERROR', e.message);
  process.exitCode = 1;
});
